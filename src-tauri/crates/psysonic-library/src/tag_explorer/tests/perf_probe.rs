//! Slice 0B: ignored Explorer backend probe.
//!
//! The test opener CAN MIGRATE a database. Never point this at a live profile.
//! To run, stop Psysonic, make a consistent copy of the library DB *and* its
//! library-cluster.db sidecar into a directory named psysonic-explorer-probe,
//! and create PROBE-COPY-ONLY.txt containing the exact acknowledgement below.
//! Then set PSYSONIC_EXPLORER_COPY_DB to the copied library.sqlite.
//! The supplied copy is never opened by Psysonic: it is copied into a unique
//! temporary sandbox first. Migrations and identity-key maintenance may write
//! only to that sandbox, which is deleted when the probe completes.
//!
//! Only aggregate counts, timing statistics, scope labels and SQLite plan
//! descriptions are printed; server IDs, tags and library names remain private.
//! The test is #[ignore] and does not run with regular cargo test.

use super::*;
use crate::dto::{LibraryAlbumDto, LibraryScopePair, LibraryTrackDto};
use crate::repos::row_to_track_row;
use crate::scope_merge::{scope_cte_sql, ALBUM_DEDUP_KEY, ALBUM_PICK_KEY, TRACK_DEDUP_KEY};
use rusqlite::{params_from_iter, Connection, OptionalExtension};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::Instant;

const RUNS: usize = 5;
const COPY_FOLDER: &str = "psysonic-explorer-probe";
const COPY_MARKER: &str = "PROBE-COPY-ONLY.txt";
const ACKNOWLEDGEMENT: &str = "I confirm these are disposable Psysonic database copies.";

/// The source probe DB is immutable input. A second throwaway copy allows
/// the real LibraryStore API (which may migrate or rebuild cluster keys) to
/// run without writing to either the supplied snapshot or the user's profile.
struct ProbeSandbox {
    directory: PathBuf,
    database: PathBuf,
}

impl Drop for ProbeSandbox {
    fn drop(&mut self) {
        if let Err(error) = std::fs::remove_dir_all(&self.directory) {
            eprintln!("WARNING: temporary probe sandbox cleanup failed: {error}");
        }
    }
}

fn stage_in_temporary_sandbox(source_db: &std::path::Path) -> ProbeSandbox {
    use std::time::{SystemTime, UNIX_EPOCH};

    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock")
        .as_nanos();
    let directory = std::env::temp_dir().join(format!(
        "psysonic-explorer-probe-{}-{nonce}",
        std::process::id()
    ));
    std::fs::create_dir(&directory).expect("create temporary probe sandbox");
    let sandbox = ProbeSandbox {
        database: directory.join("library.sqlite"),
        directory,
    };
    let parent = source_db.parent().expect("source parent");
    for name in [
        "library.sqlite",
        "library.sqlite-wal",
        "library-cluster.db",
        "library-cluster.db-wal",
    ] {
        let source = parent.join(name);
        if source.is_file() {
            std::fs::copy(&source, sandbox.directory.join(name))
                .unwrap_or_else(|error| panic!("cannot stage {name}: {error}"));
        }
    }
    sandbox
}

#[derive(Clone, Copy)]
enum View {
    Albums,
    Tracks,
}

impl View {
    fn label(self) -> &'static str {
        match self {
            Self::Albums => "albums",
            Self::Tracks => "tracks",
        }
    }
}

struct Query {
    raw_filter_sql: String,
    count_sql: String,
    page_sql: String,
    binds: Vec<SqlValue>,
    layer1: bool,
}

