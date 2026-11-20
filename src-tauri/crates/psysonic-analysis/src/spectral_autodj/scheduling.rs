//! Conservative CPU-seed-aware preflight for optional Spectral AutoDJ work.
//!
//! This staging-only path observes, but does not alter, the HTTP backfill
//! and CPU-seed worker queues. It owns no fetcher, download, cache, IPC or
//! playback integration. It consumes a length-checked, owned ORIGINAL capture
//! whose source token and trusted revision have already matched.
//!
//! Ordinary submissions revoke the one nonblocking speculative CPU reservation
//! through a monotonic generation. The reservation is held until the worker
//! actually exits, even if a JoinHandle is dropped. Normal jobs never wait for
//! it. It does NOT reserve a physical CPU core or interrupt blocked codecs.

use std::sync::Arc;
use std::time::Instant;

use tokio::task::JoinHandle;

use super::executor::{try_spawn_with_available_bytes, SpectralCompletedBoundary};
use super::lifecycle::SpectralAdmissionGate;
use super::owned_source::SpectralOwnedOriginal;
use super::{SpectralBoundaryJob, SpectralSourceToken};
use crate::analysis_runtime::{
    reserve_spectral_cpu, spectral_ordinary_pipeline_idle_epoch, SpectralCpuReservation,
};

/// Attempt one low-priority worker only for an already-owned completed
/// original, while both ordinary queues are idle and an epoch-matched
/// speculative CPU slot can be reserved. Queue absence or contention fails
/// closed without waiting or fetching audio.
///
/// A subsequent ordinary submission revokes eligibility immediately, but a
/// codec already between cancellation checks can still overlap CPU work.
/// Successful results require another source and activity check at final use.
pub fn try_spawn_if_ordinary_analysis_idle<F>(
    gate: &Arc<SpectralAdmissionGate>,
    job: SpectralBoundaryJob,
    original: SpectralOwnedOriginal,
    deadline: Instant,
    live_source: F,
) -> Option<JoinHandle<Option<SpectralCompletedBoundary>>>
where
    F: Fn() -> Option<SpectralSourceToken> + Send + 'static,
{
    try_spawn_verified_with_probe(
        gate,
        job,
        original,
        deadline,
        live_source,
        spectral_ordinary_pipeline_idle_epoch,
        reserve_spectral_cpu,
    )
}

fn try_spawn_verified_with_probe<F, P, R>(
    gate: &Arc<SpectralAdmissionGate>,
    job: SpectralBoundaryJob,
    original: SpectralOwnedOriginal,
    deadline: Instant,
    live_source: F,
    pipeline_epoch: P,
    reserve: R,
) -> Option<JoinHandle<Option<SpectralCompletedBoundary>>>
where
    F: Fn() -> Option<SpectralSourceToken> + Send + 'static,
    P: Fn() -> Option<u64> + Send + 'static,
    R: FnOnce(u64) -> Option<SpectralCpuReservation>,
{
    let (verified_source, bytes) = original.into_parts();
    if verified_source != job.source {
        return None;
    }
    let epoch = pipeline_epoch()?;
    let reservation = reserve(epoch)?;
    // The noncloneable permit lives in the source callback, which itself is
    // held by the blocking worker through completion (also on panic/unwind).
    try_spawn_with_idle_probe(
        gate,
        job,
        bytes,
        deadline,
        move || {
            if reservation.is_current() {
                live_source()
            } else {
                None
            }
        },
        pipeline_epoch,
    )
}

