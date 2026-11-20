//! Session-only experimental Spectral AutoDJ live-bridge for owner listening.
//!
//! Enabled only if PSYSONIC_SPECTRAL_AUTODJ_TRIAL=1 was set BEFORE starting the
//! app. Without that explicit process-level choice, ordinary capture hooks
//! return immediately without allocating, fetching, decoding or queueing work.
//!
//! A completed already-verified original may be processed after ordinary CPU
//! and HTTP work becomes idle. Two bounded 6-second boundary decodes share
//! one speculative CPU permit, which ordinary analysis can revoke immediately.
//! Results contain only source-bound band measurements, never encoded audio.
//! This is a temporary listening experiment, not a persisted cache/schema.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use super::owned_source::SpectralOwnedOriginal;
use super::{
    analyze_verified_boundary_bytes, plan_spectral_bass_handoff, Boundary, SpectralBandRms,
    SpectralBoundaryJob, SpectralSourceToken,
};
use crate::analysis_runtime::{
    reserve_spectral_cpu, spectral_ordinary_pipeline_idle_epoch, trusted_revision_is_current,
    TrustedAnalysisRevision,
};

const MAX_ORIGINAL_BYTES: usize = 64 * 1024 * 1024;
const MAX_PENDING: usize = 2;
const MAX_SNAPSHOTS: usize = 8;
const MAX_WAIT: Duration = Duration::from_secs(20);
const REUSE_TTL: Duration = Duration::from_secs(15 * 60);
const RETRY_PAUSE: Duration = Duration::from_millis(125);

#[derive(Clone)]
struct PairSnapshot {
    token: SpectralSourceToken,
    intro: SpectralBandRms,
    outro: SpectralBandRms,
    measured_at: Instant,
}

#[derive(Default)]
struct TrialStore {
    pending: Vec<SpectralSourceToken>,
    completed: VecDeque<PairSnapshot>,
}

impl TrialStore {
    fn finished(&mut self, source: &SpectralSourceToken, snapshot: Option<PairSnapshot>) {
        self.pending.retain(|pending| pending != source);
        self.completed.retain(|ready| ready.token != *source);
        if let Some(entry) = snapshot {
            while self.completed.len() >= MAX_SNAPSHOTS {
                self.completed.pop_front();
            }
            self.completed.push_back(entry);
        }
    }

    fn has(&self, source: &SpectralSourceToken) -> bool {
        self.pending.contains(source)
            || self.completed.iter().any(|entry| entry.token == *source)
    }

    fn pair(
        &self,
        from_server: &str,
        from_track: &str,
        to_server: &str,
        to_track: &str,
        now: Instant,
    ) -> Option<(PairSnapshot, PairSnapshot)> {
        if from_server.is_empty()
            || from_track.is_empty()
            || to_server.is_empty()
            || to_track.is_empty()
            || (from_server == to_server && from_track == to_track)
        {
            return None;
        }
        let find = |server: &str, track: &str| {
            self.completed.iter().rev().find(|entry| {
                entry.token.server_scope == server
                    && entry.token.track_id == track
                    && now.duration_since(entry.measured_at) <= REUSE_TTL
            })
        };
        Some((
            find(from_server, from_track)?.clone(),
            find(to_server, to_track)?.clone(),
        ))
    }
}

static TRIAL_ENABLED: OnceLock<bool> = OnceLock::new();
static TRIAL_STORE: OnceLock<Arc<Mutex<TrialStore>>> = OnceLock::new();

/// This opt-in cannot change until the Psysonic process is restarted.
/// It is intentionally separate from persisted preferences and Tauri IPC.
pub fn enabled() -> bool {
    *TRIAL_ENABLED.get_or_init(|| {
        std::env::var("PSYSONIC_SPECTRAL_AUTODJ_TRIAL")
            .ok()
            .as_deref()
            == Some("1")
    })
}

