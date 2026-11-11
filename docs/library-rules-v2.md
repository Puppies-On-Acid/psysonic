# Library Rules v2 — Stage 1A contract checkpoint

Branch: feat/library-tag-audit-v2 (from the working tag-audit SHA 0094fd5d).
Status: **contract and validation candidate; NOT the completed builder**. Follow the approved phased plan in the Project Hub: meta/project-hub/project/specs/PSY-015-LIBRARY-RULES.md.

## Contract

- A v1 document is { version: 1, entity: 'album' | 'track', root: group }. Each group is 'all' or 'any', with a nonempty array of group/predicate children.
- Fields and operators are explicit, typed whitelists in src/features/settings/utils/libraryRuleModel.ts; arbitrary raw SQL, arbitrary server-side Smart Playlist fields, and implicit type coercions are forbidden.
- No more than 64 total nodes (including the root) and 5 levels of groups/predicates. Values are typed; no-value operators reject a value. Unknown or malformed fields fail validation rather than being silently ignored.
- Rule execution uses the currently selected library scope **at run time**; whether a saved template pins a scope belongs to Stage 2.
- The built-in album preset exactly expresses the v1 selection: genreStatus isNot complete OR moodStatus isNot complete. Track mode checks missing per-track indexed genre/mood entries. The current v1 tag-audit query and UI remain unchanged during this slice.

## Sources

The album registry refers to physical album columns name, artist, year in migration 001_initial.sql, as well as aggregate track count, genre/mood coverage from the verified v1 audit and album.genre. The track registry refers to track.title, artist, album, year, duration_sec, bit_rate, play_count, and track_genre/track_mood existence in that same local index. Projected fields must be verified against actual DB semantics before the Rust evaluator is implemented; a declared field is NOT proof that runtime query support exists yet.

## Stage 1B1 Rust schema validator (unverified candidate)

- Pure Rust Serde contract and independently validated typed backend whitelist added in src-tauri/crates/psysonic-library/src/library_rules.rs.
- Rejects unsupported versions/fields/operators, unknown JSON keys, null or wrong-typed values, empty or deep groups, unsafe integers, and oversized rule trees.
- This adds no Tauri IPC, SQL execution, database migration, background job, or user-visible change.
- Validation required: cargo fmt --all --check; cargo test -p psysonic-library --lib library_rules -- --nocapture; cargo clippy --workspace --all-targets -- -D warnings.

## Next slices and verification

1. Validate this TypeScript contract on exact SHA with npx tsc --noEmit and npx vitest run src/features/settings/utils/libraryRuleModel.test.ts, plus npm run lint/dep:check.
2. Add the independent Rust-side validator and bounded parameterized local evaluator with fixtures for mixed-library copies, deleted tracks, album-genre inheritance, empty tags, projection readiness, AND/OR and type rejection. The backend MUST validate requests again; do not trust frontend validation as a security boundary.
3. Add the accessible visual field/group builder and explicit Run/View/CSV results, preserving current validated tag-audit UX.
4. Before calling Stage 1 complete: regenerate Specta bindings if commands change; run full test/coverage/build/Rust gates on one exact candidate SHA, compare baseline vs V2 query and Settings idle performance, manual smoke and independent read-only review.
5. No template persistence, background evaluation, schema migration, PR or integration merge in Stage 1A.
