# Living handoff — Psysonic project

**Snapshot date:** 2026-10-24, America/Los_Angeles. **Authority:** current status navigator only; live GitHub state and latest explicit owner decisions win over this snapshot. **Hub:** meta/project-hub. **Next update trigger:** meaningful verified progress, new owner approval, upstream change, benchmark evidence, CI/review outcome, or changed next step. Never treat all checkboxes as uncompleted implementation if a row is explicitly labeled completed upstream.

## Current priority and working constraints

**Active priority:** review the results of approved **Explorer Optimization Plan v1.1, Slice 0A/0B diagnostics only** with the owner, then decide whether any scoped optimization should be proposed. Slice 0A builds correctness expectations/oracle; Slice 0B is a read-only performance probe against a **disposable SQLite copy**. Owner approved these diagnostic slices on 2026-10-24. **No production-query optimization, live library/database mutation, new schema, changed UX, PR, or deployment is approved by that plan.** The current GitHub check did not independently establish the local diagnostic files or outputs; recorded observations below are owner/conversation-reported.

**Reported diagnostic progress (2026-10-24):** Slice 0A correctness oracle was reported passing (17 cases), and Slice 0B five-run read-only disposable-copy diagnostics were reported complete: 2-tag OR whole Albums/Tracks medians 1,691/3,704 ms; 5-tag AND 1,391/1,294 ms; 10-tag OR 3,089/4,847 ms; 10-tag AND 1,217/1,421 ms; five rare AND 851/1,071 ms; nonempty 10-tag AND 938/1,132 ms. Deep track pagination was reported at 2,443 to 2,716 ms (offset 0 to 5000), and reference probes at 2,516 to 2,862 ms. **These are owner/conversation-reported local diagnostic results, not independently audited artifacts or the upstream-required base-vs-head runtime benchmark.**

**Owner's explicit development boundaries:** Psysonic only; preserve the existing integration and feature/backup branches; do not create a PR without first asking; do not open an unrelated upstream change while finishing Explorer; complete representative benchmarks before the Explorer PR/docs stage.

## GitHub snapshot — explicitly verify at the start of the next session

