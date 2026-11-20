//! Local, offline A/B audition tool for the real Spectral AutoDJ listening trial.
//!
//! Operates only on two explicitly supplied original files. Both versions use
//! the SAME decoded PCM, stereo fold (mono duplication only), resampling,
//! equal-power faders, timing and output level. Only the incoming low-band EQ
//! differs. No live playback, IPC, network, database or user settings.
//!
//! This is a controlled listening harness, NOT the full in-app AutoDJ planner:
//! content-driven silence trimming, playback clocks and production gapless
//! behavior are not reproduced by this offline fixed-duration mix.

use std::fs::{self, File};
use std::io::Write;
use std::path::Path;

use psysonic_analysis::spectral_autodj::{
    analyze_boundary_pcm, decode_audition_pcm, plan_spectral_bass_handoff, Boundary,
    SpectralAuditionPcm,
};

use crate::sources::{ThreeBandEnvelope, ThreeBandEq};

const WINDOW_SECONDS: f64 = 6.0;
const OUTPUT_RATE: u32 = 48_000;
const OUTPUT_CHANNELS: usize = 2;
const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Clone, Copy)]
pub struct AuditionReport {
    pub intro_low_cut_db: f32,
    pub duration_secs: f64,
    pub overlap_secs: f64,
    pub rms_difference_db: f64,
    pub max_sample: f32,
    pub first_file_spectral: bool,
}

fn read_original(path: &Path) -> Result<Vec<u8>, String> {
    let meta = fs::metadata(path).map_err(|e| format!("Cannot inspect original audio: {e}"))?;
    if !meta.is_file() || meta.len() == 0 || meta.len() > MAX_FILE_BYTES {
        return Err(format!("Select a complete audio file between 1 byte and {MAX_FILE_BYTES} bytes"));
    }
    fs::read(path).map_err(|e| format!("Cannot read original audio: {e}"))
}

fn to_48k_stereo(input: &SpectralAuditionPcm) -> Result<Vec<f32>, String> {
    // Offline A/B comparisons deliberately refuse ambiguous multichannel
    // ordering instead of guessing a fold that differs from the live engine.
    let channels = usize::from(input.channels);
    if !(1..=2).contains(&channels)
        || !(8_000..=192_000).contains(&input.sample_rate)
        || input.pcm.len() % channels != 0
    {
        return Err("Audition requires mono/stereo decoded PCM; use a different pair for multichannel tests".into());
    }
    let frames = input.pcm.len() / channels;
    if frames < 1_024 {
        return Err("Audio boundary is too short for a representative audition".into());
    }
    let output_frames = ((frames as f64 * OUTPUT_RATE as f64
        / f64::from(input.sample_rate)).round()) as usize;
    let mut out = Vec::with_capacity(output_frames * OUTPUT_CHANNELS);
    for dst in 0..output_frames {
        let position = dst as f64 * f64::from(input.sample_rate) / f64::from(OUTPUT_RATE);
        let index = (position.floor() as usize).min(frames - 1);
        let after = (index + 1).min(frames - 1);
        let fraction = (position - index as f64).clamp(0.0, 1.0) as f32;
        for ch in 0..OUTPUT_CHANNELS {
            let src_ch = if channels == 1 { 0 } else { ch };
            let from = input.pcm[index * channels + src_ch];
            let to = input.pcm[after * channels + src_ch];
            out.push(from + (to - from) * fraction);
        }
    }
    if out.iter().any(|v| !v.is_finite()) {
        return Err("Decoder produced non-finite PCM".into());
    }
    Ok(out)
}

