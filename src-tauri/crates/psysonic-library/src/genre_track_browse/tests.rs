use super::*;
use crate::dto::{LibraryGenreTracksRequest, LibraryScopePair};
use crate::repos::{TrackRepository, TrackRow};

fn track(id: &str, title: &str, library_id: &str, genres: &[&str]) -> TrackRow {
    TrackRow {
        server_id: "s1".into(),
        id: id.into(),
        title: title.into(),
        title_sort: None,
        artist: Some("Artist".into()),
        artist_id: Some("ar1".into()),
        album: "Album".into(),
        album_id: Some("al1".into()),
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
        library_id: Some(library_id.into()),
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
        raw_json: serde_json::json!({ "genres": genres }).to_string(),
    }
}

fn request(genre: &str) -> LibraryGenreTracksRequest {
    LibraryGenreTracksRequest {
        server_id: "s1".into(),
        genre: genre.into(),
        library_scope: None,
        library_scopes: None,
        limit: 50,
        offset: 0,
        include_total: true,
        count_only: false,
    }
}

#[test]
fn list_tracks_by_genre_is_case_insensitive_and_returns_only_matching_tracks() {
    let store = LibraryStore::open_in_memory();
    TrackRepository::new(&store)
        .upsert_batch(&[
            track("t1", "Alpha", "lib1", &["Rock", "Progressive Rock"]),
            track("t2", "Bravo", "lib1", &["Rock"]),
            track("t3", "Charlie", "lib1", &["Jazz"]),
            track("t4", "Delta", "lib1", &["Rockabilly"]),
        ])
        .unwrap();

    let response = list_tracks_by_genre(&store, &request("  rock  ")).unwrap();

    assert_eq!(response.total, Some(2));
    assert_eq!(
        response
            .tracks
            .iter()
            .map(|track| track.id.as_str())
            .collect::<Vec<_>>(),
        vec!["t1", "t2"]
    );
    assert!(!response.has_more);
}

#[test]
fn list_tracks_by_genre_respects_library_scope() {
    let store = LibraryStore::open_in_memory();
    TrackRepository::new(&store)
        .upsert_batch(&[
            track("t1", "Alpha", "lib1", &["Rock"]),
            track("t2", "Bravo", "lib1", &["Rock"]),
            track("t3", "Charlie", "lib2", &["Rock"]),
        ])
        .unwrap();

    let mut req = request("Rock");
    req.library_scopes = Some(vec![LibraryScopePair {
        server_id: "s1".into(),
        library_id: Some("lib1".into()),
    }]);

    let response = list_tracks_by_genre(&store, &req).unwrap();

    assert_eq!(response.total, Some(2));
    assert_eq!(response.tracks.len(), 2);
    assert!(response
        .tracks
        .iter()
        .all(|track| track.library_id.as_deref() == Some("lib1")));
}

#[test]
fn list_tracks_by_genre_merges_selected_servers() {
    let store = LibraryStore::open_in_memory();
    let first = track("t1", "Alpha", "lib1", &["Rock"]);
    let mut second = track("t2", "Bravo", "lib2", &["Rock"]);
    second.server_id = "s2".into();

    TrackRepository::new(&store)
        .upsert_batch(&[first, second])
        .unwrap();

    let mut req = request("Rock");
    req.library_scopes = Some(vec![
        LibraryScopePair {
            server_id: "s1".into(),
            library_id: None,
        },
        LibraryScopePair {
            server_id: "s2".into(),
            library_id: None,
        },
    ]);

    let response = list_tracks_by_genre(&store, &req).unwrap();

    assert_eq!(response.total, Some(2));
    assert_eq!(response.tracks.len(), 2);
    assert_eq!(
        response
            .tracks
            .iter()
            .map(|track| track.server_id.as_str())
            .collect::<std::collections::BTreeSet<_>>(),
        std::collections::BTreeSet::from(["s1", "s2"])
    );
}

#[test]
fn count_only_returns_total_without_track_rows() {
    let store = LibraryStore::open_in_memory();
    TrackRepository::new(&store)
        .upsert_batch(&[
            track("t1", "Alpha", "lib1", &["Rock"]),
            track("t2", "Bravo", "lib1", &["Rock"]),
        ])
        .unwrap();

    let mut req = request("Rock");
    req.count_only = true;

    let response = list_tracks_by_genre(&store, &req).unwrap();

    assert_eq!(response.total, Some(2));
    assert!(response.tracks.is_empty());
    assert!(!response.has_more);
}

#[test]
fn list_tracks_by_genre_paginates_without_repeating_rows() {
    let store = LibraryStore::open_in_memory();
    TrackRepository::new(&store)
        .upsert_batch(&[
            track("t1", "Alpha", "lib1", &["Rock"]),
            track("t2", "Bravo", "lib1", &["Rock"]),
            track("t3", "Charlie", "lib1", &["Rock"]),
        ])
        .unwrap();

    let mut first_req = request("Rock");
    first_req.limit = 1;
    let first = list_tracks_by_genre(&store, &first_req).unwrap();

    assert_eq!(first.tracks[0].id, "t1");
    assert!(first.has_more);

    let mut second_req = first_req;
    second_req.offset = 1;
    let second = list_tracks_by_genre(&store, &second_req).unwrap();

    assert_eq!(second.tracks[0].id, "t2");
    assert!(second.has_more);
}

#[test]
fn stale_genre_rows_cannot_surface_deleted_tracks() {
    let store = LibraryStore::open_in_memory();
    TrackRepository::new(&store)
        .upsert_batch(&[track("t1", "Alpha", "lib1", &["Rock"])])
        .unwrap();

    store
        .with_conn("test.genre_track_soft_delete", |conn| {
            conn.execute(
                "UPDATE track SET deleted = 1 WHERE server_id = 's1' AND id = 't1'",
                [],
            )?;
            Ok(())
        })
        .unwrap();

    let response = list_tracks_by_genre(&store, &request("Rock")).unwrap();

    assert_eq!(response.total, Some(0));
    assert!(response.tracks.is_empty());
}

#[test]
fn genre_track_filter_uses_the_track_genre_primary_key() {
    let store = LibraryStore::open_in_memory();
    let sql = format!(
        "EXPLAIN QUERY PLAN \
         SELECT t.id FROM track t \
         WHERE t.server_id = ? AND t.deleted = 0 AND {}",
        genre_track_filter_sql()
    );

    let details = store
        .with_read_conn(|conn| {
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(rusqlite::params!["s1", "Rock"], |row| {
                row.get::<_, String>(3)
            })?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
        })
        .unwrap();

    assert!(
        details
            .iter()
            .any(|detail| detail.contains("track_genre") && detail.contains("INDEX")),
        "query plan did not use an index for the genre projection: {details:?}"
    );
}
