use std::cell::Cell;
use std::f64::consts::PI;

use super::{analyze_verified_boundary_bytes, Boundary, SpectralBoundaryJob, SpectralSourceToken};
use crate::analysis_cache::decode_spectral_pcm_window;

const SEEKABLE_M4A: &[u8] =
    include_bytes!("../../../psysonic-audio/fixtures/isomp4_seek_normal.m4a");

fn identity() -> SpectralSourceToken {
    SpectralSourceToken {
        server_scope: "server-one".into(),
        library_scope: "music".into(),
        track_id: "same-track-id".into(),
        content_revision: "trusted-revision-a".into(),
        generation: 10,
    }
}

fn job(boundary: Boundary, seconds: f64) -> SpectralBoundaryJob {
    SpectralBoundaryJob {
        source: identity(),
        boundary,
        window_seconds: seconds,
    }
}

fn pcm16_wav(samples: &[i16], sample_rate: u32, channels: u16) -> Vec<u8> {
    assert!(channels > 0);
    assert!(samples.len().is_multiple_of(channels as usize));
    let data_bytes = (samples.len() * 2) as u32;
    let mut bytes = Vec::with_capacity(44 + data_bytes as usize);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36u32 + data_bytes).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&channels.to_le_bytes());
    bytes.extend_from_slice(&sample_rate.to_le_bytes());
    bytes.extend_from_slice(&(sample_rate * u32::from(channels) * 2).to_le_bytes());
    bytes.extend_from_slice(&(channels * 2).to_le_bytes());
    bytes.extend_from_slice(&16u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_bytes.to_le_bytes());
    for &sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    bytes
}

fn stereo_tone(first_hz: f64, second_hz: f64, sample_rate: u32) -> Vec<u8> {
    let mut samples = Vec::with_capacity(sample_rate as usize * 4);
    for i in 0..(sample_rate as usize * 2) {
        let frequency = if i < sample_rate as usize {
            first_hz
        } else {
            second_hz
        };
        let value =
            (12_000.0 * (2.0 * PI * frequency * i as f64 / sample_rate as f64).sin()) as i16;
        samples.extend_from_slice(&[value, value]);
    }
    pcm16_wav(&samples, sample_rate, 2)
}

#[test]
fn phase_safe_stereo_bass_is_not_cancelled() {
    let rate = 48_000;
    let mut samples = Vec::new();
    for i in 0..rate / 2 {
        let value = (12_000.0 * (2.0 * PI * 80.0 * i as f64 / rate as f64).sin()) as i16;
        samples.extend_from_slice(&[value, -value]);
    }
    let wav = pcm16_wav(&samples, rate, 2);
    let measured =
        analyze_verified_boundary_bytes(&wav, &job(Boundary::Intro, 0.25), || Some(identity()))
            .expect("valid stereo window");
    assert!(measured.low > 0.2, "{measured:?}");
    assert!(measured.mid < 0.05 && measured.high < 0.05, "{measured:?}");
}

#[test]
fn intro_and_outro_select_different_music_not_center_waveform() {
    let wav = stereo_tone(80.0, 6_000.0, 48_000);
    let intro =
        analyze_verified_boundary_bytes(&wav, &job(Boundary::Intro, 0.5), || Some(identity()))
            .expect("intro");
    let outro =
        analyze_verified_boundary_bytes(&wav, &job(Boundary::Outro, 0.5), || Some(identity()))
            .expect("outro");
    assert!(intro.low > 0.2 && intro.high < 0.05, "{intro:?}");
    assert!(outro.high > 0.2 && outro.low < 0.05, "{outro:?}");
}

#[test]
fn rejects_server_library_track_revision_or_generation_mismatch() {
    let wav = stereo_tone(80.0, 80.0, 48_000);
    for altered in [
        SpectralSourceToken {
            server_scope: "other".into(),
            ..identity()
        },
        SpectralSourceToken {
            library_scope: "other".into(),
            ..identity()
        },
        SpectralSourceToken {
            track_id: "other".into(),
            ..identity()
        },
        SpectralSourceToken {
            content_revision: "revision-b".into(),
            ..identity()
        },
        SpectralSourceToken {
            generation: 11,
            ..identity()
        },
    ] {
        assert!(
            analyze_verified_boundary_bytes(&wav, &job(Boundary::Intro, 0.25), || {
                Some(altered.clone())
            })
            .is_none(),
            "must reject stale or cross-scope identity"
        );
    }
    assert!(analyze_verified_boundary_bytes(&wav, &job(Boundary::Intro, 0.25), || None).is_none());
}

