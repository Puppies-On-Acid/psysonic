//! Opt-in, memory-only handoff from verified existing media captures to the
//! experimental spectral worker. No playback caller or Tauri IPC arms requests.
//!
//! With no explicit request the hot path does one OnceLock::get and nothing
//! else: no copies, downloads, decoding, cache writes, queue or threads.
//! A caller must bind a request to the live playback generation; one completed
//! original capture may then supply a single bounded speculative attempt.
//! A result remains in memory until one fresh, source-checked consumption.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;

use tokio::task::JoinHandle;

use super::executor::SpectralCompletedBoundary;
use super::lifecycle::SpectralAdmissionGate;
use super::owned_source::SpectralOwnedOriginal;
use super::scheduling::try_spawn_if_ordinary_analysis_idle;
use super::{Boundary, SpectralBoundaryJob, SpectralSourceToken};
use crate::analysis_runtime::{
    spectral_ordinary_pipeline_idle_epoch, trusted_revision_is_current, TrustedAnalysisRevision,
};

/// A future approved playback caller must supply the SAME live generation
/// counter used to invalidate superseded plays and preloads.
#[derive(Clone)]
pub struct SpectralCaptureRequest {
    pub server_scope: String,
    pub library_scope: String,
    pub track_id: String,
    pub playback_generation: u64,
    pub playback_clock: Arc<AtomicU64>,
    pub boundary: Boundary,
    pub window_seconds: f64,
    pub deadline: Instant,
}

impl SpectralCaptureRequest {
    fn current(&self) -> bool {
        self.playback_generation == self.playback_clock.load(Ordering::SeqCst)
            && Instant::now() < self.deadline
    }

    fn usable(&self) -> bool {
        self.playback_generation > 0
            && self.current()
            && !self.server_scope.trim().is_empty()
            && !self.library_scope.trim().is_empty()
            && !self.track_id.trim().is_empty()
            && self.window_seconds.is_finite()
            && (0.1..=6.0).contains(&self.window_seconds)
    }

    fn matches(&self, server: &str, library: &str, track: &str) -> bool {
        self.current()
            && self.server_scope == server
            && self.library_scope == library
            && self.track_id == track
    }
}

struct Armed {
    ticket: u64,
    request: SpectralCaptureRequest,
    source: Option<SpectralSourceToken>,
    attempted: bool,
}

struct Ready {
    ticket: u64,
    epoch: u64,
    completed: SpectralCompletedBoundary,
}

#[derive(Default)]
struct State {
    last_ticket: u64,
    armed: Option<Armed>,
    ready: Option<Ready>,
}

/// At most one intent, one background attempt, and one optional result.
/// All work is speculative; never wait for a busy queue or rerun a fetch.
pub struct SpectralCaptureCoordinator {
    state: Mutex<State>,
    gate: Arc<SpectralAdmissionGate>,
    queue_epoch: Arc<dyn Fn() -> Option<u64> + Send + Sync>,
}

impl SpectralCaptureCoordinator {
    pub fn new() -> Arc<Self> {
        Self::with_epoch_probe(spectral_ordinary_pipeline_idle_epoch)
    }

