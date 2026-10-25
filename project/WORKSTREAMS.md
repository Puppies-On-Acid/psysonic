# Workstreams and running work tally

**Maintenance rule:** this is the index of initiatives; [STATUS](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/STATUS.md) is authoritative for *immediate* next action and live SHAs. A row can be "upstream merged" while a narrower regression watch remains open. Record who/when verified, rather than using a global "done" flag.

| ID | Initiative | Verified delivery / present state | Remaining work / constraints |
| --- | --- | --- | --- |
| PSY-001 | Native mood ingestion and mood browsing | Upstream [#1675](https://github.com/Psysonic/psysonic/pull/1675), [#1697](https://github.com/Psysonic/psysonic/pull/1697), [#1712](https://github.com/Psysonic/psysonic/pull/1712), [#1685](https://github.com/Psysonic/psysonic/pull/1685) **merged** | Monitor real-library behavior, preserve sparse-tag reconciliation, avoid redundant follow-up |
| PSY-002 | Genre/Mood Explorer multi-select | Fork code integrated into personal/integration; search/sorting foundation [#1733](https://github.com/Psysonic/psysonic/pull/1733) **merged upstream** | Finish performance work/benchmarks, independent review, identify minimum standalone PR; no PR opened |
| PSY-003 | Genre Tracks | Fork feature and combined branches retained; integrated into personal/integration | Reconfirm upstream overlap and benchmark paginated browse; do not delete feature branches |
| PSY-004 | Context-menu lyrics | Separate feature branch + integrated daily-driver behavior; owner manual tests passed on earlier build | Targeted integrated regression tests, isolate PR if owner chooses |
| PSY-005 | Track playlist membership UI | Feature branch + integrated daily-driver behavior | Upstream compatibility and performance checks, owner PR decision |
| PSY-006 | Scroll, selection toolbar and navigation polish | Feature changes and tests integrated; previous owner smoke passed | Regression on latest integration and prior Moods auto-refresh report |
| PSY-007 | Centralized window-kind logic | Refactor branch and integration commit be6b1eaf3da07583998193ec8aa0fae92e338906 | Separate review/PR decision, verify tests and i18n unaffected |
| PSY-008 | Optimization Plan v1.1 Slice 0A correctness / 0B disposable-DB probe | Owner approved 2026-10-24; correctness oracle and five-run probe matrix reported complete locally | Review and verify local evidence as needed; **no production optimization or PR authorization** |
| PSY-009 | Explorer benchmark program | Plan and benchmark routes exist, formal before/after still **pending** | Exact-base/head comparable runs incl. 2/5/10 tags, OR/AND, Albums/Tracks, cold/warm |
| PSY-010 | Explorer contribution documentation + independent review | Not completed | After perf gate, review and obtain specific owner PR authorization |
| PSY-011 | Weighted sorting | Brainstormed; explicitly postponed | Not authorized to implement |
| PSY-012 | Governance / living handoff | **Hub v0.1 owner-ratified 2026-10-24**; documentation-only branch and decision/quality framework approved (D-012) | Ongoing factual maintenance; verify existing historical entries against live evidence as needed |
| PSY-013 | Queue independence regression watch | [#1732](https://github.com/Psysonic/psysonic/pull/1732) merged upstream | Recheck device-order case if reproducible; do not assume merged == fixed in every configuration |

## Workstream PSY-002 / PSY-003 — evaluation inventory

These are feature checks discussed and/or owner-smoked on prior branches, **not** a claim that every item was independently rerun on today's latest SHA:

- [x] Multi-tag Genre and Mood selection, AND/OR combination and Albums/Tracks browsing — prior owner manual validation on Explorer branch.
- [x] Track selection and add-to-playlist flows, sticky Select toolbar, title alignment — prior owner manual validation.
- [x] Independent browse-tab scroll restoration — prior owner manual validation.
- [x] Joined code present in personal/integration after October 23 integration rebuild — GitHub commit evidence.
- [ ] Reconfirm combined functionality on the **current feature PR candidate head** (select exact branch/SHA).
- [x] Complete approved read-only diagnostics — **owner/conversation-reported**, not yet independently reproduced from raw artifacts (PSY-008).
- [ ] Review diagnostic findings, confirm target SQL plans and risks, and explicitly decide whether optimization should begin.
- [ ] Obtain owner approval before any production query optimization.
- [ ] Execute and analyze **formal upstream-prescribed runtime benchmark** (PSY-009).
- [ ] Capture exact-head type/lint/dependency/frontend/Rust/coverage/CI evidence as applicable.
- [ ] Obtain independent Claude Code review of final candidate SHA.
- [ ] Obtain explicit owner authorization **before** opening a new Psysonic upstream PR.
- [ ] Prepare user-facing docs and PR description based on final approved functionality.

## Track future ideas without implying authorization

New Roon/Plex-inspired suggestions, weighted ranking, unconfirmed bugs or tuning experiments are **ideas**, not a committed backlog. When a concept becomes actionable, create a new PSY workstream entry only with: stated user problem, accepted scope, user decision, priority, success tests, and whether an upstream issue/PR exists. Avoid burying decisions in a long chat transcript.

## Branch retention note

Preserve personal/integration-old, backup/genre-mood-explorer-pre-rebase-20261022, feat/genre-mood-explorer, feat/genre-mood-explorer-genre-tracks, feat/genre-tracks, feat/song-lyrics-context-dialog, feature/track-playlist-membership, and refactor/centralize-window-kind-detection until an explicit owner-requested cleanup. "Contains related changes" does not prove safe-to-delete equivalence after rebases.
