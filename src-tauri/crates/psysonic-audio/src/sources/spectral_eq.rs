//! Per-source, neutral-by-default three-band EQ for offline A/B trials.
//!
//! Separate from the user EQ and the existing faders. No heap operations,
//! mutexes, or coefficient design while the realtime source is being pulled.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

use rodio::Source;

const CHANNEL_CAP: usize = 8;
const MAX_ENVELOPE_SECS: f64 = 30.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct ThreeBandEnvelope {
    pub start_db: [f32; 3],
    pub duration: Duration,
}

impl ThreeBandEnvelope {
    pub(crate) fn new(start_db: [f32; 3], duration: Duration) -> Option<Self> {
        if duration.is_zero()
            || duration.as_secs_f64() > MAX_ENVELOPE_SECS
            || !start_db
                .iter()
                .all(|v| v.is_finite() && (-4.0..=0.0).contains(v))
        {
            return None;
        }
        Some(Self { start_db, duration })
    }
}

#[derive(Clone, Copy, Default)]
struct ChannelState {
    low1: f32,
    low2: f32,
    wide1: f32,
    wide2: f32,
}

impl ChannelState {
    fn split(&mut self, x: f32, low_alpha: f32, wide_alpha: f32) -> [f32; 3] {
        self.low1 += low_alpha * (x - self.low1);
        self.low2 += low_alpha * (self.low1 - self.low2);
        self.wide1 += wide_alpha * (x - self.wide1);
        self.wide2 += wide_alpha * (self.wide1 - self.wide2);
        let low = self.low2;
        let mid = self.wide2 - low;
        let high = x - self.wide2;
        [low, mid, high]
    }
}

/// A complementary crossover pair: at unity gain, all bands sum back to the
/// original sample, without stereo folding or a change in the playback clock.
pub(crate) struct ThreeBandEq {
    active: bool,
    channels: usize,
    channel_index: usize,
    frame_index: u64,
    envelope_frames: u64,
    low_alpha: f32,
    wide_alpha: f32,
    initial_linear: [f32; 3],
    current_linear: [f32; 3],
    state: [ChannelState; CHANNEL_CAP],
}

impl ThreeBandEq {
    pub(crate) fn new(rate: u32, channels: u16, envelope: Option<ThreeBandEnvelope>) -> Self {
        let valid =
            (8_000..=192_000).contains(&rate) && (1..=CHANNEL_CAP as u16).contains(&channels);
        let active = valid && envelope.is_some_and(|p| p.start_db != [0.0; 3]);
        let initial_linear =
            envelope.map_or([1.0; 3], |p| p.start_db.map(|db| 10_f32.powf(db / 20.0)));
        let seconds = envelope.map_or(0.0, |p| p.duration.as_secs_f64());
        let frames = (seconds * f64::from(rate)).round().max(1.0) as u64;
        let sample_rate = rate.max(1) as f32;
        Self {
            active,
            channels: usize::from(channels.max(1)),
            channel_index: 0,
            frame_index: 0,
            envelope_frames: frames,
            low_alpha: 1.0 - (-std::f32::consts::TAU * 180.0 / sample_rate).exp(),
            wide_alpha: 1.0 - (-std::f32::consts::TAU * 3000.0 / sample_rate).exp(),
            initial_linear,
            current_linear: initial_linear,
            state: [ChannelState::default(); CHANNEL_CAP],
        }
    }

    pub(crate) fn process(&mut self, sample: f32) -> f32 {
        if !self.active {
            return sample;
        }
        if self.channel_index == 0 {
            let progress =
                (self.frame_index as f64 / self.envelope_frames as f64).clamp(0.0, 1.0) as f32;
            let x = ((progress - 0.1) / 0.7).clamp(0.0, 1.0);
            let recovery = x * x * (3.0 - 2.0 * x);
            for band in 0..3 {
                self.current_linear[band] =
                    self.initial_linear[band] + (1.0 - self.initial_linear[band]) * recovery;
            }
        }
        let channel = self.channel_index;
        let parts = self.state[channel].split(sample, self.low_alpha, self.wide_alpha);
        let result = parts[0] * self.current_linear[0]
            + parts[1] * self.current_linear[1]
            + parts[2] * self.current_linear[2];

        self.channel_index += 1;
        if self.channel_index == self.channels {
            self.channel_index = 0;
            self.frame_index = self.frame_index.saturating_add(1);
        }
        if result.is_finite() {
            result
        } else {
            sample
        }
    }

    pub(crate) fn reset(&mut self) {
        self.state.fill(ChannelState::default());
        self.channel_index = 0;
        self.frame_index = 0;
        self.current_linear = self.initial_linear;
    }
}