    fn with_epoch_probe(
        probe: impl Fn() -> Option<u64> + Send + Sync + 'static,
    ) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(State::default()),
            gate: Arc::new(SpectralAdmissionGate::new()),
            queue_epoch: Arc::new(probe),
        })
    }

    /// Arm one preexisting source request. This does not download, schedule,
    /// or decode. Future approved playback logic must explicitly call it.
    pub fn arm(&self, request: SpectralCaptureRequest) -> bool {
        if !request.usable() {
            return false;
        }
        let Ok(mut state) = self.state.try_lock() else {
            return false;
        };
        let Some(ticket) = state.last_ticket.checked_add(1) else {
            return false;
        };
        if !self.gate.select_source(None) {
            return false;
        }
        state.last_ticket = ticket;
        state.armed = Some(Armed {
            ticket,
            request,
            source: None,
            attempted: false,
        });
        state.ready = None;
        true
    }

    pub fn cancel(&self) {
        if let Ok(mut state) = self.state.try_lock() {
            state.armed = None;
            state.ready = None;
            self.gate.select_source(None);
        }
    }

    fn live_source(&self, ticket: u64) -> Option<SpectralSourceToken> {
        let source = {
            let state = self.state.try_lock().ok()?;
            let armed = state.armed.as_ref()?;
            if armed.ticket != ticket || !armed.request.current() {
                return None;
            }
            armed.source.clone()?
        };
        trusted_revision_is_current(
            &source.server_scope,
            &source.track_id,
            &source.content_revision,
            source.generation,
        )
        .then_some(source)
    }

    /// Consume an already-completed original capture ONLY when an explicitly
    /// armed request matches. Copy media once for the worker; the ordinary
    /// analysis caller retains its original buffer. Never fetch missing media.
    pub fn offer_completed_original(
        self: &Arc<Self>,
        server: &str,
        track: &str,
        bytes: &[u8],
        complete_len: usize,
        trusted: &TrustedAnalysisRevision,
    ) -> bool {
        self.offer_with(
            server,
            track,
            bytes,
            complete_len,
            trusted,
            |gate, job, original, deadline, live| {
                try_spawn_if_ordinary_analysis_idle(gate, job, original, deadline, live)
            },
        )
    }

    fn offer_with<F>(
        self: &Arc<Self>,
        server: &str,
        track: &str,
        bytes: &[u8],
        complete_len: usize,
        trusted: &TrustedAnalysisRevision,
        spawn: F,
    ) -> bool
    where
        F: FnOnce(
            &Arc<SpectralAdmissionGate>,
            SpectralBoundaryJob,
            SpectralOwnedOriginal,
            Instant,
            Box<dyn Fn() -> Option<SpectralSourceToken> + Send>,
        ) -> Option<JoinHandle<Option<SpectralCompletedBoundary>>>,
    {
        let library = trusted.content_hash_server_id.as_deref().unwrap_or(server);
        let (ticket, request) = {
            let Ok(state) = self.state.try_lock() else {
                return false;
            };
            let Some(armed) = state.armed.as_ref() else {
                return false;
            };
            if armed.attempted || !armed.request.matches(server, library, track) {
                return false;
            }
            (armed.ticket, armed.request.clone())
        };

        // A 16-KiB prefix alone is not evidence of full-file completion.
        // The caller supplies a completed capture with independently checked
        // byte length, original provenance, and a registered trusted revision.
        if trusted.analysis_bytes_transcoded
            || trusted.generation == 0
            || bytes.is_empty()
            || bytes.len() != complete_len
            || !trusted_revision_is_current(server, track, &trusted.md5_16kb, trusted.generation)
            || tokio::runtime::Handle::try_current().is_err()
        {
            return false;
        }
        let Some(epoch) = (self.queue_epoch)() else {
            return false;
        };
        let source = SpectralSourceToken {
            server_scope: server.to_string(),
            library_scope: library.to_string(),
            track_id: track.to_string(),
            content_revision: trusted.md5_16kb.clone(),
            generation: trusted.generation,
        };
        if !crate::raw_probe::bytes_match_trusted(bytes, &trusted.md5_16kb) {
            return false;
        }

        // Ownership is transferred to the optional worker, not retained by
        // the registry. No allocation is made on the unarmed fast path.
        let Some(original) = SpectralOwnedOriginal::try_from_completed_original(
            source.clone(),
            &source,
            server,
            complete_len,
            trusted,
            bytes.to_vec(),
        ) else {
            return false;
        };

        {
            let Ok(mut state) = self.state.try_lock() else {
                return false;
            };
            let Some(armed) = state.armed.as_mut() else {
                return false;
            };
            if armed.ticket != ticket || armed.attempted || !armed.request.current() {
                return false;
            }
            armed.attempted = true;
            armed.source = Some(source.clone());
            if !self.gate.select_source(Some(source.clone())) {
                return false;
            }
        }

        if (self.queue_epoch)() != Some(epoch) {
            return false;
        }
        let job = SpectralBoundaryJob {
            source,
            boundary: request.boundary,
            window_seconds: request.window_seconds,
        };
        let manager = Arc::clone(self);
        let live = Box::new(move || manager.live_source(ticket));
        let Some(worker) = spawn(&self.gate, job, original, request.deadline, live) else {
            return false;
        };
        let manager = Arc::clone(self);
        // Observer is not a queue or a decoder. Cancellation cannot detach
        // the blocking worker's RAII lease; the join is awaited to completion.
        tokio::spawn(async move {
            if let Ok(Some(completed)) = worker.await {
                manager.publish(ticket, epoch, completed);
            }
        });
        true
    }

    fn publish(&self, ticket: u64, epoch: u64, completed: SpectralCompletedBoundary) {
        if self.live_source(ticket).as_ref() != Some(&completed.source)
            || (self.queue_epoch)() != Some(epoch)
        {
            return;
        }
        let Ok(mut state) = self.state.try_lock() else {
            return;
        };
        let Some(armed) = state.armed.as_ref() else {
            return;
        };
        if armed.ticket != ticket
            || !armed.request.current()
            || armed.source.as_ref() != Some(&completed.source)
        {
            return;
        }
        state.ready = Some(Ready {
            ticket,
            epoch,
            completed,
        });
    }

    /// Consume once, checking current playback generation, source token,
    /// trusted original revision and ordinary queue activity again.
    /// This is NOT an authorization to change playback; a future caller must
    /// recheck at the actual transition handoff too.
    pub fn take_if_current(
        &self,
        actual_source: &SpectralSourceToken,
    ) -> Option<SpectralCompletedBoundary> {
        let ready = self.state.try_lock().ok()?.ready.take()?;
        if ready.completed.source != *actual_source
            || self.live_source(ready.ticket).as_ref() != Some(actual_source)
            || (self.queue_epoch)() != Some(ready.epoch)
        {
            return None;
        }
        Some(ready.completed)
    }
}

