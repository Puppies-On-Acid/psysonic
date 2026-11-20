//! Standalone bounded PCM extraction for the Spectral AutoDJ experiment.
//!
//! Accepts *already available* complete audio bytes. Does not fetch audio,
//! call Tauri, write cache entries or run on the realtime audio thread.
//! All failures are neutral fallbacks for the caller.

use symphonia::core::formats::{SeekMode, SeekTo};
use symphonia::core::units::Time;

use super::decoder::{open_decode_session, DecodeSession};
use crate::spectral_autodj::Boundary;

const MAX_SOURCE_BYTES: usize = 64 * 1024 * 1024;
const MAX_WINDOW_SECONDS: f64 = 6.0;
const MAX_PACKETS: usize = 4_096;
const MIN_RATE: u32 = 8_000;
const MAX_RATE: u32 = 192_000;

pub(crate) struct SpectralPcmWindow {
    pub(crate) pcm: Vec<f32>,
    pub(crate) sample_rate: u32,
    pub(crate) channels: u16,
}

/// Extract a bounded, interleaved window while preserving every channel.
///
/// The supplied bytes must already be available and associated by the caller
/// with a trusted content revision. We do not fall back to a full-track decode
/// when an outro seek or timeline lookup is unavailable. The cancellation
/// guard is checked before setup, once per packet, and before returning.
///
/// The window is limited to (0, 6] seconds; missing/inaccurate codec duration,
/// unsupported sample layout, short decode and corruption all fail closed.
/// The caller may take a spectrogram only after revalidating its source token.
pub(crate) fn decode_spectral_pcm_window<F>(
    bytes: &[u8],
    boundary: Boundary,
    window_seconds: f64,
    mut is_current: F,
) -> Option<SpectralPcmWindow>
where
    F: FnMut() -> bool,
{
    if !is_current()
        || bytes.is_empty()
        || bytes.len() > MAX_SOURCE_BYTES
        || !window_seconds.is_finite()
        || !(0.1..=MAX_WINDOW_SECONDS).contains(&window_seconds)
    {
        return None;
    }

    // The existing session makes one bounded copy of the *encoded* bytes.
    // This path is offline and must be called only with already-owned media.
    let DecodeSession {
        mut format,
        mut decoder,
        track_id,
        timeline_hint,
    } = open_decode_session(bytes, None).ok()?;

    let track = format.tracks().iter().find(|t| t.id == track_id)?;
    let params = track.codec_params.as_ref()?.audio()?;
    let sample_rate = params.sample_rate?;
    let channels = params.channels.as_ref()?.count();
    if !(MIN_RATE..=MAX_RATE).contains(&sample_rate) || !(1..=8).contains(&channels) {
        return None;
    }

    let wanted_frames = (window_seconds * sample_rate as f64).ceil() as usize;
    let total_frames = timeline_hint.and_then(|frames| usize::try_from(frames).ok());
    let target_frames = wanted_frames.min(total_frames.unwrap_or(wanted_frames));
    if target_frames == 0 {
        return None;
    }

    if boundary == Boundary::Outro {
        // A reliable seek coordinate is mandatory. Never replay a long track
        // from byte zero just to locate a late transition window.
        let total = total_frames?;
        if total == 0 {
            return None;
        }
        let start = total.saturating_sub(target_frames);
        if start > 0 {
            let time = Time::try_from_secs_f64(start as f64 / sample_rate as f64)?;
            format
                .seek(
                    SeekMode::Accurate,
                    SeekTo::Time {
                        time,
                        track_id: Some(track_id),
                    },
                )
                .ok()?;
        }
    }

    let max_samples = target_frames.checked_mul(channels)?;
    let mut pcm = Vec::with_capacity(max_samples);
    let mut packet_pcm = Vec::<f32>::new();
    let mut decoded_frames = 0usize;

    for _ in 0..MAX_PACKETS {
        if !is_current() {
            return None;
        }
        let packet = match format.next_packet() {
            Ok(Some(packet)) => packet,
            Ok(None) => break,
            Err(_) => return None,
        };
        if packet.track_id != track_id {
            continue;
        }
        // A failed packet is not a reason to silently analyze a neighboring
        // region. In the experiment, missing analysis simply disables EQ.
        let decoded = decoder.decode(&packet).ok()?;
        if decoded.spec().rate() != sample_rate || decoded.spec().channels().count() != channels {
            return None;
        }
        decoded.copy_to_vec_interleaved(&mut packet_pcm);
        if !packet_pcm.len().is_multiple_of(channels) {
            return None;
        }
        let available_frames = packet_pcm.len() / channels;
        let take_frames = available_frames.min(target_frames - decoded_frames);
        let take_samples = take_frames * channels;
        if packet_pcm[..take_samples]
            .iter()
            .any(|sample| !sample.is_finite() || sample.abs() > 8.0)
        {
            return None;
        }
        pcm.extend_from_slice(&packet_pcm[..take_samples]);
        decoded_frames += take_frames;
        if decoded_frames == target_frames {
            break;
        }
    }

    if !is_current() || decoded_frames != target_frames {
        // Wrong duration/short download/truncated stream/failed seeking:
        // never create a partial outro spectrum.
        return None;
    }

    Some(SpectralPcmWindow {
        pcm,
        sample_rate,
        channels: channels as u16,
    })
}
