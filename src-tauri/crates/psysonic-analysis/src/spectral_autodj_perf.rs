//! Read-only, machine-local performance probe for the Spectral AutoDJ analyzer.
//! Runs only when explicitly requested with --ignored; never runs in normal CI.
//! Measures only spectral analysis of already-decoded PCM, not decoding,
//! networking, cache lookup, thread scheduling or live playback.

use std::hint::black_box;
use std::time::Instant;

use crate::spectral_autodj::{analyze_boundary_pcm, Boundary};

const SECONDS: usize = 6;
const WARMUP_RUNS: usize = 3;
const MEASURED_RUNS: usize = 25;

fn synthetic_interleaved_pcm(sample_rate: u32, channels: u16) -> Vec<f32> {
    let frames = sample_rate as usize * SECONDS;
    let mut pcm = Vec::with_capacity(frames * channels as usize);
    let mut seed = 0x1234_5678u32;
    for _ in 0..frames * channels as usize {
        seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        let normalized = (seed >> 8) as f32 / 16_777_216.0 - 0.5;
        pcm.push(normalized * 0.5);
    }
    pcm
}

fn measure_case(label: &str, sample_rate: u32, channels: u16) {
    // All PCM creation and initial warmups are excluded from timed samples.
    let pcm = synthetic_interleaved_pcm(sample_rate, channels);
    for _ in 0..WARMUP_RUNS {
        let result = analyze_boundary_pcm(&pcm, sample_rate, channels, Boundary::Outro);
        assert!(result.is_some(), "failed warmup for {label}");
        let _ = black_box(result);
    }

    let mut durations = Vec::with_capacity(MEASURED_RUNS);
    for _ in 0..MEASURED_RUNS {
        let begin = Instant::now();
        let result = analyze_boundary_pcm(
            black_box(pcm.as_slice()),
            sample_rate,
            channels,
            Boundary::Outro,
        );
        durations.push(begin.elapsed());
        assert!(result.is_some(), "failed measurement for {label}");
        let _ = black_box(result);
    }

    durations.sort_unstable();
    let to_ms = |index: usize| durations[index].as_secs_f64() * 1_000.0;
    let p50_ms = to_ms(MEASURED_RUNS / 2);
    let p95_ms = to_ms((MEASURED_RUNS * 95).div_ceil(100) - 1);
    let max_ms = to_ms(MEASURED_RUNS - 1);
    println!(
        "spectral-perf scenario={label} rate_hz={sample_rate} channels={channels} \
         pcm_bytes={} warmups={WARMUP_RUNS} runs={MEASURED_RUNS} \
         p50_ms={p50_ms:.3} p95_ms={p95_ms:.3} max_ms={max_ms:.3}",
        pcm.len() * std::mem::size_of::<f32>()
    );
}

/// Offline diagnostic: not a pass/fail performance budget until measured on
/// the owner's machine, with a repeatable baseline and accepted thresholds.
#[test]
#[ignore = "manual offline CPU probe; not a CI performance assertion"]
fn spectral_autodj_offline_cpu_probe() {
    measure_case("typical_stereo", 48_000, 2);
    measure_case("high_rate_eight_channel", 192_000, 8);
}

/// Current process high-water working-set sample (NOT a per-decoder allocator
/// measurement). Windows uses the built-in Get-Process command; Linux uses
/// procfs. Missing platform tools produce an explicit unavailable reading.
fn process_peak_working_set_bytes() -> Option<u64> {
    if cfg!(target_os = "windows") {
        let query = format!(
            "(Get-Process -Id {}).PeakWorkingSet64",
            std::process::id()
        );
        let output = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &query])
            .output()
            .ok()?;
        return String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse::<u64>()
            .ok();
    }
    if cfg!(target_os = "linux") {
        let status = std::fs::read_to_string("/proc/self/status").ok()?;
        let kb = status
            .lines()
            .find(|line| line.starts_with("VmHWM:"))?
            .split_whitespace()
            .nth(1)?
            .parse::<u64>()
            .ok()?;
        return kb.checked_mul(1024);
    }
    None
}