fn checked_copy_path() -> Option<PathBuf> {
    let Some(db) = std::env::var_os("PSYSONIC_EXPLORER_COPY_DB") else {
        eprintln!("SKIP: PSYSONIC_EXPLORER_COPY_DB not set (copy-only probe)");
        return None;
    };
    let path = std::fs::canonicalize(db).expect("probe DB must exist");
    assert_eq!(
        path.file_name().and_then(|n| n.to_str()),
        Some("library.sqlite"),
        "probe expects a copied library.sqlite"
    );
    let parent = path
        .parent()
        .expect("probe DB must have a parent directory");
    assert_eq!(
        parent
            .file_name()
            .and_then(|name| name.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some(COPY_FOLDER),
        "safety gate: library.sqlite must be in a directory named {COPY_FOLDER}"
    );
    assert_eq!(
        std::fs::read_to_string(parent.join(COPY_MARKER))
            .expect("safety gate: missing probe copy marker")
            .trim(),
        ACKNOWLEDGEMENT,
        "safety gate: marker acknowledgement did not match"
    );
    assert!(
        parent.join("library-cluster.db").is_file(),
        "the copied library-cluster.db sidecar must be present"
    );
    Some(path)
}

fn copy_fingerprints(parent: &Path) -> Vec<(String, u64, u64)> {
    [
        "library.sqlite",
        "library.sqlite-wal",
        "library-cluster.db",
        "library-cluster.db-wal",
    ]
    .iter()
    .filter_map(|name| {
        let data = std::fs::read(parent.join(name)).ok()?;
        let mut hasher = DefaultHasher::new();
        data.hash(&mut hasher);
        Some(((*name).to_string(), data.len() as u64, hasher.finish()))
    })
    .collect()
}

// Opening the *staged sandbox* with read-only flags records the schema
// before LibraryStore::open_path_for_test can apply any migrations.
fn sandbox_schema_head(path: &Path) -> Option<i64> {
    let conn = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;
    conn.query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
        row.get::<_, Option<i64>>(0)
    })
    .ok()
    .flatten()
}

fn report_scope_metadata(store: &LibraryStore, scopes: &[LibraryScopePair]) {
    let (cte, binds) = scope_cte_sql(scopes);
    let scoped_sql = format!(
        "{cte} SELECT COUNT(*), COUNT(ck.cluster_key) \
         FROM scoped_track s \
         INNER JOIN track t ON t.rowid = s.rowid \
         LEFT JOIN cluster.track_cluster_key ck \
           ON ck.server_id = t.server_id AND ck.track_id = t.id"
    );
    let (sqlite_version, has_stat1, schema_head, scoped_tracks, keyed_tracks) = store
        .with_read_conn(|conn| {
            let sqlite_version: String =
                conn.query_row("SELECT sqlite_version()", [], |row| row.get(0))?;
            let has_stat1: i64 = conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name = 'sqlite_stat1')",
                [],
                |row| row.get(0),
            )?;
            let schema_head: Option<i64> = conn.query_row(
                "SELECT MAX(version) FROM schema_migrations",
                [],
                |row| row.get(0),
            )?;
            let (scoped_tracks, keyed_tracks): (i64, i64) = conn.query_row(
                &scoped_sql,
                params_from_iter(binds.iter()),
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            Ok((
                sqlite_version,
                has_stat1,
                schema_head,
                scoped_tracks,
                keyed_tracks,
            ))
        })
        .expect("read-only aggregate probe metadata");
    let server_count = scopes
        .iter()
        .map(|scope| scope.server_id.as_str())
        .collect::<std::collections::HashSet<_>>()
        .len();
    eprintln!(
        "  sqlite_version={sqlite_version} sqlite_stat1_present={} \
         schema_head_after={schema_head:?} scoped_tracks={scoped_tracks} \
         keyed_scoped_tracks={keyed_tracks} selected_scopes={} selected_servers={server_count}",
        has_stat1 != 0,
        scopes.len()
    );
}

fn nondeleted_scopes(store: &LibraryStore) -> Vec<LibraryScopePair> {
    store
        .with_read_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT server_id, library_id, COUNT(*) AS n FROM track \
             WHERE deleted = 0 AND library_id IS NOT NULL AND library_id != '' \
             GROUP BY server_id, library_id ORDER BY n DESC",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok(LibraryScopePair {
                    server_id: row.get(0)?,
                    library_id: row.get(1)?,
                })
            })?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
        })
        .expect("probe scopes")
}

fn scope_cases(scopes: &[LibraryScopePair]) -> Vec<(&'static str, Vec<LibraryScopePair>)> {
    let first = &scopes[0];
    let mut cases = vec![
        (
            "whole",
            vec![LibraryScopePair {
                server_id: first.server_id.clone(),
                library_id: None,
            }],
        ),
        ("exact", vec![first.clone()]),
    ];
    if let Some(other) = scopes
        .iter()
        .find(|s| s.server_id == first.server_id && s.library_id != first.library_id)
    {
        cases.push(("multi", vec![first.clone(), other.clone()]));
    }
    if let Some(other) = scopes.iter().find(|s| s.server_id != first.server_id) {
        cases.push(("cross", vec![first.clone(), other.clone()]));
    }
    cases
}

