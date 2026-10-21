use super::*;
use crate::dto::{
    LibraryTagExplorerAlbumsRequest, LibraryTagExplorerTrackRefsRequest,
    LibraryTagExplorerTracksRequest, LibraryTagFilter, LibraryTagKind, LibraryTagMatchMode,
};
use crate::repos::{TrackRepository, TrackRow};

fn track(
    id: &str,
    title: &str,
    album_id: &str,
    genres: &[&str],
    moods: &[&str],
) -> TrackRow {
    TrackRow {
        server_id: "s1".into(),
        id: id.into(),
        title: title.into(),
        title_sort: None,
        artist: Some("Artist".into()),
        artist_id: Some("ar1".into()),
        album: format!("Album {album_id}"),
        album_id: Some(album_id.into()),
        album_artist: Some("Artist".into()),
        duration_sec: 200,
        track_number: Some(1),
        disc_number: Some(1),
        year: Some(2000),
        genre: genres.first().map(|genre| (*genre).to_string()),
        suffix: Some("flac".into()),
        bit_rate: None,
        size_bytes: None,
        cover_art_id: None,
        starred_at: None,
        user_rating: None,
        play_count: None,
        played_at: None,
        server_path: None,
        library_id: Some("lib1".into()),
        isrc: None,
        mbid_recording: None,
        bpm: None,
        replay_gain_track_db: None,
        replay_gain_album_db: None,
        replay_gain_peak: None,
        content_hash: None,
        server_updated_at: None,
        server_created_at: None,
        deleted: false,
        synced_at: 1,
        raw_json: serde_json::json!({
            "genres": genres,
            "moods": moods,
        })
        .to_string(),
    }
}

fn tags() -> Vec<LibraryTagFilter> {
    vec![
        LibraryTagFilter {
            kind: LibraryTagKind::Genre,
            value: "Rock".into(),
        },
        LibraryTagFilter {
            kind: LibraryTagKind::Mood,
            value: "Dreamy".into(),
        },
    ]
}

fn track_request(mode: LibraryTagMatchMode) -> LibraryTagExplorerTracksRequest {
    LibraryTagExplorerTracksRequest {
        server_id: "s1".into(),
        library_scope: None,
        library_scopes: None,
        tags: tags(),
        mode,
        limit: 50,
        offset: 0,
        include_total: true,
        count_only: false,
    }
}

fn album_request(mode: LibraryTagMatchMode) -> LibraryTagExplorerAlbumsRequest {
    LibraryTagExplorerAlbumsRequest {
        server_id: "s1".into(),
        library_scope: None,
        library_scopes: None,
        tags: tags(),
        mode,
        limit: 50,
        offset: 0,
        include_total: true,
        count_only: false,
    }
}

#[test]
fn track_or_matches_any_selected_genre_or_mood() {
    let store = LibraryStore::open_in_memory();
    TrackRepository::new(&store)
        .upsert_batch(&[
            track("t1", "Alpha", "a", &["Rock"], &[]),
            track("t2", "Bravo", "b", &[], &["Dreamy"]),
            track("t3", "Charlie", "c", &["Jazz"], &["Nocturnal"]),
        ])
        .unwrap();

    let response = list_tracks(&store, &track_request(LibraryTagMatchMode::Or)).unwrap();

    assert_eq!(response.total, Some(2));
    assert_eq!(
        response
            .tracks
            .iter()
            .map(|track| track.id.as_str())
            .collect::<Vec<_>>(),
        vec!["t1", "t2"]
    );
}

#[test]
fn track_and_requires_every_selected_tag_on_the_same_track() {
    let store = LibraryStore::open_in_memory();
    TrackRepository::new(&store)
        .upsert_batch(&[
            track("t1", "Alpha", "a", &["Rock"], &["Dreamy"]),
            track("t2", "Bravo", "a", &["Rock"], &[]),
            track("t3", "Charlie", "a", &[], &["Dreamy"]),
        ])
        .unwrap();

    let response = list_tracks(&store, &track_request(LibraryTagMatchMode::And)).unwrap();

    assert_eq!(response.total, Some(1));
    assert_eq!(response.tracks.len(), 1);
    assert_eq!(response.tracks[0].id, "t1");
}

#[test]
fn album_and_allows_selected_tags_to_be_satisfied_by_different_tracks() {
    let store = LibraryStore::open_in_memory();
    TrackRepository::new(&store)
        .upsert_batch(&[
            track("a1", "Alpha", "album-a", &["Rock"], &[]),
            track("a2", "Bravo", "album-a", &[], &["Dreamy"]),
            track("b1", "Charlie", "album-b", &["Rock"], &[]),
        ])
        .unwrap();

    let response = list_albums(&store, &album_request(LibraryTagMatchMode::And)).unwrap();

    assert_eq!(response.total, Some(1));
    assert_eq!(response.albums.len(), 1);
    assert_eq!(response.albums[0].id, "album-a");
    assert_eq!(response.albums[0].song_count, Some(2));
}

