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
    let rows = (0..27)
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
            } else if i < 24 {
                (&all_genres[..1], &[])
            } else if i == 24 {
                (&all_genres[2..3], &[]) // Ambient: selected by 5/10-tag OR, not 2-tag OR
            } else if i == 25 {
                (&[], &all_moods[4..5]) // Lively: selected by 10-tag OR alone
            } else {
                (&[], &[]) // Negative row: never selected by these filters
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
            // Independent golden oracle: 0..8 have every tag, 8..17 have
            // Rock/Dreamy/Electronic, 17..24 only Rock, 24 only Ambient,
            // 25 only Lively, and 26 none. Distinguish OR 2/5/10 explicitly.
            let expected_indices: Vec<usize> = match (mode, tag_count) {
                (LibraryTagMatchMode::Or, 2) => (0..24).collect(),
                (LibraryTagMatchMode::Or, 5) => (0..25).collect(),
                (LibraryTagMatchMode::Or, 10) => (0..26).collect(),
                (LibraryTagMatchMode::And, 2) => (0..17).collect(),
                (LibraryTagMatchMode::And, 5 | 10) => (0..8).collect(),
                _ => unreachable!("unexpected golden matrix case"),
            };
            let expected_tracks = expected_indices
                .iter()
                .map(|&i| {
                    (
                        (if i < 12 { "s1" } else { "s2" }).to_string(),
                        format!("matrix-{i:03}"),
                    )
                })
                .collect::<Vec<_>>();
            let actual_tracks = full_tracks
                .tracks
                .iter()
                .map(|r| (r.server_id.clone(), r.id.clone()))
                .collect::<Vec<_>>();
            assert_eq!(
                actual_tracks, expected_tracks,
                "{mode:?} {tag_count} golden tracks"
            );
            assert_eq!(full_tracks.total, Some(expected_tracks.len() as u32));
            for (&i, row) in expected_indices.iter().zip(&full_tracks.tracks) {
                assert_eq!(row.title, format!("Track {i:03}"));
                assert_eq!(
                    row.album_id.as_deref(),
                    Some(format!("matrix-album-{i:03}").as_str())
                );
                assert_eq!(
                    row.library_id.as_deref(),
                    Some(if i % 2 == 0 { "lib-a" } else { "lib-b" })
                );
                assert_eq!(row.artist.as_deref(), Some("Artist"));
                assert_eq!(row.duration_sec, 200);
                assert_eq!(row.year, Some(2000));
            }

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
                observed.extend(page.tracks.into_iter().map(|r| (r.server_id, r.id)));
                assert_eq!(page.has_more, observed.len() < expected_tracks.len());
                if !page.has_more {
                    break;
                }
                assert!(batch > 0, "tracks pagination made no forward progress");
                offset += batch as u32;
            }
            assert_eq!(observed, expected_tracks, "{mode:?} {tag_count} tracks");
            let mut empty_req = tracks_req.clone();
            empty_req.offset = 50;
            empty_req.limit = 3;
            empty_req.include_total = false;
            let empty_page = list_tracks(&store, &empty_req).unwrap();
            assert!(empty_page.tracks.is_empty());
            assert!(!empty_page.has_more);
            assert_eq!(empty_page.total, None);
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
            let expected_albums = expected_indices
                .iter()
                .map(|&i| {
                    (
                        (if i < 12 { "s1" } else { "s2" }).to_string(),
                        format!("matrix-album-{i:03}"),
                        Some(1),
                        Some(200),
                    )
                })
                .collect::<Vec<_>>();
            let actual_albums = full_albums
                .albums
                .iter()
                .map(|r| {
                    (
                        r.server_id.clone(),
                        r.id.clone(),
                        r.song_count,
                        r.duration_sec,
                    )
                })
                .collect::<Vec<_>>();
            assert_eq!(
                actual_albums, expected_albums,
                "{mode:?} {tag_count} golden albums"
            );
            assert_eq!(full_albums.total, Some(expected_albums.len() as u32));
            for (&i, row) in expected_indices.iter().zip(&full_albums.albums) {
                assert_eq!(row.name, format!("Album matrix-album-{i:03}"));
                assert_eq!(row.year, Some(2000));
            }

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
                observed.extend(
                    page.albums
                        .into_iter()
                        .map(|r| (r.server_id, r.id, r.song_count, r.duration_sec)),
                );
                assert_eq!(page.has_more, observed.len() < expected_albums.len());
                if !page.has_more {
                    break;
                }
                assert!(batch > 0, "albums pagination made no forward progress");
                offset += batch as u32;
            }
            assert_eq!(observed, expected_albums, "{mode:?} {tag_count} albums");
            let mut empty_req = albums_req.clone();
            empty_req.offset = 50;
            empty_req.limit = 3;
            empty_req.include_total = false;
            let empty_page = list_albums(&store, &empty_req).unwrap();
            assert!(empty_page.albums.is_empty());
            assert!(!empty_page.has_more);
            assert_eq!(empty_page.total, None);
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
        sample(
            "s1",
            Some("lib-a"),
            "copy1",
            "Same Track",
            "dup",
            &["Rock"],
            &["Dreamy"],
        ),
        sample(
            "s2",
            Some("lib-b"),
            "copy2",
            "Same Track",
            "dup",
            &["Rock"],
            &["Dreamy"],
        ),
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
fn baseline_reversing_scope_priority_changes_duplicate_owner_not_result_order() {
    // Deliberately distinguish representative metadata without changing
    // the identity fields (album artist and year may affect normalization).
    let mut first = sample(
        "s1",
        Some("lib-a"),
        "a-copy",
        "Alpha",
        "dup",
        &["Rock"],
        &["Dreamy"],
    );
    first.cover_art_id = Some("cover-first".into());
    first.bit_rate = Some(192);
    first.synced_at = 11;

    let mut second = sample(
        "s2",
        Some("lib-b"),
        "b-copy",
        "Alpha",
        "dup",
        &["Rock"],
        &["Dreamy"],
    );
    second.cover_art_id = Some("cover-second".into());
    second.bit_rate = Some(320);
    second.synced_at = 22;
    second.duration_sec = 203; // Same five-second dedup bucket as the first copy.

    let other = sample(
        "s3",
        Some("lib-c"),
        "other",
        "Zulu",
        "other",
        &["Rock"],
        &["Dreamy"],
    );
    let store = seed(&[first, second, other]);
    for (scopes, expected_owner, expected_id) in [
        (
            vec![
                scoped("s1", "lib-a"),
                scoped("s2", "lib-b"),
                scoped("s3", "lib-c"),
            ],
            "s1",
            "a-copy",
        ),
        (
            vec![
                scoped("s2", "lib-b"),
                scoped("s1", "lib-a"),
                scoped("s3", "lib-c"),
            ],
            "s2",
            "b-copy",
        ),
    ] {
        let mut track_req = track_request(LibraryTagMatchMode::And);
        track_req.library_scopes = Some(scopes.clone());
        let tracks = list_tracks(&store, &track_req).unwrap();
        assert_eq!(tracks.total, Some(2));
        assert_eq!(
            tracks
                .tracks
                .iter()
                .map(|t| (t.server_id.as_str(), t.id.as_str()))
                .collect::<Vec<_>>(),
            vec![(expected_owner, expected_id), ("s3", "other")]
        );
        let expected_cover = if expected_owner == "s1" {
            "cover-first"
        } else {
            "cover-second"
        };
        assert_eq!(
            tracks.tracks[0].cover_art_id.as_deref(),
            Some(expected_cover)
        );
        assert_eq!(
            tracks.tracks[0].bit_rate,
            Some(if expected_owner == "s1" { 192 } else { 320 })
        );
        assert_eq!(
            tracks.tracks[0].duration_sec,
            if expected_owner == "s1" { 200 } else { 203 }
        );
        assert_eq!(
            tracks.tracks[0].synced_at,
            if expected_owner == "s1" { 11 } else { 22 }
        );
        assert_eq!(tracks.tracks[0].album_artist.as_deref(), Some("Artist"));
        assert_eq!(tracks.tracks[0].year, Some(2000));
        assert_eq!(
            track_refs(&store, &track_req),
            vec![
                (expected_owner.to_string(), expected_id.to_string()),
                ("s3".into(), "other".into()),
            ]
        );

        let mut album_req = album_request(LibraryTagMatchMode::And);
        album_req.library_scopes = Some(scopes);
        let albums = list_albums(&store, &album_req).unwrap();
        assert_eq!(albums.total, Some(2));
        assert_eq!(
            albums
                .albums
                .iter()
                .map(|a| (a.server_id.as_str(), a.id.as_str(), a.song_count))
                .collect::<Vec<_>>(),
            vec![(expected_owner, "dup", Some(1)), ("s3", "other", Some(1))]
        );
        assert_eq!(
            albums.albums[0].cover_art_id.as_deref(),
            Some(expected_cover)
        );
        assert_eq!(albums.albums[0].year, Some(2000));
    }
}