fn render_fixed_overlap(
    outgoing: &[f32],
    incoming: &[f32],
    overlap_secs: f64,
    bass_cut_db: f32,
) -> Result<Vec<f32>, String> {
    if !overlap_secs.is_finite() || !(1.0..=5.0).contains(&overlap_secs)
        || outgoing.len() % OUTPUT_CHANNELS != 0
        || incoming.len() % OUTPUT_CHANNELS != 0
    {
        return Err("Overlap must be 1 to 5 seconds with valid interleaved stereo PCM".into());
    }
    let a_frames = outgoing.len() / OUTPUT_CHANNELS;
    let b_frames = incoming.len() / OUTPUT_CHANNELS;
    let blend_frames = (overlap_secs * f64::from(OUTPUT_RATE)).round() as usize;
    if blend_frames == 0 || a_frames <= blend_frames || b_frames <= blend_frames {
        return Err("Both selected clips need at least one second beyond the fade".into());
    }
    let b_start = a_frames - blend_frames;
    let total_frames = a_frames + b_frames - blend_frames;
    let envelope = ThreeBandEnvelope::new(
        [bass_cut_db, 0.0, 0.0],
        std::time::Duration::from_secs_f64(overlap_secs),
    );
    let mut eq = ThreeBandEq::new(OUTPUT_RATE, OUTPUT_CHANNELS as u16, envelope);
    let mut output = Vec::with_capacity(total_frames * OUTPUT_CHANNELS);
    for frame in 0..total_frames {
        let (a_gain, b_gain) = if frame < b_start {
            (1.0, 0.0)
        } else if frame >= a_frames {
            (0.0, 1.0)
        } else {
            let progress = (frame - b_start) as f64 / blend_frames as f64;
            let angle = progress * std::f64::consts::FRAC_PI_2;
            (angle.cos() as f32, angle.sin() as f32)
        };
        for ch in 0..OUTPUT_CHANNELS {
            let a = if frame < a_frames {
                outgoing[frame * OUTPUT_CHANNELS + ch] * a_gain
            } else {
                0.0
            };
            let b = if frame >= b_start {
                let input = incoming[(frame - b_start) * OUTPUT_CHANNELS + ch];
                eq.process(input) * b_gain
            } else {
                0.0
            };
            output.push(a + b);
        }
    }
    Ok(output)
}

fn root_mean_square(samples: &[f32]) -> f64 {
    let sum = samples.iter().map(|v| f64::from(*v) * f64::from(*v)).sum::<f64>();
    (sum / samples.len().max(1) as f64).sqrt()
}

fn normalize_pair(baseline: &mut [f32], spectral: &mut [f32]) -> Result<(f64, f32), String> {
    let a_rms = root_mean_square(baseline);
    let b_rms = root_mean_square(spectral);
    if !a_rms.is_finite() || !b_rms.is_finite() || a_rms <= 1e-9 || b_rms <= 1e-9 {
        return Err("Cannot loudness-match silent or invalid audio".into());
    }
    // Match broadband integrated RMS exactly; this is NOT EBU R128 LUFS.
    // A shared peak safety scale avoids a limiter that could bias the A/B.
    let gain_a = 0.12 / a_rms;
    let gain_b = 0.12 / b_rms;
    let peak_a = baseline.iter().map(|v| v.abs()).fold(0.0_f32, f32::max) as f64;
    let peak_b = spectral.iter().map(|v| v.abs()).fold(0.0_f32, f32::max) as f64;
    let common = (0.95 / (gain_a * peak_a).max(gain_b * peak_b).max(1e-9)).min(1.0);
    for value in baseline.iter_mut() {
        *value *= (gain_a * common) as f32;
    }
    for value in spectral.iter_mut() {
        *value *= (gain_b * common) as f32;
    }
    let rms_diff_db = 20.0 * (root_mean_square(baseline) / root_mean_square(spectral)).log10();
    let peak = baseline.iter().chain(spectral.iter())
        .map(|v| v.abs()).fold(0.0_f32, f32::max);
    Ok((rms_diff_db, peak))
}

