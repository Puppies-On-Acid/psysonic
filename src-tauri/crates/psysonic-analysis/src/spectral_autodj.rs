//! Experimental offline frequency analysis for Spectral AutoDJ.
//!
//! Accepts decoded interleaved PCM; never fetches streams or modifies playback.
//! Consumers must run this on a worker, not on the realtime audio thread.

use std::f64::consts::PI;

const LOW_MID_HZ: f64 = 180.0;
const MID_HIGH_HZ: f64 = 3_000.0;
const BOUNDARY_SECONDS: usize = 6;
const MAX_WINDOWS: usize = 8;
const MIN_FFT_SIZE: usize = 512;
const MAX_FFT_SIZE: usize = 8_192;
const MIN_SAMPLE_RATE: u32 = 8_000;
const MAX_SAMPLE_RATE: u32 = 192_000;
const SILENCE_POWER_FLOOR: f64 = 1.0e-8;

/// Which end of the decoded PCM should be considered for the transition.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Boundary {
    Intro,
    Outro,
}

/// Linear RMS amplitudes in disjoint bands: below 180 Hz, 180-2999 Hz,
/// and at least 3000 Hz. These are NOT percentiles or 0..1 percentages.
/// Squared fields sum to the window-corrected mean-square signal level.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SpectralBandRms {
    pub low: f32,
    pub mid: f32,
    pub high: f32,
}

/// Analyzes up to six seconds at one end of already-decoded audio.
/// At most eight Hann-windowed, 8192-point FFTs per channel are evaluated.
/// Channels are analyzed separately and their powers averaged, avoiding
/// phase cancellation in stereo material.
///
/// Returns None for silence, invalid rates/channels, malformed, too-short,
/// non-finite or clearly out-of-range samples (neutral AutoDJ fallback).
/// There is no storage, decoding, network, Tauri IPC or playback integration.
pub fn analyze_boundary_pcm(
    pcm: &[f32],
    sample_rate: u32,
    channels: u16,
    boundary: Boundary,
) -> Option<SpectralBandRms> {
    if !(MIN_SAMPLE_RATE..=MAX_SAMPLE_RATE).contains(&sample_rate) || !(1..=8).contains(&channels) {
        return None;
    }
    let channel_count = channels as usize;
    if !pcm.len().is_multiple_of(channel_count) {
        return None;
    }
    let frames = pcm.len() / channel_count;
    let fft_size = ((sample_rate as usize) / 25)
        .next_power_of_two()
        .clamp(MIN_FFT_SIZE, MAX_FFT_SIZE);
    if frames < fft_size {
        return None;
    }
    let region_frames = frames.min(sample_rate as usize * BOUNDARY_SECONDS);
    let region_start = match boundary {
        Boundary::Intro => 0,
        Boundary::Outro => frames - region_frames,
    };
    let window_count = (region_frames / fft_size).clamp(1, MAX_WINDOWS);
    let last_start = region_frames - fft_size;

    let mut hann = Vec::with_capacity(fft_size);
    let mut window_norm = 0.0;
    for n in 0..fft_size {
        let phase = 2.0 * PI * n as f64 / (fft_size - 1) as f64;
        let weight = 0.5 * (1.0 - phase.cos());
        hann.push(weight);
        window_norm += weight * weight;
    }

    let mut re = vec![0.0f64; fft_size];
    let mut im = vec![0.0f64; fft_size];
    let mut energy = [0.0f64; 3];

    for window_index in 0..window_count {
        let offset = if window_count == 1 {
            last_start / 2
        } else {
            last_start * window_index / (window_count - 1)
        };
        let start_frame = region_start + offset;
        for channel in 0..channel_count {
            im.fill(0.0);
            for (i, &weight) in hann.iter().enumerate() {
                let sample = pcm[(start_frame + i) * channel_count + channel];
                if !sample.is_finite() || sample.abs() > 8.0 {
                    return None;
                }
                re[i] = sample as f64 * weight;
            }
            fft_in_place(&mut re, &mut im);
            for k in 0..=fft_size / 2 {
                let frequency = k as f64 * sample_rate as f64 / fft_size as f64;
                let band = if frequency < LOW_MID_HZ {
                    0
                } else if frequency < MID_HIGH_HZ {
                    1
                } else {
                    2
                };
                // Negative-frequency partners double interior real-FFT bins,
                // but not DC or the Nyquist bin.
                let multiplier = if k == 0 || k == fft_size / 2 {
                    1.0
                } else {
                    2.0
                };
                energy[band] += (re[k] * re[k] + im[k] * im[k]) * multiplier;
            }
        }
    }
    // Parseval's theorem, corrected for the Hann window's squared energy.
    let scale = 1.0 / (fft_size as f64 * window_norm * channel_count as f64 * window_count as f64);
    let powers = energy.map(|value| value * scale);
    if powers
        .iter()
        .any(|power| !power.is_finite() || *power < 0.0)
        || powers.iter().sum::<f64>() < SILENCE_POWER_FLOOR
    {
        return None;
    }
    Some(SpectralBandRms {
        low: powers[0].sqrt() as f32,
        mid: powers[1].sqrt() as f32,
        high: powers[2].sqrt() as f32,
    })
}