fn shared_store() -> &'static Arc<Mutex<TrialStore>> {
    TRIAL_STORE.get_or_init(|| Arc::new(Mutex::new(TrialStore::default())))
}

fn valid_now(source: &SpectralSourceToken) -> bool {
    trusted_revision_is_current(
        &source.server_scope,
        &source.track_id,
        &source.content_revision,
        source.generation,
    )
}

/// Offer an original already captured for playback or ordinary analysis. The
/// caller must have verified complete original provenance; this API does not
/// fetch or otherwise authenticate an HTTP response's unseen tail.
///
/// All allocations are behind the explicit session opt-in. At most two
/// sources wait for normal CPU work to become idle, with a 20-second cutoff.
pub fn offer_verified_original(
    server: &str,
    track: &str,
    bytes: &[u8],
    trusted: &TrustedAnalysisRevision,
) -> bool {
    if !enabled()
        || trusted.analysis_bytes_transcoded
        || bytes.is_empty()
        || bytes.len() > MAX_ORIGINAL_BYTES
        || server.is_empty()
        || track.is_empty()
        || trusted.generation == 0
        || tokio::runtime::Handle::try_current().is_err()
        || !trusted_revision_is_current(server, track, &trusted.md5_16kb, trusted.generation)
    {
        return false;
    }
    let source = SpectralSourceToken {
        server_scope: server.to_owned(),
        library_scope: trusted
            .content_hash_server_id
            .clone()
            .unwrap_or_else(|| server.to_owned()),
        track_id: track.to_owned(),
        content_revision: trusted.md5_16kb.clone(),
        generation: trusted.generation,
    };
    let store = Arc::clone(shared_store());
    if !crate::raw_probe::bytes_match_trusted(bytes, &trusted.md5_16kb) {
        return false;
    }
    // Serialize the bounded original-byte copy with admission. The two pending
    // slots cap simultaneous source ownership, including racing HTTP/preload
    // offers that otherwise might clone 64 MiB each before being rejected.
    // This is an off-realtime analysis capture path; the audio callback never
    // takes this lock or copies these bytes.
    let owned = {
        let Ok(mut state) = store.try_lock() else {
            return false;
        };
        if state.has(&source) || state.pending.len() >= MAX_PENDING {
            return false;
        }
        let Some(original) = SpectralOwnedOriginal::try_from_completed_original(
            source.clone(),
            &source,
            server,
            bytes.len(),
            trusted,
            bytes.to_vec(),
        ) else {
            return false;
        };
        state.pending.push(source.clone());
        original.into_parts().1
    };

    tokio::spawn(async move {
        let expires = Instant::now() + MAX_WAIT;
        let mut result = None;

        while Instant::now() < expires && valid_now(&source) {
            if let Some(epoch) = spectral_ordinary_pipeline_idle_epoch() {
                if let Some(reservation) = reserve_spectral_cpu(epoch) {
                    let src = source.clone();
                    // One physical codec at a time globally, held until the
                    // worker exits even if ordinary work arrives meanwhile.
                    result = tokio::task::spawn_blocking(move || {
                        let matches = || {
                            reservation.is_current()
                                && spectral_ordinary_pipeline_idle_epoch() == Some(epoch)
                                && valid_now(&src)
                        };
                        let first = SpectralBoundaryJob {
                            source: src.clone(),
                            boundary: Boundary::Intro,
                            window_seconds: 6.0,
                        };
                        let last = SpectralBoundaryJob {
                            source: src.clone(),
                            boundary: Boundary::Outro,
                            window_seconds: 6.0,
                        };
                        let intro = analyze_verified_boundary_bytes(&owned, &first, || {
                            matches().then_some(src.clone())
                        })?;
                        let outro = analyze_verified_boundary_bytes(&owned, &last, || {
                            matches().then_some(src.clone())
                        })?;
                        matches().then_some(PairSnapshot {
                            token: src.clone(),
                            intro,
                            outro,
                            measured_at: Instant::now(),
                        })
                    })
                    .await
                    .ok()
                    .flatten();
                    break;
                }
            }
            tokio::time::sleep(RETRY_PAUSE).await;
        }

        if !valid_now(&source) {
            result = None;
        }
        if let Ok(mut state) = store.lock() {
            state.finished(&source, result);
        }
    });
    true
}

