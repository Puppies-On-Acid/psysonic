# Psysonic engineering quality and verification gates

**Purpose:** precise evaluation criteria for a high-quality owner-approved change. These extend, but must never weaken or contradict, the current [upstream contributing guide](https://github.com/Psysonic/psysonic/blob/main/CONTRIBUTING.md), [frontend tests guidance](https://github.com/Psysonic/psysonic/blob/main/src/test/README.md) and [upstream CI](https://github.com/Psysonic/psysonic/tree/main/.github/workflows). Verify the live versions every time.

## What a great result requires (check against the actual change)

1. **Scope / reviewability:** one coherent user problem, owner-approved behavior, explicit inclusions/exclusions, safe rollback, minimal unrelated diffs.
2. **Correctness / regression:** positive/negative cases, malformed/missing data, paginated search, mixed-server and large-library behavior; preserve canonical Navidrome tags, backwards compatibility and per-device queue isolation.
3. **Architecture / maintainability:** obey React feature-folder layering, dependency-cruiser guard, no new cycles, localized strings (English baseline), Rust/TypeScript Tauri command/event/payload contracts, additive API changes where possible. No undocumented settings or SQLite migration breakage.
4. **End-user quality of life:** stable album/track sorting and navigation, no lost scroll/selection, accessible interactions and keyboard usage, clear error/failure behavior, consistent themes, no jank or unnecessary data churn. Prefer evolutionary UX; describe the user-visible before/after flow.
5. **Measured performance:** classify the runtime benchmark; for required benchmarks compare same machine/library/scenario/profile and same cold/warm run count on **base SHA** vs **candidate SHA**. Include query plans/lock behavior where SQLite paths change, and show variance rather than claiming every small delta is real.
6. **Tests / CI:** run applicable checks locally, report exact results and gaps, use latest-head CI for actual PR readiness; don't transfer green status from an old SHA or a different operating system.
7. **Independent adversarial review:** significant checkpoints get a **read-only** Claude Code review through the owner's PowerShell CLI workflow, pinned to exact SHA with security, UX, performance, negative cases, findings and decisions. Any code change after review requires assessing/repeating exact-head review.
8. **Documentation / handoff:** describe functionality, API/settings/migration consequences, manual reproduction, benchmark evidence, open risks and next action; update the project hub truthfully.
9. **Owner gates:** obtain owner approval for significant choices, work expansion, PR creation, merge/release or destructive/privileged effects; passing tests does not provide any of those authorizations.

**Past example to emulate:** [#1712 mood-state reconciliation](https://github.com/Psysonic/psysonic/pull/1712) combined semantic correctness (native/canonical fallback across sparse tags), regression tests, SQLite consistency, and perf-minded implementation changes. For Explorer, the analogous evidence includes AND/OR truth tables, pagination and track/album parity, playlist actions, cache invalidation, large-library SQL plans, UI scroll/session behavior, and stable runtime benchmarks.

## Applicability-driven local checks

**Frontend from repository root** (after setup; consult current package.json and CONTRIBUTING):

~~~powershell
npm run prebuild:release-notes
npx tsc --noEmit
npm run lint
npm run dep:check
npm test
npm run test:coverage
npm run build
~~~

Use npm ci for reproducibility as needed; upstream CI has its own defined commands. prebuild generates settingsSearchIndex and release metadata; do not misdiagnose a missing generated module as a feature regression without checking generation first. Other frontend checks such as npm run check:css-imports and npm run dep:check:barrels are embedded in current npm test. Check test/coverage and bundling workflows when relevant.

**Rust / Tauri** from src-tauri (and relevant local build setup):

~~~powershell
cargo test --workspace --all-targets
cargo clippy --workspace --all-targets -- -D warnings
~~~

For changes touching both layers, run both sets and update Tauri mocks/TS callers. CI is path-filtered; upstream ci-ok aggregates the required jobs. Check the real workflow and **exact head**, not an assumed static set. A Windows WSL/bash absence during Flatpak shell validation is an environment problem to document and verify on Linux CI, **not** a waiver of the test.

**Manual smoke, targeted by change:** connect to test server(s), use large and small collections, browse/search/filter/sort, navigate back/forward retaining scroll/selection, exercise keyboard/context menu, playlist updates, re-login/resync, library/server capability absence, cold/warm load and unexpected network failure. Explicitly run independent queue startup-order regression if playback synchronization is affected.

## Runtime benchmarking rule (taken from upstream guidance)

Every intended upstream PR says exactly one of: **Runtime benchmark: required**, **Runtime benchmark: smoke**, or **Runtime benchmark: not applicable — reason**. For Explorer/query/navigation changes the correct default is **required**. Minimum upstream run count is 2 (first/warm); for Explorer experiments the owner has previously discussed 5 realistic runs and 2/5/10-tag OR/AND Albums/Tracks scenarios. Do not claim those scenarios are finished until exact outputs are captured.

Upstream Windows/macOS dev recipe: close the desktop application; start only the frontend development server in one terminal and run the CLI from another:

~~~powershell
npm run dev
~~~

~~~powershell
cargo run --manifest-path src-tauri/Cargo.toml --bin psysonic -- benchmark run --scenario all-pages --runs 5 --profile realistic --json
~~~

Confirm the CLI and scenario exist on the **chosen commit**. The upstream minimum example is core-pages, 2 runs; choose all-pages when broad Explorer routes or neighboring areas are affected. Capture separate base/head JSON and use matching controls; maintain a local copy of detailed library-dependent results and summarize sanitized values in a PR. Do not commit server addresses, track identifiers, personal library names or private benchmark data.

An isolated **read-only disposable-DB diagnostic probe** (Slice 0B) helps identify hotspots; it is **not a substitute** for a genuine user-facing base-vs-head runtime benchmark.

## Mandatory reviewer and PR-ready report

The report must contain: **goal and approved spec; exact repo/base/head SHAs; changed paths; UI and API contract impacts; test commands/results and missing checks; measured before/after performance or reason N/A; independent review SHA/verdict/findings/dispositions; user smoke results; compatibility risks; rollback; open owner decisions**.

If anything relevant remains unverified, mark the state **NOT READY / pending** rather than silently lowering criteria. For governance/doc-only updates, source-link validation, branch isolation, link checks and owner policy ratification replace code/test/benchmark gates.
