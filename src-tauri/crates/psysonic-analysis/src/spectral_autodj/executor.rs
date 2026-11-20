//! Optional, off-thread Spectral AutoDJ boundary analysis.
//!
//! This executor has NO runtime caller. It never fetches audio, starts a
//! backfill job, touches playback, or retains results. The caller must already
//! own and authenticate the complete source bytes and current source token.
//! The owned Vec is moved into a single Tokio blocking job, not cloned.
//!
//! Before any live scheduling, the ordinary CPU-seed queue must explicitly
//! arbitrate this lower-priority work. A one-slot gate only bounds spectral
//! concurrency; it is NOT a replacement for the existing queue's admission.
//! An eventual consumer must recheck the source at its own final handoff.

use std::sync::Arc;
use std::time::Instant;

use tokio::task::JoinHandle;

use super::lifecycle::SpectralAdmissionGate;
use super::{
    analyze_verified_boundary_bytes, SpectralBandRms, SpectralBoundaryJob, SpectralSourceToken,
};

/// Spawn one bounded, optional analysis of already-acquired bytes.
///
/// The caller owns the source verification, one shared gate, and the deadline.
/// No internal queue or download is created. The gate rejects busy, invalid,
/// oversized, stale or expired requests without spawning a blocking task.
/// Dropping the returned JoinHandle only detaches the worker; its lease stays
/// occupied until decoding exits, including after cancellation or a panic.
///
/// A successful result is NOT authorization to apply it to playback. A future
/// consumer must revalidate its source after awaiting and at final use.
pub fn try_spawn_with_available_bytes<F>(
    gate: &Arc<SpectralAdmissionGate>,
    job: SpectralBoundaryJob,
    bytes: Vec<u8>,
    deadline: Instant,
    live_source: F,
) -> Option<JoinHandle<Option<SpectralBandRms>>>
where
    F: Fn() -> Option<SpectralSourceToken> + Send + 'static,
{
    // Fail neutrally if called without a Tokio runtime; never spawn a thread
    // or block the submitting caller as a fallback.
    let runtime = tokio::runtime::Handle::try_current().ok()?;
    if live_source().as_ref() != Some(&job.source) {
        return None;
    }
    let lease = gate.try_admit(&job, bytes.len(), Instant::now(), deadline)?;

    Some(runtime.spawn_blocking(move || {
        // The admission slot is held even if the caller drops the JoinHandle.
        if !lease.is_current(Instant::now(), live_source().as_ref()) {
            return None;
        }

        let bands = analyze_verified_boundary_bytes(&bytes, &job, || {
            let current = live_source();
            if lease.is_current(Instant::now(), current.as_ref()) {
                current
            } else {
                None
            }
        });
        let current = live_source();
        if lease.finish(Instant::now(), current.as_ref()) {
            bands
        } else {
            None
        }
    }))
}

#[cfg(test)]
mod tests {
    use std::f64::consts::PI;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{mpsc, Arc};
    use std::time::{Duration, Instant};

    use super::*;
    use crate::spectral_autodj::Boundary;

    fn source() -> SpectralSourceToken {
        SpectralSourceToken {
            server_scope: "server-a".into(),
            library_scope: "library-a".into(),
            track_id: "same-id".into(),
            content_revision: "revision-a".into(),
            generation: 7,
        }
    }

    fn job(source: SpectralSourceToken) -> SpectralBoundaryJob {
        SpectralBoundaryJob {
            source,
            boundary: Boundary::Intro,
            window_seconds: 0.25,
        }
    }

    fn deadline() -> Instant {
        Instant::now() + Duration::from_secs(30)
    }

    fn tone_wav() -> Vec<u8> {
        let rate = 48_000_u32;
        let mut samples = Vec::with_capacity(rate as usize * 2);
        for frame in 0..rate {
            let phase = 2.0 * PI * 80.0 * f64::from(frame) / f64::from(rate);
            let value = (phase.sin() * 12_000.0) as i16;
            samples.extend_from_slice(&[value, -value]);
        }
        let data_bytes = (samples.len() * 2) as u32;
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
        for sample in samples {
            wav.extend_from_slice(&sample.to_le_bytes());
        }
        wav
    }

