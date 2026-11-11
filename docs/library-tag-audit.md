# Library Tag Audit — v0.1 implementation checkpoint

Base: Psysonic upstream `main` at `242bd6fc99832b49bb26db62d4f8fdaa86ad6345`.
Branch: `feat/library-tag-audit`.
Status: **implementation candidate**. Owner-reported manual audit smoke passed on one full library (~3 seconds, accurate classifications, search/filter and album navigation) at `81bc113a`. CSV native-save correction is pending re-test on its new HEAD; multi-library scope, comparative runtime benchmark and independent review remain pending.

## Approved behavior (2026-11-10)

- Settings → Library → Library maintenance — metadata audit.
- Scan only when **Run Audit** is clicked. **View Results** is separate; neither mounting Settings nor opening old results queries the database.
- Query the existing local SQLite track and genre/mood tag projections; no media-file reads, Navidrome REST calls, tag edits, new migration, or sync job.
- Audit the currently configured browse scope, including locally indexed offline servers. Treat individual server+library+album copies independently; do not combine copies to conceal missing metadata.
- Classify genres and moods independently:
  - **Missing**: zero tagged tracks (and for genres, no album-level genre).
  - **Partial**: some, but not all, tracks have tags; for genres, an album-level genre with untagged tracks also qualifies.
  - **Complete**: every track has at least one indexed tag (irrespective of album-level metadata).
- Include summary counts (missing genre, partial genre, missing mood, partial mood, both incomplete), results table with album links, search/filter/sort, and CSV export of the currently filtered result set via the native Save dialog, with save-success/failure feedback.
- The snapshot is kept **in app memory only** for this session, not stored on disk. Results are explicitly stale after subsequent synchronization or selection changes; rerun to refresh.

## Data behavior and constraints

- Only non-deleted local tracks with a nonblank `album_id` are eligible. Tracks without album IDs are not represented in this album-focused audit.
- Albums with no indexed tracks are not considered. This is **not** a completeness audit of remote music files.
- At audit time, both genre and mood projection migrations must be completed. This protects against false negatives during first-time tag backfill. The audit can still reflect a not-yet-finished ordinary library synchronization; explain this in the UI.
- Album-level genre presence comes from the local `album.genre` projection. Track-level genre and mood presence comes from the `track_genre` and `track_mood` projections.
- Results are explicitly snapshots, not automatically refreshed on navigation or background sync. Large, all-missing libraries will return many results on the single user-triggered query; the UI paginates rendering, not backend transmission.
- CSV exports only filtered affected-album rows and quotes/sanitizes fields against spreadsheet formula execution. No server URL, passwords, library paths, or raw track metadata is included. The picker uses existing `@tauri-apps/plugin-dialog` and `@tauri-apps/plugin-fs` permissions; cancelled saves perform no filesystem write.

## IPC contract

The `library_tag_audit` Tauri command and its request/response DTOs are Specta-typeable and are registered in both `generate_handler!` and `collect_commands!`. The committed `src/generated/bindings.ts` must be regenerated with Rust's exporter and verified with `committed_bindings_are_fresh`. Do not edit the generated file by hand or add the command to the `UNTYPEABLE` exception list.

## Verification required before calling this PR-ready

1. `npm ci` (Node version per upstream `package.json`); `npm run prebuild:release-notes`; `npx tsc --noEmit`; `npm run lint`; `npm run dep:check`; `npm run dep:check:barrels`; `npm test` and coverage gates.
2. `cargo fmt --all --check`; `cargo test --workspace --all-targets`; `cargo clippy --workspace --all-targets -- -D warnings` from `src-tauri`.
3. Test SQLite behavior on exact compiled SHA: fully tagged, partially tagged, untagged, album-level-only genre, deleted tracks, blank tag strings, per-library and cross-server duplicates, incomplete backfill, empty scope, and blocked/failed database.
4. Performance: compare upstream base versus feature HEAD on an equivalent selected local library for Settings open, Browse routes, idle/sync time, and 1× manually triggered audit latency/peak memory. Since the new query returns every affected album, use a large representative library and inspect query plan/SQLite lock contention. Define acceptable budget with owner; no result is currently a passing benchmark.
5. Owner Windows smoke: Run/View independence, scope change warning, offline indexed server, pagination, click-to-album/back, filters, CSV escaping, error retry, repeated audit; independent read-only Claude Code review pinned to exact candidate SHA.
6. Do not open a PR, merge this into `personal/integration`, or run on a production/live database without separate owner approval.

## Rollback

Revert the isolated branch commits. No schema or persistent settings changes are introduced.