| Repository / ref | Observed SHA (2026-10-24 GitHub read) | Interpretation |
| --- | --- | --- |
| [Psysonic/psysonic main](https://github.com/Psysonic/psysonic/tree/main) | f098eb2c861afbcf3352c0e3dcde55341065efa4 | Current upstream baseline at check; may advance |
| [Puppies-On-Acid/psysonic main](https://github.com/Puppies-On-Acid/psysonic/tree/main) | 6aedf91959db9bc07981d028fb0e6c28f2a30af0 | Fork main is older; **not** live upstream |
| [personal/integration](https://github.com/Puppies-On-Acid/psysonic/tree/personal/integration) | 8d4a8dff1551728944ec2052dc02d9c769c2ec7a | Owner's daily-driving integrated code branch |
| [combined Explorer/Genre Tracks](https://github.com/Puppies-On-Acid/psysonic/tree/feat/genre-mood-explorer-genre-tracks) | aa2726aa211434c132f2e11a5263156f726bc903 | Preserve for independent feature preparation |
| [Explorer standalone](https://github.com/Puppies-On-Acid/psysonic/tree/feat/genre-mood-explorer) | e8ac722b178c23428291efa3d7a742594ed0a272 | Preserve until owner says otherwise |
| [personal/integration-old](https://github.com/Puppies-On-Acid/psysonic/tree/personal/integration-old) | f0fb77f592eadd6c4155989f614dc933f35957d0 | Historical safety/reference branch |
| [Explorer backup](https://github.com/Puppies-On-Acid/psysonic/tree/backup/genre-mood-explorer-pre-rebase-20261022) | fd3ad4bdb1de1b2902622c0df6db6225506fa342 | Explicitly preserve |

The independent feature branches (Genre Tracks, lyrics context menu, playlist membership, window-kind refactor) still exist; ancestry comparisons with integration are divergent in places. **Do not infer that a divergent commit count means a feature is absent or that a branch is safe to delete.** Determine functional diffs against current upstream before any PR.

## Completed and upstream-merged contributions (verified by GitHub PR state)

- [x] [#1675 — file mood browsing](https://github.com/Psysonic/psysonic/pull/1675), merged 2026-09-29.
- [x] [#1697 — native Navidrome mood tags](https://github.com/Psysonic/psysonic/pull/1697), merged 2026-10-01.
- [x] [#1732 — independent queues when sync disabled](https://github.com/Psysonic/psysonic/pull/1732), merged 2026-10-09. Regression recheck of the user's device sequence remains desirable; merge does not resolve every observed local scenario by itself.
- [x] [#1712 — reconcile sparse/ambiguous mood tags](https://github.com/Psysonic/psysonic/pull/1712), merged 2026-10-23, with maintainer edits to inspect before any follow-up.
- [x] [#1685 — mood detail track browsing](https://github.com/Psysonic/psysonic/pull/1685), merged 2026-10-23.
- [x] [#1733 — Genres/Moods catalog search and sorting](https://github.com/Psysonic/psysonic/pull/1733), merged 2026-10-23.

Those are **merged upstream**, not outstanding PRs. They do **not** mean every Explorer extension was merged.

## Current fork-only work and pending gates

| ID | Work | Current state | Next evidence/gate |
| --- | --- | --- | --- |
| PSY-002 | Genre/Mood Explorer: multi-tag AND/OR, combined results, track/album selection, playlist actions | Integrated into personal/integration; prior owner manual functionality checks reported passing | Complete diagnostic/performance gate, compare current upstream, independent review, seek PR permission |
| PSY-003 | Genre Tracks detail browse/pagination, sessions and caching | On feature branches and integration; integrated code present | Verify current upstream overlap, cross-branch parity, benchmarks and PR scope |
| PSY-004 | Right-click **View Song Lyrics** | Integrated into personal/integration; earlier build/manual checks reported passing | Confirm integration regressions and isolate possible upstream PR |
| PSY-005 | Playlist membership column/access | Integrated in personal/integration | Regression checks, assess standalone upstream PR and benchmarks |
| PSY-006 | Independent tab scroll state; sticky toolbar; Explorer usability polish | Integrated; owner reported correct navigation/scroll behavior previously | Check latest integration and auto-refresh interaction |
| PSY-007 | Centralize window-kind detection | Refactor integrated into personal/integration | Check import/contracts/tests before separate PR decision |
| PSY-008 | Explorer Optimization Plan v1.1: Slice 0A/0B only | Owner-approved diagnostics, reported complete locally; no diagnostic artifacts independently verified on GitHub | Review correctness and performance findings with owner **before proposing optimization** |
| PSY-009 | Formal Explorer/Genre Tracks runtime benchmarks | **Deferred / not completed** as upstream PR-quality gate | Repeatable main-vs-feature head comparisons, including multi-tag OR/AND and Albums/Tracks |
| PSY-010 | Explorer docs, exact-head CI/review, PR package | **Pending** | Complete after correctness/perf findings and seek owner approval for PR |
| PSY-011 | Weighted sorting idea | **Deferred and NOT authorized for implementation** | Revisit only on owner direction after current discovery work |
| PSY-012 | Project governance/handoff setup | Hub branch created; initial v0.1 documentation committed separately | Owner ratifies governance/branch choice and past-work inventory |

## Known watch items (not all are active confirmed defects)

- Independent queue semantics must remain per-device when Play Queue Sync is disabled. Reproduce reported Resonus-first startup case before classifying it as a present bug; compare upstream #1732 and current source.
- A prior report of Moods refreshing and losing scroll state should be checked on current integration before claiming it is still present.
- [Upstream #1750 — FLAC seek stops playback](https://github.com/Psysonic/psysonic/issues/1750) is **closed** and was not reproduced in the owner's environment at prior check; retain as historical watch only, not an open assigned bug.
- Test-environment note: the Windows npm test suite previously encountered a WSL /bin/bash absence in Flatpak Bash-syntax validation. Diagnose as environment limitation when encountered; get equivalent Linux CI evidence before claiming a full pass.
- Branches may have rebases, maintainer adaptations or commits newer than this handoff. Current behavior and commit graph must be rechecked before cleanup or upstream PR planning.

## Next action (one action, no implied permission)

**Present and review the reported completed Slice 0A/0B diagnostic matrix** and correctness oracle, identify material query hotspots, and offer only scoped optimization options for explicit owner approval. Ask for missing local files/output if independent verification is needed. Do **not** implement an optimization merely because the probe suggests a hotspot.

After that, the pending sequence is: approve specific optimization if justified → implement/test only approved work → formal baseline-vs-head Explorer benchmarks → document UX and tests → independent read-only Claude Code review at exact SHA → ask the owner before opening any PR.

### How this handoff stays reliable

Each material update must retain dates, source URLs, last verified SHA and any missing evidence. Move work from pending to completed only for its **specific** gate. Never conflate an upstream merge with full owner manual QA, or a local build with CI, or an approved diagnostic with authorization to change production code. Update WORKSTREAMS for milestone transitions, HISTORY for durable checkpoints, and DECISIONS only for explicit owner-approved changes.