/// No initialization, allocation, byte copy, queue work or decoder unless
/// another (future owner-approved) component explicitly armed a request.
static LIVE_COORDINATOR: OnceLock<Arc<SpectralCaptureCoordinator>> = OnceLock::new();

pub fn arm_capture_request(request: SpectralCaptureRequest) -> bool {
    LIVE_COORDINATOR
        .get_or_init(SpectralCaptureCoordinator::new)
        .arm(request)
}

pub fn cancel_capture_request() {
    if let Some(manager) = LIVE_COORDINATOR.get() {
        manager.cancel();
    }
}

pub fn take_capture_result(source: &SpectralSourceToken) -> Option<SpectralCompletedBoundary> {
    LIVE_COORDINATOR.get()?.take_if_current(source)
}

pub(crate) fn offer_existing_original_if_armed(
    server: &str,
    track: &str,
    bytes: &[u8],
    complete_len: usize,
    trusted: &TrustedAnalysisRevision,
) -> bool {
    LIVE_COORDINATOR.get().is_some_and(|manager| {
        manager.offer_completed_original(server, track, bytes, complete_len, trusted)
    })
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;
    use crate::spectral_autodj::SpectralBandRms;

    fn fixture() -> (Vec<u8>, TrustedAnalysisRevision, SpectralCaptureRequest) {
        let mut wav = Vec::new();
        let rate = 48_000_u32;
        let frames = 24_000_u32;
        let size = frames * 2;
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(36 + size).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16_u32.to_le_bytes());
        wav.extend_from_slice(&1_u16.to_le_bytes());
        wav.extend_from_slice(&1_u16.to_le_bytes());
        wav.extend_from_slice(&rate.to_le_bytes());
        wav.extend_from_slice(&(rate * 2).to_le_bytes());
        wav.extend_from_slice(&2_u16.to_le_bytes());
        wav.extend_from_slice(&16_u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&size.to_le_bytes());
        for i in 0..frames {
            let sample = (12_000.0 * (std::f64::consts::TAU * 80.0 * f64::from(i)
                / f64::from(rate))
                .sin()) as i16;
            wav.extend_from_slice(&sample.to_le_bytes());
        }
        let revision = crate::analysis_cache::md5_first_16kb(&wav);
        let generation =
            crate::analysis_runtime::begin_trusted_revision("spectral-test-server", "track-x", &revision);
        let trusted = TrustedAnalysisRevision {
            md5_16kb: revision,
            generation,
            analysis_bytes_transcoded: false,
            content_hash_server_id: None,
        };
        let request = SpectralCaptureRequest {
            server_scope: "spectral-test-server".into(),
            library_scope: "spectral-test-server".into(),
            track_id: "track-x".into(),
            playback_generation: 7,
            playback_clock: Arc::new(AtomicU64::new(7)),
            boundary: Boundary::Intro,
            window_seconds: 0.25,
            deadline: Instant::now() + Duration::from_secs(10),
        };
        (wav, trusted, request)
    }

    fn fake_spawn(
        _: &Arc<SpectralAdmissionGate>,
        job: SpectralBoundaryJob,
        _: SpectralOwnedOriginal,
        _: Instant,
        _: Box<dyn Fn() -> Option<SpectralSourceToken> + Send>,
    ) -> Option<JoinHandle<Option<SpectralCompletedBoundary>>> {
        Some(tokio::spawn(async move {
            Some(SpectralCompletedBoundary {
                source: job.source,
                bands: SpectralBandRms {
                    low: 0.3,
                    mid: 0.0,
                    high: 0.0,
                },
            })
        }))
    }

    async fn ready_after_join(
        coordinator: &Arc<SpectralCaptureCoordinator>,
        token: &SpectralSourceToken,
    ) -> Option<SpectralCompletedBoundary> {
        for _ in 0..100 {
            if let Some(result) = coordinator.take_if_current(token) {
                return Some(result);
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        None
    }

    #[tokio::test]
    async fn complete_original_capture_yields_a_single_source_bound_result() {
        let (wav, trusted, request) = fixture();
        let queue = Arc::new(AtomicU64::new(5));
        let q = Arc::clone(&queue);
        let coordinator = SpectralCaptureCoordinator::with_epoch_probe(move || {
            Some(q.load(Ordering::SeqCst))
        });
        assert!(coordinator.arm(request));
        assert!(coordinator.offer_with(
            "spectral-test-server",
            "track-x",
            &wav,
            wav.len(),
            &trusted,
            fake_spawn
        ));
        let source = SpectralSourceToken {
            server_scope: "spectral-test-server".into(),
            library_scope: "spectral-test-server".into(),
            track_id: "track-x".into(),
            content_revision: trusted.md5_16kb.clone(),
            generation: trusted.generation,
        };
        let done = ready_after_join(&coordinator, &source)
            .await
            .expect("one safe result");
        assert!(done.bands.low > 0.2);
        assert!(coordinator.take_if_current(&source).is_none());
    }

    #[tokio::test]
    async fn unarmed_stale_transcoded_and_wrong_scope_do_no_work() {
        let (wav, trusted, request) = fixture();
        let coordinator = SpectralCaptureCoordinator::with_epoch_probe(|| Some(5));
        assert!(!coordinator.offer_with(
            "spectral-test-server",
            "track-x",
            &wav,
            wav.len(),
            &trusted,
            fake_spawn
        ));
        assert!(coordinator.arm(request.clone()));
        assert!(!coordinator.offer_with(
            "another-server",
            "track-x",
            &wav,
            wav.len(),
            &trusted,
            fake_spawn
        ));
        let mut transcoded = trusted.clone();
        transcoded.analysis_bytes_transcoded = true;
        assert!(!coordinator.offer_with(
            "spectral-test-server",
            "track-x",
            &wav,
            wav.len(),
            &transcoded,
            fake_spawn
        ));
        request.playback_clock.store(8, Ordering::SeqCst);
        assert!(!coordinator.offer_with(
            "spectral-test-server",
            "track-x",
            &wav,
            wav.len(),
            &trusted,
            fake_spawn
        ));
    }

    #[tokio::test]
    async fn activity_and_playback_churn_discard_a_ready_result() {
        let (wav, trusted, request) = fixture();
        let counter = Arc::new(AtomicU64::new(5));
        let read = Arc::clone(&counter);
        let coordinator = SpectralCaptureCoordinator::with_epoch_probe(move || {
            Some(read.load(Ordering::SeqCst))
        });
        assert!(coordinator.arm(request.clone()));
        assert!(coordinator.offer_with(
            "spectral-test-server",
            "track-x",
            &wav,
            wav.len(),
            &trusted,
            fake_spawn
        ));
        let source = SpectralSourceToken {
            server_scope: "spectral-test-server".into(),
            library_scope: "spectral-test-server".into(),
            track_id: "track-x".into(),
            content_revision: trusted.md5_16kb.clone(),
            generation: trusted.generation,
        };
        tokio::time::sleep(Duration::from_millis(10)).await;
        counter.store(6, Ordering::SeqCst);
        assert!(coordinator.take_if_current(&source).is_none());
        assert!(coordinator.arm(request.clone()));
        request.playback_clock.store(8, Ordering::SeqCst);
        assert!(coordinator.take_if_current(&source).is_none());
    }

    #[tokio::test]
    async fn actual_spectral_decoder_runs_only_from_a_verified_capture() {
        use crate::analysis_runtime::ActivityEpoch;

        let (wav, trusted, request) = fixture();
        let priority = Arc::new(ActivityEpoch::new(5));
        let probe = Arc::clone(&priority);
        let coordinator = SpectralCaptureCoordinator::with_epoch_probe(move || probe.current());
        assert!(coordinator.arm(request));
        let reserve = Arc::clone(&priority);
        let check = Arc::clone(&priority);
        assert!(coordinator.offer_with(
            "spectral-test-server",
            "track-x",
            &wav,
            wav.len(),
            &trusted,
            move |gate, job, original, deadline, live| {
                super::super::scheduling::try_spawn_verified_with_probe(
                    gate,
                    job,
                    original,
                    deadline,
                    live,
                    move || check.current(),
                    move |epoch| reserve.try_reserve(epoch),
                )
            }
        ));
        let source = SpectralSourceToken {
            server_scope: "spectral-test-server".into(),
            library_scope: "spectral-test-server".into(),
            track_id: "track-x".into(),
            content_revision: trusted.md5_16kb,
            generation: trusted.generation,
        };
        let result = ready_after_join(&coordinator, &source)
            .await
            .expect("real decoded WAV spectrum");
        assert!(result.bands.low > 0.2);
    }
}
