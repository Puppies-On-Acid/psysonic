//! Mixed Genre/Mood Explorer reads over normalized local projections.
//!
//! Tracks use same-row semantics for AND: every selected tag must be present on
//! the same track. Albums use collective semantics: every selected tag must be
//! present somewhere within the same physical album/library copy.

use std::collections::HashSet;

use crate::dto::{
    multi_library_merge_enabled, ordered_library_scope_pairs, scoped_layer1_eligible,
    LibraryScopePair, LibraryTagExplorerAlbumsRequest, LibraryTagExplorerAlbumsResponse,
    LibraryTagExplorerTrackRefDto, LibraryTagExplorerTrackRefsRequest,
    LibraryTagExplorerTrackRefsResponse, LibraryTagExplorerTracksRequest,
    LibraryTagExplorerTracksResponse, LibraryTagFilter, LibraryTagKind, LibraryTagMatchMode,
};
use crate::scope_merge;
use crate::store::LibraryStore;
use rusqlite::types::Value as SqlValue;

const MAX_TAG_FILTERS: usize = 256;
const MAX_TAG_VALUE_CHARS: usize = 256;
const ALBUM_PAGE_MAX: u32 = 100;
const TRACK_PAGE_MAX: u32 = 200;
const TRACK_REF_PAGE_MAX: u32 = 500;

fn normalize_tags(tags: &[LibraryTagFilter]) -> Result<Vec<LibraryTagFilter>, String> {
    if tags.len() > MAX_TAG_FILTERS {
        return Err(format!(
            "tag explorer accepts at most {MAX_TAG_FILTERS} filters per query"
        ));
    }

    let mut seen = HashSet::new();
    let mut normalized = Vec::with_capacity(tags.len());

    for tag in tags {
        let value = tag.value.trim();
        if value.is_empty() {
            return Err("tag explorer filters must not be empty".into());
        }
        if value.chars().count() > MAX_TAG_VALUE_CHARS {
            return Err(format!(
                "tag explorer filter exceeds {MAX_TAG_VALUE_CHARS} characters"
            ));
        }

        let kind_key = match tag.kind {
            LibraryTagKind::Genre => "genre",
            LibraryTagKind::Mood => "mood",
        };
        let key = format!("{kind_key}\u{1f}{}", value.to_lowercase());
        if seen.insert(key) {
            normalized.push(LibraryTagFilter {
                kind: tag.kind.clone(),
                value: value.to_string(),
            });
        }
    }

    if normalized.len() < 2 {
        return Err("tag explorer requires at least two distinct filters".into());
    }

    Ok(normalized)
}