    #[tokio::test]
    async fn off_thread_wav_matches_the_existing_offline_decoder() {
        let gate = Arc::new(SpectralAdmissionGate::new());
        let selected = source();
        let work = job(selected.clone());
        let bytes = tone_wav();
        let expected = analyze_verified_boundary_bytes(&bytes, &work, || Some(source()))
            .expect("valid offline reference");
        assert!(gate.select_source(Some(selected)));

        let worker = try_spawn_with_available_bytes(&gate, work, bytes, deadline(), || {
            Some(source())
        })
        .expect("work admitted");
        let measured = worker.await.expect("worker joined").expect("valid bands");
        assert_eq!(measured, expected);
        assert!(measured.low > 0.2, "{measured:?}");
        assert!(measured.high < 0.05, "{measured:?}");
    }

    #[test]
    fn missing_tokio_runtime_returns_neutral_without_reserving_slot() {
        let gate = Arc::new(SpectralAdmissionGate::new());
        let selected = source();
        assert!(gate.select_source(Some(selected.clone())));
        assert!(try_spawn_with_available_bytes(
            &gate,
            job(selected.clone()),
            tone_wav(),
            deadline(),
            || Some(source())
        )
        .is_none());
        assert!(gate
            .try_admit(&job(selected), 1024, Instant::now(), deadline())
            .is_some());
    }

    #[tokio::test]
    async fn stale_source_and_invalid_bytes_are_rejected_before_spawn() {
        let gate = Arc::new(SpectralAdmissionGate::new());
        let selected = source();
        assert!(gate.select_source(Some(selected.clone())));
        let other_server = SpectralSourceToken {
            server_scope: "server-b".into(),
            ..source()
        };
        assert!(try_spawn_with_available_bytes(
            &gate,
            job(selected.clone()),
            tone_wav(),
            deadline(),
            move || Some(other_server.clone())
        )
        .is_none());
        assert!(try_spawn_with_available_bytes(
            &gate,
            job(selected.clone()),
            Vec::new(),
            deadline(),
            || Some(source())
        )
        .is_none());
        assert!(try_spawn_with_available_bytes(
            &gate,
            job(selected),
            tone_wav(),
            Instant::now(),
            || Some(source())
        )
        .is_none());
    }

    #[tokio::test]
    async fn source_aba_discards_paused_worker_and_never_overlaps() {
        let gate = Arc::new(SpectralAdmissionGate::new());
        let first = source();
        assert!(gate.select_source(Some(first.clone())));
        let (ready_tx, ready_rx) = mpsc::channel();
        let (resume_tx, resume_rx) = mpsc::channel();
        let calls = Arc::new(AtomicUsize::new(0));
        let probe_calls = Arc::clone(&calls);
        let trusted = first.clone();
        let worker = try_spawn_with_available_bytes(
            &gate,
            job(first.clone()),
            tone_wav(),
            deadline(),
            move || {
                if probe_calls.fetch_add(1, Ordering::SeqCst) == 1 {
                    ready_tx.send(()).expect("signal started worker");
                    resume_rx.recv().expect("release worker");
                }
                Some(trusted.clone())
            },
        )
        .expect("first admitted");
        ready_rx
            .recv_timeout(Duration::from_secs(10))
            .expect("worker reached source check");

        let other = SpectralSourceToken {
            generation: first.generation + 1,
            ..source()
        };
        assert!(gate.select_source(Some(other)));
        assert!(gate.select_source(Some(first.clone())));
        assert!(try_spawn_with_available_bytes(
            &gate,
            job(first.clone()),
            tone_wav(),
            deadline(),
            || Some(source())
        )
        .is_none());

        resume_tx.send(()).expect("resume stale worker");
        assert!(worker.await.expect("worker joined").is_none());
        let replacement = try_spawn_with_available_bytes(
            &gate,
            job(first),
            tone_wav(),
            deadline(),
            || Some(source()),
        )
        .expect("slot released after stale worker exits");
        assert!(replacement.await.expect("worker joined").is_some());
    }

    #[tokio::test]
    async fn panic_in_source_check_releases_the_worker_slot() {
        let gate = Arc::new(SpectralAdmissionGate::new());
        assert!(gate.select_source(Some(source())));
        let calls = Arc::new(AtomicUsize::new(0));
        let probe_calls = Arc::clone(&calls);
        let worker = try_spawn_with_available_bytes(
            &gate,
            job(source()),
            tone_wav(),
            deadline(),
            move || {
                if probe_calls.fetch_add(1, Ordering::SeqCst) > 0 {
                    panic!("synthetic background source failure");
                }
                Some(source())
            },
        )
        .expect("first admitted");
        assert!(worker.await.is_err());
        let replacement = try_spawn_with_available_bytes(
            &gate,
            job(source()),
            tone_wav(),
            deadline(),
            || Some(source()),
        )
        .expect("lease released on worker panic");
        assert!(replacement.await.expect("worker joined").is_some());
    }
}