fn catalog(
    store: &LibraryStore,
    server: &str,
    kind: LibraryTagKind,
    rare: bool,
) -> Vec<LibraryTagFilter> {
    let (table, column) = match kind {
        LibraryTagKind::Genre => ("track_genre", "genre"),
        LibraryTagKind::Mood => ("track_mood", "mood"),
    };
    // Identifiers are fixed literals; values remain bound parameters.
    let order = if rare { "ASC" } else { "DESC" };
    let sql = format!(
        "SELECT {column} FROM {table} WHERE server_id = ?1 \
         GROUP BY {column} COLLATE NOCASE ORDER BY COUNT(*) {order}, {column} LIMIT 12"
    );
    store
        .with_read_conn(|conn| {
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map([server], |row| {
                Ok(LibraryTagFilter {
                    kind: kind.clone(),
                    value: row.get(0)?,
                })
            })?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
        })
        .expect("probe catalog")
}

fn alternating(
    genres: &[LibraryTagFilter],
    moods: &[LibraryTagFilter],
    size: usize,
) -> Option<Vec<LibraryTagFilter>> {
    let mut tags = Vec::with_capacity(size);
    for i in 0..genres.len().max(moods.len()) {
        if let Some(tag) = genres.get(i) {
            if tags.len() < size {
                tags.push(tag.clone());
            }
        }
        if let Some(tag) = moods.get(i) {
            if tags.len() < size {
                tags.push(tag.clone());
            }
        }
    }
    (tags.len() == size).then_some(tags)
}

fn nonempty_ten_tag_and(store: &LibraryStore, server: &str) -> Option<Vec<LibraryTagFilter>> {
    // This discovery query may scan the tag projections; it runs outside the
    // measured intervals and finds a real *track-level* 10-tag intersection.
    let track_id: Option<String> = store
        .with_read_conn(|conn| {
            conn.query_row(
                "SELECT refs.track_id \
             FROM (SELECT server_id, track_id FROM track_genre \
                   UNION ALL SELECT server_id, track_id FROM track_mood) refs \
             INNER JOIN track t ON t.server_id = refs.server_id AND t.id = refs.track_id \
             WHERE refs.server_id = ?1 AND t.deleted = 0 \
             GROUP BY refs.server_id, refs.track_id \
             HAVING COUNT(*) >= 10 ORDER BY COUNT(*) DESC LIMIT 1",
                [server],
                |row| row.get(0),
            )
            .optional()
        })
        .expect("discover 10-tag AND");
    let track_id = track_id?;
    let mut tags = Vec::new();
    for (table, column, kind) in [
        ("track_genre", "genre", LibraryTagKind::Genre),
        ("track_mood", "mood", LibraryTagKind::Mood),
    ] {
        let sql = format!(
            "SELECT {column} FROM {table} WHERE server_id = ?1 AND track_id = ?2 \
             ORDER BY {column} COLLATE NOCASE LIMIT 10"
        );
        let mut found: Vec<LibraryTagFilter> = store
            .with_read_conn(|conn| {
                let mut stmt = conn.prepare(&sql)?;
                let rows = stmt.query_map([server, &track_id], |row| {
                    Ok(LibraryTagFilter {
                        kind: kind.clone(),
                        value: row.get(0)?,
                    })
                })?;
                rows.collect::<rusqlite::Result<Vec<_>>>()
            })
            .expect("track tags");
        tags.append(&mut found);
    }
    tags.truncate(10);
    (normalize_tags(&tags).ok()?.len() == 10).then_some(tags)
}