fn effective_scopes(
    server_id: &str,
    library_scope: Option<&str>,
    library_scopes: Option<&[LibraryScopePair]>,
) -> Result<Vec<LibraryScopePair>, String> {
    let mut scopes = ordered_library_scope_pairs(server_id, library_scope, library_scopes)?;
    if scopes.is_empty() {
        let server_id = server_id.trim();
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

fn join_predicates(parts: Vec<String>, mode: LibraryTagMatchMode) -> String {
    let operator = match mode {
        LibraryTagMatchMode::Or => " OR ",
        LibraryTagMatchMode::And => " AND ",
    };
    format!("({})", parts.join(operator))
}

fn track_filter_sql(
    tags: &[LibraryTagFilter],
    mode: LibraryTagMatchMode,
) -> (String, Vec<SqlValue>) {
    let mut parts = Vec::with_capacity(tags.len());
    let mut params = Vec::with_capacity(tags.len());

    for tag in tags {
        let predicate = match tag.kind {
            LibraryTagKind::Genre => {
                "EXISTS (                    SELECT 1 FROM track_genre tg                    WHERE tg.server_id = t.server_id                      AND tg.track_id = t.id                      AND tg.genre = ? COLLATE NOCASE                  )"
            }
            LibraryTagKind::Mood => {
                "EXISTS (                    SELECT 1 FROM track_mood tm                    WHERE tm.server_id = t.server_id                      AND tm.track_id = t.id                      AND tm.mood = ? COLLATE NOCASE                  )"
            }
        };
        parts.push(predicate.to_string());
        params.push(SqlValue::Text(tag.value.clone()));
    }

    (join_predicates(parts, mode), params)
}

fn album_filter_sql(
    tags: &[LibraryTagFilter],
    mode: LibraryTagMatchMode,
) -> (String, Vec<SqlValue>) {
    let mut parts = Vec::with_capacity(tags.len());
    let mut params = Vec::with_capacity(tags.len());

    for tag in tags {
        let predicate = match tag.kind {
            LibraryTagKind::Genre => {
                "EXISTS (                    SELECT 1                    FROM track_genre tg INDEXED BY idx_track_genre_browse                    INNER JOIN track tx INDEXED BY sqlite_autoindex_track_1                      ON tx.server_id = tg.server_id AND tx.id = tg.track_id                    WHERE tg.server_id = t.server_id                      AND tg.genre = ? COLLATE NOCASE                      AND tg.album_id = t.album_id                      AND tg.album_id IS NOT NULL AND tg.album_id != ''                      AND tx.library_id IS t.library_id                      AND tx.deleted = 0                  )"
            }
            LibraryTagKind::Mood => {
                "EXISTS (                    SELECT 1                    FROM track_mood tm INDEXED BY idx_track_mood_browse                    INNER JOIN track tx INDEXED BY sqlite_autoindex_track_1                      ON tx.server_id = tm.server_id AND tx.id = tm.track_id                    WHERE tm.server_id = t.server_id                      AND tm.mood = ? COLLATE NOCASE                      AND tm.album_id = t.album_id                      AND tm.album_id IS NOT NULL AND tm.album_id != ''                      AND tx.library_id IS t.library_id                      AND tx.deleted = 0                  )"
            }
        };
        parts.push(predicate.to_string());
        params.push(SqlValue::Text(tag.value.clone()));
    }

    (join_predicates(parts, mode), params)
}

fn prepare_scope(
    store: &LibraryStore,
    server_id: &str,
    library_scope: Option<&str>,
    library_scopes: Option<&[LibraryScopePair]>,
) -> Result<Vec<LibraryScopePair>, String> {
    let scopes = effective_scopes(server_id, library_scope, library_scopes)?;
    if multi_library_merge_enabled(&scopes) {
        scope_merge::ensure_cluster_keys_for_scopes(store, &scopes)?;
    }
    Ok(scopes)
}

pub fn list_albums(
    store: &LibraryStore,
    req: &LibraryTagExplorerAlbumsRequest,
) -> Result<LibraryTagExplorerAlbumsResponse, String> {
    let tags = normalize_tags(&req.tags)?;
    let scopes = prepare_scope(
        store,
        &req.server_id,
        req.library_scope.as_deref(),
        req.library_scopes.as_deref(),
    )?;
    let (where_sql, params) = album_filter_sql(&tags, req.mode);

    let page_limit = req.limit.clamp(1, ALBUM_PAGE_MAX);
    let query_limit = if req.count_only {
        0
    } else {
        page_limit.saturating_add(1)
    };

    let (mut albums, matching_total) = scope_merge::list_albums_filtered(
        store,
        &scopes,
        &where_sql,
        &params,
        "ORDER BY album COLLATE NOCASE ASC, artist COLLATE NOCASE ASC, album_id ASC",
        query_limit,
        req.offset,
        !req.include_total,
    )?;

    let total = req.include_total.then_some(matching_total);
    if req.count_only {
        return Ok(LibraryTagExplorerAlbumsResponse {
            albums: Vec::new(),
            has_more: false,
            total,
            source: "local".into(),
        });
    }

    let has_more = albums.len() > page_limit as usize;
    albums.truncate(page_limit as usize);

    Ok(LibraryTagExplorerAlbumsResponse {
        albums,
        has_more,
        total,
        source: "local".into(),
    })
}

pub fn list_tracks(
    store: &LibraryStore,
    req: &LibraryTagExplorerTracksRequest,
) -> Result<LibraryTagExplorerTracksResponse, String> {
    let tags = normalize_tags(&req.tags)?;
    let scopes = prepare_scope(
        store,
        &req.server_id,
        req.library_scope.as_deref(),
        req.library_scopes.as_deref(),
    )?;
    let (where_sql, params) = track_filter_sql(&tags, req.mode);

    let page_limit = req.limit.clamp(1, TRACK_PAGE_MAX);
    let query_limit = if req.count_only {
        1
    } else {
        page_limit.saturating_add(1)
    };

    let (mut tracks, matching_total) =
        if scoped_layer1_eligible(&scopes) && !multi_library_merge_enabled(&scopes) {
            scope_merge::list_tracks_layer1_filtered(
                store,
                &scopes,
                &where_sql,
                &params,
                "ORDER BY t.title COLLATE NOCASE ASC, t.artist COLLATE NOCASE ASC,                           t.album COLLATE NOCASE ASC, t.id ASC",
                query_limit,
                req.offset,
                !req.include_total,
                false,
                false,
            )?
        } else {
            scope_merge::list_tracks_filtered(
                store,
                &scopes,
                &where_sql,
                &params,
                "ORDER BY title COLLATE NOCASE ASC, artist COLLATE NOCASE ASC,                           album COLLATE NOCASE ASC, id ASC",
                query_limit,
                req.offset,
                !req.include_total,
                false,
                false,
            )?
        };

    let total = req.include_total.then_some(matching_total);
    if req.count_only {
        return Ok(LibraryTagExplorerTracksResponse {
            tracks: Vec::new(),
            has_more: false,
            total,
            source: "local".into(),
        });
    }

    let has_more = tracks.len() > page_limit as usize;
    tracks.truncate(page_limit as usize);

    Ok(LibraryTagExplorerTracksResponse {
        tracks,
        has_more,
        total,
        source: "local".into(),
    })
}

pub fn list_track_refs(
    store: &LibraryStore,
    req: &LibraryTagExplorerTrackRefsRequest,
) -> Result<LibraryTagExplorerTrackRefsResponse, String> {
    let tags = normalize_tags(&req.tags)?;
    let scopes = prepare_scope(
        store,
        &req.server_id,
        req.library_scope.as_deref(),
        req.library_scopes.as_deref(),
    )?;
    let (where_sql, params) = track_filter_sql(&tags, req.mode);

    let page_limit = req.limit.clamp(1, TRACK_REF_PAGE_MAX);
    let query_limit = page_limit.saturating_add(1);

    let (mut tracks, _) =
        if scoped_layer1_eligible(&scopes) && !multi_library_merge_enabled(&scopes) {
            scope_merge::list_tracks_layer1_filtered(
                store,
                &scopes,
                &where_sql,
                &params,
                "ORDER BY t.title COLLATE NOCASE ASC, t.artist COLLATE NOCASE ASC,                           t.album COLLATE NOCASE ASC, t.id ASC",
                query_limit,
                req.offset,
                true,
                false,
                false,
            )?
        } else {
            scope_merge::list_tracks_filtered(
                store,
                &scopes,
                &where_sql,
                &params,
                "ORDER BY title COLLATE NOCASE ASC, artist COLLATE NOCASE ASC,                           album COLLATE NOCASE ASC, id ASC",
                query_limit,
                req.offset,
                true,
                false,
                false,
            )?
        };

    let has_more = tracks.len() > page_limit as usize;
    tracks.truncate(page_limit as usize);

    Ok(LibraryTagExplorerTrackRefsResponse {
        tracks: tracks
            .into_iter()
            .map(|track| LibraryTagExplorerTrackRefDto {
                server_id: track.server_id,
                track_id: track.id,
            })
            .collect(),
        has_more,
    })
}

#[cfg(test)]
#[path = "tag_explorer/tests.rs"]
mod tests;
