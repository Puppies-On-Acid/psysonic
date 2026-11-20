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