fn build_query(
    scopes: &[LibraryScopePair],
    tags: &[LibraryTagFilter],
    mode: LibraryTagMatchMode,
    view: View,
) -> Query {
    let (cte, scope_params) = scope_cte_sql(scopes);
    let (where_sql, tag_params) = match view {
        View::Albums => album_filter_sql(tags, mode),
        View::Tracks => track_filter_sql(tags, mode),
    };
    let layer1 = matches!(view, View::Tracks)
        && crate::dto::scoped_layer1_eligible(scopes)
        && !crate::dto::multi_library_merge_enabled(scopes);

    let base_join = if layer1 {
        "FROM scoped_track s CROSS JOIN track t ON t.rowid = s.rowid WHERE t.deleted = 0"
    } else {
        "FROM scoped_track s CROSS JOIN track t ON t.rowid = s.rowid \
         LEFT JOIN cluster.track_cluster_key ck \
         ON ck.server_id = t.server_id AND ck.track_id = t.id \
         WHERE t.deleted = 0"
    };
    let base = if matches!(view, View::Albums) {
        format!("{base_join} AND t.album_id IS NOT NULL AND t.album_id != '' AND {where_sql}")
    } else {
        format!("{base_join} AND {where_sql}")
    };
    let (count_sql, page_sql) = if layer1 {
        (
            format!("{cte} SELECT COUNT(*) {base}"),
            format!(
                "{cte} SELECT {} {base} \
                 ORDER BY t.title COLLATE NOCASE ASC, t.artist COLLATE NOCASE ASC, \
                          t.album COLLATE NOCASE ASC, t.id ASC LIMIT ? OFFSET ?",
                crate::search::aliased_track_columns("t"),
            ),
        )
    } else if matches!(view, View::Tracks) {
        (
            format!("{cte} SELECT COUNT(DISTINCT {TRACK_DEDUP_KEY}) {base}"),
            format!(
                "{cte}, ranked AS ( \
                   SELECT {}, s.pr, {TRACK_DEDUP_KEY} AS track_dedup, \
                          ROW_NUMBER() OVER (PARTITION BY {TRACK_DEDUP_KEY} \
                          ORDER BY s.pr ASC, t.id ASC) AS rn \
                   {base} \
                 ) SELECT {} FROM ranked WHERE rn = 1 \
                 ORDER BY title COLLATE NOCASE ASC, artist COLLATE NOCASE ASC, \
                          album COLLATE NOCASE ASC, id ASC LIMIT ? OFFSET ?",
                crate::search::aliased_track_columns("t"),
                crate::repos::track_columns(),
            ),
        )
    } else {
        (
            format!("{cte} SELECT COUNT(DISTINCT {ALBUM_DEDUP_KEY}) {base}"),
            format!(
                "{cte}, base AS ( \
                   SELECT t.server_id, t.album_id, t.album, t.artist, t.artist_id, \
                          t.album_artist, t.year, t.genre, t.cover_art_id, \
                          t.starred_at, t.synced_at, t.duration_sec, t.id, s.pr, \
                          {ALBUM_DEDUP_KEY} AS album_dedup, \
                          {TRACK_DEDUP_KEY} AS track_dedup {base} \
                 ) \
                 SELECT server_id, album_id, album, artist, artist_id, album_artist, \
                        song_count, duration_total, year, genre, cover_art_id, starred_at, synced_at \
                 FROM ( \
                   SELECT server_id, album_id, album, artist, artist_id, album_artist, \
                          year, genre, cover_art_id, starred_at, synced_at, \
                          COUNT(DISTINCT track_dedup) AS song_count, \
                          SUM(duration_sec) AS duration_total, \
                          MIN({ALBUM_PICK_KEY}) AS _pick \
                   FROM base GROUP BY album_dedup \
                 ) \
                 ORDER BY album COLLATE NOCASE ASC, artist COLLATE NOCASE ASC, \
                          album_id ASC LIMIT ? OFFSET ?"
            ),
        )
    };
    let mut binds = scope_params;
    binds.extend(tag_params);
    Query {
        raw_filter_sql: format!("{cte} SELECT COUNT(*) {base}"),
        count_sql,
        page_sql,
        binds,
        layer1,
    }
}

fn plan(conn: &Connection, sql: &str, binds: &[SqlValue]) -> rusqlite::Result<Vec<String>> {
    let explain = format!("EXPLAIN QUERY PLAN {sql}");
    let mut stmt = conn.prepare(&explain)?;
    let rows = stmt.query_map(params_from_iter(binds.iter()), |row| {
        row.get::<_, String>(3)
    })?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
}

fn stats(label: &str, unit: &str, values: &[u64]) {
    if values.is_empty() {
        return;
    }
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    eprintln!(
        "    {label}: min_{unit}={} median_{unit}={} max_{unit}={} samples_{unit}={values:?}",
        sorted[0],
        sorted[sorted.len() / 2],
        sorted[sorted.len() - 1],
    );
}

