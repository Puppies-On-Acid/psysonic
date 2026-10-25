# Psysonic owner decision register

Record the decision, what it authorizes, what it **does not** authorize, date, and source. Historic items below are based on explicit owner directions in prior project chats and/or verifiable GitHub state, not made-up GitHub approvals. A future material decision should receive an explicit owner response and be recorded here with its GitHub/commit/spec reference. **Only the owner can approve or supersede these decisions.**

| ID | Date | Decision | Status and limits |
| --- | --- | --- | --- |
| D-001 | 2026-10-24 | Restrict this ChatGPT project to **Psysonic development**; put independent Navidrome/Spindle/Picard/other work in other projects. | **Owner-directed.** Integrations may be tested only insofar as Psysonic needs them. Chat moves are manual. |
| D-002 | 2026-10-24 | Maintain a separate docs-only governance and running-tally branch; suggested name **meta/project-hub**. | **Owner-approved and ratified 2026-10-24** (D-012). Never merge automatically into personal/integration. |
| D-003 | Standing | Do **not** open a Psysonic upstream PR without first asking the owner; owner generally submits PRs personally. | **Approved owner constraint.** May edit existing PR only upon express request. No automatic merge, release, branch rewrite/deletion. |
| D-004 | Standing | personal/integration is the daily-drive/test integration surface; preserve historical/feature/backup branches pending approval. | **Owner-directed.** Never confuse integrated changes with upstream merge or full PR readiness. |
| D-005 | Oct 2026 | Explorer supports multi-selection, AND/OR, both Albums/Tracks, playlist interactions, search/sorting and browse scroll restoration; weighted sort is later. | **Approved feature direction.** The upstream catalog search/sort foundation [#1733](https://github.com/Psysonic/psysonic/pull/1733) merged; additional Explorer features remain fork-specific. |
| D-006 | 2026-10-17 onward | Benchmark Explorer before final documentation/PR; investigate regressions rather than treating a passing build as sufficient. | **Owner-directed.** Specific regression remediation requires scoped approval; no invented perf target. |
| D-007 | 2026-10-23 | Integrate Explorer, Genre Tracks and existing approved local enhancements into personal/integration for daily-driver testing, preserving source feature branches. | **Owner-directed/implemented on fork.** Does not authorize PR opening. |
| D-008 | 2026-10-23 | Build combined Genre Tracks + Genre/Mood Explorer from upstream while preserving originals, excluding unrelated lyrics/playlist work from its standalone PR scope. | **Owner-directed.** Do not silently broaden a future Explorer PR based on what daily integration happens to contain. |
| D-009 | 2026-10-24 | Explorer Optimization Plan v1.1: **Slice 0A correctness oracle + Slice 0B read-only diagnostic probe** on disposable SQLite copy only. | **Approved limited diagnostic scope.** No live DB changes, production optimization, schema/UX changes, merge or PR. Must return with findings before next authorization. |
| D-010 | 2026-10-24 | GitHub Issues are disabled on personal fork, so versioned STATUS.md will be the sole living handoff initially. | **Owner ratified this initial versioned-handoff approach 2026-10-24** (D-012). Do not change Issues setting or invent an issue number. |
| D-011 | Standing | Keep **Play Queue Sync disabled** behavior independent between devices; do not allow the phone to overwrite desktop queue solely due to start order. | **Owner goal**; upstream [#1732](https://github.com/Psysonic/psysonic/pull/1732) merged, but reproduce a remaining scenario before claiming defect resolved. |
| D-012 | 2026-10-24 | Ratify **Psysonic Project Hub v0.1**, including the **meta/project-hub** branch name, docs-only structure, governance in AGENTS.md, evaluation standards in QUALITY_GATES.md, and permission for factual status, workstream, and history updates during active work. | **Explicit owner approval in this ChatGPT project conversation.** Governance/quality policy or scope changes still require separate approval. Does not authorize application code changes, PR creation or merge, branch deletion/rewrite, live-system operations, or changes to GitHub Issues settings. |

## Initial hub v0.1 ratified — 2026-10-24 (D-012)

- [x] Owner approves branch name **meta/project-hub** and docs-only lifecycle.
- [x] Owner approves factual STATUS/WORKSTREAMS/HISTORY updates during active sessions without separate permission; governance/decisions/code/PR changes still require explicit direction.
- [x] Owner confirms this project is Psysonic-only and independent server/plugin topics move elsewhere.
- [x] Owner approves the evaluation and independent-review requirements in QUALITY_GATES.md.
- [ ] **Optional future decision, not approved or required for v0.1:** whether to enable GitHub Issues and relocate the single living handoff.

The approval ratifies project documentation and factual bookkeeping only. It does **not** grant additional repository administration, PR, engineering-change, merge or deployment authorization.
