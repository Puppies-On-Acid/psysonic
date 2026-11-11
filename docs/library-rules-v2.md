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

## Stage 1B2 — paged local evaluator (candidate; not yet compiled/tested)

- `library_rules/evaluator.rs` compiles validated nested ALL/ANY typed predicates into SQL built from literal whitelisted field expressions. User text/numbers/scope ids are **always bound**, not concatenated. Literal substring operators use `instr` rather than SQL LIKE wildcards; unsupported fields/operators are rejected by the independent Rust validator. Explicit `isNot`/`notContains` exclude missing values; `isMissing` is a distinct operation.
- Album rules group by physical `(server_id, library_id, album_id)`, use the v1 genre/mood projection checks, respect album-level genre tags, and exclude tracks lacking album ids. Track rules include live tracks even if album ids are absent. Deleted tracks are excluded from both. Tag-dependent rules require a ready local genre/mood projection, while title/year-only rules can run without it.
- Response is **one deterministic page** of max 200 matches, plus a `has_more` flag using one extra row. Pagination/CSV over complete results, total candidate/match counts, IPC and React builder belong to the next integration slice. SQL evaluation remains a pure function over the caller's SQLite read connection; no new schema, file writes, Tauri command, or automatic triggers.
- Tests use in-memory SQLite and a readonly `PRAGMA query_only` connection to exercise v1 parity, nested conditions, pagination, nulls, exact library scopes, duplicate album copies, tombstones, blank tags, malformed rules and injection-shaped text. v1 audit visibility was broadened only to `pub(crate)` so the tests can compare outputs.
- Required owner Windows proof: `cargo fmt --all --check`, `cargo test -p psysonic-library --lib library_rules -- --nocapture`, `cargo clippy --workspace --all-targets -- -D warnings`. Follow with full workspace suite on exact SHA under the established process-scoped UTC workaround. No test claim before execution.
- Remaining Stage 1: TypeScript/Tauri IPC with generated Specta bindings, visual builder, result navigation/CSV, explicit Run/Preview, perf baseline and independent read-only review.

## Next slices and verification

1. Validate this TypeScript contract on exact SHA with npx tsc --noEmit and npx vitest run src/features/settings/utils/libraryRuleModel.test.ts, plus npm run lint/dep:check.
2. Add the independent Rust-side validator and bounded parameterized local evaluator with fixtures for mixed-library copies, deleted tracks, album-genre inheritance, empty tags, projection readiness, AND/OR and type rejection. The backend MUST validate requests again; do not trust frontend validation as a security boundary.
3. Add the accessible visual field/group builder and explicit Run/View/CSV results, preserving current validated tag-audit UX.
4. Before calling Stage 1 complete: regenerate Specta bindings if commands change; run full test/coverage/build/Rust gates on one exact candidate SHA, compare baseline vs V2 query and Settings idle performance, manual smoke and independent read-only review.
5. No template persistence, background evaluation, schema migration, PR or integration merge in Stage 1A.

## Stage 1C1 — isolated visual rule builder (candidate)

The reusable `LibraryRuleBuilder` control builds album/track nested ALL/ANY conditions using typed field/operator selectors. It never invokes Tauri, scans the library, saves a rule, or schedules monitoring. Parent components must wire an explicit Run action in Stage 1C2 after IPC and pagination integration; this component is deliberately not mounted in Settings yet to preserve the working V1 audit. Edits are immutable, the root and last child are protected, and add controls are bounded at 64 nodes and nesting depth 5. English strings are added with ordinary translation fallback. Verify new reducer and component tests, TypeScript, ESLint, dependency rules, and existing audit test before continuing.

## Stage 1C2A — typed Rust service boundary (unverified candidate)

- `library_rules::RuleEvaluateRequest` defines a Specta-compatible IPC shape with `scopes`, `ruleJson`, `limit` and `offset`; `RulePage`/`RuleMatch` are serializable, typeable DTOs in camelCase.
- The `library_rules::run` service is **explicitly invoked only** (not wired into Tauri yet) and uses `LibraryStore::with_scope_detail_read_conn` to avoid contending with ordinary browse reads. The request rejects malformed/oversized JSON (2 MiB), page limits outside 1–200, scope counts outside 1–150, and invalid rule ASTs *before* taking a database read lock.
- Two new Rust unit tests cover service input rejection and request shape; test `cargo fmt --all --check`, targeted `cargo test -p psysonic-library --lib library_rules -- --nocapture` (19 expected), and Clippy on an exact SHA. No SQLite writes, schema changes, generated TypeScript binding changes, UI mounting, background jobs or PR.
- Next Stage 1C2B will register a single `#[tauri::command]`/Specta command, regenerate the committed `src/generated/bindings.ts` through the **upstream generator** on the owner's Windows checkout, and wire the manual-only frontend. Do not hand-fake the generated binding or mark Specta freshness pass prematurely.

## Stage 1C2B — manual-only Tauri command registration (candidate; bindings pending)

- Registers `library_rules_evaluate` in the **live** Tauri `generate_handler!` and matching Specta `collect_commands!`, beside the existing `library_tag_audit`. The existing V1 command and audit/CSV remain unchanged.
- New command accepts the bounded, typed `RuleEvaluateRequest`, clones the shared library store and uses `library_spawn_blocking` before calling `library_rules::run` (read-only heavy-query connection). It executes **only on explicit invocation**, and is not mounted by any UI yet.
- **Important deliberate build gate:** Committed `src/generated/bindings.ts` is now STALE until regenerated using the upstream headless `cargo test -p psysonic regenerate_committed_bindings -- --ignored` from `src-tauri`. Do not hand-write the generated binding. The owner should generate on a guarded clean checkout at this SHA, inspect the generated one-file diff and supply it so the exact generated bytes can be committed separately. The generated file change is expected; other unplanned dirty files are not.
- Before generation, run `cargo fmt --all --check`, `cargo test -p psysonic-library --lib library_rules -- --nocapture` (19 expected), `cargo clippy --workspace --all-targets -- -D warnings`; command and Specta export must also compile, and the `committed_bindings_are_fresh` test should only be run **after** generated output is committed.
- No frontend invoke or visible editor integration in this checkpoint; Stage 1C2C adds the typed frontend client and a manual Run/Next-page results view. No template storage, automatic evaluator or sync-trigger.