/// A specific source receives a one-shot control before it enters the mixer.
#[derive(Clone)]
pub(crate) struct SpectralEqHandle {
    gain_bits: Arc<[AtomicU32; 3]>,
    armed: Arc<AtomicBool>,
}

impl SpectralEqHandle {
    pub(crate) fn arm(&self, start_db: [f32; 3]) -> bool {
        if !start_db
            .iter()
            .all(|db| db.is_finite() && (-4.0..=0.0).contains(db))
            || self.armed.load(Ordering::Acquire)
        {
            return false;
        }
        for (item, db) in self.gain_bits.iter().zip(start_db) {
            item.store(db.to_bits(), Ordering::Relaxed);
        }
        self.armed.store(true, Ordering::Release);
        true
    }
}

/// Source wrapper remains bit-identical to ordinary audio when unarmed.
pub(crate) struct SpectralEqSource<S: Source<Item = f32>> {
    inner: S,
    handle: SpectralEqHandle,
    fade: Duration,
    dsp: ThreeBandEq,
    initialized: bool,
}

impl<S: Source<Item = f32>> SpectralEqSource<S> {
    pub(crate) fn new(inner: S, fade: Duration) -> (Self, SpectralEqHandle) {
        let control = SpectralEqHandle {
            gain_bits: Arc::new(std::array::from_fn(|_| AtomicU32::new(0.0_f32.to_bits()))),
            armed: Arc::new(AtomicBool::new(false)),
        };
        let dsp = ThreeBandEq::new(inner.sample_rate().get(), inner.channels().get(), None);
        (
            Self {
                inner,
                handle: control.clone(),
                fade,
                dsp,
                initialized: false,
            },
            control,
        )
    }

    fn initialize(&mut self) {
        if self.initialized {
            return;
        }
        self.initialized = true;
        if self.handle.armed.load(Ordering::Acquire) {
            let db = std::array::from_fn(|i| {
                f32::from_bits(self.handle.gain_bits[i].load(Ordering::Relaxed))
            });
            let plan = ThreeBandEnvelope::new(db, self.fade);
            self.dsp = ThreeBandEq::new(
                self.inner.sample_rate().get(),
                self.inner.channels().get(),
                plan,
            );
        }
    }
}

impl<S: Source<Item = f32>> Iterator for SpectralEqSource<S> {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        let sample = self.inner.next()?;
        self.initialize();
        Some(self.dsp.process(sample))
    }
}

