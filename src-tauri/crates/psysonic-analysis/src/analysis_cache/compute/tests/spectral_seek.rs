//! Optional long compressed-audio seek calibration. No music-library input.
//! Requires ffmpeg installed on PATH (or PSYSONIC_TEST_FFMPEG). Ignored in CI.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use super::super::decoder::open_decode_session;
use super::super::spectral_decode::decode_spectral_pcm_window;
use crate::spectral_autodj::Boundary;

const SAMPLE_RATE: u32 = 48_000;
const CHANNELS: usize = 2;
const DURATION_SECONDS: usize = 12;
const MAX_REFERENCE_SAMPLES: usize = SAMPLE_RATE as usize * CHANNELS * 16;

struct ScratchAudioDir(PathBuf);

impl ScratchAudioDir {
    fn create() -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock must be after the Unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "psysonic-spectral-seek-{}-{unique}",
            std::process::id()
        ));
        std::fs::create_dir(&path).expect("create synthetic fixture directory");
        Self(path)
    }

    fn join(&self, file: &str) -> PathBuf {
        self.0.join(file)
    }
}

impl Drop for ScratchAudioDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Deterministic stereo noise creates a non-periodic reference timeline; it
/// contains no user music or copyrighted samples.
fn synthetic_stereo_wav() -> Vec<u8> {
    let frames = SAMPLE_RATE as usize * DURATION_SECONDS;
    let pcm_bytes = frames * CHANNELS * 2;
    let mut wav = Vec::with_capacity(44 + pcm_bytes);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + pcm_bytes as u32).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    wav.extend_from_slice(&(SAMPLE_RATE * 4).to_le_bytes());
    wav.extend_from_slice(&4u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&(pcm_bytes as u32).to_le_bytes());
    let mut seed = 0x5472_81a3_u32;
    for _ in 0..frames * CHANNELS {
        seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        let sample = ((seed >> 16) as i16) / 4;
        wav.extend_from_slice(&sample.to_le_bytes());
    }
    wav
}