fn synthetic_stereo_wav_seconds(seconds: u32) -> Vec<u8> {
    let rate = 48_000_u32;
    let frames = rate * seconds;
    let data_bytes = frames * 4;
    let mut wav = Vec::with_capacity(44 + data_bytes as usize);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_bytes).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16_u32.to_le_bytes());
    wav.extend_from_slice(&1_u16.to_le_bytes());
    wav.extend_from_slice(&2_u16.to_le_bytes());
    wav.extend_from_slice(&rate.to_le_bytes());
    wav.extend_from_slice(&(rate * 4).to_le_bytes());
    wav.extend_from_slice(&4_u16.to_le_bytes());
    wav.extend_from_slice(&16_u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_bytes.to_le_bytes());
    for index in 0..frames {
        let t = index as f64 / f64::from(rate);
        let low = (std::f64::consts::TAU * 73.0 * t).sin() * 9_000.0;
        let high = (std::f64::consts::TAU * 4_500.0 * t).sin() * 1_500.0;
        let sample = (low + high) as i16;
        wav.extend_from_slice(&sample.to_le_bytes());
        wav.extend_from_slice(&(-sample).to_le_bytes());
    }
    wav
}

fn measure_decode_plus_fft(label: &str, bytes: &[u8], boundary: Boundary) {
    use crate::spectral_autodj::{
        analyze_verified_boundary_bytes, SpectralBoundaryJob, SpectralSourceToken,
    };

    let source = SpectralSourceToken {
        server_scope: "perf-server".into(),
        library_scope: "perf-server".into(),
        track_id: label.into(),
        content_revision: crate::analysis_cache::md5_first_16kb(bytes),
        generation: 1,
    };
    let job = SpectralBoundaryJob {
        source: source.clone(),
        boundary,
        window_seconds: 0.25,
    };
    for _ in 0..3 {
        let _ = black_box(analyze_verified_boundary_bytes(bytes, &job, || Some(source.clone())));
    }

    let peak_before = process_peak_working_set_bytes();
    let mut durations = Vec::with_capacity(25);
    let mut measured = 0usize;
    for _ in 0..25 {
        let begin = Instant::now();
        let result = analyze_verified_boundary_bytes(
            black_box(bytes),
            &job,
            || Some(source.clone()),
        );
        durations.push(begin.elapsed());
        measured += usize::from(result.is_some());
        let _ = black_box(result);
    }
    durations.sort_unstable();
    let millis = |index: usize| durations[index].as_secs_f64() * 1_000.0;
    let peak_after = process_peak_working_set_bytes();
    println!(
        "spectral-e2e scenario={label} boundary={boundary:?} encoded_bytes={} \
         decode_fft_valid_runs={measured}/25 warmups=3 runs=25 \
         p50_ms={:.3} p95_ms={:.3} max_ms={:.3} \
         process_peak_ws_before_bytes={peak_before:?} process_peak_ws_after_bytes={peak_after:?}",
        bytes.len(),
        millis(12),
        millis(23),
        millis(24)
    );
}

/// Manual, read-only full decode + spectral FFT characterization. Checked-in
/// codec fixtures may deliberately return neutral (missing duration/gapless
/// metadata); report rather than relaxing the strict codec acceptance rule.
/// No server, private library, network or stored audio is accessed.
#[test]
#[ignore = "manual full decode+FFT and process high-water memory characterization"]
fn spectral_autodj_existing_codec_end_to_end_probe() {
    let wav = synthetic_stereo_wav_seconds(12);
    measure_decode_plus_fft("synthetic_wav", &wav, Boundary::Intro);
    measure_decode_plus_fft("synthetic_wav", &wav, Boundary::Outro);

    let m4a = include_bytes!("../../psysonic-audio/fixtures/isomp4_seek_normal.m4a");
    let mp3 = include_bytes!("../../psysonic-audio/fixtures/lame_sine_22050.mp3");
    let no_xing = include_bytes!("../../psysonic-audio/fixtures/no_xing_sine.mp3");
    let surround = include_bytes!("../../psysonic-audio/fixtures/five_one_sine.flac");
    for (label, data) in [
        ("aac_m4a", m4a.as_slice()),
        ("lame_mp3", mp3.as_slice()),
        ("no_xing_mp3", no_xing.as_slice()),
        ("surround_flac", surround.as_slice()),
    ] {
        measure_decode_plus_fft(label, data, Boundary::Intro);
        measure_decode_plus_fft(label, data, Boundary::Outro);
    }
}