#[test]
fn baseline_collective_album_and_across_libraries_and_servers_has_golden_metadata() {
    let store = seed(&[
        sample("s1", Some("lib-a"), "a", "Alpha", "album-a", &["Rock"], &[]),
        sample(
            "s1",
            Some("lib-a"),
            "b",
            "Bravo",
            "album-a",
            &[],
            &["Dreamy"],
        ),
        sample(
            "s1",
            Some("lib-b"),
            "c",
            "Charlie",
            "album-b",
            &["Rock"],
            &["Dreamy"],
        ),
        sample(
            "s2",
            Some("lib-c"),
            "d",
            "Delta",
            "album-c",
            &["Rock"],
            &["Dreamy"],
        ),
    ]);
    let scopes = vec![
        scoped("s1", "lib-a"),
        scoped("s1", "lib-b"),
        scoped("s2", "lib-c"),
    ];
    let mut album_req = album_request(LibraryTagMatchMode::And);
    album_req.library_scopes = Some(scopes.clone());
    let albums = list_albums(&store, &album_req).unwrap();
    assert_eq!(albums.total, Some(3));
    assert_eq!(
        albums
            .albums
            .iter()
            .map(|a| (
                a.server_id.as_str(),
                a.id.as_str(),
                a.song_count,
                a.duration_sec
            ))
            .collect::<Vec<_>>(),
        vec![
            ("s1", "album-a", Some(2), Some(400)),
            ("s1", "album-b", Some(1), Some(200)),
            ("s2", "album-c", Some(1), Some(200)),
        ]
    );

    let mut track_req = track_request(LibraryTagMatchMode::And);
    track_req.library_scopes = Some(scopes);
    let tracks = list_tracks(&store, &track_req).unwrap();
    assert_eq!(tracks.total, Some(2));
    assert_eq!(
        tracks
            .tracks
            .iter()
            .map(|t| (t.server_id.as_str(), t.id.as_str()))
            .collect::<Vec<_>>(),
        vec![("s1", "c"), ("s2", "d")]
    );
    assert_eq!(
        track_refs(&store, &track_req),
        vec![("s1".into(), "c".into()), ("s2".into(), "d".into())]
    );
}