fn report_plan(store: &LibraryStore, name: &str, sql: &str, binds: &[SqlValue]) {
    let steps = store
        .with_read_conn(|conn| plan(conn, sql, binds))
        .expect("EXPLAIN QUERY PLAN");
    // Plans contain schema object names and operations, never bound tag values.
    eprintln!("  plan={name} steps={}", steps.len());
    for detail in &steps {
        eprintln!("    {detail}");
    }
}

fn run_one(
    store: &LibraryStore,
    scopes: &[LibraryScopePair],
    tags: &[LibraryTagFilter],
    mode: LibraryTagMatchMode,
    view: View,
    offset: u32,
) {
    let query = build_query(scopes, tags, mode, view);
    let mut page_binds = query.binds.clone();
    page_binds.push(SqlValue::Integer(if matches!(view, View::Albums) {
        51
    } else {
        101
    }));
    page_binds.push(SqlValue::Integer(i64::from(offset)));

    let mut raw_filter_ms = Vec::new();
    let mut counts = Vec::new();
    let mut count_waits = Vec::new();
    let mut pages = Vec::new();
    let mut page_waits = Vec::new();
    let mut mapping_us = Vec::new();
    let mut api_ms = Vec::new();
    let mut result_count = 0i64;
    let mut page_len = 0usize;

    for _ in 0..RUNS {
        let (_, filter_timing) = store
            .with_read_conn_timed(|conn| {
                conn.query_row(
                    &query.raw_filter_sql,
                    params_from_iter(query.binds.iter()),
                    |row| row.get::<_, i64>(0),
                )
            })
            .expect("raw filtering");
        raw_filter_ms.push(filter_timing.exec_ms);

        let (count, timing) = store
            .with_read_conn_timed(|conn| {
                conn.query_row(
                    &query.count_sql,
                    params_from_iter(query.binds.iter()),
                    |row| row.get::<_, i64>(0),
                )
            })
            .expect("count statement");
        result_count = count;
        counts.push(timing.exec_ms);
        count_waits.push(timing.lock_wait_ms);

        let ((mirror_rows, map_us), timing) = store
            .with_read_conn_timed(|conn| {
                let mut stmt = conn.prepare(&query.page_sql)?;
                let mut converted_us = 0u128;
                let rows = stmt.query_map(params_from_iter(page_binds.iter()), |row| {
                    let started = Instant::now();
                    match view {
                        View::Tracks => {
                            let track = row_to_track_row(row)?;
                            let _dto = LibraryTrackDto::from_row(&track);
                        }
                        View::Albums => {
                            let parsed: crate::scope_merge::AlbumListRow = (
                                row.get(0)?,
                                row.get(1)?,
                                row.get(2)?,
                                row.get(3)?,
                                row.get(4)?,
                                row.get(5)?,
                                row.get(6)?,
                                row.get(7)?,
                                row.get(8)?,
                                row.get(9)?,
                                row.get(10)?,
                                row.get(11)?,
                                row.get(12)?,
                            );
                            let _dto: LibraryAlbumDto =
                                crate::scope_merge::album_row_to_dto(parsed);
                        }
                    }
                    converted_us += started.elapsed().as_micros();
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })?;
                let ids = rows.collect::<rusqlite::Result<Vec<_>>>()?;
                Ok((ids, converted_us))
            })
            .expect("page statement");
        page_len = mirror_rows.len();
        pages.push(timing.exec_ms);
        page_waits.push(timing.lock_wait_ms);
        mapping_us.push(map_us as u64);

        // Full public API timing includes scope preparation and post-query
        // overlays, which the direct SQL above does not. Do not subtract it
        // from the SQL timings: the two reads are different transactions.
        let started = Instant::now();
        let (public_ids, public_total) = match view {
            View::Albums => {
                let page = list_albums(
                    store,
                    &LibraryTagExplorerAlbumsRequest {
                        server_id: scopes[0].server_id.clone(),
                        library_scope: None,
                        library_scopes: Some(scopes.to_vec()),
                        tags: tags.to_vec(),
                        mode,
                        limit: 50,
                        offset,
                        include_total: offset == 0,
                        count_only: false,
                    },
                )
                .expect("albums API");
                (
                    page.albums
                        .into_iter()
                        .map(|a| (a.server_id, a.id))
                        .collect::<Vec<_>>(),
                    page.total,
                )
            }
            View::Tracks => {
                let page = list_tracks(
                    store,
                    &LibraryTagExplorerTracksRequest {
                        server_id: scopes[0].server_id.clone(),
                        library_scope: None,
                        library_scopes: Some(scopes.to_vec()),
                        tags: tags.to_vec(),
                        mode,
                        limit: 100,
                        offset,
                        include_total: offset == 0,
                        count_only: false,
                    },
                )
                .expect("tracks API");
                (
                    page.tracks
                        .into_iter()
                        .map(|t| (t.server_id, t.id))
                        .collect::<Vec<_>>(),
                    page.total,
                )
            }
        };
        api_ms.push(started.elapsed().as_millis() as u64);
        // The SQL mirror requests limit+1; compare the exact public page prefix.
        assert_eq!(
            &mirror_rows[..mirror_rows.len().min(public_ids.len())],
            public_ids.as_slice(),
            "SQL mirror must preserve exact ordered identities"
        );
        assert!(mirror_rows.len() == public_ids.len() || mirror_rows.len() == public_ids.len() + 1);
        if offset == 0 {
            assert_eq!(
                public_total,
                Some(result_count.max(0) as u32),
                "SQL/API count mismatch"
            );
        } else {
            assert!(public_total.is_none());
        }
    }

    eprintln!(
        "  view={} mode={mode:?} tags={} offset={} layer1={} total={} rows={} runs={RUNS}",
        view.label(),
        tags.len(),
        offset,
        query.layer1,
        result_count,
        page_len
    );
    stats("raw_filter_scan", "ms", &raw_filter_ms);
    stats("count_execution", "ms", &counts);
    stats("count_read_lock_wait", "ms", &count_waits);
    stats("page_execution_including_conversion", "ms", &pages);
    stats("page_read_lock_wait", "ms", &page_waits);
    stats("row_to_dto_conversion", "us", &mapping_us);
    stats("public_API_total", "ms", &api_ms);

    // Reference enumeration always starts at zero and traverses the entire
    // matching set. Repeating it for every deep page multiplies run cost.
    if matches!(view, View::Tracks) && offset == 0 {
        let mut refs_ms = Vec::new();
        let mut refs_size = 0usize;
        for _ in 0..RUNS {
            let started = Instant::now();
            let mut next_offset = 0u32;
            let mut collected = Vec::new();
            loop {
                let page = list_track_refs(
                    store,
                    &LibraryTagExplorerTrackRefsRequest {
                        server_id: scopes[0].server_id.clone(),
                        library_scope: None,
                        library_scopes: Some(scopes.to_vec()),
                        tags: tags.to_vec(),
                        mode,
                        limit: 500,
                        offset: next_offset,
                    },
                )
                .expect("full selection reference query");
                let n = page.tracks.len();
                collected.extend(page.tracks.into_iter().map(|r| (r.server_id, r.track_id)));
                if !page.has_more {
                    break;
                }
                assert!(n > 0, "reference pagination must progress");
                next_offset += n as u32;
            }
            let unique: std::collections::HashSet<_> = collected.iter().collect();
            assert_eq!(
                unique.len(),
                collected.len(),
                "duplicate playlist reference"
            );
            assert_eq!(
                collected.len() as i64,
                result_count,
                "Select All references must equal the independently measured exact count"
            );
            refs_ms.push(started.elapsed().as_millis() as u64);
            refs_size = collected.len();
        }
        eprintln!("    complete_reference_rows={refs_size} reference_page_limit=500");
        stats("full_reference_resolution", "ms", &refs_ms);
    }
    report_plan(store, "raw_filter", &query.raw_filter_sql, &query.binds);
    report_plan(store, "count", &query.count_sql, &query.binds);
    report_plan(store, "page", &query.page_sql, &page_binds);
}

