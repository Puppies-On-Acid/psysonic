# Workstreams and running work tally

**Maintenance rule:** this is a durable index of PSY workstream identifiers and broad lifecycle states. [GitHub handoff #1](https://github.com/Puppies-On-Acid/psysonic/issues/1) is the **one** authority for immediate priority and checkpoint; **linked work issues** track open gates and evidence. Do not mirror their detailed changing checklists here. A row can be upstream-merged while a narrower regression watch remains open; verify exact commits and record who/when. [Issue tracking conventions](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/ISSUE_TRACKING.md).

| ID | Initiative | Verified delivery / present state | Remaining work / constraints |
| --- | --- | --- | --- |
| PSY-001 | Native mood ingestion and mood browsing | Upstream [#1675](https://github.com/Psysonic/psysonic/pull/1675), [#1697](https://github.com/Psysonic/psysonic/pull/1697), [#1712](https://github.com/Psysonic/psysonic/pull/1712), [#1685](https://github.com/Psysonic/psysonic/pull/1685) **merged** | Monitor real-library behavior, preserve sparse-tag reconciliation, avoid redundant follow-up |
| [PSY-002](https://github.com/Puppies-On-Acid/psysonic/issues/2) | Genre/Mood Explorer multi-select | Fork code integrated into personal/integration; search/sorting foundation [#1733](https://github.com/Psysonic/psysonic/pull/1733) **merged upstream** | Finish performance work/benchmarks, independent review, identify minimum standalone PR; no PR opened |
| [PSY-003](https://github.com/Puppies-On-Acid/psysonic/issues/4) | Genre Tracks | Fork feature and combined branches retained; integrated into personal/integration | Reconfirm upstream overlap and benchmark paginated browse; do not delete feature branches |
| [PSY-004](https://github.com/Puppies-On-Acid/psysonic/issues/7) | Context-menu lyrics | Separate feature branch + integrated daily-driver behavior; owner manual tests passed on earlier build | Targeted integrated regression tests, isolate PR if owner chooses |
| [PSY-005](https://github.com/Puppies-On-Acid/psysonic/issues/8) | Track playlist membership UI | Feature branch + integrated daily-driver behavior | Upstream compatibility and performance checks, owner PR decision |
| [PSY-006](https://github.com/Puppies-On-Acid/psysonic/issues/11) | Scroll, selection toolbar and navigation polish | Feature changes and tests integrated; previous owner smoke passed | Regression on latest integration and prior Moods auto-refresh report |
| [PSY-007](https://github.com/Puppies-On-Acid/psysonic/issues/9) | Centralized window-kind logic | Refactor branch and integration commit be6b1eaf3da07583998193ec8aa0fae92e338906 | Separate review/PR decision, verify tests and i18n unaffected |
| [PSY-008](https://github.com/Puppies-On-Acid/psysonic/issues/3) | Optimization Plan v1.1 Slice 0A correctness / 0B disposable-DB probe | Owner approved 2026-10-24; correctness oracle and five-run probe matrix reported complete locally | Review and verify local evidence as needed; **no production optimization or PR authorization** |
| [PSY-009](https://github.com/Puppies-On-Acid/psysonic/issues/5) | Explorer benchmark program | Plan and benchmark routes exist, formal before/after still **pending** | Exact-base/head comparable runs incl. 2/5/10 tags, OR/AND, Albums/Tracks, cold/warm |
| [PSY-010](https://github.com/Puppies-On-Acid/psysonic/issues/6) | Explorer contribution documentation + independent review | Not completed | After perf gate, review and obtain specific owner PR authorization |
| PSY-011 | Weighted sorting | Brainstormed; explicitly postponed | Not authorized to implement |
| PSY-012 | Governance / living handoff | Hub v0.1 owner-ratified (D-012); public [Issue #1](https://github.com/Puppies-On-Acid/psysonic/issues/1) tracking migration owner-authorized (D-013) | Keep a single live handoff and the project hub current; continue factual maintenance |
| [PSY-013](https://github.com/Puppies-On-Acid/psysonic/issues/10) | Queue independence regression watch | [#1732](https://github.com/Psysonic/psysonic/pull/1732) merged upstream | Recheck device-order case if reproducible; do not assume merged == fixed in every configuration |

## Explorer / Genre Tracks live verification gates

The **current**, individually evidence-bearing checkpoints are in [Explorer parent issue #2](https://github.com/Puppies-On-Acid/psysonic/issues/2), [diagnostics review #3](https://github.com/Puppies-On-Acid/psysonic/issues/3), [Genre Tracks #4](https://github.com/Puppies-On-Acid/psysonic/issues/4), [formal benchmarks #5](https://github.com/Puppies-On-Acid/psysonic/issues/5), [PR readiness #6](https://github.com/Puppies-On-Acid/psysonic/issues/6), and [UX watch #11](https://github.com/Puppies-On-Acid/psysonic/issues/11). Do not check off work in two places or infer PR authorization from an issue title.

Earlier owner-reported successful multi-select, playlist-action, toolbar and browse-scroll tests are preserved in [HISTORY](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/HISTORY.md) and the [pre-migration STATUS archive](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/archive/STATUS_2026-10-24-pre-issues.md); they do not substitute for final candidate-SHA test, benchmark or independent-review evidence.

## Track future ideas without implying authorization

New Roon/Plex-inspired suggestions, weighted ranking, unconfirmed bugs or tuning experiments are **ideas**, not a committed backlog. When a concept becomes actionable, create a new PSY workstream entry only with: stated user problem, accepted scope, user decision, priority, success tests, and whether an upstream issue/PR exists. Avoid burying decisions in a long chat transcript.

## Branch retention note

Preserve personal/integration-old, backup/genre-mood-explorer-pre-rebase-20261022, feat/genre-mood-explorer, feat/genre-mood-explorer-genre-tracks, feat/genre-tracks, feat/song-lyrics-context-dialog, feature/track-playlist-membership, and refactor/centralize-window-kind-detection until an explicit owner-requested cleanup. "Contains related changes" does not prove safe-to-delete equivalence after rebases.
