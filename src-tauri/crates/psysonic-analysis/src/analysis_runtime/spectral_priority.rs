//! Monotonic ordinary-analysis activity and revocable spectral CPU reservation.
//!
//! Ordinary queue submissions revoke speculative spectral work without waiting
//! for a blocking decoder to exit. Only one global speculative reservation may
//! exist; it does NOT reserve a physical CPU core, throttle normal workers, or
//! preempt a codec blocked between cancellation checks.
//!
//! The coordinator contains no download source, worker queue, or playback API.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};

#[derive(Debug)]
pub(crate) struct ActivityEpoch {
    value: AtomicU64,
    spectral_reserved: AtomicBool,
}

/// Noncloneable permit held until the speculative worker exits, including
/// when its JoinHandle was dropped or the worker unwinds. Ordinary jobs never
/// wait for this permit; their new activity generation revokes its validity.
#[derive(Debug)]
pub(crate) struct SpectralCpuReservation {
    epoch: u64,
    owner: Arc<ActivityEpoch>,
}

impl ActivityEpoch {
    pub(crate) const fn new(value: u64) -> Self {
        Self {
            value: AtomicU64::new(value),
            spectral_reserved: AtomicBool::new(false),
        }
    }

    pub(crate) fn current(&self) -> Option<u64> {
        let value = self.value.load(Ordering::SeqCst);
        (value != u64::MAX).then_some(value)
    }

    pub(crate) fn record(&self) {
        // Saturate permanently rather than wrap to a previously accepted
        // generation; exhaustion must fail closed for future spectral work.
        let _ = self
            .value
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_add(1));
    }

    pub(crate) fn try_reserve(self: &Arc<Self>, epoch: u64) -> Option<SpectralCpuReservation> {
        if self.current()? != epoch {
            return None;
        }
        self.spectral_reserved
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .ok()?;
        let reservation = SpectralCpuReservation {
            epoch,
            owner: Arc::clone(self),
        };
        // Ordinary enqueue may race the CAS; the second check fails closed
        // and the RAII drop releases the speculative slot.
        if !reservation.is_current() {
            return None;
        }
        Some(reservation)
    }
}

impl SpectralCpuReservation {
    pub(crate) fn is_current(&self) -> bool {
        self.owner.spectral_reserved.load(Ordering::SeqCst)
            && self.owner.current() == Some(self.epoch)
    }
}

impl Drop for SpectralCpuReservation {
    fn drop(&mut self) {
        self.owner.spectral_reserved.store(false, Ordering::SeqCst);
    }
}

static ORDINARY_ACTIVITY: OnceLock<Arc<ActivityEpoch>> = OnceLock::new();

fn shared_activity() -> &'static Arc<ActivityEpoch> {
    ORDINARY_ACTIVITY.get_or_init(|| Arc::new(ActivityEpoch::new(0)))
}

pub(super) fn ordinary_activity_epoch() -> Option<u64> {
    shared_activity().current()
}

/// Actual HTTP queue admission and CPU-seed submission call this; it does
/// not alter normal queue order, wakeups, capacity or deduplication.
pub(super) fn record_ordinary_queue_submission() {
    shared_activity().record();
}

/// Experimental spectral-only admission. Call only after a fresh idle probe.
/// Ordinary queues are NOT required to acquire or release this reservation.
pub(crate) fn reserve_spectral_cpu(epoch: u64) -> Option<SpectralCpuReservation> {
    shared_activity().try_reserve(epoch)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis_runtime::backfill_queue::AnalysisBackfillQueueState;
    use crate::analysis_runtime::cpu_seed::AnalysisCpuSeedQueueState;
    use crate::analysis_runtime::types::AnalysisBackfillPriority;

    #[test]
    fn monotonic_generation_never_wraps_or_revalidates_old_tickets() {
        let epoch = ActivityEpoch::new(11);
        assert_eq!(epoch.current(), Some(11));
        epoch.record();
        assert_eq!(epoch.current(), Some(12));

        let near_exhaustion = ActivityEpoch::new(u64::MAX - 1);
        assert_eq!(near_exhaustion.current(), Some(u64::MAX - 1));
        near_exhaustion.record();
        assert_eq!(near_exhaustion.current(), None);
        near_exhaustion.record();
        assert_eq!(near_exhaustion.current(), None);
    }

    #[test]
    fn ordinary_http_and_cpu_queue_entries_both_advance_epoch() {
        let before = ordinary_activity_epoch().expect("not exhausted");
        let mut http = AnalysisBackfillQueueState::default();
        http.push_new(
            AnalysisBackfillPriority::High,
            (
                "synthetic-track".into(),
                "synthetic-url".into(),
                "server".into(),
            ),
        );
        let after_http = ordinary_activity_epoch().expect("not exhausted");
        assert!(
            after_http > before,
            "HTTP queue must revoke spectral ticket"
        );

        let mut cpu = AnalysisCpuSeedQueueState::default();
        let (_kind, _rx) = cpu.enqueue(
            "server".into(),
            "synthetic-track".into(),
            vec![1, 2, 3],
            None,
            None,
            AnalysisBackfillPriority::Low,
            0,
        );
        let after_cpu = ordinary_activity_epoch().expect("not exhausted");
        assert!(
            after_cpu > after_http,
            "CPU queue must revoke spectral ticket"
        );
    }

    #[test]
    fn one_speculative_cpu_slot_is_held_until_the_worker_exits() {
        let owner = Arc::new(ActivityEpoch::new(7));
        let first = owner.try_reserve(7).expect("first reservation");
        assert!(first.is_current());
        assert!(owner.try_reserve(7).is_none());

        owner.record();
        assert!(!first.is_current());
        assert!(owner.try_reserve(8).is_none());

        drop(first);
        let replacement = owner.try_reserve(8).expect("lease released on drop");
        assert!(replacement.is_current());
    }

    #[test]
    fn ordinary_work_revokes_a_speculative_slot_without_waiting() {
        let owner = Arc::new(ActivityEpoch::new(3));
        let held = owner.try_reserve(3).expect("speculative reservation");
        // Ordinary analysis must never acquire the speculative reservation.
        // An enqueue just advances the epoch and proceeds immediately.
        owner.record();
        assert_eq!(owner.current(), Some(4));
        assert!(!held.is_current());
        assert!(owner.try_reserve(4).is_none());

        drop(held);
        assert!(owner.try_reserve(4).is_some());
    }

    #[test]
    fn stale_or_exhausted_epochs_never_reserve_work() {
        let owner = Arc::new(ActivityEpoch::new(5));
        assert!(owner.try_reserve(4).is_none());
        let lease = owner.try_reserve(5).expect("current epoch");
        drop(lease);

        let exhausted = Arc::new(ActivityEpoch::new(u64::MAX));
        assert!(exhausted.current().is_none());
        assert!(exhausted.try_reserve(u64::MAX).is_none());
        assert!(exhausted.try_reserve(0).is_none());
    }
}
