//! Optional long compressed-audio seek calibration. No music-library input.
//! Requires ffmpeg installed on PATH (or PSYSONIC_TEST_FFMPEG). Ignored in CI.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use super::super::decoder::open_decode_session;
use super::super::spectral_decode::decode_spectral_pcm_window;
use crate::spectral_autodj::{analyze_boundary_pcm, Boundary};

const SAMPLE_RATE: u32 = 48_000;
const CHANNELS: usize = 2;
const DURATION_SECONDS: usize = 12;
const SPECTRAL_TILE_FRAMES: usize = 2_048;
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

fn encode_m4a_with_ffmpeg(wav: &Path, output: &Path, pns_enabled: bool) {
    let binary = std::env::var_os("PSYSONIC_TEST_FFMPEG")
        .unwrap_or_else(|| std::ffi::OsString::from("ffmpeg"));
    let mut command = Command::new(binary);
    command
        .args(["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(wav)
        .args(["-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"]);
    if !pns_enabled {
        // FFmpeg's native AAC encoder supports disabling Perceptual Noise
        // Substitution. This isolates seek precision from the decoder's
        // stateful PNS random-number history without changing any user audio.
        command.args(["-aac_pns", "disable"]);
    }
    let result = command.arg(output).output().unwrap_or_else(|error| {
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
    full_decode_reference_at_rate(bytes, SAMPLE_RATE)
}

fn full_decode_reference_at_rate(bytes: &[u8], expected_rate: u32) -> Vec<f32> {
    let mut session = open_decode_session(bytes, None).expect("probe synthetic audio");
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
        assert_eq!(decoded.spec().rate(), expected_rate);
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
        (expected_rate as usize * CHANNELS * 11..=MAX_REFERENCE_SAMPLES).contains(&pcm.len()),
        "unexpected full decoded fixture size: {} samples",
        pcm.len()
    );
    pcm
}

/// Shared full-decode reference comparison for codecs with and without PNS.
/// The strict sample-level assertion is deliberately unchanged for both.
fn calibrate_long_m4a_seek(pns_enabled: bool) {
    let scratch = ScratchAudioDir::create();
    let wav_path = scratch.join("synthetic.wav");
    let m4a_path = scratch.join("synthetic.m4a");
    std::fs::write(&wav_path, synthetic_stereo_wav()).expect("write synthetic WAV");
    encode_m4a_with_ffmpeg(&wav_path, &m4a_path, pns_enabled);
    let m4a = std::fs::read(&m4a_path).expect("read synthetic compressed fixture");

    let full_pcm = full_decode_reference(&m4a);
    let full_frames = full_pcm.len() / CHANNELS;
    let session = open_decode_session(&m4a, None).expect("probe container timeline");
    let reported_frames = session.timeline_hint.expect("container must report frames");
    let presentation_end = usize::try_from(reported_frames).expect("bounded fixture duration");
    assert!(
        presentation_end <= full_frames,
        "container endpoint exceeds the full decoded PCM reference"
    );
    assert!(
        presentation_end >= SAMPLE_RATE as usize * 11,
        "container endpoint is unexpectedly short"
    );
    let track = session
        .format
        .tracks()
        .iter()
        .find(|track| track.id == session.track_id)
        .expect("selected audio track");
    println!(
        "spectral-seek fixture pns_enabled={pns_enabled} source_frames={} decoded_frames={full_frames} \
         container_frames={reported_frames} delay={:?} padding={:?} \
         decoded_minus_source={} decoded_minus_container={}",
        DURATION_SECONDS * SAMPLE_RATE as usize,
        track.delay,
        track.padding,
        full_frames as isize - (DURATION_SECONDS * SAMPLE_RATE as usize) as isize,
        full_frames - presentation_end
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
        // The full raw decode may contain encoder padding after the timeline
        // endpoint. Use the exact endpoint reported by the demuxer, rather
        // than the final raw decoder sample, for this reference comparison.
        let reference_end = presentation_end * CHANNELS;
        let reference_start = reference_end
            .checked_sub(requested_samples)
            .expect("requested tail exceeds the presentation timeline");
        let reference = &full_pcm[reference_start..reference_end];
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
        let nominal_start = presentation_end - requested_frames;
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
        // Distinguish a later AAC decoder-state burst from a missing/extra
        // packet (which would make the post-error segment match at a shift).
        // Keep this diagnostic in the generated-audio ignored test only.
        let mut first_bad_frame = None;
        let mut last_bad_frame = None;
        let mut bad_frame_count = 0usize;
        let (actual_frames, actual_remainder) = tail.pcm.as_chunks::<CHANNELS>();
        let (reference_frames, reference_remainder) = reference.as_chunks::<CHANNELS>();
        assert!(actual_remainder.is_empty() && reference_remainder.is_empty());
        let frame_pairs = actual_frames.iter().zip(reference_frames.iter());
        for (frame, (actual, expected)) in frame_pairs.enumerate() {
            let bad = actual
                .iter()
                .zip(expected)
                .any(|(a, b)| (a - b).abs() > 1.0e-5);
            if bad {
                first_bad_frame.get_or_insert(frame);
                last_bad_frame = Some(frame);
                bad_frame_count += 1;
            }
        }
        let late_probe_frame = first_bad_frame
            .unwrap_or(0)
            .saturating_add(1024)
            .min(requested_frames - 1);
        let late_probe_frames = (requested_frames - late_probe_frame).min(4096);
        let mut late_best_shift_frames = 0isize;
        let mut late_best_probe_mean = f64::INFINITY;
        for shift in -2048isize..=2048 {
            let reference_start = nominal_start as isize + shift + late_probe_frame as isize;
            if reference_start < 0 || reference_start as usize + late_probe_frames > full_frames {
                continue;
            }
            let mut error_sum = 0.0f64;
            let mut count = 0usize;
            for offset in (0..late_probe_frames).step_by(16) {
                let sample_index = (late_probe_frame + offset) * CHANNELS;
                let reference_index = (reference_start as usize + offset) * CHANNELS;
                let sample_error = (tail.pcm[sample_index] - full_pcm[reference_index]).abs();
                error_sum += f64::from(sample_error);
                count += 1;
            }
            let mean = error_sum / count as f64;
            if mean < late_best_probe_mean {
                late_best_probe_mean = mean;
                late_best_shift_frames = shift;
            }
        }
        let last_frames = requested_frames.min(1024);
        let last_sample_start = (requested_frames - last_frames) * CHANNELS;
        let last1024_max = tail.pcm[last_sample_start..]
            .iter()
            .zip(&reference[last_sample_start..])
            .map(|(actual, expected)| (actual - expected).abs())
            .fold(0.0_f32, f32::max);

        println!(
            "spectral-seek m4a duration_s={DURATION_SECONDS} full_frames={full_frames} \
             window_s={window_sec:.3} max_error={max_error:.8} \
             first1024_max={first_max:.8} after2048_max={after2048_max:.8} \
             last1024_max={last1024_max:.8} first_bad_frame={first_bad_frame:?} \
             last_bad_frame={last_bad_frame:?} bad_frames={bad_frame_count} \
             best_shift_frames={best_shift_frames} \
             best_shift_probe_mean={best_probe_mean:.8} \
             late_probe_frame={late_probe_frame} \
             late_best_shift_frames={late_best_shift_frames} \
             late_best_probe_mean={late_best_probe_mean:.8}"
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

#[test]
#[ignore = "manual: ffmpeg AAC with PNS enabled, verify raw PCM seek invariance"]
fn spectral_seek_long_m4a_matches_full_decode_reference() {
    calibrate_long_m4a_seek(true);
}

#[test]
#[ignore = "manual: ffmpeg AAC with PNS disabled, verify raw PCM seek invariance"]
fn spectral_seek_long_m4a_without_pns_matches_full_decode_reference() {
    calibrate_long_m4a_seek(false);
}

/// Locally encode the same non-copyright synthetic WAV into an MP3.
/// All codec/muxer arguments are explicit so test files have known metadata.
fn encode_mp3_with_ffmpeg(wav: &Path, output: &Path, options: &[&str]) {
    let binary = std::env::var_os("PSYSONIC_TEST_FFMPEG")
        .unwrap_or_else(|| std::ffi::OsString::from("ffmpeg"));
    let result = Command::new(binary)
        .args(["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(wav)
        .args(options)
        .arg(output)
        .output()
        .expect("FFmpeg with libmp3lame is required for the manual MP3 probes");
    assert!(
        result.status.success(),
        "FFmpeg could not encode synthetic MP3: {}",
        String::from_utf8_lossy(&result.stderr)
    );
}

fn encode_vbr_mp3_with_ffmpeg(wav: &Path, output: &Path) {
    encode_mp3_with_ffmpeg(wav, output, &["-c:a", "libmp3lame", "-q:a", "2"]);
}

/// Test-only full-reference endpoint: no unbounded full-file decode in the
/// production window extractor. The generated source is exactly 12 seconds.
fn synthetic_reference_end(bytes: &[u8], decoded_frames: usize) -> usize {
    synthetic_reference_end_at_rate(bytes, decoded_frames, SAMPLE_RATE)
}

fn synthetic_reference_end_at_rate(bytes: &[u8], decoded_frames: usize, sample_rate: u32) -> usize {
    let session = open_decode_session(bytes, None).expect("probe synthetic codec timeline");
    let reported_frames = session
        .timeline_hint
        .expect("codec must report total frames");
    let endpoint = usize::try_from(reported_frames).expect("bounded generated fixture");
    assert!(
        (sample_rate as usize * 11..=decoded_frames).contains(&endpoint),
        "inconsistent container endpoint: {endpoint}, decoded {decoded_frames}"
    );
    endpoint
}

fn strict_reference_slice(
    full_pcm: &[f32],
    endpoint_frames: usize,
    wanted_frames: usize,
) -> &[f32] {
    let start = endpoint_frames
        .checked_sub(wanted_frames)
        .expect("requested window cannot exceed the synthetic fixture");
    &full_pcm[start * CHANNELS..endpoint_frames * CHANNELS]
}

/// Controlled investigation, NOT a production PNS acceptance rule.
///
/// PNS is permitted to synthesize different individual noise samples after a
/// seek; measure the actual three-band RMS feature that Spectral AutoDJ uses.
/// The original PNS-on strict PCM regression remains separately red; this test
/// does not change or waive it. PNS-off still requires exact PCM agreement.
#[test]
#[ignore = "manual: FFmpeg AAC PNS-on/off band RMS + bounded decode/FFT timings"]
fn spectral_codec_pns_rms_characterization() {
    let scratch = ScratchAudioDir::create();
    let wav_path = scratch.join("synthetic.wav");
    std::fs::write(&wav_path, synthetic_stereo_wav()).expect("write original synthetic WAV");

    for pns_enabled in [true, false] {
        let out = if pns_enabled {
            scratch.join("aac-pns-on.m4a")
        } else {
            scratch.join("aac-pns-off.m4a")
        };
        encode_m4a_with_ffmpeg(&wav_path, &out, pns_enabled);
        let bytes = std::fs::read(out).expect("read locally encoded AAC");
        let full_pcm = full_decode_reference(&bytes);
        let endpoint = synthetic_reference_end(&bytes, full_pcm.len() / CHANNELS);

        for window_seconds in [0.213_f64, 1.137, 3.817] {
            let window_frames = (window_seconds * f64::from(SAMPLE_RATE)).ceil() as usize;
            let reference = strict_reference_slice(&full_pcm, endpoint, window_frames);
            let reference_bands =
                analyze_boundary_pcm(reference, SAMPLE_RATE, CHANNELS as u16, Boundary::Outro)
                    .expect("full-decode reference must have three-band energy");

            let mut decode_ms = [0.0f64; 5];
            let mut current = None;
            for elapsed in &mut decode_ms {
                let started = Instant::now();
                let decoded =
                    decode_spectral_pcm_window(&bytes, Boundary::Outro, window_seconds, || true)
                        .expect("synthetic AAC seek should provide a complete window");
                *elapsed = started.elapsed().as_secs_f64() * 1000.0;
                current = Some(decoded);
            }
            let current = current.expect("measured five AAC windows");
            assert_eq!(current.sample_rate, SAMPLE_RATE);
            assert_eq!(usize::from(current.channels), CHANNELS);
            assert_eq!(current.pcm.len(), reference.len());

            let mut fft_ms = [0.0f64; 5];
            let mut current_bands = None;
            for elapsed in &mut fft_ms {
                let started = Instant::now();
                let bands = analyze_boundary_pcm(
                    &current.pcm,
                    current.sample_rate,
                    current.channels,
                    Boundary::Outro,
                )
                .expect("seek PCM must have three-band energy");
                *elapsed = started.elapsed().as_secs_f64() * 1000.0;
                current_bands = Some(bands);
            }
            let bands = current_bands.expect("measured five FFT runs");
            let reference_rms = [
                reference_bands.low,
                reference_bands.mid,
                reference_bands.high,
            ];
            let seek_rms = [bands.low, bands.mid, bands.high];
            let rel_pct = std::array::from_fn::<f64, 3, _>(|index| {
                let reference = f64::from(reference_rms[index]);
                let actual = f64::from(seek_rms[index]);
                100.0 * (actual - reference).abs() / reference.max(1.0e-5)
            });
            assert!(rel_pct.iter().all(|value| value.is_finite()));
            let max_pcm = current
                .pcm
                .iter()
                .zip(reference)
                .map(|(a, b)| (a - b).abs())
                .fold(0.0f32, f32::max);

            // The main analyzer samples only eight FFT positions: it can
            // entirely miss the isolated 2048-frame AAC PNS difference.
            // Inspect every complete, non-overlapping FFT-sized tile with
            // the same production analyzer, without setting a new tolerance.
            let mut tile_max_pct = [0.0f64; 3];
            let mut tile_worst_start = [None; 3];
            let mut pcm_different_tiles = 0usize;
            let tile_count = window_frames / SPECTRAL_TILE_FRAMES;
            for tile_index in 0..tile_count {
                let start_frame = tile_index * SPECTRAL_TILE_FRAMES;
                let start = start_frame * CHANNELS;
                let end = start + SPECTRAL_TILE_FRAMES * CHANNELS;
                let seek_tile = &current.pcm[start..end];
                let reference_tile = &reference[start..end];
                if seek_tile
                    .iter()
                    .zip(reference_tile)
                    .any(|(a, b)| (a - b).abs() > 1.0e-5)
                {
                    pcm_different_tiles += 1;
                }

                let a =
                    analyze_boundary_pcm(seek_tile, SAMPLE_RATE, CHANNELS as u16, Boundary::Outro)
                        .expect("synthetic AAC tile must contain band energy");
                let b = analyze_boundary_pcm(
                    reference_tile,
                    SAMPLE_RATE,
                    CHANNELS as u16,
                    Boundary::Outro,
                )
                .expect("full-decode AAC tile must contain band energy");
                let a = [a.low, a.mid, a.high];
                let b = [b.low, b.mid, b.high];
                for band in 0..3 {
                    let base = f64::from(b[band]);
                    let value = f64::from(a[band]);
                    let pct = 100.0 * (value - base).abs() / base.max(1.0e-5);
                    assert!(pct.is_finite());
                    if pct > tile_max_pct[band] {
                        tile_max_pct[band] = pct;
                        tile_worst_start[band] = Some(start_frame);
                    }
                }
            }
            decode_ms.sort_by(f64::total_cmp);
            fft_ms.sort_by(f64::total_cmp);
            println!(
                "spectral-codec aac pns={pns_enabled} window={window_seconds:.3} \
                 max_pcm_error={max_pcm:.8} ref_rms={reference_rms:?} \
                 seek_rms={seek_rms:?} relative_pct={rel_pct:?} \
                 tiles={tile_count} pcm_different_tiles={pcm_different_tiles} \
                 tile_max_relative_pct={tile_max_pct:?} \
                 tile_worst_start_frame={tile_worst_start:?} \
                 decode_ms_p50={:.3} fft_ms_p50={:.3} encoded_bytes={} \
                 pcm_bytes={}",
                decode_ms[2],
                fft_ms[2],
                bytes.len(),
                current.pcm.len() * std::mem::size_of::<f32>()
            );

            if !pns_enabled {
                assert!(
                    max_pcm <= 1.0e-5,
                    "PNS-disabled AAC must match sample-exact PCM, max {max_pcm}"
                );
            }
        }
    }
}

/// Real VBR MP3 seeks use packet timestamps, bitrate-reservoir state and
/// encoder delay. Do not call MP3 compatible unless the exact 12s synthetic
/// full-reference comparison passes at all three non-packet-aligned offsets.
#[test]
#[ignore = "manual: FFmpeg libmp3lame VBR seek vs full reference"]
fn spectral_codec_vbr_mp3_seek_calibration() {
    let scratch = ScratchAudioDir::create();
    let wav = scratch.join("synthetic.wav");
    let mp3 = scratch.join("synthetic-vbr.mp3");
    std::fs::write(&wav, synthetic_stereo_wav()).expect("write original synthetic WAV");
    encode_vbr_mp3_with_ffmpeg(&wav, &mp3);
    let bytes = std::fs::read(mp3).expect("read locally encoded VBR MP3");
    let full_pcm = full_decode_reference(&bytes);
    let decoded_frames = full_pcm.len() / CHANNELS;
    // Symphonia's MP3 demuxer reads LAME/Xing delay and padding metadata.
    // Its declared duration is presentation frames, but the full decoder
    // runs in gapless(false) mode and returns BOTH delay and tail padding.
    // Align a strict PCM reference using the demuxer's actual metadata,
    // not a guessed or codec-specific constant offset.
    let presentation_frames = synthetic_reference_end(&bytes, decoded_frames);
    let session = open_decode_session(&bytes, None).expect("probe VBR MP3 gapless metadata");
    let track = session
        .format
        .tracks()
        .iter()
        .find(|track| track.id == session.track_id)
        .expect("selected MP3 audio track");
    let delay = usize::try_from(track.delay.expect("VBR MP3 must report LAME delay"))
        .expect("bounded MP3 delay");
    let padding = usize::try_from(track.padding.expect("VBR MP3 must report LAME padding"))
        .expect("bounded MP3 padding");
    let endpoint = delay
        .checked_add(presentation_frames)
        .expect("bounded raw reference endpoint");
    assert_eq!(
        endpoint.checked_add(padding),
        Some(decoded_frames),
        "MP3 LAME delay + presentation duration + padding must equal full raw decode"
    );
    println!(
        "spectral-codec mp3-vbr full_frames={decoded_frames} \
         presentation_frames={presentation_frames} delay={delay} padding={padding} \
         reference_endpoint={endpoint} encoded_bytes={}",
        bytes.len()
    );

    let mut bad_cases = 0usize;
    for window_seconds in [0.213_f64, 1.137, 3.817] {
        let wanted_frames = (window_seconds * f64::from(SAMPLE_RATE)).ceil() as usize;
        let reference = strict_reference_slice(&full_pcm, endpoint, wanted_frames);
        let begin = Instant::now();
        let result = decode_spectral_pcm_window(&bytes, Boundary::Outro, window_seconds, || true)
            .expect("VBR MP3 must provide complete window, or compatibility stays blocked");
        let elapsed_ms = begin.elapsed().as_secs_f64() * 1000.0;
        assert_eq!(result.sample_rate, SAMPLE_RATE);
        assert_eq!(usize::from(result.channels), CHANNELS);
        assert_eq!(result.pcm.len(), reference.len());
        let mut first_bad = None;
        let mut last_bad = None;
        let mut worst_error = 0.0f32;
        let (actual_frames, actual_remainder) = result.pcm.as_chunks::<CHANNELS>();
        let (reference_frames, reference_remainder) = reference.as_chunks::<CHANNELS>();
        assert!(actual_remainder.is_empty() && reference_remainder.is_empty());
        let frame_pairs = actual_frames.iter().zip(reference_frames.iter());
        for (frame, (a, b)) in frame_pairs.enumerate() {
            let error = a
                .iter()
                .zip(b)
                .map(|(actual, reference)| (actual - reference).abs())
                .fold(0.0f32, f32::max);
            worst_error = worst_error.max(error);
            if error > 1.0e-5 {
                first_bad.get_or_insert(frame);
                last_bad = Some(frame);
            }
        }
        // Only a diagnostic: compare a bounded set of candidate offsets.
        // A good shift must also match the ENTIRE requested PCM window.
        // Never apply this shift to the production decoder or reference.
        let nominal_start = endpoint - wanted_frames;
        let mut best_shift = 0isize;
        let mut best_probe_mean = f64::INFINITY;
        for shift in -4_096isize..=4_096 {
            let candidate = nominal_start as isize + shift;
            if candidate < 0 || candidate as usize + wanted_frames > decoded_frames {
                continue;
            }
            let mut sum = 0.0f64;
            let mut count = 0usize;
            for frame in (0..wanted_frames.min(8_192)).step_by(32) {
                let actual_index = frame * CHANNELS;
                let ref_index = (candidate as usize + frame) * CHANNELS;
                sum += f64::from((result.pcm[actual_index] - full_pcm[ref_index]).abs());
                count += 1;
            }
            let mean = sum / count as f64;
            if mean < best_probe_mean {
                best_probe_mean = mean;
                best_shift = shift;
            }
        }
        let best_start = usize::try_from(nominal_start as isize + best_shift)
            .expect("bounded probe chose a nonnegative reference offset");
        let best_reference =
            &full_pcm[best_start * CHANNELS..(best_start + wanted_frames) * CHANNELS];
        let shifted_max_error = result
            .pcm
            .iter()
            .zip(best_reference)
            .map(|(a, b)| (a - b).abs())
            .fold(0.0f32, f32::max);
        println!(
            "spectral-codec mp3-vbr window={window_seconds:.3} \
             max_pcm_error={worst_error:.8} first_bad={first_bad:?} \
             last_bad={last_bad:?} best_shift_frames={best_shift} \
             best_probe_mean={best_probe_mean:.8} \
             shifted_max_error={shifted_max_error:.8} decode_ms={elapsed_ms:.3}"
        );
        if worst_error > 1.0e-5 {
            bad_cases += 1;
        }
    }
    assert_eq!(
        bad_cases, 0,
        "VBR MP3 exact-seek mismatch in {bad_cases}/3 synthetic windows"
    );
}

/// Alternate common rate: a 44.1 kHz LAME-tagged VBR MP3 must honor its
/// *own* encoder delay and padding, not a 48 kHz fixture-specific offset.
/// FFmpeg resamples the existing deterministic 48 kHz WAV; no user audio.
#[test]
#[ignore = "manual: ffmpeg 44.1kHz VBR MP3 strict reference/gapless calibration"]
fn spectral_codec_vbr_mp3_44100_gapless_calibration() {
    const RATE: u32 = 44_100;

    let scratch = ScratchAudioDir::create();
    let wav = scratch.join("synthetic.wav");
    let mp3 = scratch.join("synthetic-44100-vbr.mp3");
    std::fs::write(&wav, synthetic_stereo_wav()).expect("write synthetic WAV");
    encode_mp3_with_ffmpeg(&wav, &mp3, &["-ar", "44100", "-c:a", "libmp3lame", "-q:a", "2"]);
    let bytes = std::fs::read(mp3).expect("read locally encoded 44.1kHz MP3");
    let full_pcm = full_decode_reference_at_rate(&bytes, RATE);
    let decoded_frames = full_pcm.len() / CHANNELS;
    let presentation_frames = synthetic_reference_end_at_rate(&bytes, decoded_frames, RATE);
    let session = open_decode_session(&bytes, None).expect("probe 44.1kHz MP3");
    let track = session
        .format
        .tracks()
        .iter()
        .find(|track| track.id == session.track_id)
        .expect("selected MP3 track");
    let delay = usize::try_from(track.delay.expect("LAME delay required"))
        .expect("bounded encoder delay");
    let padding = usize::try_from(track.padding.expect("LAME padding required"))
        .expect("bounded encoder padding");
    let reference_end = presentation_frames
        .checked_add(delay)
        .expect("bounded raw reference endpoint");
    assert_eq!(
        reference_end.checked_add(padding),
        Some(decoded_frames),
        "44.1kHz LAME metadata must explain the entire raw decoder output"
    );

    println!(
        "spectral-codec mp3-vbr-44100 rate={RATE} decoded={decoded_frames} \
         presentation={presentation_frames} delay={delay} padding={padding}"
    );
    for seconds in [0.213_f64, 1.137, 3.817] {
        let frames = (seconds * f64::from(RATE)).ceil() as usize;
        let reference = strict_reference_slice(&full_pcm, reference_end, frames);
        let actual = decode_spectral_pcm_window(&bytes, Boundary::Outro, seconds, || true)
            .expect("44.1kHz MP3 seek must produce a full bounded window");
        assert_eq!(actual.sample_rate, RATE);
        assert_eq!(usize::from(actual.channels), CHANNELS);
        assert_eq!(actual.pcm.len(), reference.len());
        let max_error = actual
            .pcm
            .iter()
            .zip(reference)
            .map(|(a, b)| (a - b).abs())
            .fold(0.0f32, f32::max);
        println!(
            "spectral-codec mp3-vbr-44100 window={seconds:.3} \
             max_pcm_error={max_error:.8}"
        );
        assert!(
            max_error <= 1.0e-5,
            "44.1kHz VBR MP3 full PCM mismatch at {seconds:.3}s: {max_error}"
        );
    }
}

/// Missing Xing/LAME metadata is a diagnostic, NOT a claim of gapless support.
/// FFmpeg's MP3 muxer -write_xing 0 omits the duration/delay information.
/// The demuxer may estimate duration from CBR file length, but without delay
/// and padding there is no verified presentation-to-raw sample alignment.
/// Inspect only bounded results; never promote these to strict compatibility.
#[test]
#[ignore = "manual: ffmpeg CBR MP3 without Xing/LAME header, fallback characterization"]
fn spectral_codec_mp3_without_xing_metadata_diagnostic() {
    let scratch = ScratchAudioDir::create();
    let wav = scratch.join("synthetic.wav");
    let mp3 = scratch.join("synthetic-no-xing.mp3");
    std::fs::write(&wav, synthetic_stereo_wav()).expect("write synthetic WAV");
    encode_mp3_with_ffmpeg(
        &wav,
        &mp3,
        &[
            "-c:a",
            "libmp3lame",
            "-b:a",
            "192k",
            "-write_xing",
            "0",
            "-id3v2_version",
            "0",
        ],
    );
    let bytes = std::fs::read(mp3).expect("read synthetic header-free MP3");
    let session = open_decode_session(&bytes, None).expect("probe no-Xing MP3");
    let track = session
        .format
        .tracks()
        .iter()
        .find(|track| track.id == session.track_id)
        .expect("selected MP3 audio track");
    assert!(
        track.delay.is_none() && track.padding.is_none(),
        "no-Xing control must not expose LAME encoder delay or padding"
    );
    let declared = session.timeline_hint;
    let raw_pcm = full_decode_reference(&bytes);
    let raw_frames = raw_pcm.len() / CHANNELS;
    println!(
        "spectral-codec mp3-no-xing reported_frames={declared:?} \
         raw_frames={raw_frames} delay={:?} padding={:?}",
        track.delay,
        track.padding
    );

    // Source tokens can cancel without any decoder output regardless of the
    // presence or absence of gapless metadata.
    assert!(decode_spectral_pcm_window(&bytes, Boundary::Outro, 0.213, || false).is_none());
    for seconds in [0.213_f64, 1.137, 3.817] {
        let wanted_frames = (seconds * f64::from(SAMPLE_RATE)).ceil() as usize;
        match decode_spectral_pcm_window(&bytes, Boundary::Outro, seconds, || true) {
            None => {
                println!(
                    "spectral-codec mp3-no-xing window={seconds:.3} \
                     outcome=neutral-fallback"
                );
            }
            Some(actual) => {
                assert_eq!(actual.sample_rate, SAMPLE_RATE);
                assert_eq!(usize::from(actual.channels), CHANNELS);
                assert_eq!(actual.pcm.len(), wanted_frames * CHANNELS);
                assert!(actual.pcm.iter().all(|sample| sample.is_finite()));
                let raw_start = raw_frames
                    .checked_sub(wanted_frames)
                    .expect("synthetic reference must exceed requested tail");
                let reference = &raw_pcm[raw_start * CHANNELS..];
                let raw_tail_error = actual
                    .pcm
                    .iter()
                    .zip(reference)
                    .map(|(a, b)| (a - b).abs())
                    .fold(0.0f32, f32::max);
                println!(
                    "spectral-codec mp3-no-xing window={seconds:.3} \
                     outcome=bounded-pcm raw_tail_error={raw_tail_error:.8} \
                     note=no-gapless-timeline-proof"
                );
            }
        }
    }
}
