//! Spectral AutoDJ experimental, offline-only admission/cancellation gate.
//!
//! This is NOT a worker executor or playback integration. A future owner-approved
//! worker may use one shared gate to serialize *already-owned, trusted* bytes.
//! Keep the lease alive until the worker exits. Cancellation does not free the
//! occupied slot early: a decoder must acknowledge cancellation first.
//!
//! All deadlines are provided by the caller (there is no approved live budget).
//! No audio buffers, result cache, file I/O, HTTP, Tauri IPC or threads are owned.

use std::sync::{Arc, Mutex};
use std::time::Instant;

use super::{SpectralBoundaryJob, SpectralSourceToken};

// Match the existing bounded decoder's encoded-input ceiling. Any future
// decoder ceiling change must be reviewed alongside this admission limit.
pub(super) const MAX_ENCODED_BYTES: usize = 64 * 1024 * 1024;
const MIN_WINDOW_SECONDS: f64 = 0.1;
const MAX_WINDOW_SECONDS: f64 = 6.0;

#[derive(Debug, Default)]
pub struct SpectralAdmissionGate {
    state: Mutex<GateState>,
}

#[derive(Debug, Default)]
struct GateState {
    selected: Option<SpectralSourceToken>,
    in_flight: Option<InFlight>,
    last_ticket: u64,
}

#[derive(Debug)]
struct InFlight {
    ticket: u64,
    source: SpectralSourceToken,
    deadline: Instant,
    cancelled: bool,
}

/// An uncloneable reservation for one worker. Dropping it (including on a
/// worker panic) releases the slot, while a cancelled worker continues to
/// occupy the slot until the worker actually exits.
#[derive(Debug)]
pub struct SpectralWorkLease {
    gate: Arc<SpectralAdmissionGate>,
    ticket: u64,
    settled: bool,
}

impl SpectralAdmissionGate {
    pub fn new() -> Self {
        Self::default()
    }

    /// Install a freshly authenticated source identity. All changes cancel
    /// the previous lease, including A -> B -> A transitions, but the lease
    /// keeps the slot occupied until its worker releases it.
    ///
    /// Invalid source identities are cleared and return false. Never infer
    /// identity or content revision from raw track IDs alone.
    pub fn select_source(&self, source: Option<SpectralSourceToken>) -> bool {
        let usable = source.as_ref().is_none_or(SpectralSourceToken::usable);
        let next = if usable { source } else { None };
        let Ok(mut state) = self.state.lock() else {
            return false;
        };
        if state.selected != next {
            if let Some(active) = state.in_flight.as_mut() {
                active.cancelled = true;
            }
        }
        state.selected = next;
        usable
    }

    /// Cancel an in-flight request without releasing its slot. A stopped
    /// worker drops its lease or calls finish; there is never a queued job.
    pub fn cancel_active(&self) {
        if let Ok(mut state) = self.state.lock() {
            if let Some(active) = state.in_flight.as_mut() {
                active.cancelled = true;
            }
        }
    }

    /// Try to admit one bounded already-available source. No encoded bytes
    /// are copied or retained. The caller must enforce its own authenticated
    /// media revision and provide a deadline before attempting work.
    ///
    /// No queue is created. A busy, invalid or poisoned gate returns None.
    pub fn try_admit(
        self: &Arc<Self>,
        job: &SpectralBoundaryJob,
        encoded_bytes: usize,
        now: Instant,
        deadline: Instant,
    ) -> Option<SpectralWorkLease> {
        if encoded_bytes == 0
            || encoded_bytes > MAX_ENCODED_BYTES
            || !(MIN_WINDOW_SECONDS..=MAX_WINDOW_SECONDS).contains(&job.window_seconds)
            || !job.source.usable()
            || deadline <= now
        {
            return None;
        }
        let mut state = self.state.lock().ok()?;
        if state.in_flight.is_some() || state.selected.as_ref() != Some(&job.source) {
            return None;
        }
        // Never wrap: an extremely long-lived session must fail closed rather
        // than allow an old ticket to match a new work item.
        let ticket = state.last_ticket.checked_add(1)?;
        state.last_ticket = ticket;
        state.in_flight = Some(InFlight {
            ticket,
            source: job.source.clone(),
            deadline,
            cancelled: false,
        });
        Some(SpectralWorkLease {
            gate: Arc::clone(self),
            ticket,
            settled: false,
        })
    }

    fn is_current(
        &self,
        ticket: u64,
        now: Instant,
        live_source: Option<&SpectralSourceToken>,
    ) -> bool {
        let Ok(state) = self.state.lock() else {
            return false;
        };
        state.in_flight.as_ref().is_some_and(|active| {
            active.ticket == ticket
                && !active.cancelled
                && now < active.deadline
                && state.selected.as_ref() == Some(&active.source)
                && live_source == Some(&active.source)
        })
    }

