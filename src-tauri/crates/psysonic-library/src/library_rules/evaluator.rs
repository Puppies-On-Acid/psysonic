//! Stage 1B2: manual-only, read-only SQLite evaluation of validated rule trees.
//! This module does not register IPC, open database files or schedule work.
//! SQL identifiers and expressions are fixed by backend mappings; every
//! user-provided value and server/library scope is a SQLite bound parameter.

use rusqlite::{params_from_iter, types::Value as SqlValue, Connection};
use serde::Serialize;

use super::{
    validate_rule_document, RuleCombinator, RuleDocument, RuleEntity, RuleNode, RuleOperator,
    RuleValue,
};
use crate::dto::LibraryScopePair;
use crate::scope_merge::normalize_scope_pairs;
use crate::tag_audit::projections_ready;

pub const MAX_RULE_PAGE_SIZE: u32 = 200;
const MAX_RULE_SCOPES: usize = 150;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuleMatch {
    pub server_id: String,
    pub library_id: Option<String>,
    pub item_id: String,
    pub album_id: Option<String>,
    pub name: String,
    pub artist: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RulePage {
    pub items: Vec<RuleMatch>,
    pub has_more: bool,
}

struct CompiledQuery {
    sql: String,
    params: Vec<SqlValue>,
}

fn requires_tag_projection(node: &RuleNode) -> bool {
    match node {
        RuleNode::Group { children, .. } => children.iter().any(requires_tag_projection),
        RuleNode::Predicate { field, .. } => matches!(
            field.as_str(),
            "genreStatus"
                | "moodStatus"
                | "genreMissingTracks"
                | "moodMissingTracks"
                | "genrePresent"
                | "moodPresent"
        ),
    }
}

fn scoped_where(scopes: &[LibraryScopePair]) -> Result<(String, Vec<SqlValue>), String> {
    let scopes = normalize_scope_pairs(scopes)?;
    if scopes.is_empty() {
        return Err("Select at least one library before running a rule".to_string());
    }
    if scopes.len() > MAX_RULE_SCOPES {
        return Err("Too many selected library scopes for a rule".to_string());
    }

    let mut conditions = Vec::with_capacity(scopes.len());
    let mut params = Vec::with_capacity(scopes.len() * 2);
    for scope in scopes {
        if let Some(library_id) = scope.library_id {
            conditions.push("(t.server_id = ? AND t.library_id = ?)".to_string());
            params.push(SqlValue::Text(scope.server_id));
            params.push(SqlValue::Text(library_id));
        } else {
            conditions.push("(t.server_id = ?)".to_string());
            params.push(SqlValue::Text(scope.server_id));
        }
    }
    Ok((conditions.join(" OR "), params))
}

/// The two-stage aggregation retains the original tag-audit algorithm.
/// Album-level genre alone counts as partial (not missing) when no tracks
/// contain genre tags; a fully tagged track set is complete.
fn album_source_sql(scope_sql: &str) -> String {
    format!(
        r#"
        SELECT x.server_id, x.library_id, x.album_id AS item_id,
               x.album_id, COALESCE(x.albumName, '[Unknown album]') AS name,
               x.albumArtist AS artist, x.albumName, x.albumArtist, x.albumYear,
               x.trackCount, x.albumGenrePresent,
               (x.trackCount - x.genreTaggedTracks) AS genreMissingTracks,
               (x.trackCount - x.moodTaggedTracks) AS moodMissingTracks,
               CASE WHEN x.genreTaggedTracks >= x.trackCount THEN 'complete'
                    WHEN x.genreTaggedTracks = 0 AND x.albumGenrePresent = 0 THEN 'missing'
                    ELSE 'partial' END AS genreStatus,
               CASE WHEN x.moodTaggedTracks >= x.trackCount THEN 'complete'
                    WHEN x.moodTaggedTracks = 0 THEN 'missing'
                    ELSE 'partial' END AS moodStatus
        FROM (
            SELECT t.server_id, COALESCE(t.library_id, '') AS library_id,
                   t.album_id,
                   COALESCE(NULLIF(TRIM(MAX(a.name)), ''),
                            NULLIF(TRIM(MAX(t.album)), '')) AS albumName,
                   COALESCE(NULLIF(TRIM(MAX(a.artist)), ''),
                            NULLIF(TRIM(MAX(t.album_artist)), ''),
                            NULLIF(TRIM(MAX(t.artist)), '')) AS albumArtist,
                   NULLIF(MAX(a.year), 0) AS albumYear,
                   COUNT(*) AS trackCount,
                   SUM(CASE WHEN EXISTS (
                       SELECT 1 FROM track_genre g
                       WHERE g.server_id = t.server_id AND g.track_id = t.id
                         AND TRIM(g.genre) != ''
                   ) THEN 1 ELSE 0 END) AS genreTaggedTracks,
                   SUM(CASE WHEN EXISTS (
                       SELECT 1 FROM track_mood m
                       WHERE m.server_id = t.server_id AND m.track_id = t.id
                         AND TRIM(m.mood) != ''
                   ) THEN 1 ELSE 0 END) AS moodTaggedTracks,
                   MAX(CASE WHEN NULLIF(TRIM(a.genre), '') IS NOT NULL
                       THEN 1 ELSE 0 END) AS albumGenrePresent
            FROM track t
            LEFT JOIN album a ON a.server_id = t.server_id AND a.id = t.album_id
            WHERE t.deleted = 0 AND t.album_id IS NOT NULL
              AND TRIM(t.album_id) != '' AND ({scope_sql})
            GROUP BY t.server_id, COALESCE(t.library_id, ''), t.album_id
        ) x
        "#
    )
}

fn track_source_sql(scope_sql: &str) -> String {
    format!(
        r#"
        SELECT t.server_id, COALESCE(t.library_id, '') AS library_id,
               t.id AS item_id, t.album_id,
               t.title AS name, t.artist,
               t.title AS trackTitle, NULLIF(TRIM(t.artist), '') AS trackArtist,
               NULLIF(TRIM(t.album), '') AS albumName,
               NULLIF(t.year, 0) AS trackYear, t.duration_sec AS durationSeconds,
               t.bit_rate AS bitRate, t.play_count AS playCount,
               CASE WHEN EXISTS (
                   SELECT 1 FROM track_genre g
                   WHERE g.server_id = t.server_id AND g.track_id = t.id
                     AND TRIM(g.genre) != ''
               ) THEN 1 ELSE 0 END AS genrePresent,
               CASE WHEN EXISTS (
                   SELECT 1 FROM track_mood m
                   WHERE m.server_id = t.server_id AND m.track_id = t.id
                     AND TRIM(m.mood) != ''
               ) THEN 1 ELSE 0 END AS moodPresent
        FROM track t
        WHERE t.deleted = 0 AND ({scope_sql})
        "#
    )
}

/// Never interpolate a user-supplied column name. The field strings below
/// are literal compiler-controlled expressions independent of the frontend.
fn field_sql(entity: RuleEntity, field: &str) -> Result<&'static str, String> {
    let expression = match (entity, field) {
        (RuleEntity::Album, "albumName") => "r.albumName",
        (RuleEntity::Album, "albumArtist") => "r.albumArtist",
        (RuleEntity::Album, "albumYear") => "r.albumYear",
        (RuleEntity::Album, "trackCount") => "r.trackCount",
        (RuleEntity::Album, "genreStatus") => "r.genreStatus",
        (RuleEntity::Album, "moodStatus") => "r.moodStatus",
        (RuleEntity::Album, "genreMissingTracks") => "r.genreMissingTracks",
        (RuleEntity::Album, "moodMissingTracks") => "r.moodMissingTracks",
        (RuleEntity::Album, "albumGenrePresent") => "r.albumGenrePresent",
        (RuleEntity::Track, "trackTitle") => "r.trackTitle",
        (RuleEntity::Track, "trackArtist") => "r.trackArtist",
        (RuleEntity::Track, "albumName") => "r.albumName",
        (RuleEntity::Track, "trackYear") => "r.trackYear",
        (RuleEntity::Track, "durationSeconds") => "r.durationSeconds",
        (RuleEntity::Track, "bitRate") => "r.bitRate",
        (RuleEntity::Track, "playCount") => "r.playCount",
        (RuleEntity::Track, "genrePresent") => "r.genrePresent",
        (RuleEntity::Track, "moodPresent") => "r.moodPresent",
        _ => return Err(format!("Unsupported Library Rules field: {field}")),
    };
    Ok(expression)
}

