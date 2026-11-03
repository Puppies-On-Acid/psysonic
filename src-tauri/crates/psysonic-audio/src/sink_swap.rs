//! Sink-lifecycle glue for `audio_play`: atomically swap a freshly built sink
//! into `state.current` (handing off the old one to a crossfade tail or a hard
//! stop), and the legacy non-seekable path that holds a sink paused until the
//! download task arms playback. Split out of `play_input.rs` so source
//! selection and source building stay focused on their own concerns.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, State};

use super::engine::{AudioCurrent, AudioEngine};
use super::playback_rate::raw_counter_samples_for_content_position;
use super::preserve_worker::StreamingSeekHandle;
use super::sources::activate_sample_counter_generation;

/// Args for [`spawn_legacy_stream_start_when_armed`].
pub(super) struct LegacyStreamStartWhenArmed {
    pub gen: u64,
    pub gen_arc: Arc<AtomicU64>,
    pub playback_armed: Arc<AtomicBool>,
    pub samples_played: Arc<AtomicU64>,
    pub current: Arc<Mutex<AudioCurrent>>,
    pub app: AppHandle,
    pub duration_secs: f64,
    pub hold_paused: bool,
}

/// Legacy `AudioStreamReader`: keep the sink paused until the download task arms
/// playback, then reset counters and emit `audio:playing` so the UI does not
/// extrapolate ahead of audible output.
pub(super) fn spawn_legacy_stream_start_when_armed(args: LegacyStreamStartWhenArmed) {
    let LegacyStreamStartWhenArmed {
        gen,
        gen_arc,
        playback_armed,
        samples_played,
        current,
        app,
        duration_secs,
        hold_paused,
    } = args;
    tokio::spawn(async move {
        loop {
            if gen_arc.load(Ordering::SeqCst) != gen {
                return;
            }
            if playback_armed.load(Ordering::Relaxed) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        if gen_arc.load(Ordering::SeqCst) != gen {
            return;
        }
        samples_played.store(0, Ordering::Relaxed);
        let sink = current.lock().unwrap().sink.clone();
        if let Some(sink) = sink {
            if hold_paused {
                sink.pause();
                let mut cur = current.lock().unwrap();
                cur.play_started = None;
                if cur.paused_at.is_none() {
                    cur.paused_at = Some(0.0);
                }
                cur.seek_offset = 0.0;
                crate::app_deprintln!(
                    "[stream] legacy track-stream: buffer ready, holding paused (silent prepare)"
                );
            } else {
                {
                    let mut cur = current.lock().unwrap();
                    cur.play_started = Some(Instant::now());
                    cur.paused_at = None;
                    cur.seek_offset = 0.0;
                }
                sink.play();
                app.emit("audio:playing", duration_secs).ok();
                crate::app_deprintln!(
                    "[stream] legacy track-stream: playback started after buffer ready"
                );
            }
        }
    });
}

/// State + decisions audio_play computed before the sink swap.
pub(crate) struct SinkSwapInputs {
    pub(crate) generation: u64,
    pub(crate) sink: Arc<rodio::Player>,
    pub(crate) duration_secs: f64,
    pub(crate) volume: f32,
    pub(crate) gain_linear: f32,
    pub(crate) fadeout_trigger: Arc<AtomicBool>,
    pub(crate) fadeout_samples: Arc<AtomicU64>,
    pub(crate) crossfade_enabled: bool,
    pub(crate) actual_fade_secs: f32,
    /// Track A fade-out length (decoupled from B's `actual_fade_secs` fade-in).
    /// `0` ⇒ don't fade A — it rides its own recorded fade-out (scenario A).
    pub(crate) outgoing_fade_secs: f32,
    pub(crate) start_paused: bool,
    /// Start the committed player while the current-sink mutex is held.
    pub(crate) start_playback: bool,
    /// Re-seed the clock after a successful head/resume seek, before playback.
    pub(crate) start_position_secs: Option<f64>,
    pub(crate) streaming_seek: Option<StreamingSeekHandle>,
}

/// Hand off the outgoing sink to a sample-level fade-out, then stop it after
/// `cleanup_secs`. No-op when `fade_secs <= 0` (immediate stop).
fn handoff_old_sink_fade_out(
    state: &State<'_, AudioEngine>,
    old_sink: Option<Arc<rodio::Player>>,
    old_fadeout_trigger: Option<Arc<AtomicBool>>,
    old_fadeout_samples: Option<Arc<AtomicU64>>,
    fade_secs: f32,
    cleanup_secs: f32,
) {
    let Some(old) = old_sink else {
        return;
    };
    if fade_secs <= 0.0 {
        old.stop();
        return;
    }
    let rate = state.current_sample_rate.load(Ordering::Relaxed);
    let ch = state.current_channels.load(Ordering::Relaxed);
    let fade_total = (fade_secs as f64 * rate as f64 * ch as f64) as u64;

    if let (Some(trigger), Some(samples)) = (old_fadeout_trigger, old_fadeout_samples) {
        samples.store(fade_total.max(1), Ordering::SeqCst);
        trigger.store(true, Ordering::SeqCst);
    }

    *state.fading_out_sink.lock().unwrap() = Some(old);
    let fo_arc = state.fading_out_sink.clone();
    let cleanup_dur = Duration::from_secs_f32(cleanup_secs.max(fade_secs + 0.1));
    tokio::spawn(async move {
        tokio::time::sleep(cleanup_dur).await;
        if let Some(s) = fo_arc.lock().unwrap().take() {
            s.stop();
        }
    });
}

/// Only start the source while its published state is held under `current`.
/// Checking the current sink and pause intent also makes a late duplicate
/// starter harmless after a user pause or sink replacement.
fn start_committed_player(
    current: &AudioCurrent,
    sink: &Arc<rodio::Player>,
    start_playback: bool,
) {
    if start_playback
        && current.paused_at.is_none()
        && current
            .sink
            .as_ref()
            .is_some_and(|active| Arc::ptr_eq(active, sink))
    {
        sink.play();
    }
}

/// Atomically swap the new sink into `state.current`, then handle the old
/// sink: trigger sample-level fade-out (crossfade enabled) or stop it
/// immediately (hard cut). The fade-out is handed off to a small spawned
/// task that drops the old sink ~`actual_fade_secs + 0.5 s` later.
pub(crate) fn swap_in_new_sink(state: &State<'_, AudioEngine>, inputs: SinkSwapInputs) {
    let SinkSwapInputs {
        generation,
        sink,
        duration_secs,
        volume,
        gain_linear,
        fadeout_trigger: new_fadeout_trigger,
        fadeout_samples: new_fadeout_samples,
        crossfade_enabled,
        actual_fade_secs,
        outgoing_fade_secs,
        start_paused,
        start_playback,
        start_position_secs,
        streaming_seek,
    } = inputs;

    let (old_sink, old_fadeout_trigger, old_fadeout_samples) = {
        let mut cur = state.current.lock().unwrap();
        let old = cur.sink.take();
        let old_fo_trigger = cur.fadeout_trigger.take();
        let old_fo_samples = cur.fadeout_samples.take();
        cur.sink = Some(sink.clone());
        cur.duration_secs = duration_secs;
        cur.seek_offset = start_position_secs.unwrap_or(0.0);
        if start_paused {
            sink.pause();
            cur.play_started = None;
            cur.paused_at = Some(cur.seek_offset);
        } else {
            cur.play_started = Some(Instant::now());
            cur.paused_at = None;
        }
        cur.replay_gain_linear = gain_linear;
        cur.base_volume = volume.clamp(0.0, 1.0);
        cur.fadeout_trigger = Some(new_fadeout_trigger);
        cur.fadeout_samples = Some(new_fadeout_samples);
        cur.streaming_seek = streaming_seek;
        let initial_samples = start_position_secs
            .map(|secs| {
                raw_counter_samples_for_content_position(
                    secs,
                    state.current_sample_rate.load(Ordering::Relaxed),
                    state.current_channels.load(Ordering::Relaxed),
                    &state.playback_rate,
                )
            })
            .unwrap_or(0);
        activate_sample_counter_generation(
            &state.current_generation,
            &state.samples_played,
            generation,
            initial_samples,
        );
        // A simultaneous audio_pause waits for `current`, then pauses a
        // running player; it can no longer miss the transition.
        start_committed_player(&cur, &sink, start_playback);
        (old, old_fo_trigger, old_fo_samples)
    };

    if crossfade_enabled {
        if outgoing_fade_secs > 0.0 {
            // Scenario A (`outgoing_fade_secs == 0`): A keeps full engine gain;
            // still keep the old sink alive until B's fade-in window elapses.
            handoff_old_sink_fade_out(
                state,
                old_sink,
                old_fadeout_trigger,
                old_fadeout_samples,
                outgoing_fade_secs,
                actual_fade_secs.max(outgoing_fade_secs) + 0.5,
            );
        } else if let Some(old) = old_sink {
            // Prep already volume-ducked A; scenario-A keeps sample gain at 1.0
            // so clamp the handoff sink or A blasts over B's fade-in.
            if state.interrupt_outgoing_duck_active.load(Ordering::Relaxed) {
                old.set_volume(0.0);
            }
            *state.fading_out_sink.lock().unwrap() = Some(old);
            let fo_arc = state.fading_out_sink.clone();
            let cleanup_dur = Duration::from_secs_f32(actual_fade_secs + 0.5);
            tokio::spawn(async move {
                tokio::time::sleep(cleanup_dur).await;
                if let Some(s) = fo_arc.lock().unwrap().take() {
                    s.stop();
                }
            });
        }
    } else if let Some(old) = old_sink {
        old.stop();
    }
    state
        .interrupt_outgoing_duck_active
        .store(false, Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::num::{NonZeroU16, NonZeroU32};

    fn test_current(sink: Arc<rodio::Player>) -> Mutex<AudioCurrent> {
        Mutex::new(AudioCurrent {
            sink: Some(sink),
            duration_secs: 30.0,
            seek_offset: 0.0,
            play_started: None,
            paused_at: None,
            replay_gain_linear: 1.0,
            base_volume: 0.8,
            fadeout_trigger: None,
            fadeout_samples: None,
            streaming_seek: None,
        })
    }

    #[test]
    fn committed_sink_start_cannot_undo_user_pause() {
        // Rodio's software mixer needs no output device for this transport test.
        let (mixer, _output) = rodio::mixer::mixer(
            NonZeroU16::new(2).unwrap(),
            NonZeroU32::new(48_000).unwrap(),
        );
        let sink = Arc::new(rodio::Player::connect_new(&mixer));
        sink.pause();
        let current = test_current(sink.clone());

        // The actual swap starts the source while holding this same mutex.
        {
            let cur = current.lock().unwrap();
            start_committed_player(&cur, &sink, true);
        }
        assert!(!sink.is_paused());

        // The pause command runs next; no delayed start can override it.
        {
            let mut cur = current.lock().unwrap();
            sink.pause();
            cur.play_started = None;
            cur.paused_at = Some(0.0);
            start_committed_player(&cur, &sink, true);
        }
        assert!(sink.is_paused());
    }

    #[test]
    fn deferred_and_silent_commits_do_not_start_the_sink() {
        let (mixer, _output) = rodio::mixer::mixer(
            NonZeroU16::new(2).unwrap(),
            NonZeroU32::new(48_000).unwrap(),
        );
        let sink = Arc::new(rodio::Player::connect_new(&mixer));
        sink.pause();
        let current = test_current(sink.clone());
        let cur = current.lock().unwrap();
        start_committed_player(&cur, &sink, false);
        assert!(sink.is_paused());
    }
}