/// Scope for one ephemeral, already-verified audio representation. The caller
/// must bind these fields to its current trusted source; this struct does not
/// authenticate media bytes or create a cache entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpectralSourceToken {
    pub server_scope: String,
    pub library_scope: String,
    pub track_id: String,
    pub content_revision: String,
    pub generation: u64,
}

impl SpectralSourceToken {
    fn usable(&self) -> bool {
        self.generation > 0
            && !self.server_scope.trim().is_empty()
            && !self.library_scope.trim().is_empty()
            && !self.track_id.trim().is_empty()
            && !self.content_revision.trim().is_empty()
    }
}

/// The window is ephemeral and bounded; no settings, cache or playback state.
#[derive(Debug, Clone)]
pub struct SpectralBoundaryJob {
    pub source: SpectralSourceToken,
    pub boundary: Boundary,
    pub window_seconds: f64,
}

/// Offline spectral measurement of previously acquired, verified audio bytes.
/// The caller supplies a source-identity lookup; stale generations, different
/// servers/libraries, changed content revisions and cancellation all return
/// None. Source identity is rechecked per decoded packet and after the FFT.
///
/// Only a later worker integration may call this away from the audio thread.
/// A live consumer must *also* recheck the token at the final handoff to avoid
/// applying a result after a newer playback generation has superseded it.
pub fn analyze_verified_boundary_bytes<F>(
    bytes: &[u8],
    job: &SpectralBoundaryJob,
    mut current_source: F,
) -> Option<SpectralBandRms>
where
    F: FnMut() -> Option<SpectralSourceToken>,
{
    if !job.source.usable() {
        return None;
    }
    let mut current_matches = || current_source().as_ref() == Some(&job.source);
    if !current_matches() {
        return None;
    }
    let window = crate::analysis_cache::decode_spectral_pcm_window(
        bytes,
        job.boundary,
        job.window_seconds,
        &mut current_matches,
    )?;
    if !current_matches() {
        return None;
    }
    // The PCM is already cut to the requested boundary; take its own head.
    let bands = analyze_boundary_pcm(
        &window.pcm,
        window.sample_rate,
        window.channels,
        Boundary::Intro,
    )?;
    if !current_matches() {
        return None;
    }
    Some(bands)
}