fn compile_node(
    node: &RuleNode,
    entity: RuleEntity,
    params: &mut Vec<SqlValue>,
) -> Result<String, String> {
    match node {
        RuleNode::Group {
            combinator,
            children,
        } => {
            let joiner = match combinator {
                RuleCombinator::All => " AND ",
                RuleCombinator::Any => " OR ",
            };
            let parts = children
                .iter()
                .map(|child| compile_node(child, entity, params))
                .collect::<Result<Vec<_>, _>>()?;
            Ok(format!("({})", parts.join(joiner)))
        }
        RuleNode::Predicate {
            field,
            operator,
            value,
        } => {
            let column = field_sql(entity, field)?;
            if *operator == RuleOperator::IsMissing {
                return Ok(format!("{column} IS NULL"));
            }
            if *operator == RuleOperator::IsPresent {
                return Ok(format!("{column} IS NOT NULL"));
            }

            let bound = value
                .as_ref()
                .ok_or_else(|| format!("Missing rule value for {field}"))?;
            let sql_value = match bound {
                RuleValue::Text(text) => SqlValue::Text(text.clone()),
                RuleValue::Integer(number) => SqlValue::Integer(*number),
                RuleValue::Boolean(flag) => SqlValue::Integer(i64::from(*flag)),
            };
            let is_text = matches!(bound, RuleValue::Text(_));
            let column_cmp = if is_text {
                format!("{column} COLLATE NOCASE")
            } else {
                column.to_string()
            };
            let query = match operator {
                RuleOperator::Is => format!("{column_cmp} = ?"),
                RuleOperator::IsNot => {
                    format!("({column} IS NOT NULL AND {column_cmp} <> ?)")
                }
                RuleOperator::Contains => {
                    format!("INSTR(LOWER({column}), LOWER(?)) > 0")
                }
                RuleOperator::NotContains => {
                    format!("({column} IS NOT NULL AND INSTR(LOWER({column}), LOWER(?)) = 0)")
                }
                RuleOperator::StartsWith => {
                    format!("INSTR(LOWER({column}), LOWER(?)) = 1")
                }
                RuleOperator::EndsWith => {
                    params.push(sql_value.clone());
                    format!("SUBSTR(LOWER({column}), -LENGTH(?)) = LOWER(?)")
                }
                RuleOperator::GreaterThan => format!("{column} > ?"),
                RuleOperator::AtLeast => format!("{column} >= ?"),
                RuleOperator::LessThan => format!("{column} < ?"),
                RuleOperator::AtMost => format!("{column} <= ?"),
                RuleOperator::IsPresent | RuleOperator::IsMissing => {
                    unreachable!("presence handled before binding")
                }
            };
            params.push(sql_value);
            Ok(query)
        }
    }
}