/// Optional worker-path measurement: includes one owned-byte copy, original
/// validation, speculative reservation, Tokio spawn_blocking and actual
/// decoder+FFT. It has no live library or ordinary queue dependency. Still not
/// a real contention/priority preemption measurement.
#[tokio::test]
#[ignore = "manual end-to-end speculative worker timing and working-set probe"]
async fn spectral_autodj_worker_capture_latency_probe() {
    use std::sync::Arc;

    use crate::analysis_runtime::{ActivityEpoch, TrustedAnalysisRevision};
    use crate::spectral_autodj::lifecycle::SpectralAdmissionGate;
    use crate::spectral_autodj::owned_source::SpectralOwnedOriginal;
    use crate::spectral_autodj::scheduling::try_spawn_verified_with_probe;
    use crate::spectral_autodj::{SpectralBoundaryJob, SpectralSourceToken};

    let wav = synthetic_stereo_wav_seconds(12);
    let source = SpectralSourceToken {
        server_scope: "perf-original".into(),
        library_scope: "perf-original".into(),
        track_id: "synthetic-wav".into(),
        content_revision: crate::analysis_cache::md5_first_16kb(&wav),
        generation: 1,
    };
    let trusted = TrustedAnalysisRevision {
        md5_16kb: source.content_revision.clone(),
        generation: 1,
        analysis_bytes_transcoded: false,
        content_hash_server_id: None,
    };
    let gate = Arc::new(SpectralAdmissionGate::new());
    assert!(gate.select_source(Some(source.clone())));
    let priority = Arc::new(ActivityEpoch::new(1));
    let peak_before = process_peak_working_set_bytes();
    let mut durations = Vec::with_capacity(25);

    for iteration in 0..28 {
        let started = Instant::now();
        let original = SpectralOwnedOriginal::try_from_completed_original(
            source.clone(),
            &source,
            "perf-original",
            wav.len(),
            &trusted,
            wav.clone(),
        )
        .expect("trusted completed original");
        let job = SpectralBoundaryJob {
            source: source.clone(),
            boundary: Boundary::Outro,
            window_seconds: 0.25,
        };
        let current = source.clone();
        let probe = Arc::clone(&priority);
        let reserve = Arc::clone(&priority);
        let task = try_spawn_verified_with_probe(
            &gate,
            job,
            original,
            Instant::now() + std::time::Duration::from_secs(10),
            move || Some(current.clone()),
            move || probe.current(),
            move |epoch| reserve.try_reserve(epoch),
        )
        .expect("one speculative slot");
        assert!(task.await.expect("blocking worker joined").is_some());
        if iteration >= 3 {
            durations.push(started.elapsed());
        }
    }
    durations.sort_unstable();
    let millis = |index: usize| durations[index].as_secs_f64() * 1_000.0;
    println!(
        "spectral-worker scenario=synthetic_wav_12s original_bytes={} \
         warmups=3 runs=25 p50_ms={:.3} p95_ms={:.3} max_ms={:.3} \
         peak_ws_before_bytes={peak_before:?} peak_ws_after_bytes={:?}",
        wav.len(),
        millis(12),
        millis(23),
        millis(24),
        process_peak_working_set_bytes()
    );
}
