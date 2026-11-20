//! Monotonic ordinary-analysis admission activity marker.
//!
//! A queue entry or CPU submission revokes speculative spectral analysis even
//! if the ordinary queue becomes empty before the next decoder callback.
//! This is an observation-only epoch, NOT an exclusive CPU-slot reservation.
//! No background worker, source fetch, or additional queue is started here.

use std::sync::atomic::{AtomicU64, Ordering};

struct ActivityEpoch {
    value: AtomicU64,
}

impl ActivityEpoch {
    const fn new(value: u64) -> Self {
        Self {
            value: AtomicU64::new(value),
        }
    }

    fn current(&self) -> Option<u64> {
        let value = self.value.load(Ordering::SeqCst);
        (value != u64::MAX).then_some(value)
    }

    fn record(&self) {
        // Saturate permanently rather than wrap to a previously accepted
        // generation; exhaustion must fail closed for future spectral work.
        let _ = self
            .value
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_add(1));
    }
}

static ORDINARY_ACTIVITY: ActivityEpoch = ActivityEpoch::new(0);

pub(super) fn ordinary_activity_epoch() -> Option<u64> {
    ORDINARY_ACTIVITY.current()
}

/// Called by actual HTTP queue admission and CPU-seed submission. This has
/// no effect on their ordinary queue order, wakeups, or job deduplication.
pub(super) fn record_ordinary_queue_submission() {
    ORDINARY_ACTIVITY.record();
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
}