#[test]
fn rejects_missing_scope_revision_and_zero_generation() {
    let wav = stereo_tone(80.0, 80.0, 48_000);
    for missing in [
        SpectralSourceToken {
            server_scope: String::new(),
            ..identity()
        },
        SpectralSourceToken {
            library_scope: " ".into(),
            ..identity()
        },
        SpectralSourceToken {
            track_id: String::new(),
            ..identity()
        },
        SpectralSourceToken {
            content_revision: String::new(),
            ..identity()
        },
        SpectralSourceToken {
            generation: 0,
            ..identity()
        },
    ] {
        let candidate = SpectralBoundaryJob {
            source: missing.clone(),
            ..job(Boundary::Intro, 0.25)
        };
        assert!(
            analyze_verified_boundary_bytes(&wav, &candidate, || Some(missing.clone())).is_none()
        );
    }
}

#[test]
fn cancellation_during_the_decode_discards_partial_pcm() {
    let wav = stereo_tone(80.0, 80.0, 48_000);
    let calls = Cell::new(0usize);
    let result = analyze_verified_boundary_bytes(&wav, &job(Boundary::Outro, 0.5), || {
        let count = calls.get() + 1;
        calls.set(count);
        (count <= 3).then(identity)
    });
    assert!(result.is_none());
    assert!(calls.get() > 3);
}

#[test]
fn short_tracks_use_full_available_window_without_extra_decoding() {
    let rate = 48_000;
    let samples: Vec<i16> = (0..rate / 4)
        .flat_map(|i| {
            let v = (12_000.0 * (2.0 * PI * 80.0 * i as f64 / rate as f64).sin()) as i16;
            [v, v]
        })
        .collect();
    let wav = pcm16_wav(&samples, rate, 2);
    for boundary in [Boundary::Intro, Boundary::Outro] {
        let result =
            analyze_verified_boundary_bytes(&wav, &job(boundary, 0.5), || Some(identity()));
        assert!(result.is_some(), "short {boundary:?} should use full track");
    }
}

#[test]
fn invalid_byte_buffer_window_and_untrusted_source_fail_closed() {
    let wav = stereo_tone(80.0, 80.0, 48_000);
    for seconds in [0.0, -1.0, 7.0, f64::NAN, f64::INFINITY] {
        assert!(
            analyze_verified_boundary_bytes(&wav, &job(Boundary::Intro, seconds), || {
                Some(identity())
            })
            .is_none(),
        );
    }
    for corrupt in [&b"not audio"[..], &b""[..], &wav[..20]] {
        assert!(
            analyze_verified_boundary_bytes(corrupt, &job(Boundary::Intro, 0.5), || {
                Some(identity())
            })
            .is_none(),
        );
    }
}

#[test]
fn existing_m4a_fixture_decodes_without_downmixing() {
    let pcm = decode_spectral_pcm_window(SEEKABLE_M4A, Boundary::Intro, 0.1, || true)
        .expect("existing M4A seek fixture should decode PCM");
    assert_eq!(pcm.sample_rate, 44_100);
    assert!((4_300..=4_500).contains(&(pcm.pcm.len() / usize::from(pcm.channels))));
    assert!(pcm.pcm.iter().all(|sample| sample.is_finite()));
}

#[test]
fn outro_pcm_window_starts_at_exact_sample_after_packet_aligned_seek() {
    let rate = 48_000u32;
    let frames = rate as usize * 2;
    let mut samples = Vec::with_capacity(frames * 2);
    for i in 0..frames {
        let value = ((i * 17 % 20_001) as i16) - 10_000;
        samples.extend_from_slice(&[value, value]);
    }
    let wav = pcm16_wav(&samples, rate, 2);
    // Deliberately not aligned to typical demuxer packet sizes.
    let window_seconds = 0.213f64;
    let want_frames = (window_seconds * f64::from(rate)).ceil() as usize;
    let result = decode_spectral_pcm_window(&wav, Boundary::Outro, window_seconds, || true)
        .expect("sample-aligned PCM outro");
    assert_eq!(result.pcm.len(), want_frames * 2);
    assert_eq!(result.channels, 2);
    for offset in [0usize, 1, 13, 255, want_frames - 1] {
        let expected = f32::from(samples[(frames - want_frames + offset) * 2]) / 32768.0;
        let actual = result.pcm[offset * 2];
        assert!(
            (actual - expected).abs() < 0.0001,
            "outro offset {offset}: expected {expected}, got {actual}"
        );
    }
}
