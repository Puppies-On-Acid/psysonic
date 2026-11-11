# PSY-015 — Library Rules: phased implementation specification

**Status:** Owner-approved **product direction** (D-016) and **Stage 1 branch/implementation** (D-017, 2026-11-10). Stage 1A contract/validation candidate has been committed to `feat/library-tag-audit-v2` and awaits Windows tests. Stages 2–3 persistence/tracking design and PR remain separate approval decisions.

**Live records:** [PSY-015 work issue #13](https://github.com/Puppies-On-Acid/psysonic/issues/13), [living handoff #1](https://github.com/Puppies-On-Acid/psysonic/issues/1), [owner decisions D-016/D-017](../DECISIONS.md), [preserved v1 baseline](https://github.com/Puppies-On-Acid/psysonic/tree/feat/library-tag-audit) and [isolated Stage 1 work branch](https://github.com/Puppies-On-Acid/psysonic/tree/feat/library-tag-audit-v2).

**Verified refs at planning time (2026-11-10):** upstream/fork main `242bd6fc99832b49bb26db62d4f8fdaa86ad6345`; tag-audit candidate `0094fd5dfdfe86fe5fea499a01b1e745793705ea`; daily-drive `personal/integration` `8d4a8dff1551728944ec2052dc02d9c769c2ec7a`. Re-fetch before implementation; these are not timeless SHAs.

## Owner-approved intent and non-negotiables

- Evolve the single-purpose genre/mood audit into a local **Library Rules** experience with **arbitrary combinations of supported, typed conditions** over library metadata, not arbitrary user-supplied SQL.
- Preserve genre/mood missing/partial behavior as an obvious, usable **built-in rule/template**; preserve manual Run/View separation, album navigation, correct filtering and CSV Save dialog.
- Stage 1: generalized condition builder with nested **ALL/ANY**, usable for albums and tracks, evaluated locally. Stage 2: save and reuse named templates. Stage 3: opt-in automatic **violator tracking** after successful library sync; distinguish new/continuing/resolved matches. **No continuous polling.**
- Default remains manual/on-demand. No unexpected work on Settings render, startup, browse or ordinary library idle. Never change music files/tags, send metadata to third parties, or write to Navidrome/Subsonic as part of rule evaluation.
- Respect server/library scope, offline indexed data, album copies, deleted tracks, incomplete local projections, and privacy. Keep public GitHub logs free of private server/library metadata.
- No PR, daily-driver branch merge, live-database modification, schema migration, deployment, or force-push without separate applicable authorization.

## Architecture assessment (verified upstream source)

The upstream Smart Playlist editor already provides Basic/Advanced/JSON nested ALL/ANY groups, rule AST/editing primitives and a type-aware field/operator registry (`src/features/playlist/utils/smartPlaylistRules.ts`, `smartPlaylistFields.ts`, `PlaylistsSmartEditorAdvanced.tsx`). **Reuse concepts/UI primitives where they truly fit; do not couple local Library Rules to server-specific Smart Playlist evaluation/version gates.** Local library data and rule semantics differ: a playlist queries tracks on a server while an audit analyzes indexed album copies, partial tag coverage and tracks across local scopes. The current audit runs through `with_scope_detail_read_conn` and uses read-only SQLite aggregation, plus existing UI CSV and navigation.

### Proposed schema and evaluator

- Represent rules as a **versioned, serializable AST**: `{ version, entity: album|track, scope, condition: group|predicate }`. A group has `all` or `any` and nonempty children; a predicate has `field, operator, typedValue`. Store metadata in the AST only when templates exist (Stage 2).
- Use a **whitelisted local field registry** derived from *actual current SQLite columns/projections* and metadata-ready guards. Initial candidate fields: album/track title and artist, track count, genre/mood presence/coverage, and release year **only if actually indexed and semantically validated**. Later add rating, play count, artwork, audio quality etc. after source/field-specific verification. Unknown/unavailable fields cause an explicit validation error; never silently treat them as missing.
- Define album-oriented track predicates unambiguously: for example, `any track missing mood`, `all tracks have genre`; a track-oriented rule produces individual track results. Resolve subtle cases (empty album, inherited album genre, mixed folders) explicitly before implementing.
- Compile AST into **bounded, parameterized, read-only SQL** (or safe, measured equivalent) with validated identifiers/operators. No arbitrary SQL injection or user-controlled column names. Proposed initial guardrails for review: 64 predicate nodes maximum, group depth maximum 5, 150 scope pairs (consistent with existing audit), and paged/capped result transport when needed. Document actual limits after benchmarks.
- Reuse existing index read connections and preserve album identity as `(server_id, library_id, album_id)`; track identity as `(server_id, track_id)` with scope association. Skip tombstones. Explicitly preserve the current genre/mood classification semantics as a regression oracle.
- Report **scope**, evaluation timestamp, total checked, matched, match explanation (field/group), stale/reindexing state, typed validation/SQL errors; preserve existing result search/sort/CSV and accessible keyboard navigation. Preview must never persist a template or trigger a sync.

## Delivery stages and acceptance gates

### Stage 1 — general-purpose rule builder and manual execution

Suggested small slices:
1. **Contract, fixtures and field registry.** Versioned AST, allowed field/operator metadata, validation errors, deterministic JSON roundtrip. Test nested AND/OR, empty and malformed groups, unsupported field/operator, type/null mismatches, deep/large trees and nonexistent indexed fields.
2. **Read-only query compilation.** Parameterized local evaluator; test mixed scopes, album copies, track-vs-album quantifier semantics, deleted rows, projections not ready, missing vs partial album genre/mood, empty/unknown values, errors, and SQL plan/index use. Existing tag-audit oracle results must match the equivalent rule.
3. **React builder and results.** Field/operator/value controls, nested groups, inline validation, explicit Run/Preview, album/track links, sort/filter/pagination, existing native CSV export and clear cancel/error UX. No save/monitoring side effects in this stage.

**Stage 1 measurable exit:** fixtures and tag-audit regression oracle pass; no DB writes, no scan on render; exact-head TS/ESLint/dependency/Vitest/coverage/Rust fmt/tests/Clippy/Specta freshness where IPC changes; Windows app smoke, including offline and server-folder cases using safe fixtures where owner has only one real server; acceptable benchmark relative to the tested candidate on the *same* library. Separate query execution cost, UI idle cost, and result transfer/render cost.

### Stage 2 — local named rule templates

- Name/edit/duplicate/delete/select built-in and user templates; use stable ids and a schema/version field; preserve original tag/mood presets without rewriting them.
- **Storage is an unresolved owner decision:** likely local app settings or local application database, never server-synchronized by default. Verify backup/restore support, atomic writes, migration/versioning, recoverability of corrupt/unsupported rules and behavior across devices. No persistence code until chosen.
- **Acceptance:** save and restart restore; duplicate/rename/delete predictably; invalid template recovery without data loss; scope changes clearly flagged; no automatic evaluation just because a template exists; relevant storage/backup regression tests and negative cases.

### Stage 3 — opt-in post-sync violation tracking

- Owner-approved trigger: successful relevant library synchronization **only for individually enabled templates**; explicit Run remains available. No polling, no retroactive unrequested initial scan, no automatic use until opt-in.
- **State and scheduling remain design decisions:** persist prior rule/scope evaluation version, last successful evaluation, per-item violation state and change timestamps. Compare only *compatible complete* snapshots. Distinguish new / continuing / resolved; never claim resolved because a server went offline, a scope shrank, indexing was incomplete or an evaluation failed.
- Proposed execution policy for review: coalesce bursts of sync events, serialize/limit heavy evaluations, cap CPU/DB contention/memory, postpone heavy work while sync writes continue; cancellation and shutdown must not corrupt tracking. Track only opted-in templates; opt-out halts work and retains or clears history based on explicit UX decision.
- **Acceptance:** zero background audit activity with monitoring disabled; exactly one coalesced evaluation after a relevant successful sync per eligible scope; no evaluation for unrelated scopes or failed syncs; new/ongoing/resolved counts correct across indexed changes and restart, no false resolutions offline; measured idle, playback, browse and sync overhead versus nonmonitoring base; no arbitrary remote data writes.

## Performance / compatibility / rollback

- **Benchmark classification: required** (large local-library scan, SQL and potentially background sync work). Compare same machine/library/profile and identical cold/warm run counts for an agreed baseline SHA vs each stage candidate. Capture median/min/max/variance for Settings open (no scan), 5 warm & 1 cold manual evaluation, library browse, sync idle, peak RSS/allocations, query plans/SQL index choices, lock contention and UI long-task symptoms. The owner's **~3-second** single audit observation is a smoke result, *not* a controlled comparison or a universal latency budget.
- Preserve offline multi-server/library selection and read-only data semantics. Match upstream architecture, Rust/Specta bindings generation, translation/accessibility and build configuration. Treat missing local projections as explicit “not ready” rather than reporting zero tags.
- Preserve current working tag-audit commit `0094fd5d` as a recoverable checkpoint. **Owner-approved and implemented branch strategy (D-017)**: Stage 1 lives on `feat/library-tag-audit-v2`, created from `0094fd5d`, while original `feat/library-tag-audit` is untouched. Stage 2 and Stage 3 remain distinct follow-up implementation phases requiring their persistence/scheduling details approved. Source changes in V2 do not imply testing or PR readiness.
- Independent **read-only Claude Code** review pinned to each meaningful exact SHA is required before PR readiness. Record findings and remediation; do not claim green CI until observed. Four Flatpak/Bash tests remain locally blocked in Windows and require a suitable Linux shell/CI environment.

## Open owner decisions (before consequential implementation)

1. **Branch/review strategy — APPROVED (D-017):** separate Stage 1 `feat/library-tag-audit-v2` from `0094fd5d`; preserve the tested original branch. No PR is authorized yet.
2. **Saved-template storage:** local application settings JSON (small and backup-friendly) versus a versioned SQLite rules store (better for later tracking but requires migrations). Prefer versioned settings for templates; independent tracking-state persistence may need SQLite in Stage 3.
3. **Rule domain semantics:** default album and track as separate rule types, with explicit `any/all` track quantifiers within album rules (recommended), rather than a universal cross-entity expression language.
4. **Tracking budget and persistence:** approval needed before writing new persistent tracking data or changing default scheduling/cancellation policies. Stage 3 cannot be implemented solely on the approval of its high-level intent.

**Next action:** run Windows validation on `feat/library-tag-audit-v2` Stage 1A (`libraryRuleModel.ts` and tests), then implement an independently validated, bounded Rust SQL evaluator and later the UI under this approved Stage 1 scope. Keep decisions about saved-rule storage and automatic tracking separate; retain exact-SHA benchmark and independent-review gates.
