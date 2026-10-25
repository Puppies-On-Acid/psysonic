# Psysonic work history — durable checkpoint ledger

**Rule:** append dated, source-attributed checkpoints; use explicit evidence labels and do not overwrite the past when a later bug/regression appears. This is not the live priority list; see [STATUS](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/STATUS.md). PR mergers listed here were verified on GitHub on 2026-10-24.

| Date | Event / evidence | Verification label |
| --- | --- | --- |
| 2026-09-29 | [#1675](https://github.com/Psysonic/psysonic/pull/1675) file mood browsing merged upstream | GitHub merged-state verified |
| 2026-10-01 | [#1697](https://github.com/Psysonic/psysonic/pull/1697) Navidrome-native mood tags merged | GitHub merged-state verified |
| 2026-10-09 | [#1732](https://github.com/Psysonic/psysonic/pull/1732) queues independent when sync disabled merged | GitHub merged-state verified; owner's later device-order concern requires regression check |
| 2026-10-15 to 2026-10-17 | Explorer owner-reported manual tests: multi-select, AND/OR, Albums/Tracks, playlist actions, sticky toolbar and scroll restore | Owner-reported on prior branch head; not latest-head CI |
| 2026-10-21 to 2026-10-23 | Right-click View Song Lyrics function and Explorer owner-reported functional/build success on working branches | Owner-reported manual checks; exact latest-head evidence to refresh |
| 2026-10-23 | [#1712](https://github.com/Psysonic/psysonic/pull/1712) mood reconciliation, [#1685](https://github.com/Psysonic/psysonic/pull/1685) Mood Tracks, [#1733](https://github.com/Psysonic/psysonic/pull/1733) Genres/Moods catalog search/sort merged upstream | GitHub merged-state verified; inspect maintainer edits before backporting/PR |
| 2026-10-23 | personal/integration rebuilt on current-at-time upstream foundation with Explorer/Genre Tracks, lyrics, playlist membership, tab scroll, window refactor and tests; GitHub head [8d4a8dff](https://github.com/Puppies-On-Acid/psysonic/commit/8d4a8dff1551728944ec2052dc02d9c769c2ec7a) | Commit/head verified; prior owner report of app build/manual success is distinct from complete CI/benchmarks |
| 2026-10-24 | Owner approved Optimization Plan v1.1 **Slice 0A/0B only**, with correctness oracle and read-only probes on disposable SQLite copy; no live DB/production optimizer/PR. Subsequent project discussion reported Slice 0A oracle passing 17 cases and five-run Slice 0B probes complete, including rare, deep-page and ten-tag cases. | Owner decision and conversation-reported test outcome; raw local artifacts not independently verified on GitHub |
| 2026-10-24 | Confirmed repository fork main older than upstream main; fork issues disabled. Created docs-only meta/project-hub and initial governance/handoff framework v0.1 | GitHub verified and branch commit; owner ratification was pending at this checkpoint |
| 2026-10-24 | Owner explicitly ratified the Psysonic Project Hub v0.1 branch, documentation structure, governance, quality gates and factual bookkeeping permissions. Recorded as [D-012](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/DECISIONS.md). | Owner approval in this ChatGPT project conversation; docs-only checkpoint, no application-code or PR authorization |

| 2026-10-24 | Owner chose to keep Psysonic fork public and enabled GitHub Issues; expressly authorized tracker/handoff migration (**D-013**). Created [living handoff #1](https://github.com/Puppies-On-Acid/psysonic/issues/1), [Explorer parent #2](https://github.com/Puppies-On-Acid/psysonic/issues/2), and focused issues [#3–#11](https://github.com/Puppies-On-Acid/psysonic/issues); archived former STATUS snapshot, made STATUS a pointer, preserved governance/workstreams/history on `meta/project-hub`. | GitHub verified Issues enabled, issue creation and documentation-only commit; tracker creation does **not** authorize code changes or PRs |
## Carry-forward from the mood reconciliation benchmark experience

Earlier project tests for [#1712](https://github.com/Psysonic/psysonic/pull/1712) combined schema/canonical-state correctness checks, sparse tag upserts/deletes, real-library reconciliation, and performance concerns. New work should retain that model: measurable correctness, explicit edge cases, large-library realism and repeatable benchmarks, not "the screen looked okay" alone. The reported dataset-specific metrics from earlier private testing are intentionally not reproduced publicly here.

## Recording a new checkpoint

Add: **date/timezone; branch and exact SHA; objective; source (PR/commit/run/report); commands and results; owner manual evidence vs assistant independent verification; benchmark applicability/results; unresolved risks; owner decision; next handoff link**. Do not label a checkpoint accepted when only code was committed or an earlier SHA was reviewed.
