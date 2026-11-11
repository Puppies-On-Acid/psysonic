//! On-demand, read-only audit of genre/mood coverage in the local track index.
//!
//! A result is a *snapshot*, created only by the explicit Settings action.
//! Individual (server, library, album) copies remain separate rather than
//! merging away metadata gaps across servers or music folders.

use rusqlite::{params_from_iter, types::Value as SqlValue, Connection};
use serde::{Deserialize, Serialize};

use crate::dto::LibraryScopePair;
use crate::store::LibraryStore;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagAuditRequest {
    pub scopes: Vec<LibraryScopePair>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TagAuditStatus {
    Complete,
    Partial,
    Missing,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagAuditAlbum {
    pub server_id: String,
    pub library_id: Option<String>,
    pub album_id: String,
    pub name: String,
    pub artist: Option<String>,
    pub track_count: u64,
    pub genre_tagged_tracks: u64,
    pub mood_tagged_tracks: u64,
    /// Album-level genre presence is distinct from the per-track genre count.
    pub album_genre_tagged: bool,
    pub genre_status: TagAuditStatus,
    pub mood_status: TagAuditStatus,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagAuditSummary {
    pub albums_checked: u64,
    pub tracks_checked: u64,
    pub genre_missing: u64,
    pub genre_partial: u64,
    pub mood_missing: u64,
    pub mood_partial: u64,
    pub missing_both: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagAuditResponse {
    pub summary: TagAuditSummary,
    pub albums: Vec<TagAuditAlbum>,
}

fn coverage_status(tagged: u64, total: u64, album_tagged: bool) -> TagAuditStatus {
    if tagged >= total {
        TagAuditStatus::Complete
    } else if tagged == 0 && !album_tagged {
        TagAuditStatus::Missing
    } else {
        TagAuditStatus::Partial
    }
}

fn projections_ready(conn: &Connection) -> rusqlite::Result<bool> {
    let completed: i64 = conn.query_row(
        "SELECT COUNT(*) FROM library_data_migration \
         WHERE id IN ('genre_tags_v1', 'mood_tags_v3') \
           AND completed_at IS NOT NULL",
        [],
        |row| row.get(0),
    )?;
    Ok(completed == 2)
}

fn query_audit(
    conn: &Connection,
    scopes: &[LibraryScopePair],
) -> rusqlite::Result<TagAuditResponse> {
    let mut where_parts = Vec::with_capacity(scopes.len());
    let mut binds = Vec::<SqlValue>::new();

    for scope in scopes {
        if let Some(library_id) = &scope.library_id {
            where_parts.push("(t.server_id = ? AND t.library_id = ?)".to_owned());
            binds.push(SqlValue::Text(scope.server_id.clone()));
            binds.push(SqlValue::Text(library_id.clone()));
        } else {
            where_parts.push("(t.server_id = ?)".to_owned());
            binds.push(SqlValue::Text(scope.server_id.clone()));
        }
    }

    // Both tag tables have primary-key prefixes (server_id, track_id), so
    // these EXISTS checks are per-track lookups, not multiplicative joins.
    // Group per concrete library as well as album: one tagged copy on another
    // server or in another music folder must never hide an untagged copy.
    let sql = format!(
        "SELECT t.server_id, COALESCE(t.library_id, ''), t.album_id, \
                COALESCE(NULLIF(TRIM(MAX(a.name)), ''), \
                         NULLIF(TRIM(MAX(t.album)), ''), '[Unknown album]'), \
                COALESCE(NULLIF(TRIM(MAX(a.artist)), ''), \
                         NULLIF(TRIM(MAX(t.album_artist)), ''), \
                         NULLIF(TRIM(MAX(t.artist)), '')), \
                COUNT(*) AS track_count, \
                SUM(CASE WHEN EXISTS ( \
                    SELECT 1 FROM track_genre g \
                    WHERE g.server_id = t.server_id AND g.track_id = t.id \
                      AND TRIM(g.genre) != '' \
                ) THEN 1 ELSE 0 END) AS genre_tagged_tracks, \
                SUM(CASE WHEN EXISTS ( \
                    SELECT 1 FROM track_mood m \
                    WHERE m.server_id = t.server_id AND m.track_id = t.id \
                      AND TRIM(m.mood) != '' \
                ) THEN 1 ELSE 0 END) AS mood_tagged_tracks, \
                MAX(CASE WHEN NULLIF(TRIM(a.genre), '') IS NOT NULL \
                    THEN 1 ELSE 0 END) AS album_genre_tagged \
         FROM track t \
         LEFT JOIN album a ON a.server_id = t.server_id AND a.id = t.album_id \
         WHERE t.deleted = 0 AND t.album_id IS NOT NULL \
           AND TRIM(t.album_id) != '' AND ({}) \
         GROUP BY t.server_id, COALESCE(t.library_id, ''), t.album_id \
         ORDER BY 4 COLLATE NOCASE, t.server_id, t.album_id, 2",
        where_parts.join(" OR "),
    );

    let mut summary = TagAuditSummary::default();
    let mut albums = Vec::new();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(binds.iter()), |r| {
        let library_id: String = r.get(1)?;
        let track_count = r.get::<_, i64>(5)?.max(0) as u64;
        let genre_tagged_tracks = r.get::<_, i64>(6)?.max(0) as u64;
        let mood_tagged_tracks = r.get::<_, i64>(7)?.max(0) as u64;
        let album_genre_tagged = r.get::<_, i64>(8)? != 0;

        Ok(TagAuditAlbum {
            server_id: r.get(0)?,
            library_id: (!library_id.is_empty()).then_some(library_id),
            album_id: r.get(2)?,
            name: r.get(3)?,
            artist: r.get(4)?,
            track_count,
            genre_tagged_tracks,
            mood_tagged_tracks,
            album_genre_tagged,
            genre_status: coverage_status(genre_tagged_tracks, track_count, album_genre_tagged),
            mood_status: coverage_status(mood_tagged_tracks, track_count, false),
        })
    })?;

    for album in rows {
        let album = album?;
        summary.albums_checked += 1;
        summary.tracks_checked += album.track_count;
        match album.genre_status {
            TagAuditStatus::Missing => summary.genre_missing += 1,
            TagAuditStatus::Partial => summary.genre_partial += 1,
            TagAuditStatus::Complete => {}
        }
        match album.mood_status {
            TagAuditStatus::Missing => summary.mood_missing += 1,
            TagAuditStatus::Partial => summary.mood_partial += 1,
            TagAuditStatus::Complete => {}
        }
        if album.genre_status != TagAuditStatus::Complete
            && album.mood_status != TagAuditStatus::Complete
        {
            summary.missing_both += 1;
        }
        if album.genre_status != TagAuditStatus::Complete
            || album.mood_status != TagAuditStatus::Complete
        {
            albums.push(album);
        }
    }
    Ok(TagAuditResponse { summary, albums })
}

/// Never runs during sync, startup or browse. Invoked only by "Run Audit".
/// Uses the dedicated heavy-query reader to avoid blocking ordinary browsing.
pub fn run(store: &LibraryStore, request: &TagAuditRequest) -> Result<TagAuditResponse, String> {
    let scopes = crate::scope_merge::normalize_scope_pairs(&request.scopes)?;
    if scopes.is_empty() {
        return Err("Select at least one library before running the tag audit".to_string());
    }
    if scopes.len() > 150 {
        return Err("Too many library scopes selected for one tag audit".to_string());
    }

    let ready = store.with_scope_detail_read_conn(projections_ready)?;
    if !ready {
        return Err(
            "Genre/mood metadata indexing is not complete. Finish the local library indexing before running the audit."
                .to_string(),
        );
    }
    store.with_scope_detail_read_conn(|conn| query_audit(conn, &scopes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    fn fixture() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE album (
                 server_id TEXT, id TEXT, name TEXT, artist TEXT, genre TEXT,
                 PRIMARY KEY (server_id, id)
             );
             CREATE TABLE track (
                 server_id TEXT, id TEXT, album_id TEXT, album TEXT,
                 artist TEXT, album_artist TEXT, library_id TEXT,
                 deleted INTEGER NOT NULL DEFAULT 0,
                 PRIMARY KEY (server_id, id)
             );
             CREATE TABLE track_genre (
                 server_id TEXT, track_id TEXT, genre TEXT,
                 PRIMARY KEY (server_id, track_id, genre)
             );
             CREATE TABLE track_mood (
                 server_id TEXT, track_id TEXT, mood TEXT,
                 PRIMARY KEY (server_id, track_id, mood)
             );
             CREATE TABLE library_data_migration (id TEXT, completed_at INTEGER);",
        )
        .unwrap();
        conn
    }

    fn track(
        conn: &Connection,
        server: &str,
        library: &str,
        album: &str,
        id: &str,
        genre: bool,
        mood: bool,
    ) {
        conn.execute(
            "INSERT INTO track (server_id, id, album_id, album, artist, album_artist, library_id) \
             VALUES (?1, ?2, ?3, ?3, 'Artist', 'Artist', ?4)",
            params![server, id, album, library],
        )
        .unwrap();
        if genre {
            conn.execute(
                "INSERT INTO track_genre VALUES (?1, ?2, 'Rock')",
                params![server, id],
            )
            .unwrap();
        }
        if mood {
            conn.execute(
                "INSERT INTO track_mood VALUES (?1, ?2, 'Dreamy')",
                params![server, id],
            )
            .unwrap();
        }
    }

    fn scope(server: &str, library: Option<&str>) -> LibraryScopePair {
        LibraryScopePair {
            server_id: server.to_owned(),
            library_id: library.map(str::to_owned),
        }
    }

    #[test]
    fn classifies_full_partial_complete_and_album_level_genre() {
        let conn = fixture();
        track(&conn, "s1", "l1", "empty", "e1", false, false);
        track(&conn, "s1", "l1", "mixed", "m1", true, true);
        track(&conn, "s1", "l1", "mixed", "m2", false, false);
        track(&conn, "s1", "l1", "complete", "c1", true, true);
        track(&conn, "s1", "l1", "album-genre", "a1", false, true);
        conn.execute(
            "INSERT INTO album VALUES ('s1', 'album-genre', 'Album Genre', 'Artist', 'Jazz')",
            [],
        )
        .unwrap();

        let result = query_audit(&conn, &[scope("s1", None)]).unwrap();
        assert_eq!(result.summary.albums_checked, 4);
        assert_eq!(result.summary.tracks_checked, 5);
        assert_eq!(result.summary.genre_missing, 1);
        assert_eq!(result.summary.genre_partial, 2);
        assert_eq!(result.summary.mood_missing, 1);
        assert_eq!(result.summary.mood_partial, 1);
        assert_eq!(result.summary.missing_both, 2);
        assert_eq!(result.albums.len(), 3);
        let album_genre = result
            .albums
            .iter()
            .find(|a| a.album_id == "album-genre")
            .unwrap();
        assert_eq!(album_genre.genre_status, TagAuditStatus::Partial);
        assert_eq!(album_genre.genre_tagged_tracks, 0);
        assert!(album_genre.album_genre_tagged);
    }

    #[test]
    fn keeps_server_and_library_copies_distinct_and_excludes_tombstones() {
        let conn = fixture();
        track(&conn, "s1", "l1", "same", "a", true, true);
        track(&conn, "s1", "l2", "same", "b", false, false);
        track(&conn, "s2", "l1", "same", "c", false, true);
        track(&conn, "s1", "l1", "deleted", "d", false, false);
        conn.execute("UPDATE track SET deleted = 1 WHERE id = 'd'", [])
            .unwrap();

        let result = query_audit(&conn, &[scope("s1", None), scope("s2", None)]).unwrap();
        assert_eq!(result.summary.albums_checked, 3);
        assert_eq!(result.albums.len(), 2);
        assert_eq!(result.summary.genre_missing, 2);
        assert_eq!(result.summary.mood_missing, 1);

        let only_l1 = query_audit(&conn, &[scope("s1", Some("l1"))]).unwrap();
        assert_eq!(only_l1.summary.albums_checked, 1);
        assert!(only_l1.albums.is_empty());
    }

    #[test]
    fn ignores_empty_tag_rows_and_checks_projection_readiness() {
        let conn = fixture();
        track(&conn, "s1", "l1", "empty-tag", "t1", false, false);
        conn.execute("INSERT INTO track_genre VALUES ('s1', 't1', '  ')", [])
            .unwrap();
        conn.execute("INSERT INTO track_mood VALUES ('s1', 't1', '')", [])
            .unwrap();
        assert!(!projections_ready(&conn).unwrap());
        conn.execute(
            "INSERT INTO library_data_migration VALUES ('genre_tags_v1', 1), ('mood_tags_v3', 1)",
            [],
        )
        .unwrap();
        assert!(projections_ready(&conn).unwrap());
        let result = query_audit(&conn, &[scope("s1", None)]).unwrap();
        assert_eq!(result.summary.genre_missing, 1);
        assert_eq!(result.summary.mood_missing, 1);
    }
}
