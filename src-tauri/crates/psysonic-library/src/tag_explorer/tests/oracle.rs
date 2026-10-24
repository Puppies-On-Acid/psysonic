//! Slice 0A behavioral oracle for Explorer before SQL optimization.
//!
//! These fixtures intentionally record the current results. Known quirks,
//! including compilation splits and Unicode case handling, are labeled
//! explicitly: any subsequent semantic correction needs owner approval.

use super::*;
use crate::dto::LibraryScopePair;

fn scoped(server: &str, library: &str) -> LibraryScopePair {
    LibraryScopePair {
        server_id: server.into(),
        library_id: Some(library.into()),
    }
}

fn sample(
    server: &str,
    library: Option<&str>,
    id: &str,
    title: &str,
    album_id: &str,
    genres: &[&str],
    moods: &[&str],
) -> TrackRow {
    let mut row = track(id, title, album_id, genres, moods);
    row.server_id = server.into();
    row.library_id = library.map(str::to_string);
    row
}

fn seed(rows: &[TrackRow]) -> LibraryStore {
    let store = LibraryStore::open_in_memory();
    TrackRepository::new(&store).upsert_batch(rows).unwrap();
    store
}

fn ten_tags() -> Vec<LibraryTagFilter> {
    [
        (LibraryTagKind::Genre, "Rock"),
        (LibraryTagKind::Mood, "Dreamy"),
        (LibraryTagKind::Genre, "Electronic"),
        (LibraryTagKind::Mood, "Bright"),
        (LibraryTagKind::Genre, "Ambient"),
        (LibraryTagKind::Mood, "Warm"),
        (LibraryTagKind::Genre, "Jazz"),
        (LibraryTagKind::Mood, "Calm"),
        (LibraryTagKind::Genre, "Folk"),
        (LibraryTagKind::Mood, "Lively"),
    ]
    .into_iter()
    .map(|(kind, value)| LibraryTagFilter {
        kind,
        value: value.into(),
    })
    .collect()
}

fn seeded_matrix() -> (LibraryStore, Vec<LibraryScopePair>) {
    let all_genres = ["Rock", "Electronic", "Ambient", "Jazz", "Folk"];
    let all_moods = ["Dreamy", "Bright", "Warm", "Calm", "Lively"];
    let rows = (0..24)
        .map(|i| {
            let server = if i < 12 { "s1" } else { "s2" };
            let library = if i % 2 == 0 { "lib-a" } else { "lib-b" };
            let id = format!("matrix-{i:03}");
            let title = format!("Track {i:03}");
            let album_id = format!("matrix-album-{i:03}");
            let (genres, moods): (&[&str], &[&str]) = if i < 8 {
                (&all_genres, &all_moods)
            } else if i < 17 {
                (&all_genres[..2], &all_moods[..1])
            } else {
                (&all_genres[..1], &[])
            };
            sample(server, Some(library), &id, &title, &album_id, genres, moods)
        })
        .collect::<Vec<_>>();
    (
        seed(&rows),
        vec![
            scoped("s1", "lib-a"),
            scoped("s1", "lib-b"),
            scoped("s2", "lib-a"),
            scoped("s2", "lib-b"),
        ],
    )
}

fn track_refs(
    store: &LibraryStore,
    req: &LibraryTagExplorerTracksRequest,
) -> Vec<(String, String)> {
    let mut offset = 0u32;
    let mut all = Vec::new();
    loop {
        let response = list_track_refs(
            store,
            &LibraryTagExplorerTrackRefsRequest {
                server_id: req.server_id.clone(),
                library_scope: req.library_scope.clone(),
                library_scopes: req.library_scopes.clone(),
                tags: req.tags.clone(),
                mode: req.mode,
                limit: 3,
                offset,
            },
        )
        .unwrap();
        let count = response.tracks.len();
        all.extend(
            response
                .tracks
                .into_iter()
                .map(|r| (r.server_id, r.track_id)),
        );
        if !response.has_more {
            break;
        }
        assert!(count > 0, "refs pagination made no forward progress");
        offset += count as u32;
    }
    all
}