#[test]
fn album_or_matches_any_selected_tag() {
    let store = LibraryStore::open_in_memory();
    TrackRepository::new(&store)
        .upsert_batch(&[
            track("a1", "Alpha", "album-a", &["Rock"], &[]),
            track("b1", "Bravo", "album-b", &[], &["Dreamy"]),
            track("c1", "Charlie", "album-c", &["Jazz"], &[]),
        ])
        .unwrap();

    let response = list_albums(&store, &album_request(LibraryTagMatchMode::Or)).unwrap();

    assert_eq!(response.total, Some(2));
    assert_eq!(
        response
            .albums
            .iter()
            .map(|album| album.id.as_str())
            .collect::<Vec<_>>(),
        vec!["album-a", "album-b"]
    );
}

#[test]
fn duplicate_case_equivalent_filters_are_normalized_before_minimum_check() {
    let store = LibraryStore::open_in_memory();
    let mut req = track_request(LibraryTagMatchMode::Or);
    req.tags = vec![
        LibraryTagFilter {
            kind: LibraryTagKind::Genre,
            value: " Rock ".into(),
        },
        LibraryTagFilter {
            kind: LibraryTagKind::Genre,
            value: "rock".into(),
        },
    ];

    let err = list_tracks(&store, &req).unwrap_err();

    assert!(err.contains("at least two distinct"));
}

#[test]
fn lightweight_track_refs_page_without_full_track_payloads() {
    let store = LibraryStore::open_in_memory();
    TrackRepository::new(&store)
        .upsert_batch(&[
            track("t1", "Alpha", "a", &["Rock"], &["Dreamy"]),
            track("t2", "Bravo", "a", &["Rock"], &["Dreamy"]),
            track("t3", "Charlie", "a", &["Rock"], &["Dreamy"]),
        ])
        .unwrap();

    let response = list_track_refs(
        &store,
        &LibraryTagExplorerTrackRefsRequest {
            server_id: "s1".into(),
            library_scope: None,
            library_scopes: None,
            tags: tags(),
            mode: LibraryTagMatchMode::And,
            limit: 2,
            offset: 0,
        },
    )
    .unwrap();

    assert_eq!(response.tracks.len(), 2);
    assert!(response.has_more);
    assert_eq!(response.tracks[0].track_id, "t1");
}

#[test]
fn mixed_track_predicate_uses_both_normalized_projection_indexes() {
    let store = LibraryStore::open_in_memory();
    let normalized = normalize_tags(&tags()).unwrap();
    let (where_sql, params) = track_filter_sql(&normalized, LibraryTagMatchMode::And);
    let sql = format!(
        "EXPLAIN QUERY PLAN SELECT t.id FROM track t WHERE t.server_id = ? AND t.deleted = 0 AND {where_sql}"
    );

    let details = store
        .with_read_conn(|conn| {
            let mut binds = vec![SqlValue::Text("s1".into())];
            binds.extend(params);
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(rusqlite::params_from_iter(binds.iter()), |row| {
                row.get::<_, String>(3)
            })?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
        })
        .unwrap();

    assert!(
        details.iter().any(|detail| detail.contains("track_genre") && detail.contains("INDEX")),
        "genre projection was not indexed: {details:?}"
    );
    assert!(
        details.iter().any(|detail| detail.contains("track_mood") && detail.contains("INDEX")),
        "mood projection was not indexed: {details:?}"
    );
}

#[test]
fn collective_album_predicate_uses_browse_indexes() {
    let store = LibraryStore::open_in_memory();
    let normalized = normalize_tags(&tags()).unwrap();
    let (where_sql, params) = album_filter_sql(&normalized, LibraryTagMatchMode::And);
    let sql = format!(
        "EXPLAIN QUERY PLAN SELECT t.id FROM track t WHERE t.server_id = ? AND t.deleted = 0 AND t.album_id IS NOT NULL AND {where_sql}"
    );

    let details = store
        .with_read_conn(|conn| {
            let mut binds = vec![SqlValue::Text("s1".into())];
            binds.extend(params);
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(rusqlite::params_from_iter(binds.iter()), |row| {
                row.get::<_, String>(3)
            })?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
        })
        .unwrap();

    assert!(
        details.iter().any(|detail| detail.contains("idx_track_genre_browse")),
        "album genre lookup was not driven by the genre browse index: {details:?}"
    );
    assert!(
        details.iter().any(|detail| detail.contains("idx_track_mood_browse")),
        "album mood lookup was not driven by the mood browse index: {details:?}"
    );
}
