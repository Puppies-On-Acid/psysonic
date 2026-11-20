//! Conservative CPU-seed-aware preflight for optional Spectral AutoDJ work.
//!
//! This staging-only path observes, but does not alter, the existing HTTP
//! backfill and CPU-seed queues. It owns no source provider, queue, download,
//! persistent result or playback integration. Already-authenticated bytes
//! must be supplied by the caller and are never cloned by this adapter.
//!
//! Idle snapshots are advisory: a normal job can start immediately afterward.
//! Recheck on every decoder callback so that ordinary work emerging during a
//! spectral attempt causes a neutral result. This cannot preempt a blocked
//! codec or guarantee zero overlap: live integration still requires explicit
//! priority arbitration, an activity epoch and a verified byte source.

use std::sync::Arc;
use std::time::Instant;

use tokio::task::JoinHandle;

use super::executor::{try_spawn_with_available_bytes, SpectralCompletedBoundary};
use super::lifecycle::SpectralAdmissionGate;
use super::{SpectralBoundaryJob, SpectralSourceToken};
use crate::analysis_runtime::spectral_ordinary_pipeline_idle;

/// Attempt an off-thread analysis ONLY when both established ordinary analysis
/// queues appear idle. Missing, busy, contended or poisoned queues fail closed.
/// No queue is initialized here; a completely cold pipeline is not permission
/// to start a background decode.
///
/// This is experimental scaffolding, with no live runtime call site. A future
/// consumer must check the source token and latest queue activity after join
/// and again at the actual playback handoff. The idle sample is NOT a CPU slot
/// reservation and must not be mistaken for complete priority arbitration.
pub fn try_spawn_if_ordinary_analysis_idle<F>(
    gate: &Arc<SpectralAdmissionGate>,
    job: SpectralBoundaryJob,
    bytes: Vec<u8>,
    deadline: Instant,
    live_source: F,
) -> Option<JoinHandle<Option<SpectralCompletedBoundary>>>
where
    F: Fn() -> Option<SpectralSourceToken> + Send + 'static,
{
    try_spawn_with_idle_probe(
        gate,
        job,
        bytes,
        deadline,
        live_source,
        spectral_ordinary_pipeline_idle,
    )
}

fn try_spawn_with_idle_probe<F, P>(
    gate: &Arc<SpectralAdmissionGate>,
    job: SpectralBoundaryJob,
    bytes: Vec<u8>,
    deadline: Instant,
    live_source: F,
    pipeline_idle: P,
) -> Option<JoinHandle<Option<SpectralCompletedBoundary>>>
where
    F: Fn() -> Option<SpectralSourceToken> + Send + 'static,
    P: Fn() -> Option<bool> + Send + 'static,
{
    if pipeline_idle() != Some(true) {
        return None;
    }

    // The existing executor revalidates this combined state before the
    // worker starts, once per decoded packet and at completion. New ordinary
    // queue activity makes the work ineligible for any consumer.
    try_spawn_with_available_bytes(gate, job, bytes, deadline, move || {
        if pipeline_idle() == Some(true) {
            live_source()
        } else {
            None
        }
    })
}

#[cfg(test)]
mod tests {
    use std::f64::consts::PI;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    use super::*;
    use crate::spectral_autodj::Boundary;

    fn source() -> SpectralSourceToken {
        SpectralSourceToken {
            server_scope: "server-a".into(),
            library_scope: "library-a".into(),
            track_id: "synthetic-track".into(),
            content_revision: "trusted-revision".into(),
            generation: 3,
        }
    }

    fn job() -> SpectralBoundaryJob {
        SpectralBoundaryJob {
            source: source(),
            boundary: Boundary::Intro,
            window_seconds: 0.25,
        }
    }

    fn deadline() -> Instant {
        Instant::now() + Duration::from_secs(10)
    }

    fn wav() -> Vec<u8> {
        let rate = 48_000_u32;
        let frames = rate / 2;
        let pcm: Vec<i16> = (0..frames)
            .map(|i| {
                let phase = 2.0 * PI * 80.0 * f64::from(i) / f64::from(rate);
                (phase.sin() * 12_000.0) as i16
            })
            .collect();
        let data_bytes = (pcm.len() * 2) as u32;
        let mut bytes = Vec::with_capacity(44 + data_bytes as usize);
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data_bytes).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16_u32.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&rate.to_le_bytes());
        bytes.extend_from_slice(&(rate * 2).to_le_bytes());
        bytes.extend_from_slice(&2_u16.to_le_bytes());
        bytes.extend_from_slice(&16_u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_bytes.to_le_bytes());
        for sample in pcm {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
        bytes
    }

    fn try_test_request<P>(
        gate: &Arc<SpectralAdmissionGate>,
        probe: P,
    ) -> Option<JoinHandle<Option<SpectralCompletedBoundary>>>
    where
        P: Fn() -> Option<bool> + Send + 'static,
    {
        try_spawn_with_idle_probe(gate, job(), wav(), deadline(), source_option, probe)
    }

    #[tokio::test]
    async fn idle_probe_allows_owned_bytes_and_preserves_source_identity() {
        let gate = Arc::new(SpectralAdmissionGate::new());
        assert!(gate.select_source(Some(source())));
        let worker =
            try_test_request(&gate, || Some(true)).expect("verified idle source can enter");
        let done = worker
            .await
            .expect("worker joined")
            .expect("valid spectrum");
        assert_eq!(done.source, source());
        assert!(done.bands.low > 0.2);
    }

    fn source_option() -> Option<SpectralSourceToken> {
        Some(source())
    }

    #[tokio::test]
    async fn unknown_or_busy_pipeline_never_consumes_the_admission_slot() {
        let gate = Arc::new(SpectralAdmissionGate::new());
        assert!(gate.select_source(Some(source())));
        assert!(try_test_request(&gate, || None).is_none());
        assert!(try_test_request(&gate, || Some(false)).is_none());
        let worker =
            try_test_request(&gate, || Some(true)).expect("rejected work did not reserve the slot");
        assert!(worker.await.expect("worker joined").is_some());
    }

    #[tokio::test]
    async fn ordinary_work_arriving_before_admission_rejects_spectral_job() {
        let gate = Arc::new(SpectralAdmissionGate::new());
        assert!(gate.select_source(Some(source())));
        let polls = Arc::new(AtomicUsize::new(0));
        let next = Arc::clone(&polls);
        let rejected = try_test_request(&gate, move || {
            Some(next.fetch_add(1, Ordering::SeqCst) == 0)
        });
        // The first idle check passed. Executor admission then rechecked and
        // observed ordinary analysis activity before reserving a worker slot.
        assert!(rejected.is_none());
        assert!(polls.load(Ordering::SeqCst) >= 2);
        assert!(gate
            .try_admit(&job(), 1024, Instant::now(), deadline())
            .is_some());
    }

    #[tokio::test]
    async fn ordinary_activity_during_decode_discards_the_stale_result() {
        let gate = Arc::new(SpectralAdmissionGate::new());
        assert!(gate.select_source(Some(source())));
        let polls = Arc::new(AtomicUsize::new(0));
        let next = Arc::clone(&polls);
        let worker = try_test_request(&gate, move || Some(next.fetch_add(1, Ordering::SeqCst) < 6))
            .expect("initially idle");
        assert!(worker.await.expect("worker joined").is_none());
        assert!(polls.load(Ordering::SeqCst) > 6);
        // The dropped lease must free its slot even when queue pressure
        // arrived after an initially eligible admission.
        assert!(gate
            .try_admit(&job(), 1024, Instant::now(), deadline())
            .is_some());
    }
}