fn write_stereo_pcm16_wav(path: &Path, samples: &[f32]) -> Result<(), String> {
    let payload_bytes = samples.len().checked_mul(2)
        .and_then(|count| u32::try_from(count).ok())
        .ok_or_else(|| "WAV payload too large".to_string())?;
    let file_bytes = payload_bytes.checked_add(36)
        .ok_or_else(|| "WAV RIFF length overflow".to_string())?;
    let mut wav = File::create(path).map_err(|e| format!("Cannot create WAV: {e}"))?;
    wav.write_all(b"RIFF").map_err(|e| e.to_string())?;
    wav.write_all(&file_bytes.to_le_bytes()).map_err(|e| e.to_string())?;
    wav.write_all(b"WAVEfmt ").map_err(|e| e.to_string())?;
    wav.write_all(&16_u32.to_le_bytes()).map_err(|e| e.to_string())?;
    wav.write_all(&1_u16.to_le_bytes()).map_err(|e| e.to_string())?;
    wav.write_all(&2_u16.to_le_bytes()).map_err(|e| e.to_string())?;
    wav.write_all(&OUTPUT_RATE.to_le_bytes()).map_err(|e| e.to_string())?;
    wav.write_all(&(OUTPUT_RATE * 4).to_le_bytes()).map_err(|e| e.to_string())?;
    wav.write_all(&4_u16.to_le_bytes()).map_err(|e| e.to_string())?;
    wav.write_all(&16_u16.to_le_bytes()).map_err(|e| e.to_string())?;
    wav.write_all(b"data").map_err(|e| e.to_string())?;
    wav.write_all(&payload_bytes.to_le_bytes()).map_err(|e| e.to_string())?;
    for sample in samples {
        let quantized = (sample.clamp(-1.0, 1.0) * 32767.0).round() as i16;
        wav.write_all(&quantized.to_le_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Render two blind, level-matched local WAVs. Never uploads or modifies input.
/// Label randomization is determined by the caller-supplied private seed.
pub fn render_audition_pair(
    outgoing_path: &Path,
    incoming_path: &Path,
    output_dir: &Path,
    overlap_secs: f64,
    seed: u64,
) -> Result<AuditionReport, String> {
    if !overlap_secs.is_finite() || !(1.0..=5.0).contains(&overlap_secs) {
        return Err("Overlap must be between 1 and 5 seconds".into());
    }
    let outgoing_bytes = read_original(outgoing_path)?;
    let incoming_bytes = read_original(incoming_path)?;
    let a = decode_audition_pcm(&outgoing_bytes, Boundary::Outro, WINDOW_SECONDS)
        .ok_or_else(|| "Outgoing original: strict bounded outro decode unavailable".to_string())?;
    let b = decode_audition_pcm(&incoming_bytes, Boundary::Intro, WINDOW_SECONDS)
        .ok_or_else(|| "Incoming original: strict bounded intro decode unavailable".to_string())?;
    let bass_a = analyze_boundary_pcm(&a.pcm, a.sample_rate, a.channels, Boundary::Intro);
    let bass_b = analyze_boundary_pcm(&b.pcm, b.sample_rate, b.channels, Boundary::Intro);
    let cut_db = plan_spectral_bass_handoff(bass_a, bass_b);
    let a_pcm = to_48k_stereo(&a)?;
    let b_pcm = to_48k_stereo(&b)?;
    let mut baseline = render_fixed_overlap(&a_pcm, &b_pcm, overlap_secs, 0.0)?;
    let mut spectral = render_fixed_overlap(&a_pcm, &b_pcm, overlap_secs, cut_db)?;
    let (rms_difference_db, peak) = normalize_pair(&mut baseline, &mut spectral)?;
    if output_dir.exists() {
        if !output_dir.is_dir() {
            return Err("Output path is not a directory".into());
        }
    } else {
        fs::create_dir_all(output_dir).map_err(|e| format!("Cannot create output directory: {e}"))?;
    }
    let spectral_first = seed % 2 == 0;
    let (one, two) = if spectral_first {
        (&spectral, &baseline)
    } else {
        (&baseline, &spectral)
    };
    write_stereo_pcm16_wav(&output_dir.join("Sample_1.wav"), one)?;
    write_stereo_pcm16_wav(&output_dir.join("Sample_2.wav"), two)?;
    let answer = format!(
        "Private local A/B answer key (do not publish):\n\
         Sample_1 = {}\nSample_2 = {}\n\
         Incoming low-band cut: {cut_db:.3} dB\n\
         Integrated broadband RMS difference: {rms_difference_db:.5} dB\n\
         Output peak: {peak:.5} (1.0 is full scale)\n\
         Same PCM, equal-power fades, 48kHz stereo and overlap in both versions.\n\
         RMS matching is not a formal BS.1770 LUFS match.\n\
         A zero cut means both mixes should sound identical (neutral control).\n",
        if spectral_first { "Spectral" } else { "Ordinary AutoDJ" },
        if spectral_first { "Ordinary AutoDJ" } else { "Spectral" },
    );
    fs::write(output_dir.join("ANSWER_KEY.txt"), answer)
        .map_err(|e| format!("Cannot write private answer key: {e}"))?;
    Ok(AuditionReport {
        intro_low_cut_db: cut_db,
        duration_secs: baseline.len() as f64 / (OUTPUT_CHANNELS as f64 * f64::from(OUTPUT_RATE)),
        overlap_secs,
        rms_difference_db,
        max_sample: peak,
        first_file_spectral: spectral_first,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wave(freq: f32) -> Vec<f32> {
        let mut pcm = Vec::new();
        for i in 0..(OUTPUT_RATE * 6) {
            let sample = (std::f32::consts::TAU * freq * i as f32 / OUTPUT_RATE as f32).sin() * 0.4;
            pcm.extend_from_slice(&[sample, sample]);
        }
        pcm
    }

    #[test]
    fn baseline_and_neutral_are_bit_identical() {
        let a = wave(55.0);
        let b = wave(80.0);
        let first = render_fixed_overlap(&a, &b, 3.0, 0.0).unwrap();
        let second = render_fixed_overlap(&a, &b, 3.0, 0.0).unwrap();
        assert_eq!(first, second);
    }

    #[test]
    fn bass_handoff_shifts_spectrum_without_changing_samples_or_clipping() {
        let a = wave(55.0);
        let b = wave(70.0);
        let mut normal = render_fixed_overlap(&a, &b, 3.0, 0.0).unwrap();
        let mut spectral = render_fixed_overlap(&a, &b, 3.0, -4.0).unwrap();
        assert_eq!(normal.len(), spectral.len());
        assert_ne!(normal, spectral);
        let (delta, peak) = normalize_pair(&mut normal, &mut spectral).unwrap();
        assert!(delta.abs() < 0.01);
        assert!(peak <= 0.951);
    }

    #[test]
    fn output_rate_conversion_preserves_mono_as_stereo() {
        let pcm = SpectralAuditionPcm {
            pcm: vec![0.25; 2_048],
            sample_rate: 44_100,
            channels: 1,
        };
        let stereo = to_48k_stereo(&pcm).unwrap();
        assert_eq!(stereo.len() % 2, 0);
        for pair in stereo.chunks_exact(2) {
            assert_eq!(pair[0], pair[1]);
        }
    }

    #[test]
    fn invalid_overlap_and_ambiguous_multichannel_fail_closed() {
        let a = wave(60.0);
        assert!(render_fixed_overlap(&a, &a, 0.5, 0.0).is_err());
        let multi = SpectralAuditionPcm {
            pcm: vec![0.25; 6_000],
            sample_rate: 48_000,
            channels: 6,
        };
        assert!(to_48k_stereo(&multi).is_err());
    }

    #[test]
    fn complete_synthetic_wav_pair_renders_two_listenable_files() {
        let seed = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "psysonic_spectral_audition_test_{}_{}", std::process::id(), seed
        ));
        fs::create_dir_all(&dir).unwrap();
        let outgoing = dir.join("synthetic_a.wav");
        let incoming = dir.join("synthetic_b.wav");
        let output = dir.join("rendered");
        write_stereo_pcm16_wav(&outgoing, &wave(62.0)).unwrap();
        write_stereo_pcm16_wav(&incoming, &wave(88.0)).unwrap();

        let report = render_audition_pair(
            &outgoing, &incoming, &output, 3.5, 2,
        )
        .expect("synthetic original-to-audition pipeline");
        assert!(report.intro_low_cut_db < -1.0);
        assert!(report.first_file_spectral);
        assert!(report.max_sample < 1.0);
        let first = fs::read(output.join("Sample_1.wav")).unwrap();
        let second = fs::read(output.join("Sample_2.wav")).unwrap();
        assert_eq!(&first[..4], b"RIFF");
        assert_eq!(&second[..4], b"RIFF");
        assert_eq!(first.len(), second.len());
        assert_ne!(first, second);
        assert!(output.join("ANSWER_KEY.txt").exists());
        fs::remove_dir_all(&dir).unwrap();
    }
}