fn encode_m4a_with_ffmpeg(wav: &Path, output: &Path) {
    let binary = std::env::var_os("PSYSONIC_TEST_FFMPEG")
        .unwrap_or_else(|| std::ffi::OsString::from("ffmpeg"));
    let result = Command::new(binary)
        .args(["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(wav)
        .args(["-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"])
        .arg(output)
        .output()
        .unwrap_or_else(|error| {
            panic!("ffmpeg is required for this explicitly ignored test: {error}")
        });
    assert!(
        result.status.success(),
        "ffmpeg could not encode synthetic M4A: {}",
        String::from_utf8_lossy(&result.stderr)
    );
}

/// Independent full-from-start reference using the existing Symphonia setup.
/// Test-only and strictly bounded to a 16-second, two-channel fixture.
fn full_decode_reference(bytes: &[u8]) -> Vec<f32> {
    let mut session = open_decode_session(bytes, None).expect("probe synthetic M4A");
    let mut pcm = Vec::new();
    let mut scratch = Vec::new();
    let mut reached_end = false;

    for _ in 0..4_096 {
        let packet = match session.format.next_packet().expect("read reference packet") {
            Some(packet) => packet,
            None => {
                reached_end = true;
                break;
            }
        };
        if packet.track_id != session.track_id {
            continue;
        }
        let decoded = session
            .decoder
            .decode(&packet)
            .expect("decode reference packet");
        assert_eq!(decoded.spec().rate(), SAMPLE_RATE);
        assert_eq!(decoded.spec().channels().count(), CHANNELS);
        decoded.copy_to_vec_interleaved(&mut scratch);
        assert!(scratch.len().is_multiple_of(CHANNELS));
        assert!(
            pcm.len() + scratch.len() <= MAX_REFERENCE_SAMPLES,
            "reference exceeded the bounded synthetic test size"
        );
        pcm.extend_from_slice(&scratch);
    }

    assert!(reached_end, "reference exceeded 4096 packets");
    assert!(
        (SAMPLE_RATE as usize * CHANNELS * 11..=MAX_REFERENCE_SAMPLES).contains(&pcm.len()),
        "unexpected full decoded fixture size: {} samples",
        pcm.len()
    );
    pcm
}

#[test]
#[ignore = "manual: requires ffmpeg to encode 12s synthetic AAC/M4A"]
fn spectral_seek_long_m4a_matches_full_decode_reference() {
    let scratch = ScratchAudioDir::create();
    let wav_path = scratch.join("synthetic.wav");
    let m4a_path = scratch.join("synthetic.m4a");
    std::fs::write(&wav_path, synthetic_stereo_wav()).expect("write synthetic WAV");
    encode_m4a_with_ffmpeg(&wav_path, &m4a_path);
    let m4a = std::fs::read(&m4a_path).expect("read synthetic compressed fixture");

    let full_pcm = full_decode_reference(&m4a);
    let full_frames = full_pcm.len() / CHANNELS;
    let reported_frames = open_decode_session(&m4a, None)
        .expect("probe container timeline")
        .timeline_hint;
    println!(
        "spectral-seek fixture source_frames={} decoded_frames={full_frames} \
         container_frames={reported_frames:?} decoded_minus_source={}",
        DURATION_SECONDS * SAMPLE_RATE as usize,
        full_frames as isize - (DURATION_SECONDS * SAMPLE_RATE as usize) as isize
    );

    let mut failing_windows = 0usize;
    for window_sec in [0.213_f64, 1.137, 3.817] {
        // On a 12-second fixture these all enter the actual
        // accurate-seek + decoder-reset + one-second-preroll branch.
        let tail = decode_spectral_pcm_window(&m4a, Boundary::Outro, window_sec, || true)
            .expect("long AAC/M4A spectral outro should decode");
        assert_eq!(tail.sample_rate, SAMPLE_RATE);
        assert_eq!(usize::from(tail.channels), CHANNELS);

        let requested_frames = (window_sec * f64::from(SAMPLE_RATE)).ceil() as usize;
        let requested_samples = requested_frames * CHANNELS;
        assert_eq!(tail.pcm.len(), requested_samples);
        let reference = &full_pcm[full_pcm.len() - requested_samples..];
        let max_error = tail
            .pcm
            .iter()
            .zip(reference)
            .map(|(actual, expected)| (actual - expected).abs())
            .fold(0.0_f32, f32::max);
        let first_frames = requested_frames.min(1024);
        let first_samples = first_frames * CHANNELS;
        let first_max = tail.pcm[..first_samples]
            .iter()
            .zip(&reference[..first_samples])
            .map(|(actual, expected)| (actual - expected).abs())
            .fold(0.0_f32, f32::max);
        let post_preroll_frame = requested_frames.min(2048);
        let post_preroll_sample = post_preroll_frame * CHANNELS;
        let after2048_max = tail.pcm[post_preroll_sample..]
            .iter()
            .zip(&reference[post_preroll_sample..])
            .map(|(actual, expected)| (actual - expected).abs())
            .fold(0.0_f32, f32::max);

        // Diagnostic only: locate a possible constant offset between the
        // decoded reference and demuxer presentation timeline. Never apply
        // the shift to the decoder or relax the strict original assertion.
        let nominal_start = full_frames - requested_frames;
        let mut best_shift_frames = 0isize;
        let mut best_probe_mean = f64::INFINITY;
        for shift in -4096isize..=4096 {
            let candidate = nominal_start as isize + shift;
            if candidate < 0 || candidate as usize + requested_frames > full_frames {
                continue;
            }
            let mut sum = 0.0f64;
            let mut count = 0usize;
            for frame in (0..requested_frames.min(8192)).step_by(32) {
                let reference_index = (candidate as usize + frame) * CHANNELS;
                let sample_index = frame * CHANNELS;
                sum += f64::from((tail.pcm[sample_index] - full_pcm[reference_index]).abs());
                count += 1;
            }
            let mean = sum / count as f64;
            if mean < best_probe_mean {
                best_probe_mean = mean;
                best_shift_frames = shift;
            }
        }
        println!(
            "spectral-seek m4a duration_s={DURATION_SECONDS} full_frames={full_frames} \
             window_s={window_sec:.3} max_error={max_error:.8} \
             first1024_max={first_max:.8} after2048_max={after2048_max:.8} \
             best_shift_frames={best_shift_frames} \
             best_shift_probe_mean={best_probe_mean:.8}"
        );
        if max_error > 1.0e-5 {
            failing_windows += 1;
        }
    }
    assert_eq!(
        failing_windows, 0,
        "long AAC/M4A PCM mismatch on {failing_windows} of three windows; \
         strict max_error <= 1.0e-5 required for each"
    );
}