#[test]
fn baseline_compilation_without_album_artist_keeps_one_physical_album() {
    let mut first = sample("s1", Some("lib-a"), "a", "First", "comp", &["Rock"], &[]);
    let mut second = sample("s1", Some("lib-a"), "b", "Second", "comp", &[], &["Dreamy"]);
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
        "s1",
        Some("lib-a"),
        "orphan",
        "Orphan",
        "ignored",
        &["Rock"],
        &["Dreamy"],
    );
    albumless.album_id = None;
    albumless.album = "Unsorted".into();
    let first = sample("s1", None, "null-a", "First", "null-album", &["Rock"], &[]);
    let second = sample(
        "s1",
        None,
        "null-b",
        "Second",
        "null-album",
        &[],
        &["Dreamy"],
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
        "s1",
        Some("lib-a"),
        "deleted",
        "Deleted",
        "deleted-album",
        &["Rock"],
        &["Dreamy"],
    );
    deleted.deleted = true;
    let store = seed(&[
        sample(
            "s1",
            Some("lib-a"),
            "visible",
            "Visible",
            "visible-album",
            &["Rock"],
            &["Dreamy"],
        ),
        sample(
            "s1",
            Some("lib-b"),
            "elsewhere",
            "Elsewhere",
            "other-album",
            &["Rock"],
            &["Dreamy"],
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
        sample(
            "s1",
            Some("lib-a"),
            "upper",
            "Upper",
            "a",
            &["Ärt"],
            &["Dreamy"],
        ),
        sample(
            "s1",
            Some("lib-a"),
            "lower",
            "Lower",
            "b",
            &["ärt"],
            &["Dreamy"],
        ),
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
        LibraryTagFilter {
            kind: LibraryTagKind::Genre,
            value: "Ärt".into(),
        },
        LibraryTagFilter {
            kind: LibraryTagKind::Genre,
            value: "ärt".into(),
        },
    ];
    // KNOWN BASELINE QUIRK (F10): Unicode folding merges the two tags even
    // though SQLite NOCASE does not make them equivalent.
    assert!(list_tracks(&store, &req)
        .unwrap_err()
        .contains("at least two distinct"));
}

#[test]
fn baseline_track_order_is_title_artist_album_id_nocase() {
    // Insert deliberately out of title/artist/album/id order. An index scan,
    // ROWID walk, or pure bytewise sort must not satisfy this golden list.
    let mut rows = vec![
        sample(
            "s1",
            Some("lib-a"),
            "z",
            "zulu",
            "album-z",
            &["Rock"],
            &["Dreamy"],
        ),
        sample(
            "s1",
            Some("lib-a"),
            "a-id-z",
            "ALPHA",
            "album-sort",
            &["Rock"],
            &["Dreamy"],
        ),
        sample(
            "s1",
            Some("lib-a"),
            "accent",
            "Écho",
            "album-accent",
            &["Rock"],
            &["Dreamy"],
        ),
        sample(
            "s1",
            Some("lib-a"),
            "a-zartist",
            "alpha",
            "album-zz",
            &["Rock"],
            &["Dreamy"],
        ),
        sample(
            "s1",
            Some("lib-a"),
            "b",
            "bravo",
            "album-bravo",
            &["Rock"],
            &["Dreamy"],
        ),
        sample(
            "s1",
            Some("lib-a"),
            "a-id-a",
            "Alpha",
            "album-sort",
            &["Rock"],
            &["Dreamy"],
        ),
        sample(
            "s1",
            Some("lib-a"),
            "z-album-first",
            "alpha",
            "album-a",
            &["Rock"],
            &["Dreamy"],
        ),
        sample(
            "s2",
            Some("lib-b"),
            "ascii-echo",
            "Echo",
            "album-echo",
            &["Rock"],
            &["Dreamy"],
        ),
        sample(
            "s2",
            Some("lib-b"),
            "a-bartist",
            "ALPHA",
            "album-b",
            &["Rock"],
            &["Dreamy"],
        ),
    ];
    for row in &mut rows {
        match row.id.as_str() {
            "a-zartist" => row.artist = Some("Zed".into()),
            "a-bartist" => row.artist = Some("Bob".into()),
            "a-id-a" | "a-id-z" | "z-album-first" => row.artist = Some("Aaron".into()),
            _ => {}
        }
        if row.id == "z-album-first" {
            row.album = "Album A".into();
        } else if row.id == "a-id-a" || row.id == "a-id-z" {
            row.album = "Album Z".into();
        }
    }
    let store = seed(&rows);
    for (label, scopes, expected) in [
        (
            "single-exact",
            vec![scoped("s1", "lib-a")],
            vec![
                "z-album-first",
                "a-id-a",
                "a-id-z",
                "a-zartist",
                "b",
                "z",
                "accent",
            ],
        ),
        (
            "multi-server",
            vec![scoped("s1", "lib-a"), scoped("s2", "lib-b")],
            vec![
                "z-album-first",
                "a-id-a",
                "a-id-z",
                "a-bartist",
                "a-zartist",
                "b",
                "ascii-echo",
                "z",
                "accent",
            ],
        ),
    ] {
        let mut req = track_request(LibraryTagMatchMode::And);
        req.library_scopes = Some(scopes);
        let actual = list_tracks(&store, &req).unwrap();
        let ids = actual
            .tracks
            .iter()
            .map(|t| t.id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(ids, expected, "{label}");
        assert_eq!(actual.total, Some(expected.len() as u32), "{label}");
    }
}

#[test]
fn baseline_album_order_is_album_artist_album_id_nocase() {
    let mut rows = vec![
        sample(
            "s1",
            Some("lib-a"),
            "z-row",
            "Z Track",
            "z-alb",
            &["Rock"],
            &["Dreamy"],
        ),
        sample(
            "s1",
            Some("lib-a"),
            "a2-row",
            "A2 Track",
            "a2-alb",
            &["Rock"],
            &["Dreamy"],
        ),
        sample(
            "s1",
            Some("lib-a"),
            "accent-row",
            "Accent",
            "accent-alb",
            &["Rock"],
            &["Dreamy"],
        ),
        sample(
            "s1",
            Some("lib-a"),
            "az-row",
            "AZ Track",
            "a0-alb",
            &["Rock"],
            &["Dreamy"],
        ),
        sample(
            "s1",
            Some("lib-a"),
            "b-row",
            "B Track",
            "b-alb",
            &["Rock"],
            &["Dreamy"],
        ),
        sample(
            "s1",
            Some("lib-a"),
            "a1-row",
            "A1 Track",
            "a1-alb",
            &["Rock"],
            &["Dreamy"],
        ),
        sample(
            "s1",
            Some("lib-a"),
            "e-row",
            "E Track",
            "e-alb",
            &["Rock"],
            &["Dreamy"],
        ),
    ];
    for row in &mut rows {
        match row.id.as_str() {
            "a1-row" => {
                row.album = "Alpha".into();
                row.artist = Some("Aaron".into());
                row.album_artist = Some("Aaron".into());
            }
            "a2-row" => {
                row.album = "alpha".into();
                row.artist = Some("Aaron".into());
                row.album_artist = Some("Avery".into());
            }
            "az-row" => {
                row.album = "ALPHA".into();
                row.artist = Some("Zed".into());
                row.album_artist = Some("Zed".into());
            }
            "b-row" => row.album = "bravo".into(),
            "e-row" => row.album = "Echo".into(),
            "z-row" => row.album = "zulu".into(),
            "accent-row" => row.album = "Écho".into(),
            _ => unreachable!(),
        }
    }
    let store = seed(&rows);
    let mut req = album_request(LibraryTagMatchMode::And);
    req.library_scopes = Some(vec![scoped("s1", "lib-a")]);
    let actual = list_albums(&store, &req).unwrap();
    let ids = actual
        .albums
        .iter()
        .map(|a| a.id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        ids,
        vec![
            "a1-alb",
            "a2-alb",
            "a0-alb",
            "b-alb",
            "e-alb",
            "z-alb",
            "accent-alb"
        ]
    );
    assert_eq!(actual.total, Some(7));
}

#[test]
fn baseline_exact_scope_album_dedup_depends_on_cluster_key_state() {
    // Single exact-library browsing does not eagerly ensure cluster keys.
    // Once maintenance builds canonical keys, two physical copies with the
    // same *performing* album artist can merge. Preserve this baseline.
    let mut first = sample(
        "s1",
        Some("lib-a"),
        "cold-1",
        "First",
        "cold-a",
        &["Rock"],
        &["Dreamy"],
    );
    let mut second = sample(
        "s1",
        Some("lib-a"),
        "cold-2",
        "Second",
        "cold-b",
        &["Rock"],
        &["Dreamy"],
    );
    first.album = "Alpha".into();
    second.album = "alpha".into();
    first.artist = Some("Aaron".into());
    second.artist = Some("Aaron".into());
    first.album_artist = Some("Aaron".into());
    second.album_artist = Some("Aaron".into());

    let store = seed(&[first, second]);
    let mut req = album_request(LibraryTagMatchMode::And);
    req.library_scopes = Some(vec![scoped("s1", "lib-a")]);

    let cold = list_albums(&store, &req).unwrap();
    assert_eq!(
        cold.total,
        Some(2),
        "cold exact scope keeps physical albums"
    );

    crate::identity::ensure_cluster_keys_built(&store, "s1").unwrap();

    let warm = list_albums(&store, &req).unwrap();
    assert_eq!(
        warm.total,
        Some(1),
        "warm keys merge equivalent physical albums"
    );
    assert_eq!(warm.albums.len(), 1);
    assert_eq!(warm.albums[0].song_count, Some(2));
}

#[test]
fn baseline_nonperforming_album_credit_does_not_merge_physical_albums() {
    // Under identity v11, an album-artist credit that is not represented by
    // any performing track is insufficient evidence to collapse two physical
    // albums, even after cluster keys have been rebuilt.
    let mut first = sample(
        "s1",
        Some("lib-a"),
        "credit-1",
        "First",
        "credit-a",
        &["Rock"],
        &["Dreamy"],
    );
    let mut second = sample(
        "s1",
        Some("lib-a"),
        "credit-2",
        "Second",
        "credit-b",
        &["Rock"],
        &["Dreamy"],
    );
    first.album = "Alpha".into();
    second.album = "alpha".into();
    first.album_artist = Some("Aaron".into());
    second.album_artist = Some("Aaron".into());
    // The fixture's performing artist remains "Artist", not "Aaron".

    let store = seed(&[first, second]);
    let mut req = album_request(LibraryTagMatchMode::And);
    req.library_scopes = Some(vec![scoped("s1", "lib-a")]);

    let cold = list_albums(&store, &req).unwrap();
    assert_eq!(cold.total, Some(2));

    crate::identity::ensure_cluster_keys_built(&store, "s1").unwrap();

    let warm = list_albums(&store, &req).unwrap();
    assert_eq!(warm.total, Some(2));
    assert_eq!(warm.albums.len(), 2);
    assert!(warm.albums.iter().any(|album| album.id == "credit-a"));
    assert!(warm.albums.iter().any(|album| album.id == "credit-b"));
}

#[test]
fn baseline_single_exact_whole_server_and_multi_scope_count_pagination_goldens() {
    let (store, all_scopes) = seeded_matrix();
    // Each candidate set is independent of the Explorer API under test.
    let cases = [
        (
            "single-exact",
            Some(vec![scoped("s1", "lib-a")]),
            vec![0, 2, 4, 6, 8, 10],
        ),
        ("whole-server", None, (0..12).collect::<Vec<_>>()),
        ("multi", Some(all_scopes), (0..27).collect::<Vec<_>>()),
    ];
    for (scope_label, selected_scopes, candidates) in cases {
        for mode in [LibraryTagMatchMode::And, LibraryTagMatchMode::Or] {
            for tag_count in [2usize, 5, 10] {
                let expected = candidates
                    .iter()
                    .copied()
                    .filter(|&i| match (mode, tag_count) {
                        (LibraryTagMatchMode::Or, 2) => i < 24,
                        (LibraryTagMatchMode::Or, 5) => i < 25,
                        (LibraryTagMatchMode::Or, 10) => i < 26,
                        (LibraryTagMatchMode::And, 2) => i < 17,
                        (LibraryTagMatchMode::And, 5 | 10) => i < 8,
                        _ => unreachable!(),
                    })
                    .collect::<Vec<_>>();
                let expected_tracks = expected
                    .iter()
                    .map(|&i| {
                        (
                            (if i < 12 { "s1" } else { "s2" }).to_string(),
                            format!("matrix-{i:03}"),
                        )
                    })
                    .collect::<Vec<_>>();
                let expected_albums = expected
                    .iter()
                    .map(|&i| {
                        (
                            (if i < 12 { "s1" } else { "s2" }).to_string(),
                            format!("matrix-album-{i:03}"),
                        )
                    })
                    .collect::<Vec<_>>();

                let mut tracks_req = track_request(mode);
                tracks_req.tags = ten_tags()[..tag_count].to_vec();
                tracks_req.library_scopes = selected_scopes.clone();
                tracks_req.limit = 3;
                let first = list_tracks(&store, &tracks_req).unwrap();
                assert_eq!(
                    first.total,
                    Some(expected_tracks.len() as u32),
                    "{scope_label}"
                );
                assert_eq!(
                    first
                        .tracks
                        .iter()
                        .map(|t| (t.server_id.clone(), t.id.clone()))
                        .collect::<Vec<_>>(),
                    expected_tracks.iter().take(3).cloned().collect::<Vec<_>>(),
                    "{scope_label}"
                );
                assert_eq!(first.has_more, expected_tracks.len() > 3, "{scope_label}");
                let mut count_req = tracks_req.clone();
                count_req.count_only = true;
                let count = list_tracks(&store, &count_req).unwrap();
                assert!(count.tracks.is_empty());
                assert_eq!(
                    count.total,
                    Some(expected_tracks.len() as u32),
                    "{scope_label}"
                );
                let mut empty_req = tracks_req.clone();
                empty_req.offset = 100;
                let empty = list_tracks(&store, &empty_req).unwrap();
                assert!(empty.tracks.is_empty());
                assert!(!empty.has_more);
                assert_eq!(
                    empty.total,
                    Some(expected_tracks.len() as u32),
                    "{scope_label}"
                );
                assert_eq!(
                    track_refs(&store, &tracks_req),
                    expected_tracks,
                    "{scope_label}"
                );

                let mut albums_req = album_request(mode);
                albums_req.tags = ten_tags()[..tag_count].to_vec();
                albums_req.library_scopes = selected_scopes.clone();
                albums_req.limit = 3;
                let first = list_albums(&store, &albums_req).unwrap();
                assert_eq!(
                    first.total,
                    Some(expected_albums.len() as u32),
                    "{scope_label}"
                );
                assert_eq!(
                    first
                        .albums
                        .iter()
                        .map(|a| (a.server_id.clone(), a.id.clone()))
                        .collect::<Vec<_>>(),
                    expected_albums.iter().take(3).cloned().collect::<Vec<_>>(),
                    "{scope_label}"
                );
                assert_eq!(first.has_more, expected_albums.len() > 3, "{scope_label}");
                let mut count_req = albums_req.clone();
                count_req.count_only = true;
                let count = list_albums(&store, &count_req).unwrap();
                assert!(count.albums.is_empty());
                assert_eq!(
                    count.total,
                    Some(expected_albums.len() as u32),
                    "{scope_label}"
                );
                let mut empty_req = albums_req.clone();
                empty_req.offset = 100;
                let empty = list_albums(&store, &empty_req).unwrap();
                assert!(empty.albums.is_empty());
                assert!(!empty.has_more);
                assert_eq!(
                    empty.total,
                    Some(expected_albums.len() as u32),
                    "{scope_label}"
                );
            }
        }
    }
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