fn try_spawn_with_idle_probe<F, P>(
    gate: &Arc<SpectralAdmissionGate>,
    job: SpectralBoundaryJob,
    bytes: Vec<u8>,
    deadline: Instant,
    live_source: F,
    pipeline_epoch: P,
) -> Option<JoinHandle<Option<SpectralCompletedBoundary>>>
where
    F: Fn() -> Option<SpectralSourceToken> + Send + 'static,
    P: Fn() -> Option<u64> + Send + 'static,
{
    let admitted_epoch = pipeline_epoch()?;

    // Revalidate the SAME epoch before admission, once per decoder callback
    // and at completion. A brief busy -> idle transition cannot resurrect a
    // previously admitted speculative spectral job.
    try_spawn_with_available_bytes(gate, job, bytes, deadline, move || {
        if pipeline_epoch() == Some(admitted_epoch) {
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
        P: Fn() -> Option<u64> + Send + 'static,
    {
        try_spawn_with_idle_probe(gate, job(), wav(), deadline(), source_option, probe)
    }

    #[tokio::test]
    async fn idle_probe_allows_owned_bytes_and_preserves_source_identity() {
        let gate = Arc::new(SpectralAdmissionGate::new());
        assert!(gate.select_source(Some(source())));
        let worker = try_test_request(&gate, || Some(5)).expect("verified idle source can enter");
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

        let checks = Arc::new(AtomicUsize::new(0));
        let next = Arc::clone(&checks);
        let became_busy = try_test_request(&gate, move || {
            if next.fetch_add(1, Ordering::SeqCst) == 0 {
                Some(5)
            } else {
                None
            }
        });
        assert!(became_busy.is_none());
        let worker =
            try_test_request(&gate, || Some(5)).expect("rejected work did not reserve the slot");
        assert!(worker.await.expect("worker joined").is_some());
    }

    #[tokio::test]
    async fn ordinary_work_arriving_before_admission_rejects_spectral_job() {
        let gate = Arc::new(SpectralAdmissionGate::new());
        assert!(gate.select_source(Some(source())));
        let polls = Arc::new(AtomicUsize::new(0));
        let next = Arc::clone(&polls);
        let rejected = try_test_request(&gate, move || {
            if next.fetch_add(1, Ordering::SeqCst) == 0 {
                Some(5)
            } else {
                Some(6)
            }
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
        let worker = try_test_request(&gate, move || {
            (next.fetch_add(1, Ordering::SeqCst) < 6).then_some(5)
        })
        .expect("initially idle");
        assert!(worker.await.expect("worker joined").is_none());
        assert!(polls.load(Ordering::SeqCst) > 6);
        // The dropped lease must free its slot even when queue pressure
        // arrived after an initially eligible admission.
        assert!(gate
            .try_admit(&job(), 1024, Instant::now(), deadline())
            .is_some());
    }

    #[tokio::test]
    async fn transient_busy_then_idle_activity_never_revalidates_an_old_epoch() {
        let gate = Arc::new(SpectralAdmissionGate::new());
        assert!(gate.select_source(Some(source())));
        let polls = Arc::new(AtomicUsize::new(0));
        let next = Arc::clone(&polls);
        let worker = try_test_request(&gate, move || {
            // Even after the queue becomes idle again, generation 6 differs
            // permanently from the originally admitted generation 5.
            let poll = next.fetch_add(1, Ordering::SeqCst);
            Some(if poll < 6 { 5 } else { 6 })
        })
        .expect("admitted under original idle epoch");
        assert!(worker.await.expect("worker joined").is_none());
        assert!(polls.load(Ordering::SeqCst) > 6);
        assert!(gate
            .try_admit(&job(), 1024, Instant::now(), deadline())
            .is_some());
    }

    fn verified_wav() -> (SpectralOwnedOriginal, SpectralBoundaryJob, SpectralSourceToken) {
        let bytes = wav();
        let mut selected = source();
        selected.content_revision = crate::analysis_cache::md5_first_16kb(&bytes);
        let trusted = crate::analysis_runtime::TrustedAnalysisRevision {
            md5_16kb: selected.content_revision.clone(),
            generation: selected.generation,
            analysis_bytes_transcoded: false,
            content_hash_server_id: Some("library-a".into()),
        };
        let original = SpectralOwnedOriginal::try_from_completed_original(
            selected.clone(),
            &selected,
            "server-a",
            bytes.len(),
            &trusted,
            bytes,
        )
        .expect("completed owned original");
        let work = SpectralBoundaryJob {
            source: selected.clone(),
            boundary: Boundary::Intro,
            window_seconds: 0.25,
        };
        (original, work, selected)
    }

    #[tokio::test]
    async fn owned_original_with_spare_slot_yields_source_bound_result() {
        use crate::analysis_runtime::ActivityEpoch;

        let (original, work, selected) = verified_wav();
        let gate = Arc::new(SpectralAdmissionGate::new());
        assert!(gate.select_source(Some(selected.clone())));
        let coordinator = Arc::new(ActivityEpoch::new(5));
        let probe = Arc::clone(&coordinator);
        let reserve = Arc::clone(&coordinator);
        let current = selected.clone();
        let worker = try_spawn_verified_with_probe(
            &gate,
            work,
            original,
            deadline(),
            move || Some(current.clone()),
            move || probe.current(),
            move |epoch| reserve.try_reserve(epoch),
        )
        .expect("one validated original can start");
        let result = worker.await.expect("joined").expect("measured bands");
        assert_eq!(result.source, selected);
        assert!(result.bands.low > 0.2);
        assert!(coordinator.try_reserve(5).is_some());
    }

    #[tokio::test]
    async fn source_job_mismatch_cannot_take_speculative_cpu_slot() {
        use crate::analysis_runtime::ActivityEpoch;

        let (original, mut work, selected) = verified_wav();
        work.source.generation += 1;
        let coordinator = Arc::new(ActivityEpoch::new(5));
        let gate = Arc::new(SpectralAdmissionGate::new());
        assert!(gate.select_source(Some(selected.clone())));
        let probe = Arc::clone(&coordinator);
        let reserve = Arc::clone(&coordinator);
        let rejected = try_spawn_verified_with_probe(
            &gate,
            work,
            original,
            deadline(),
            move || Some(selected.clone()),
            move || probe.current(),
            move |epoch| reserve.try_reserve(epoch),
        );
        assert!(rejected.is_none());
        assert!(coordinator.try_reserve(5).is_some());
    }

    #[tokio::test]
    async fn ordinary_enqueue_revokes_held_slot_until_worker_exits() {
        use std::sync::mpsc;

        use crate::analysis_runtime::ActivityEpoch;

        let (original, work, selected) = verified_wav();
        let gate = Arc::new(SpectralAdmissionGate::new());
        assert!(gate.select_source(Some(selected.clone())));
        let coordinator = Arc::new(ActivityEpoch::new(5));
        let probe = Arc::clone(&coordinator);
        let reserve = Arc::clone(&coordinator);
        let (ready_tx, ready_rx) = mpsc::channel();
        let (resume_tx, resume_rx) = mpsc::channel();
        let calls = Arc::new(AtomicUsize::new(0));
        let seen = Arc::clone(&calls);
        let current = selected.clone();
        let worker = try_spawn_verified_with_probe(
            &gate,
            work,
            original,
            deadline(),
            move || {
                if seen.fetch_add(1, Ordering::SeqCst) == 1 {
                    ready_tx.send(()).expect("worker entered");
                    resume_rx.recv().expect("worker resumed");
                }
                Some(current.clone())
            },
            move || probe.current(),
            move |epoch| reserve.try_reserve(epoch),
        )
        .expect("worker admitted before ordinary queue activity");
        ready_rx
            .recv_timeout(Duration::from_secs(10))
            .expect("blocking worker reached source check");
        assert!(coordinator.try_reserve(5).is_none());

        coordinator.record(); // ordinary queue gains immediate priority
        assert!(coordinator.try_reserve(6).is_none());
        resume_tx.send(()).expect("unblock worker");
        assert!(worker.await.expect("worker joined").is_none());
        assert!(coordinator.try_reserve(6).is_some());
    }
}