    fn settle(&self, ticket: u64, now: Instant, live_source: Option<&SpectralSourceToken>) -> bool {
        let Ok(mut state) = self.state.lock() else {
            return false;
        };
        let Some(active) = state.in_flight.as_ref() else {
            return false;
        };
        if active.ticket != ticket {
            return false;
        }
        let accepted = !active.cancelled
            && now < active.deadline
            && state.selected.as_ref() == Some(&active.source)
            && live_source == Some(&active.source);
        state.in_flight = None;
        // A future playback consumer must make ANOTHER fresh token check at
        // its own final handoff; this is not permission to apply a result.
        accepted
    }

    fn release(&self, ticket: u64) {
        if let Ok(mut state) = self.state.lock() {
            if state
                .in_flight
                .as_ref()
                .is_some_and(|active| active.ticket == ticket)
            {
                state.in_flight = None;
            }
        }
    }
}

impl SpectralWorkLease {
    /// Use as the cheap per-packet/current-generation check in a future
    /// worker, with a fresh caller-trusted current-source snapshot.
    /// Neither timeout nor cancellation can interrupt a blocked decoder;
    /// they only make the eventual completion ineligible for delivery.
    pub fn is_current(&self, now: Instant, live_source: Option<&SpectralSourceToken>) -> bool {
        !self.settled && self.gate.is_current(self.ticket, now, live_source)
    }

    /// Only a completed worker may settle its lease. The return value is
    /// an eligibility check, not an audio result or final playback approval.
    pub fn finish(mut self, now: Instant, live_source: Option<&SpectralSourceToken>) -> bool {
        let accepted = self.gate.settle(self.ticket, now, live_source);
        self.settled = true;
        accepted
    }
}

