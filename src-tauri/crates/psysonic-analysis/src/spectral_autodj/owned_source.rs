//! Contract for a *completed*, already-owned ORIGINAL encoded audio capture.
//!
//! A cache row or 16-KiB prefix fingerprint is not a complete audio buffer.
//! This wrapper performs conservative identity, length, and original-prefix
//! checks at handoff, but cannot independently prove that a remote response
//! was complete or cryptographically authenticate its unseen tail. The caller
//! must establish the original endpoint, finished transfer/file read, and
//! stated total length before constructing it. No fetching, disk I/O, cloning,
//! persistent cache, or playback observation occurs inside this module.

use super::lifecycle::MAX_ENCODED_BYTES;
use super::SpectralSourceToken;
use crate::analysis_runtime::TrustedAnalysisRevision;

pub struct SpectralOwnedOriginal {
    source: SpectralSourceToken,
    bytes: Vec<u8>,
}

impl SpectralOwnedOriginal {
    /// Consume bytes from a *completed* original capture, not a streaming
    /// prefix, server transcode, analysis cache row, or unknown-length stream.
    ///
    /// `complete_len` must come from independently checked full-transfer or
    /// stable file-read metadata. A forged or mistaken length can still pass:
    /// this is a guarded integration boundary, NOT full-file attestation.
    pub fn try_from_completed_original(
        source: SpectralSourceToken,
        current_source: &SpectralSourceToken,
        cache_server_scope: &str,
        complete_len: usize,
        trusted: &TrustedAnalysisRevision,
        bytes: Vec<u8>,
    ) -> Option<Self> {
        let expected_library = trusted
            .content_hash_server_id
            .as_deref()
            .unwrap_or(cache_server_scope);
        if bytes.is_empty()
            || bytes.len() > MAX_ENCODED_BYTES
            || bytes.len() != complete_len
            || !source.usable()
            || source != *current_source
            || source.server_scope != cache_server_scope
            || source.library_scope != expected_library
            || trusted.analysis_bytes_transcoded
            || trusted.generation == 0
            || trusted.generation != source.generation
            || trusted.md5_16kb != source.content_revision
            || !crate::raw_probe::bytes_match_trusted(&bytes, &trusted.md5_16kb)
        {
            return None;
        }
        Some(Self { source, bytes })
    }

    pub fn source(&self) -> &SpectralSourceToken {
        &self.source
    }

    pub(crate) fn into_parts(self) -> (SpectralSourceToken, Vec<u8>) {
        (self.source, self.bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (Vec<u8>, SpectralSourceToken, TrustedAnalysisRevision) {
        let bytes = b"RIFFsynthetic-original-owned-file".to_vec();
        let revision = crate::analysis_cache::md5_first_16kb(&bytes);
        let source = SpectralSourceToken {
            server_scope: "server-a".into(),
            library_scope: "server-a".into(),
            track_id: "track-1".into(),
            content_revision: revision.clone(),
            generation: 9,
        };
        let trusted = TrustedAnalysisRevision {
            md5_16kb: revision,
            generation: 9,
            analysis_bytes_transcoded: false,
            content_hash_server_id: None,
        };
        (bytes, source, trusted)
    }

    #[test]
    fn completed_original_moves_owned_bytes_and_preserves_full_identity() {
        let (bytes, source, trusted) = fixture();
        let len = bytes.len();
        let accepted = SpectralOwnedOriginal::try_from_completed_original(
            source.clone(),
            &source,
            "server-a",
            len,
            &trusted,
            bytes,
        )
        .expect("trusted completed original");
        assert_eq!(accepted.source(), &source);
        let (returned_source, returned_bytes) = accepted.into_parts();
        assert_eq!(returned_source, source);
        assert_eq!(returned_bytes.len(), len);
    }

    #[test]
    fn offline_dual_scope_requires_explicit_library_identity() {
        let (bytes, mut source, mut trusted) = fixture();
        source.library_scope = "library-b".into();
        trusted.content_hash_server_id = Some("library-b".into());
        assert!(SpectralOwnedOriginal::try_from_completed_original(
            source.clone(),
            &source,
            "server-a",
            bytes.len(),
            &trusted,
            bytes.clone(),
        )
        .is_some());

        trusted.content_hash_server_id = None;
        assert!(SpectralOwnedOriginal::try_from_completed_original(
            source.clone(),
            &source,
            "server-a",
            bytes.len(),
            &trusted,
            bytes,
        )
        .is_none());
    }

    #[test]
    fn transcodes_and_incomplete_or_unknown_captures_fail_closed() {
        let (bytes, source, mut trusted) = fixture();
        trusted.analysis_bytes_transcoded = true;
        assert!(SpectralOwnedOriginal::try_from_completed_original(
            source.clone(),
            &source,
            "server-a",
            bytes.len(),
            &trusted,
            bytes.clone(),
        )
        .is_none());

        trusted.analysis_bytes_transcoded = false;
        for reported_length in [0, bytes.len() - 1, bytes.len() + 1] {
            assert!(SpectralOwnedOriginal::try_from_completed_original(
                source.clone(),
                &source,
                "server-a",
                reported_length,
                &trusted,
                bytes.clone(),
            )
            .is_none());
        }
        assert!(SpectralOwnedOriginal::try_from_completed_original(
            source.clone(),
            &source,
            "server-a",
            0,
            &trusted,
            Vec::new(),
        )
        .is_none());
    }

    #[test]
    fn wrong_content_prefix_generation_server_or_current_source_fail_closed() {
        let (bytes, source, trusted) = fixture();
        let mut modified = bytes.clone();
        modified[4] ^= 1;
        assert!(SpectralOwnedOriginal::try_from_completed_original(
            source.clone(),
            &source,
            "server-a",
            modified.len(),
            &trusted,
            modified,
        )
        .is_none());

        let mut older = source.clone();
        older.generation -= 1;
        assert!(SpectralOwnedOriginal::try_from_completed_original(
            older,
            &source,
            "server-a",
            bytes.len(),
            &trusted,
            bytes.clone(),
        )
        .is_none());

        let mut another_server = source.clone();
        another_server.server_scope = "server-b".into();
        assert!(SpectralOwnedOriginal::try_from_completed_original(
            source.clone(),
            &another_server,
            "server-a",
            bytes.len(),
            &trusted,
            bytes.clone(),
        )
        .is_none());
        assert!(SpectralOwnedOriginal::try_from_completed_original(
            source,
            &another_server,
            "server-b",
            bytes.len(),
            &trusted,
            bytes,
        )
        .is_none());
    }
}