/// In-place radix-2 FFT; this is offline bounded work, never a rodio/CPAL hook.
fn fft_in_place(re: &mut [f64], im: &mut [f64]) {
    let n = re.len();
    debug_assert!(n.is_power_of_two() && im.len() == n);

    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }

    let mut len = 2;
    while len <= n {
        let angle = -2.0 * PI / len as f64;
        let (base_sin, base_cos) = angle.sin_cos();
        for start in (0..n).step_by(len) {
            let (mut w_re, mut w_im) = (1.0, 0.0);
            for i in 0..len / 2 {
                let left = start + i;
                let right = left + len / 2;
                let t_re = w_re * re[right] - w_im * im[right];
                let t_im = w_re * im[right] + w_im * re[right];
                let u_re = re[left];
                let u_im = im[left];
                re[left] = u_re + t_re;
                im[left] = u_im + t_im;
                re[right] = u_re - t_re;
                im[right] = u_im - t_im;
                let next_re = w_re * base_cos - w_im * base_sin;
                w_im = w_re * base_sin + w_im * base_cos;
                w_re = next_re;
            }
        }
        len *= 2;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(sample_rate: u32, frequency: f64, amplitude: f64, seconds: f64) -> Vec<f32> {
        let count = (sample_rate as f64 * seconds) as usize;
        (0..count)
            .map(|i| {
                (amplitude * (2.0 * PI * frequency * i as f64 / sample_rate as f64).sin()) as f32
            })
            .collect()
    }

    fn analyze_mono(data: &[f32], sample_rate: u32, side: Boundary) -> SpectralBandRms {
        analyze_boundary_pcm(data, sample_rate, 1, side).expect("usable PCM")
    }

    #[test]
    fn tones_land_in_independent_low_mid_high_bands_at_common_and_hi_res_rates() {
        for sample_rate in [44_100, 48_000, 88_200, 96_000, 192_000] {
            for (frequency, band) in [(70.0, 0), (900.0, 1), (8_000.0, 2)] {
                let pcm = sine(sample_rate, frequency, 0.5, 0.5);
                let e = analyze_mono(&pcm, sample_rate, Boundary::Intro);
                let amplitudes = [e.low, e.mid, e.high];
                assert!(
                    amplitudes[band] > 0.32,
                    "{sample_rate} Hz, {frequency} Hz, {e:?}"
                );
                for (idx, other) in amplitudes.into_iter().enumerate() {
                    if idx != band {
                        assert!(
                            other < 0.05,
                            "unexpected leakage: {sample_rate}, {frequency}, {e:?}"
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn rms_energy_is_physical_not_a_normalized_spectrum_percentage() {
        let pcm = sine(48_000, 700.0, 0.5, 0.5);
        let e = analyze_mono(&pcm, 48_000, Boundary::Intro);
        let total_rms = (e.low * e.low + e.mid * e.mid + e.high * e.high).sqrt();
        assert!(
            (total_rms - 0.5_f32 / 2.0_f32.sqrt()).abs() < 0.015,
            "{e:?}"
        );
    }

    #[test]
    fn boundary_selection_uses_only_first_or_last_six_seconds() {
        let mut pcm = sine(8_000, 65.0, 0.5, 7.0);
        pcm.extend(sine(8_000, 3_200.0, 0.5, 7.0));
        let intro = analyze_mono(&pcm, 8_000, Boundary::Intro);
        let outro = analyze_mono(&pcm, 8_000, Boundary::Outro);
        assert!(intro.low > 0.3 && intro.high < 0.05, "{intro:?}");
        assert!(outro.high > 0.3 && outro.low < 0.05, "{outro:?}");
    }

    #[test]
    fn stereo_inverted_phase_does_not_cancel_bass() {
        let mono = sine(44_100, 85.0, 0.5, 0.4);
        let stereo: Vec<_> = mono.iter().flat_map(|&s| [s, -s]).collect();
        let e = analyze_boundary_pcm(&stereo, 44_100, 2, Boundary::Intro).unwrap();
        assert!(e.low > 0.3 && e.mid < 0.05, "{e:?}");
    }

    #[test]
    fn different_frequencies_in_each_channel_contribute_power() {
        let low = sine(48_000, 65.0, 0.5, 0.3);
        let high = sine(48_000, 7_000.0, 0.5, 0.3);
        let stereo: Vec<_> = low
            .into_iter()
            .zip(high)
            .flat_map(|(a, b)| [a, b])
            .collect();
        let e = analyze_boundary_pcm(&stereo, 48_000, 2, Boundary::Outro).unwrap();
        assert!(e.low > 0.2 && e.high > 0.2, "{e:?}");
        assert!(e.mid < 0.05, "{e:?}");
    }

    #[test]
    fn corrupt_silent_and_too_short_inputs_fail_closed() {
        assert!(analyze_boundary_pcm(&[], 48_000, 1, Boundary::Intro).is_none());
        assert!(analyze_boundary_pcm(&[0.0; 1024], 48_000, 1, Boundary::Intro).is_none());
        assert!(analyze_boundary_pcm(&[0.0; 8192], 48_000, 1, Boundary::Intro).is_none());
        let mut invalid = sine(48_000, 700.0, 0.5, 0.2);
        invalid[0] = f32::NAN;
        assert!(analyze_boundary_pcm(&invalid, 48_000, 1, Boundary::Intro).is_none());
        invalid[0] = f32::INFINITY;
        assert!(analyze_boundary_pcm(&invalid, 48_000, 1, Boundary::Intro).is_none());
        invalid[0] = 10.0;
        assert!(analyze_boundary_pcm(&invalid, 48_000, 1, Boundary::Intro).is_none());
    }

    #[test]
    fn invalid_rates_channels_and_incomplete_frames_fail_closed() {
        let pcm = sine(48_000, 700.0, 0.5, 0.2);
        for bad_rate in [0, 100, 7_999, 192_001] {
            assert!(analyze_boundary_pcm(&pcm, bad_rate, 1, Boundary::Intro).is_none());
        }
        for bad_channels in [0, 9, 100] {
            assert!(analyze_boundary_pcm(&pcm, 48_000, bad_channels, Boundary::Outro).is_none());
        }
        assert!(analyze_boundary_pcm(&pcm[..pcm.len() - 1], 48_000, 2, Boundary::Intro).is_none());
    }

    #[test]
    fn deterministic_noise_has_finite_nonzero_band_energy() {
        let mut seed = 1u32;
        let mut pcm = Vec::new();
        for _ in 0..24_000 {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            pcm.push((seed as f64 / u32::MAX as f64 * 2.0 - 1.0) as f32 * 0.1);
        }
        let a = analyze_mono(&pcm, 48_000, Boundary::Intro);
        let b = analyze_mono(&pcm, 48_000, Boundary::Intro);
        assert_eq!(a, b);
        assert!(a.low > 0.0 && a.mid > 0.0 && a.high > 0.0);
        assert!(a.low.is_finite() && a.mid.is_finite() && a.high.is_finite());
    }
}

/// Experimental off-thread admission guard; disconnected from playback.
pub mod lifecycle;

/// Optional background executor for already-available, trusted bytes only.
pub mod executor;

/// Advisory, fail-closed CPU-seed priority preflight; not connected to playback.
pub mod scheduling;

#[cfg(test)]
mod boundary_tests;