impl Drop for SpectralWorkLease {
    fn drop(&mut self) {
        if !self.settled {
            self.gate.release(self.ticket);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{mpsc, Arc};
    use std::thread;
    use std::time::{Duration, Instant};

    use super::*;
    use crate::spectral_autodj::Boundary;

    fn source() -> SpectralSourceToken {
        SpectralSourceToken {
            server_scope: "server-a".into(),
            library_scope: "library-a".into(),
            track_id: "shared-track-id".into(),
            content_revision: "revision-1".into(),
            generation: 1,
        }
    }

    fn job(source: SpectralSourceToken) -> SpectralBoundaryJob {
        SpectralBoundaryJob {
            source,
            boundary: Boundary::Outro,
            window_seconds: 0.5,
        }
    }

    fn deadline(now: Instant) -> Instant {
        now + Duration::from_millis(500)
    }

    #[test]
    fn single_slot_rejects_concurrent_work_and_drop_releases_capacity() {
        let gate = Arc::new(SpectralAdmissionGate::new());
        let current = source();
        let now = Instant::now();
        assert!(gate.select_source(Some(current.clone())));
        let lease = gate
            .try_admit(&job(current.clone()), 1024, now, deadline(now))
            .expect("first work item can reserve the only slot");
        assert!(lease.is_current(now, Some(&current)));
        assert!(
            gate.try_admit(&job(current.clone()), 1024, now, deadline(now))
                .is_none(),
            "no queue or second concurrent work item"
        );
        drop(lease);
        let next = gate
            .try_admit(&job(current.clone()), 1024, now, deadline(now))
            .expect("slot freed only after the worker releases its lease");
        assert!(next.finish(now, Some(&current)));
    }

    #[test]
    fn invalid_scope_size_window_deadline_and_ticket_exhaustion_fail_closed() {
        let gate = Arc::new(SpectralAdmissionGate::new());
        let now = Instant::now();
        let current = source();
        assert!(gate
            .try_admit(&job(current.clone()), 1024, now, deadline(now))
            .is_none());
        for bad_source in [
            SpectralSourceToken {
                server_scope: " ".into(),
                ..source()
            },
            SpectralSourceToken {
                library_scope: String::new(),
                ..source()
            },
            SpectralSourceToken {
                track_id: String::new(),
                ..source()
            },
            SpectralSourceToken {
                content_revision: String::new(),
                ..source()
            },
            SpectralSourceToken {
                generation: 0,
                ..source()
            },
        ] {
            assert!(!gate.select_source(Some(bad_source)));
        }
        assert!(gate.select_source(Some(current.clone())));
        for size in [0, MAX_ENCODED_BYTES + 1] {
            assert!(gate
                .try_admit(&job(current.clone()), size, now, deadline(now))
                .is_none());
        }
        for window_seconds in [0.0, 0.099, 6.01, f64::NAN, f64::INFINITY] {
            let mut invalid = job(current.clone());
            invalid.window_seconds = window_seconds;
            assert!(gate.try_admit(&invalid, 1024, now, deadline(now)).is_none());
        }
        assert!(gate
            .try_admit(&job(current.clone()), 1024, now, now)
            .is_none());
        assert!(gate
            .try_admit(
                &job(current.clone()),
                1024,
                now,
                now - Duration::from_secs(1)
            )
            .is_none());
        gate.state.lock().unwrap().last_ticket = u64::MAX;
        assert!(gate
            .try_admit(&job(current), MAX_ENCODED_BYTES, now, deadline(now))
            .is_none());
    }

    #[test]
    fn full_identity_must_match_even_when_track_ids_are_equal() {
        let gate = Arc::new(SpectralAdmissionGate::new());
        let now = Instant::now();
        let selected = source();
        assert!(gate.select_source(Some(selected.clone())));
        for wrong in [
            SpectralSourceToken {
                server_scope: "server-b".into(),
                ..source()
            },
            SpectralSourceToken {
                library_scope: "library-b".into(),
                ..source()
            },
            SpectralSourceToken {
                content_revision: "revision-2".into(),
                ..source()
            },
            SpectralSourceToken {
                generation: 2,
                ..source()
            },
        ] {
            assert_eq!(wrong.track_id, selected.track_id);
            assert!(gate
                .try_admit(&job(wrong), 1024, now, deadline(now))
                .is_none());
        }
        let lease = gate
            .try_admit(&job(selected.clone()), 1024, now, deadline(now))
            .unwrap();
        let other_server = SpectralSourceToken {
            server_scope: "server-b".into(),
            ..source()
        };
        assert!(!lease.is_current(now, Some(&other_server)));
        assert!(!lease.finish(now, Some(&other_server)));
    }

    #[test]
    fn cancel_and_source_aba_never_resurrect_old_work_or_overlap_workers() {
        let gate = Arc::new(SpectralAdmissionGate::new());
        let now = Instant::now();
        let original = source();
        let different = SpectralSourceToken {
            generation: 2,
            ..source()
        };
        gate.select_source(Some(original.clone()));
        let first = gate
            .try_admit(&job(original.clone()), 1024, now, deadline(now))
            .unwrap();
        gate.select_source(Some(different.clone()));
        gate.select_source(Some(original.clone()));
        assert!(!first.is_current(now, Some(&original)));
        assert!(gate
            .try_admit(&job(original.clone()), 1024, now, deadline(now))
            .is_none());
        assert!(!first.finish(now, Some(&original)));
        let second = gate
            .try_admit(&job(original.clone()), 1024, now, deadline(now))
            .unwrap();
        gate.cancel_active();
        assert!(!second.is_current(now, Some(&original)));
        assert!(!second.finish(now, Some(&original)));
        let third = gate
            .try_admit(&job(original.clone()), 1024, now, deadline(now))
            .unwrap();
        assert!(third.finish(now, Some(&original)));
    }

    #[test]
    fn deadline_expiry_rejects_completion_but_holds_slot_until_exit() {
        let gate = Arc::new(SpectralAdmissionGate::new());
        let now = Instant::now();
        let current = source();
        gate.select_source(Some(current.clone()));
        let lease = gate
            .try_admit(
                &job(current.clone()),
                1024,
                now,
                now + Duration::from_millis(1),
            )
            .unwrap();
        let later = now + Duration::from_millis(2);
        assert!(!lease.is_current(later, Some(&current)));
        assert!(gate
            .try_admit(&job(current.clone()), 1024, later, deadline(later))
            .is_none());
        assert!(!lease.finish(later, Some(&current)));
        let next = gate
            .try_admit(&job(current.clone()), 1024, later, deadline(later))
            .unwrap();
        assert!(next.finish(later, Some(&current)));
    }

    #[test]
    fn cross_thread_source_replacement_cancels_without_early_slot_release() {
        let gate = Arc::new(SpectralAdmissionGate::new());
        let now = Instant::now();
        let a = source();
        let b = SpectralSourceToken {
            server_scope: "server-b".into(),
            ..source()
        };
        gate.select_source(Some(a.clone()));
        let lease = gate
            .try_admit(&job(a.clone()), 1024, now, deadline(now))
            .unwrap();
        let (ready_tx, ready_rx) = mpsc::channel();
        let (resume_tx, resume_rx) = mpsc::channel();
        let worker = thread::spawn(move || {
            ready_tx.send(()).unwrap();
            resume_rx.recv().unwrap();
            assert!(!lease.is_current(now, Some(&a)));
            lease.finish(now, Some(&a))
        });
        ready_rx.recv().unwrap();
        gate.select_source(Some(b.clone()));
        assert!(gate
            .try_admit(&job(b.clone()), 1024, now, deadline(now))
            .is_none());
        resume_tx.send(()).unwrap();
        assert!(!worker.join().unwrap());
        let replacement = gate
            .try_admit(&job(b.clone()), 1024, now, deadline(now))
            .unwrap();
        assert!(replacement.finish(now, Some(&b)));
    }

    #[test]
    fn worker_unwind_drops_lease_and_frees_slot() {
        let gate = Arc::new(SpectralAdmissionGate::new());
        let now = Instant::now();
        let current = source();
        gate.select_source(Some(current.clone()));
        let lease = gate
            .try_admit(&job(current.clone()), 1024, now, deadline(now))
            .unwrap();
        let worker = thread::spawn(move || {
            let _lease = lease;
            panic!("synthetic worker failure");
        });
        assert!(worker.join().is_err());
        let replacement = gate
            .try_admit(&job(current.clone()), 1024, now, deadline(now))
            .unwrap();
        assert!(replacement.finish(now, Some(&current)));
    }
}