fn compile_page(
    doc: &RuleDocument,
    scopes: &[LibraryScopePair],
    limit: u32,
    offset: u32,
) -> Result<CompiledQuery, String> {
    validate_rule_document(doc)?;
    if limit == 0 || limit > MAX_RULE_PAGE_SIZE {
        return Err(format!(
            "Library Rules page limit must be between 1 and {MAX_RULE_PAGE_SIZE}"
        ));
    }
    let (scope_sql, mut params) = scoped_where(scopes)?;
    let source = match doc.entity {
        RuleEntity::Album => album_source_sql(&scope_sql),
        RuleEntity::Track => track_source_sql(&scope_sql),
    };
    let predicate = compile_node(&doc.root, doc.entity, &mut params)?;
    params.push(SqlValue::Integer(i64::from(limit) + 1));
    params.push(SqlValue::Integer(i64::from(offset)));

    // A deterministic total order prevents records jumping across pages.
    // One extra record indicates whether another page exists; avoid returning
    // an unbounded set of potentially 100k+ matching tracks to the frontend.
    let sql = format!(
        "SELECT r.server_id, r.library_id, r.item_id, r.album_id, \
                r.name, r.artist FROM ({source}) r \
         WHERE {predicate} \
         ORDER BY r.name COLLATE NOCASE, r.server_id, r.library_id, r.item_id \
         LIMIT ? OFFSET ?"
    );
    Ok(CompiledQuery { sql, params })
}