#[test]
fn baseline_matrix_preserves_exact_counts_order_and_paginated_refs() {
    let (store, scopes) = seeded_matrix();

    for mode in [LibraryTagMatchMode::Or, LibraryTagMatchMode::And] {
        for tag_count in [2usize, 5, 10] {
            let selected_tags = ten_tags()[..tag_count].to_vec();

            let mut tracks_req = track_request(mode);
            tracks_req.tags = selected_tags.clone();
            tracks_req.library_scopes = Some(scopes.clone());
            tracks_req.limit = 200;
            let full_tracks = list_tracks(&store, &tracks_req).unwrap();
            let expected_tracks = full_tracks
                .tracks
                .iter()
                .map(|r| (r.server_id.clone(), r.id.clone()))
                .collect::<Vec<_>>();
            assert_eq!(full_tracks.total, Some(expected_tracks.len() as u32));
            assert!(expected_tracks.len() >= 8, "{mode:?} {tag_count} tags");

            let mut count_req = tracks_req.clone();
            count_req.count_only = true;
            let count = list_tracks(&store, &count_req).unwrap();
            assert!(count.tracks.is_empty());
            assert_eq!(count.total, full_tracks.total);

            let mut observed = Vec::new();
            let mut offset = 0u32;
            loop {
                let mut page_req = tracks_req.clone();
                page_req.limit = 3;
                page_req.offset = offset;
                page_req.include_total = offset == 0;
                let page = list_tracks(&store, &page_req).unwrap();
                let batch = page.tracks.len();
                if offset == 0 {
                    assert_eq!(page.total, full_tracks.total);
                } else {
                    assert!(page.total.is_none());
                }
                observed.extend(
                    page.tracks.into_iter().map(|r| (r.server_id, r.id)),
                );
                assert_eq!(page.has_more, observed.len() < expected_tracks.len());
                if !page.has_more {
                    break;
                }
                assert!(batch > 0, "tracks pagination made no forward progress");
                offset += batch as u32;
            }
            assert_eq!(observed, expected_tracks, "{mode:?} {tag_count} tracks");
            assert_eq!(
                track_refs(&store, &tracks_req),
                expected_tracks,
                "{mode:?} {tag_count} refs"
            );

            let mut albums_req = album_request(mode);
            albums_req.tags = selected_tags;
            albums_req.library_scopes = Some(scopes.clone());
            albums_req.limit = 100;
            let full_albums = list_albums(&store, &albums_req).unwrap();
            let expected_albums = full_albums
                .albums
                .iter()
                .map(|r| {
                    (r.server_id.clone(), r.id.clone(), r.song_count, r.duration_sec)
                })
                .collect::<Vec<_>>();
            assert_eq!(full_albums.total, Some(expected_albums.len() as u32));
            assert!(expected_albums.len() >= 8, "{mode:?} {tag_count} albums");

            let mut count_req = albums_req.clone();
            count_req.count_only = true;
            let count = list_albums(&store, &count_req).unwrap();
            assert!(count.albums.is_empty());
            assert_eq!(count.total, full_albums.total);

            let mut observed = Vec::new();
            let mut offset = 0u32;
            loop {
                let mut page_req = albums_req.clone();
                page_req.limit = 3;
                page_req.offset = offset;
                page_req.include_total = offset == 0;
                let page = list_albums(&store, &page_req).unwrap();
                let batch = page.albums.len();
                if offset == 0 {
                    assert_eq!(page.total, full_albums.total);
                } else {
                    assert!(page.total.is_none());
                }
                observed.extend(page.albums.into_iter().map(|r| {
                    (r.server_id, r.id, r.song_count, r.duration_sec)
                }));
                assert_eq!(page.has_more, observed.len() < expected_albums.len());
                if !page.has_more {
                    break;
                }
                assert!(batch > 0, "albums pagination made no forward progress");
                offset += batch as u32;
            }
            assert_eq!(observed, expected_albums, "{mode:?} {tag_count} albums");
        }
    }
}

