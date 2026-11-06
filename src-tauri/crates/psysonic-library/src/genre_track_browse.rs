//! Paginated genre -> track browse from the local genre projection.
//!
//! The predicate is a correlated `EXISTS` against `track_genre`, keeping the
//! track row as the paged entity while allowing SQLite to use the projection
//! primary key `(server_id, track_id, genre COLLATE NOCASE)`.

use crate::dto::{
    multi_library_merge_enabled, ordered_library_scope_pairs, scoped_layer1_eligible,
    LibraryGenreTracksRequest, LibraryGenreTracksResponse, LibraryScopePair,
};
use crate::scope_merge;
use crate::store::LibraryStore;
use rusqlite::types::Value as SqlValue;

const TRACK_PAGE_MAX: u32 = 200;

pub(crate) fn genre_track_filter_sql() -> &'static str {
    "EXISTS ( \
       SELECT 1 FROM track_genre tg \
       WHERE tg.server_id = t.server_id \
         AND tg.track_id = t.id \
         AND tg.genre = ? COLLATE NOCASE \
     )"
}

fn effective_scopes(req: &LibraryGenreTracksRequest) -> Result<Vec<LibraryScopePair>, String> {
    let mut scopes = ordered_library_scope_pairs(
        &req.server_id,
        req.library_scope.as_deref(),
        req.library_scopes.as_deref(),
    )?;

    if scopes.is_empty() {
        let server_id = req.server_id.trim();
        if server_id.is_empty() {
            return Err("server_id must not be empty".into());
        }
        scopes.push(LibraryScopePair {
            server_id: server_id.to_string(),
            library_id: None,
        });
    }

    Ok(scopes)
}

/// Paginated tracks carrying one exact genre.
pub fn list_tracks_by_genre(
    store: &LibraryStore,
    req: &LibraryGenreTracksRequest,
) -> Result<LibraryGenreTracksResponse, String> {
    let genre = req.genre.trim();
    if genre.is_empty() {
        return Ok(LibraryGenreTracksResponse {
            tracks: Vec::new(),
            has_more: false,
            total: req.include_total.then_some(0),
            source: "local".into(),
        });
    }

    let scopes = effective_scopes(req)?;
    if multi_library_merge_enabled(&scopes) {
        scope_merge::ensure_cluster_keys_for_scopes(store, &scopes)?;
    }

    let page_limit = req.limit.clamp(1, TRACK_PAGE_MAX);
    let query_limit = if req.count_only {
        1
    } else {
        page_limit.saturating_add(1)
    };
    let extra_where = genre_track_filter_sql();
    let extra_params = [SqlValue::Text(genre.to_string())];
    let skip_totals = !req.include_total;

    let (mut tracks, matching_total) =
        if scoped_layer1_eligible(&scopes) && !multi_library_merge_enabled(&scopes) {
            scope_merge::list_tracks_layer1_filtered(
                store,
                &scopes,
                extra_where,
                &extra_params,
                "ORDER BY t.title COLLATE NOCASE ASC, t.artist COLLATE NOCASE ASC, \
                      t.album COLLATE NOCASE ASC, t.id ASC",
                query_limit,
                req.offset,
                skip_totals,
                false,
                false,
            )?
        } else {
            scope_merge::list_tracks_filtered(
                store,
                &scopes,
                extra_where,
                &extra_params,
                "ORDER BY title COLLATE NOCASE ASC, artist COLLATE NOCASE ASC, \
                      album COLLATE NOCASE ASC, id ASC",
                query_limit,
                req.offset,
                skip_totals,
                false,
                false,
            )?
        };

    let total = req.include_total.then_some(matching_total);

    if req.count_only {
        return Ok(LibraryGenreTracksResponse {
            tracks: Vec::new(),
            has_more: false,
            total,
            source: "local".into(),
        });
    }

    let has_more = tracks.len() > page_limit as usize;
    tracks.truncate(page_limit as usize);

    Ok(LibraryGenreTracksResponse {
        tracks,
        has_more,
        total,
        source: "local".into(),
    })
}

#[cfg(test)]
#[path = "genre_track_browse/tests.rs"]
mod tests;