#[test]
#[ignore = "requires explicitly marked disposable PSYSONIC_EXPLORER_COPY_DB copy"]
fn explorer_backend_queries_against_disposable_copy() {
    let Some(db) = checked_copy_path() else {
        return;
    };
    let staged_at = Instant::now();
    let source_parent = db.parent().expect("source directory");
    let source_before = copy_fingerprints(source_parent);
    let sandbox = stage_in_temporary_sandbox(&db);
    eprintln!("sandbox_stage_ms={}", staged_at.elapsed().as_millis());
    let schema_before = sandbox_schema_head(&sandbox.database);
    eprintln!("sandbox_schema_head_before={schema_before:?}");
    let opened = Instant::now();
    // This opener can migrate/rebuild, but only within the second disposable
    // sandbox. The supplied copy and live Psysonic database stay untouched.
    let store =
        LibraryStore::open_path_for_test(&sandbox.database).expect("open temporary probe sandbox");
    eprintln!("open_sandbox_ms={}", opened.elapsed().as_millis());
    let scopes = nondeleted_scopes(&store);
    if scopes.is_empty() {
        eprintln!("SKIP: no indexed library scopes");
        return;
    }
    let cases = scope_cases(&scopes);
    let server = scopes[0].server_id.as_str();

    let common_genres = catalog(&store, server, LibraryTagKind::Genre, false);
    let common_moods = catalog(&store, server, LibraryTagKind::Mood, false);
    let rare_genres = catalog(&store, server, LibraryTagKind::Genre, true);
    let rare_moods = catalog(&store, server, LibraryTagKind::Mood, true);
    let and_ten = nonempty_ten_tag_and(&store, server);

    let mut selections = Vec::new();
    for n in [2usize, 5, 10] {
        if let Some(tags) = alternating(&common_genres, &common_moods, n) {
            selections.push((format!("common-{n}"), tags));
        }
        if let Some(tags) = alternating(&rare_genres, &rare_moods, n) {
            selections.push((format!("rare-{n}"), tags));
        }
    }
    if let Some(tags) = and_ten {
        selections.push(("nonempty-10-AND".to_string(), tags));
    } else {
        eprintln!("SKIP: no track-level nonempty 10-tag AND could be derived");
    }

    let scope_filter =
        std::env::var("PSYSONIC_EXPLORER_PROBE_SCOPE").unwrap_or_else(|_| "whole".into());
    let selection_filter =
        std::env::var("PSYSONIC_EXPLORER_PROBE_SELECTION").unwrap_or_else(|_| "all".into());
    let mode_filter =
        std::env::var("PSYSONIC_EXPLORER_PROBE_MODE").unwrap_or_else(|_| "all".into());
    let offsets =
        std::env::var("PSYSONIC_EXPLORER_PROBE_OFFSETS").unwrap_or_else(|_| "0,1000,5000".into());
    let offsets: Vec<u32> = offsets
        .split(',')
        .map(|s| {
            s.trim()
                .parse()
                .expect("offset must be a nonnegative integer")
        })
        .collect();
    let mut executed = 0usize;
    for (label, selected_scopes) in &cases {
        if scope_filter != "all" && scope_filter != *label {
            continue;
        }
        let started = Instant::now();
        prepare_scope(
            &store,
            &selected_scopes[0].server_id,
            None,
            Some(selected_scopes),
        )
        .expect("prepare scope");
        eprintln!(
            "scope={label} scope_count={} initial_prepare_ms={}",
            selected_scopes.len(),
            started.elapsed().as_millis()
        );
        report_scope_metadata(&store, selected_scopes);
        let mut warm_prepare_ms = Vec::new();
        for _ in 0..RUNS {
            let started = Instant::now();
            prepare_scope(
                &store,
                &selected_scopes[0].server_id,
                None,
                Some(selected_scopes),
            )
            .expect("warm prepare");
            warm_prepare_ms.push(started.elapsed().as_millis() as u64);
        }
        stats("warm_scope_prepare", "ms", &warm_prepare_ms);

        for (selection_name, tags) in &selections {
            if selection_filter != "all" && selection_filter != *selection_name {
                continue;
            }
            eprintln!("selection={selection_name} (values withheld)");
            for mode in [LibraryTagMatchMode::Or, LibraryTagMatchMode::And] {
                if selection_name == "nonempty-10-AND" && mode == LibraryTagMatchMode::Or {
                    continue;
                }
                if mode_filter != "all" && mode_filter != format!("{mode:?}").to_lowercase() {
                    continue;
                }
                for view in [View::Albums, View::Tracks] {
                    for &offset in &offsets {
                        run_one(&store, selected_scopes, tags, mode, view, offset);
                        executed += 1;
                    }
                }
            }
        }
    }
    assert!(executed > 0, "no probe cases were selected");
    assert_eq!(
        copy_fingerprints(source_parent),
        source_before,
        "disposable source files changed during probe"
    );
    eprintln!(
        "complete_cases={executed}; source_copy_unchanged=verified; sandbox_writes_only=true"
    );
}