#[test]
fn baseline_album_and_must_not_combine_tags_from_different_library_copies() {
    let store = seed(&[
        sample("s1", Some("lib-a"), "a1", "One", "shared", &["Rock"], &[]),
        sample("s1", Some("lib-b"), "b1", "Two", "shared", &[], &["Dreamy"]),
    ]);
    let mut req = album_request(LibraryTagMatchMode::And);
    req.library_scopes = Some(vec![scoped("s1", "lib-a"), scoped("s1", "lib-b")]);
    let result = list_albums(&store, &req).unwrap();
    assert_eq!(result.total, Some(0));
    assert!(result.albums.is_empty());
}

#[test]
fn baseline_filter_before_dedup_retains_lower_priority_only_matching_copy() {
    let store = seed(&[
        sample("s1", Some("lib-a"), "hi", "Shared Track", "same", &[], &[]),
        sample(
            "s2",
            Some("lib-b"),
            "lo",
            "Shared Track",
            "same",
            &["Rock"],
            &["Dreamy"],
        ),
    ]);
    let scopes = vec![scoped("s1", "lib-a"), scoped("s2", "lib-b")];
    let mut req = track_request(LibraryTagMatchMode::And);
    req.library_scopes = Some(scopes.clone());
    let tracks = list_tracks(&store, &req).unwrap();
    assert_eq!(tracks.total, Some(1));
    assert_eq!(
        tracks
            .tracks
            .iter()
            .map(|r| (r.server_id.as_str(), r.id.as_str()))
            .collect::<Vec<_>>(),
        vec![("s2", "lo")]
    );
    let mut album_req = album_request(LibraryTagMatchMode::And);
    album_req.library_scopes = Some(scopes);
    let albums = list_albums(&store, &album_req).unwrap();
    assert_eq!(albums.total, Some(1));
    assert_eq!(albums.albums[0].server_id, "s2");
}

#[test]
fn baseline_same_tagged_copies_dedup_with_priority() {
    let store = seed(&[
        sample("s1", Some("lib-a"), "copy1", "Same Track", "dup", &["Rock"], &["Dreamy"]),
        sample("s2", Some("lib-b"), "copy2", "Same Track", "dup", &["Rock"], &["Dreamy"]),
    ]);
    let scopes = vec![scoped("s1", "lib-a"), scoped("s2", "lib-b")];
    let mut req = track_request(LibraryTagMatchMode::And);
    req.library_scopes = Some(scopes.clone());
    let tracks = list_tracks(&store, &req).unwrap();
    assert_eq!(tracks.total, Some(1));
    assert_eq!(tracks.tracks[0].server_id, "s1");
    let mut req = album_request(LibraryTagMatchMode::And);
    req.library_scopes = Some(scopes);
    let albums = list_albums(&store, &req).unwrap();
    assert_eq!(albums.total, Some(1));
    assert_eq!(albums.albums[0].server_id, "s1");
}

#[test]
fn baseline_compilation_without_album_artist_keeps_one_physical_album() {
    let mut first = sample(
        "s1", Some("lib-a"), "a", "First", "comp", &["Rock"], &[],
    );
    let mut second = sample(
        "s1", Some("lib-a"), "b", "Second", "comp", &[], &["Dreamy"],
    );
    first.album_artist = None;
    first.artist = Some("Singer A".into());
    first.artist_id = Some("singer-a".into());
    second.album_artist = None;
    second.artist = Some("Singer B".into());
    second.artist_id = Some("singer-b".into());
    let store = seed(&[first, second]);
    let result = list_albums(&store, &album_request(LibraryTagMatchMode::And)).unwrap();
    // BASELINE (F2 reassessed): distinct track artists without an album artist
    // still receive a common physical album key. Do not introduce splits.
    assert_eq!(result.total, Some(1));
    assert_eq!(result.albums.len(), 1);
    assert_eq!(result.albums[0].id, "comp");
    assert_eq!(result.albums[0].song_count, Some(2));
}