/// Return the conservative per-deck incoming low-band attenuation only if
/// both ORIGINAL source revisions remain current. The audio engine must also
/// independently verify it is handling a real AutoDJ overlap, not a manual
/// skip, radio, gapless chain or a sink rebuild.
pub fn pair_low_cut(
    from_server: &str,
    from_track: &str,
    to_server: &str,
    to_track: &str,
) -> Option<f32> {
    if !enabled() {
        return None;
    }
    let (outgoing, incoming) = shared_store()
        .try_lock()
        .ok()?
        .pair(from_server, from_track, to_server, to_track, Instant::now())?;
    if !valid_now(&outgoing.token) || !valid_now(&incoming.token) {
        return None;
    }
    let cut = plan_spectral_bass_handoff(Some(outgoing.outro), Some(incoming.intro));
    (cut < -0.001 && cut.is_finite()).then_some(cut)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn token(server: &str, track: &str) -> SpectralSourceToken {
        SpectralSourceToken {
            server_scope: server.into(),
            library_scope: server.into(),
            track_id: track.into(),
            content_revision: "synthetic-original-revision".into(),
            generation: 1,
        }
    }

    fn bands(bass: f32) -> SpectralBandRms {
        SpectralBandRms {
            low: bass,
            mid: (1.0 - bass) / 2.0,
            high: (1.0 - bass) / 2.0,
        }
    }

    fn snapshot(server: &str, track: &str, bass: f32) -> PairSnapshot {
        PairSnapshot {
            token: token(server, track),
            intro: bands(bass),
            outro: bands(bass),
            measured_at: Instant::now(),
        }
    }

    #[test]
    fn cross_server_and_duplicate_track_scopes_never_mix() {
        let mut store = TrialStore::default();
        store.finished(&token("server-a", "shared"), Some(snapshot("server-a", "shared", 0.8)));
        store.finished(&token("server-b", "shared"), Some(snapshot("server-b", "shared", 0.8)));
        assert!(store.pair("server-a", "shared", "server-b", "shared", Instant::now()).is_some());
        assert!(store.pair("server-a", "shared", "server-a", "shared", Instant::now()).is_none());
        assert!(store.pair("server-c", "shared", "server-b", "shared", Instant::now()).is_none());
    }

    #[test]
    fn stale_candidates_and_insufficient_bass_remain_neutral() {
        let mut store = TrialStore::default();
        store.finished(&token("a", "t1"), Some(snapshot("a", "t1", 0.8)));
        store.finished(&token("a", "t2"), Some(snapshot("a", "t2", 0.1)));
        let (a, b) = store.pair("a", "t1", "a", "t2", Instant::now()).unwrap();
        assert_eq!(plan_spectral_bass_handoff(Some(a.outro), Some(b.intro)), 0.0);

        store.completed[0].measured_at = Instant::now() - REUSE_TTL - Duration::from_secs(1);
        assert!(store.pair("a", "t1", "a", "t2", Instant::now()).is_none());
    }

    #[test]
    fn pending_and_completed_are_bounded_by_identity_and_count() {
        let mut store = TrialStore::default();
        let candidate = token("server", "a");
        store.pending.push(candidate.clone());
        assert!(store.has(&candidate));
        store.finished(&candidate, Some(snapshot("server", "a", 0.8)));
        assert!(store.has(&candidate));
        assert!(store.pending.is_empty());
        for i in 0..20 {
            let name = format!("song-{i}");
            store.finished(&token("server", &name), Some(snapshot("server", &name, 0.8)));
        }
        assert!(store.completed.len() <= MAX_SNAPSHOTS);
    }
}