impl<S: Source<Item = f32>> Source for SpectralEqSource<S> {
    fn current_span_len(&self) -> Option<usize> {
        self.inner.current_span_len()
    }
    fn channels(&self) -> rodio::ChannelCount {
        self.inner.channels()
    }
    fn sample_rate(&self) -> rodio::SampleRate {
        self.inner.sample_rate()
    }
    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }
    fn try_seek(&mut self, pos: Duration) -> Result<(), rodio::source::SeekError> {
        self.inner.try_seek(pos)?;
        if self.initialized {
            // A live user seek ends the scheduled EQ handoff rather than
            // replaying bass attenuation from the new seek position. A source
            // prepared with B-head trim before its FIRST pull keeps the trial
            // armed, and starts its envelope when actual playback begins.
            self.dsp = ThreeBandEq::new(
                self.inner.sample_rate().get(),
                self.inner.channels().get(),
                None,
            );
        } else {
            self.dsp.reset();
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine_rms(rate: u32, freq: f32, plan: Option<ThreeBandEnvelope>) -> f32 {
        let mut filter = ThreeBandEq::new(rate, 2, plan);
        let frames = rate / 4;
        let mut energy = 0.0_f64;
        let mut count = 0_u64;
        for i in 0..frames {
            let sample = (std::f32::consts::TAU * freq * i as f32 / rate as f32).sin() * 0.5;
            for _ in 0..2 {
                let output = filter.process(sample);
                if i > rate / 50 {
                    energy += f64::from(output * output);
                    count += 1;
                }
            }
        }
        (energy / count as f64).sqrt() as f32
    }

    #[test]
    fn neutral_is_bit_identical_for_mono_stereo_and_multichannel() {
        for channels in [1, 2, 6, 8, 12] {
            let mut dsp = ThreeBandEq::new(48_000, channels, None);
            for i in 0..10_000 {
                let x = ((i % 199) as f32 - 100.0) / 256.0;
                assert_eq!(dsp.process(x).to_bits(), x.to_bits());
            }
        }
    }

    #[test]
    fn bass_attenuation_keeps_treble_near_unity() {
        let plan = ThreeBandEnvelope::new([-4.0, 0.0, 0.0], Duration::from_secs(5));
        let low_ratio = sine_rms(48_000, 45.0, plan) / sine_rms(48_000, 45.0, None);
        let high_ratio = sine_rms(48_000, 6_000.0, plan) / sine_rms(48_000, 6_000.0, None);
        assert!((0.55..0.90).contains(&low_ratio), "bass ratio {low_ratio}");
        assert!(
            (0.92..1.08).contains(&high_ratio),
            "treble ratio {high_ratio}"
        );
    }

    #[test]
    fn antiphase_stereo_stays_independent() {
        let mut dsp = ThreeBandEq::new(
            48_000,
            2,
            ThreeBandEnvelope::new([-4.0, 0.0, 0.0], Duration::from_secs(4)),
        );
        for i in 0..15_000 {
            let x = (std::f32::consts::TAU * 60.0 * i as f32 / 48_000.0).sin() * 0.5;
            let left = dsp.process(x);
            let right = dsp.process(-x);
            assert!((left + right).abs() < 1e-4);
        }
    }

    #[test]
    fn recovery_and_seek_reset_are_deterministic() {
        let mut dsp = ThreeBandEq::new(
            48_000,
            1,
            ThreeBandEnvelope::new([-4.0, 0.0, 0.0], Duration::from_millis(100)),
        );
        for idx in 0..8_000 {
            let x = (std::f32::consts::TAU * 50.0 * idx as f32 / 48_000.0).sin() * 0.5;
            let y = dsp.process(x);
            if idx > 6_000 {
                assert!((y - x).abs() < 0.0001);
            }
        }
        dsp.reset();
        assert_eq!(dsp.frame_index, 0);
        assert_eq!(dsp.current_linear, dsp.initial_linear);
    }

    #[test]
    fn invalid_or_boosted_plans_fail_closed() {
        for gains in [[1.0, 0.0, 0.0], [-5.0, 0.0, 0.0], [f32::NAN, 0.0, 0.0]] {
            assert!(ThreeBandEnvelope::new(gains, Duration::from_secs(5)).is_none());
        }
        assert!(ThreeBandEnvelope::new([-4.0, 0.0, 0.0], Duration::ZERO).is_none());
    }

    #[test]
    fn live_rodio_adapter_is_independent_and_neutral_until_armed() {
        let rate = std::num::NonZeroU32::new(48_000).unwrap();
        let channels = std::num::NonZeroU16::new(2).unwrap();
        let data = (0..96_000)
            .map(|i| (std::f32::consts::TAU * 55.0 * i as f32 / 96_000.0).sin() * 0.4)
            .collect::<Vec<_>>();
        let neutral = rodio::buffer::SamplesBuffer::new(channels, rate, data.clone());
        let (source, neutral_handle) = SpectralEqSource::new(neutral, Duration::from_secs(3));
        assert!(!neutral_handle.armed.load(Ordering::Relaxed));
        assert_eq!(source.collect::<Vec<_>>(), data);

        let filtered = rodio::buffer::SamplesBuffer::new(channels, rate, data.clone());
        let (source, filtered_handle) = SpectralEqSource::new(filtered, Duration::from_secs(3));
        assert!(filtered_handle.arm([-4.0, 0.0, 0.0]));
        assert!(!filtered_handle.arm([-4.0, 0.0, 0.0]));
        let output = source.collect::<Vec<_>>();
        assert_eq!(output.len(), data.len());
        assert!(output
            .iter()
            .zip(data.iter())
            .any(|(a, b)| (a - b).abs() > 0.01));
        assert!(output.iter().all(|v| v.is_finite()));
    }

    #[test]
    fn live_seek_disables_only_the_active_source_eq() {
        let rate = std::num::NonZeroU32::new(48_000).unwrap();
        let channels = std::num::NonZeroU16::new(2).unwrap();
        let pcm = vec![0.4; 96_000];
        let source = rodio::buffer::SamplesBuffer::new(channels, rate, pcm);
        let (mut spectral, handle) = SpectralEqSource::new(source, Duration::from_secs(3));
        assert!(handle.arm([-4.0, 0.0, 0.0]));
        assert!(spectral.next().is_some());
        assert!(spectral.dsp.active);
        assert!(spectral.try_seek(Duration::from_millis(50)).is_ok());
        assert!(!spectral.dsp.active);
    }

    #[test]
    fn prestart_b_head_seek_preserves_pending_single_deck_arm() {
        let rate = std::num::NonZeroU32::new(48_000).unwrap();
        let channels = std::num::NonZeroU16::new(2).unwrap();
        let pcm = vec![0.3; 96_000];
        let source = rodio::buffer::SamplesBuffer::new(channels, rate, pcm);
        let (mut spectral, handle) = SpectralEqSource::new(source, Duration::from_secs(3));
        assert!(handle.arm([-4.0, 0.0, 0.0]));
        assert!(spectral.try_seek(Duration::from_millis(50)).is_ok());
        assert!(!spectral.initialized);
        assert!(spectral.next().is_some());
        assert!(spectral.dsp.active);
    }
}