#[test]
fn baseline_albumless_and_null_library_tracks_are_not_silently_discarded() {
    let mut albumless = sample(
        "s1", Some("lib-a"), "orphan", "Orphan", "ignored", &["Rock"], &["Dreamy"],
    );
    albumless.album_id = None;
    albumless.album = "Unsorted".into();
    let first = sample(
        "s1", None, "null-a", "First", "null-album", &["Rock"], &[],
    );
    let second = sample(
        "s1", None, "null-b", "Second", "null-album", &[], &["Dreamy"],
    );
    let store = seed(&[albumless, first, second]);
    let tracks = list_tracks(&store, &track_request(LibraryTagMatchMode::And)).unwrap();
    assert_eq!(tracks.total, Some(1));
    assert_eq!(tracks.tracks[0].id, "orphan");

    let albums = list_albums(&store, &album_request(LibraryTagMatchMode::And)).unwrap();
    assert_eq!(albums.total, Some(1));
    assert_eq!(albums.albums[0].id, "null-album");
    assert_eq!(albums.albums[0].song_count, Some(2));
}

#[test]
fn baseline_exact_library_excludes_other_libraries_and_deleted_tracks() {
    let mut deleted = sample(
        "s1", Some("lib-a"), "deleted", "Deleted", "deleted-album",
        &["Rock"], &["Dreamy"],
    );
    deleted.deleted = true;
    let store = seed(&[
        sample(
            "s1", Some("lib-a"), "visible", "Visible", "visible-album",
            &["Rock"], &["Dreamy"],
        ),
        sample(
            "s1", Some("lib-b"), "elsewhere", "Elsewhere", "other-album",
            &["Rock"], &["Dreamy"],
        ),
        deleted,
    ]);
    let mut req = track_request(LibraryTagMatchMode::And);
    req.library_scopes = Some(vec![scoped("s1", "lib-a")]);
    let result = list_tracks(&store, &req).unwrap();
    assert_eq!(result.total, Some(1));
    assert_eq!(result.tracks[0].id, "visible");

    let mut albums_req = album_request(LibraryTagMatchMode::And);
    albums_req.library_scopes = Some(vec![scoped("s1", "lib-a")]);
    let result = list_albums(&store, &albums_req).unwrap();
    assert_eq!(result.total, Some(1));
    assert_eq!(result.albums[0].id, "visible-album");
}

#[test]
fn baseline_unicode_case_normalization_and_sql_collation_are_not_equivalent() {
    let store = seed(&[
        sample("s1", Some("lib-a"), "upper", "Upper", "a", &["Ärt"], &["Dreamy"]),
        sample("s1", Some("lib-a"), "lower", "Lower", "b", &["ärt"], &["Dreamy"]),
    ]);
    let mut req = track_request(LibraryTagMatchMode::And);
    req.tags[0].value = "Ärt".into();
    let upper = list_tracks(&store, &req).unwrap();
    assert_eq!(upper.total, Some(1));
    assert_eq!(upper.tracks[0].id, "upper");

    req.tags[0].value = "ärt".into();
    let lower = list_tracks(&store, &req).unwrap();
    assert_eq!(lower.total, Some(1));
    assert_eq!(lower.tracks[0].id, "lower");

    req.tags = vec![
        LibraryTagFilter { kind: LibraryTagKind::Genre, value: "Ärt".into() },
        LibraryTagFilter { kind: LibraryTagKind::Genre, value: "ärt".into() },
    ];
    // KNOWN BASELINE QUIRK (F10): Unicode folding merges the two tags even
    // though SQLite NOCASE does not make them equivalent.
    assert!(list_tracks(&store, &req)
        .unwrap_err()
        .contains("at least two distinct"));
}

#[test]
fn baseline_rejects_more_than_256_tags_before_querying() {
    let store = LibraryStore::open_in_memory();
    let mut req = track_request(LibraryTagMatchMode::Or);
    req.tags = (0..257)
        .map(|i| LibraryTagFilter {
            kind: LibraryTagKind::Genre,
            value: format!("Genre {i}"),
        })
        .collect();
    assert!(list_tracks(&store, &req)
        .unwrap_err()
        .contains("at most 256"));
}
