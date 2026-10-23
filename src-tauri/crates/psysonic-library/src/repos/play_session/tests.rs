mod insert_completion;
mod recent_plays;
mod summaries;
mod track_links;
mod year_recap;

use super::*;
use crate::dto::PlaySessionInputDto;
use crate::repos::{TrackRepository, TrackRow};

fn seed_track(store: &LibraryStore, server_id: &str, track_id: &str, duration_sec: i64) {
    TrackRepository::new(store)
        .upsert_batch(&[TrackRow {
            server_id: server_id.into(),
            id: track_id.into(),
            title: "Test".into(),
            title_sort: None,
            artist: Some("Artist".into()),
            artist_id: None,
            album: "Album".into(),
            album_id: None,
            album_artist: None,
            duration_sec,
            track_number: None,
            disc_number: None,
            year: None,
            genre: None,
            suffix: None,
            bit_rate: None,
            size_bytes: None,
            cover_art_id: None,
            starred_at: None,
            user_rating: None,
            play_count: None,
            played_at: None,
            server_path: None,
            library_id: None,
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
            raw_json: "{}".into(),
        }])
        .expect("seed track");
}

fn row_with_id_hash(server: &str, id: &str, hash: &str, path: &str) -> TrackRow {
    TrackRow {
        server_id: server.into(),
        id: id.into(),
        title: "Title".into(),
        title_sort: None,
        artist: None,
        artist_id: None,
        album: "Album".into(),
        album_id: None,
        album_artist: None,
        duration_sec: 200,
        track_number: None,
        disc_number: None,
        year: None,
        genre: None,
        suffix: None,
        bit_rate: None,
        size_bytes: None,
        cover_art_id: None,
        starred_at: None,
        user_rating: None,
        play_count: None,
        played_at: None,
        server_path: if path.is_empty() {
            None
        } else {
            Some(path.into())
        },
        library_id: None,
        isrc: None,
        mbid_recording: None,
        bpm: None,
        replay_gain_track_db: None,
        replay_gain_album_db: None,
        replay_gain_peak: None,
        content_hash: if hash.is_empty() {
            None
        } else {
            Some(hash.into())
        },
        server_updated_at: None,
        server_created_at: None,
        deleted: false,
        synced_at: 1,
        raw_json: "{}".into(),
    }
}

// Listening-history queries group timestamps using SQLite's localtime modifier.
// Create test instants at local noon so calendar assertions are stable in any
// timezone, including locations west of UTC at the Unix epoch boundary.
fn local_noon_ms(store: &LibraryStore, date_iso: &str) -> i64 {
    store
        .with_read_conn(|conn| {
            conn.query_row(
                "SELECT CAST(strftime('%s', ?1 || ' 12:00:00', 'utc') AS INTEGER) * 1000",
                [date_iso],
                |row| row.get(0),
            )
        })
        .expect("convert local noon to epoch milliseconds")
}

fn sample_input(server_id: &str, track_id: &str) -> PlaySessionInputDto {
    PlaySessionInputDto {
        server_id: server_id.into(),
        track_id: track_id.into(),
        started_at_ms: 1_000,
        listened_sec: 20.0,
        position_max_sec: 15.0,
        end_reason: "ended".into(),
        duration_sec_hint: None,
    }
}

fn purge_play_sessions_for_server(store: &LibraryStore, server_id: &str) {
    store
        .with_conn_mut("test.purge_play_session", |conn| {
            conn.execute(
                "DELETE FROM play_session WHERE server_id = ?1",
                rusqlite::params![server_id],
            )?;
            Ok(())
        })
        .expect("purge play_session");
}