/// Caller-owned read-only SQLite connection. This method never writes,
/// opens files, syncs or schedules work. A Tauri command is NOT wired yet.
pub fn evaluate_page(
    conn: &Connection,
    doc: &RuleDocument,
    scopes: &[LibraryScopePair],
    limit: u32,
    offset: u32,
) -> Result<RulePage, String> {
    // Always validate untrusted rules, scope and pagination before touching SQLite.
    let compiled = compile_page(doc, scopes, limit, offset)?;
    // Do not silently report missing metadata while projection backfill is
    // incomplete. Rules on unrelated indexed fields remain evaluable.
    if requires_tag_projection(&doc.root) {
        let ready = projections_ready(conn).map_err(|err| err.to_string())?;
        if !ready {
            return Err("Genre/mood projection backfill is incomplete".to_string());
        }
    }
    let mut stmt = conn.prepare(&compiled.sql).map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map(params_from_iter(compiled.params.iter()), |row| {
            let library_id: String = row.get(1)?;
            Ok(RuleMatch {
                server_id: row.get(0)?,
                library_id: (!library_id.is_empty()).then_some(library_id),
                item_id: row.get(2)?,
                album_id: row.get(3)?,
                name: row.get(4)?,
                artist: row.get(5)?,
            })
        })
        .map_err(|err| err.to_string())?;
    let mut items = rows
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|err| err.to_string())?;
    let has_more = items.len() > limit as usize;
    items.truncate(limit as usize);
    Ok(RulePage { items, has_more })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn fixture() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE album (
                server_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL,
                artist TEXT, genre TEXT, year INTEGER,
                PRIMARY KEY (server_id, id)
             );
             CREATE TABLE track (
                server_id TEXT NOT NULL, id TEXT NOT NULL,
                title TEXT NOT NULL, artist TEXT, album TEXT NOT NULL DEFAULT '',
                album_id TEXT, album_artist TEXT, library_id TEXT,
                year INTEGER, duration_sec INTEGER NOT NULL DEFAULT 0,
                bit_rate INTEGER, play_count INTEGER,
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

    fn add_track(
        conn: &Connection,
        server: &str,
        library: &str,
        album: Option<&str>,
        id: &str,
        genre: Option<&str>,
        mood: Option<&str>,
    ) {
        conn.execute(
            "INSERT INTO track
             (server_id, id, title, artist, album, album_id,
              album_artist, library_id, year, duration_sec, play_count)
             VALUES (?1, ?2, ?2, 'The Artist', COALESCE(?3, ''),
                     ?3, 'The Artist', ?4, 1999, 120, 0)",
            (server, id, album, library),
        )
        .unwrap();
        if let Some(tag) = genre {
            conn.execute(
                "INSERT INTO track_genre VALUES (?1, ?2, ?3)",
                (server, id, tag),
            )
            .unwrap();
        }
        if let Some(tag) = mood {
            conn.execute(
                "INSERT INTO track_mood VALUES (?1, ?2, ?3)",
                (server, id, tag),
            )
            .unwrap();
        }
    }

    fn ready(conn: &Connection) {
        conn.execute_batch(
            "INSERT INTO library_data_migration VALUES
             ('genre_tags_v1', 1), ('mood_tags_v3', 1)",
        )
        .unwrap();
    }

    fn scope(server: &str, library: Option<&str>) -> LibraryScopePair {
        LibraryScopePair {
            server_id: server.to_string(),
            library_id: library.map(str::to_string),
        }
    }

    fn rule(json_value: Value) -> RuleDocument {
        serde_json::from_value(json_value).unwrap()
    }

    fn missing_preset() -> RuleDocument {
        rule(json!({
            "version": 1, "entity": "album",
            "root": {"kind": "group", "combinator": "any", "children": [
                {"kind": "predicate", "field": "genreStatus",
                 "operator": "isNot", "value": "complete"},
                {"kind": "predicate", "field": "moodStatus",
                 "operator": "isNot", "value": "complete"}
            ]}
        }))
    }

    fn matched_ids(page: &RulePage) -> Vec<String> {
        let mut ids = page
            .items
            .iter()
            .map(|row| row.item_id.clone())
            .collect::<Vec<_>>();
        ids.sort();
        ids
    }

    #[test]
    fn matches_the_v1_genre_mood_oracle_including_album_level_genre() {
        let conn = fixture();
        ready(&conn);
        add_track(&conn, "s1", "l1", Some("empty"), "e1", None, None);
        add_track(
            &conn,
            "s1",
            "l1",
            Some("mixed"),
            "m1",
            Some("Rock"),
            Some("Bright"),
        );
        add_track(&conn, "s1", "l1", Some("mixed"), "m2", None, None);
        add_track(
            &conn,
            "s1",
            "l1",
            Some("done"),
            "d1",
            Some("Rock"),
            Some("Bright"),
        );
        add_track(
            &conn,
            "s1",
            "l1",
            Some("album-genre"),
            "a1",
            None,
            Some("Bright"),
        );
        conn.execute(
            "INSERT INTO album VALUES ('s1', 'album-genre', 'Album Genre',
                                      'The Artist', 'Jazz', 1999)",
            [],
        )
        .unwrap();

        let scopes = [scope("s1", None)];
        let v1 = crate::tag_audit::query_audit(&conn, &scopes).unwrap();
        let v2 = evaluate_page(&conn, &missing_preset(), &scopes, 50, 0).unwrap();
        let mut expected = v1
            .albums
            .into_iter()
            .map(|album| album.album_id)
            .collect::<Vec<_>>();
        expected.sort();
        assert_eq!(matched_ids(&v2), expected);
        assert_eq!(expected.len(), 3);
        assert!(!v2.has_more);
    }

    #[test]
    fn does_not_merge_copies_or_include_deleted_or_unlinked_albums() {
        let conn = fixture();
        ready(&conn);
        add_track(
            &conn,
            "s1",
            "l1",
            Some("same"),
            "a",
            Some("Rock"),
            Some("Bright"),
        );
        add_track(&conn, "s1", "l2", Some("same"), "b", None, None);
        add_track(&conn, "s2", "l1", Some("same"), "c", None, Some("Bright"));
        add_track(&conn, "s1", "l1", Some("deleted"), "d", None, None);
        add_track(&conn, "s1", "l1", None, "orphan", None, None);
        conn.execute("UPDATE track SET deleted = 1 WHERE id = 'd'", [])
            .unwrap();
        let scopes = [scope("s1", None), scope("s2", None)];
        let result = evaluate_page(&conn, &missing_preset(), &scopes, 50, 0).unwrap();
        assert_eq!(result.items.len(), 2);
        assert_eq!(
            result
                .items
                .iter()
                .map(|row| row.server_id.as_str())
                .collect::<Vec<_>>(),
            vec!["s1", "s2"]
        );
        assert!(result
            .items
            .iter()
            .all(|row| row.album_id.as_deref() == Some("same")));
        let only_l1 =
            evaluate_page(&conn, &missing_preset(), &[scope("s1", Some("l1"))], 50, 0).unwrap();
        assert!(only_l1.items.is_empty());
    }

    #[test]
    fn evaluates_nested_typed_conditions_and_literal_search_text() {
        let conn = fixture();
        ready(&conn);
        add_track(&conn, "s1", "l1", Some("Jazz_100%"), "a1", None, None);
        add_track(&conn, "s1", "l1", Some("Other"), "a2", None, None);
        let doc = rule(json!({
            "version": 1, "entity": "album",
            "root": {"kind": "group", "combinator": "all", "children": [
                {"kind": "predicate", "field": "trackCount",
                 "operator": "atLeast", "value": 1},
                {"kind": "group", "combinator": "any", "children": [
                    {"kind": "predicate", "field": "albumName",
                     "operator": "contains", "value": "_100%"},
                    {"kind": "predicate", "field": "albumYear",
                     "operator": "isPresent"}
                ]}
            ]}
        }));
        let result = evaluate_page(&conn, &doc, &[scope("s1", None)], 50, 0).unwrap();
        assert_eq!(matched_ids(&result), vec!["Jazz_100%"]);
        let injected = rule(json!({
            "version": 1, "entity": "album",
            "root": {"kind": "group", "combinator": "all", "children": [
                {"kind": "predicate", "field": "albumName",
                 "operator": "contains", "value": "' OR 1=1 --"}
            ]}
        }));
        assert!(evaluate_page(&conn, &injected, &[scope("s1", None)], 50, 0)
            .unwrap()
            .items
            .is_empty());
    }

    #[test]
    fn track_rules_include_orphans_and_ignore_blank_tags_and_tombstones() {
        let conn = fixture();
        ready(&conn);
        add_track(&conn, "s1", "l1", None, "orphan", None, None);
        add_track(
            &conn,
            "s1",
            "l1",
            Some("one"),
            "tagged",
            Some("Rock"),
            Some("Bright"),
        );
        add_track(
            &conn,
            "s1",
            "l1",
            Some("two"),
            "blank",
            Some("  "),
            Some(""),
        );
        add_track(&conn, "s1", "l1", Some("three"), "deleted", None, None);
        conn.execute("UPDATE track SET deleted = 1 WHERE id = 'deleted'", [])
            .unwrap();
        let doc = rule(json!({
            "version": 1, "entity": "track",
            "root": {"kind": "group", "combinator": "any", "children": [
                {"kind": "predicate", "field": "genrePresent",
                 "operator": "is", "value": false},
                {"kind": "predicate", "field": "moodPresent",
                 "operator": "is", "value": false}
            ]}
        }));
        let result = evaluate_page(&conn, &doc, &[scope("s1", None)], 50, 0).unwrap();
        assert_eq!(matched_ids(&result), vec!["blank", "orphan"]);
    }

    #[test]
    fn gating_blocks_unindexed_tags_but_allows_metadata_only_queries() {
        let conn = fixture();
        add_track(&conn, "s1", "l1", Some("one"), "t1", None, None);
        assert!(
            evaluate_page(&conn, &missing_preset(), &[scope("s1", None)], 50, 0)
                .unwrap_err()
                .contains("backfill")
        );

        let simple = rule(json!({
            "version": 1, "entity": "track",
            "root": {"kind": "group", "combinator": "all", "children": [
                {"kind": "predicate", "field": "durationSeconds",
                 "operator": "atLeast", "value": 100}
            ]}
        }));
        assert_eq!(
            evaluate_page(&conn, &simple, &[scope("s1", None)], 50, 0)
                .unwrap()
                .items
                .len(),
            1
        );
    }

    #[test]
    fn pagination_is_deterministic_and_bounded() {
        let conn = fixture();
        for id in ["a", "b", "c"] {
            add_track(&conn, "s1", "l1", None, id, None, None);
        }
        let doc = rule(json!({
            "version": 1, "entity": "track",
            "root": {"kind": "group", "combinator": "all", "children": [
                {"kind": "predicate", "field": "durationSeconds",
                 "operator": "greaterThan", "value": 0}
            ]}
        }));
        let scopes = [scope("s1", None)];
        let page0 = evaluate_page(&conn, &doc, &scopes, 1, 0).unwrap();
        let page1 = evaluate_page(&conn, &doc, &scopes, 1, 1).unwrap();
        let page2 = evaluate_page(&conn, &doc, &scopes, 1, 2).unwrap();
        assert_eq!(matched_ids(&page0), vec!["a"]);
        assert_eq!(matched_ids(&page1), vec!["b"]);
        assert_eq!(matched_ids(&page2), vec!["c"]);
        assert!(page0.has_more);
        assert!(page1.has_more);
        assert!(!page2.has_more);
        assert!(evaluate_page(&conn, &doc, &scopes, 0, 0).is_err());
        assert!(evaluate_page(&conn, &doc, &scopes, MAX_RULE_PAGE_SIZE + 1, 0).is_err());
        assert!(evaluate_page(&conn, &doc, &[], 1, 0).is_err());
    }

    #[test]
    fn readonly_sqlite_connection_can_evaluate_both_entities() {
        let conn = fixture();
        ready(&conn);
        add_track(&conn, "s1", "l1", Some("one"), "t1", None, None);
        conn.execute_batch("PRAGMA query_only = ON").unwrap();
        let scopes = [scope("s1", None)];
        let page = evaluate_page(&conn, &missing_preset(), &scopes, 5, 0).unwrap();
        assert_eq!(page.items.len(), 1);
        let track = rule(json!({
            "version": 1, "entity": "track",
            "root": {"kind": "group", "combinator": "all", "children": [
                {"kind": "predicate", "field": "trackTitle",
                 "operator": "startsWith", "value": "t"}
            ]}
        }));
        assert_eq!(
            evaluate_page(&conn, &track, &scopes, 5, 0)
                .unwrap()
                .items
                .len(),
            1
        );
        assert!(conn.execute("DELETE FROM track", []).is_err());
    }

    #[test]
    fn rejects_invalid_rule_fields_even_for_direct_rust_callers() {
        let conn = fixture();
        let doc = rule(json!({
            "version": 1, "entity": "album",
            "root": {"kind": "group", "combinator": "all", "children": [
                {"kind": "predicate", "field": "notAField",
                 "operator": "is", "value": "x"}
            ]}
        }));
        assert!(evaluate_page(&conn, &doc, &[scope("s1", None)], 5, 0).is_err());
    }

    #[test]
    fn missing_values_do_not_match_is_not_or_not_contains() {
        let conn = fixture();
        add_track(&conn, "s1", "l1", Some("first"), "one", None, None);
        add_track(&conn, "s1", "l1", Some("second"), "two", None, None);
        conn.execute("UPDATE track SET artist = NULL WHERE id = 'one'", [])
            .unwrap();
        let predicate = |operator: &str, value: Option<&str>| {
            let mut node = json!({
                "kind": "predicate", "field": "trackArtist",
                "operator": operator
            });
            if let Some(value) = value {
                node["value"] = json!(value);
            }
            rule(json!({
                "version": 1, "entity": "track",
                "root": {"kind": "group", "combinator": "all", "children": [node]}
            }))
        };
        let scopes = [scope("s1", None)];
        let not_contains = evaluate_page(
            &conn,
            &predicate("notContains", Some("other")),
            &scopes,
            10,
            0,
        )
        .unwrap();
        assert_eq!(matched_ids(&not_contains), vec!["two"]);
        let missing = evaluate_page(&conn, &predicate("isMissing", None), &scopes, 10, 0).unwrap();
        assert_eq!(matched_ids(&missing), vec!["one"]);
    }
}
