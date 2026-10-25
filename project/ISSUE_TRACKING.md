# Psysonic public GitHub Issues — tracking conventions

**Owner decision:** [D-013](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/DECISIONS.md), 2026-10-24. The fork remains public; Issues are enabled, with one [living handoff issue #1](https://github.com/Puppies-On-Acid/psysonic/issues/1). This document complements [AGENTS.md](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/AGENTS.md) and [QUALITY_GATES.md](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/QUALITY_GATES.md); it never authorizes product work.

## Where each kind of truth belongs

| Record | Authority / update behavior |
| --- | --- |
| [Issue #1 — living handoff](https://github.com/Puppies-On-Acid/psysonic/issues/1) | **Single source for current priority, verified checkpoint, blockers, applicable SHAs and immediate next action.** Update on meaningful changes during user-initiated sessions. |
| Numbered GitHub work issues | Each task's scope, known evidence, acceptance gates, review findings and next decision. Issue creation or a checklist is NOT implementation approval. |
| [WORKSTREAMS.md](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/WORKSTREAMS.md) | Stable PSY IDs, brief lifecycle context and links to current work issues; not duplicate detailed issue checklists. |
| [AGENTS.md](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/AGENTS.md), [QUALITY_GATES.md](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/QUALITY_GATES.md) | Owner-ratified policy; changes require explicit approval. |
| [DECISIONS.md](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/DECISIONS.md) | Explicit owner decisions; append/supersede with clear authority, do not infer approval from issue text. |
| [HISTORY.md](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/HISTORY.md) | Durable, dated evidence and important changes, append-only. |
| [STATUS.md](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/STATUS.md) | Stable redirect only. [Pre-migration snapshot](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/archive/STATUS_2026-10-24-pre-issues.md) is archival, not current. |

## Initial issue registry (2026-10-24)

| Issue | Workstream | Purpose |
| --- | --- | --- |
| [#1](https://github.com/Puppies-On-Acid/psysonic/issues/1) | All | Living project handoff (one current status) |
| [#2](https://github.com/Puppies-On-Acid/psysonic/issues/2) | PSY-002/003 | Genre/Mood Explorer and Genre Tracks coordinated readiness |
| [#3](https://github.com/Puppies-On-Acid/psysonic/issues/3) | PSY-008 | Approved read-only diagnostic review and owner decision |
| [#4](https://github.com/Puppies-On-Acid/psysonic/issues/4) | PSY-003 | Genre Tracks upstream/source/test reconciliation |
| [#5](https://github.com/Puppies-On-Acid/psysonic/issues/5) | PSY-009 | Formal base-vs-head runtime benchmarks |
| [#6](https://github.com/Puppies-On-Acid/psysonic/issues/6) | PSY-010 | Exact-head CI, docs, independent review, PR permission |
| [#7](https://github.com/Puppies-On-Acid/psysonic/issues/7) | PSY-004 | Context-menu lyrics contribution candidate |
| [#8](https://github.com/Puppies-On-Acid/psysonic/issues/8) | PSY-005 | Playlist membership contribution candidate |
| [#9](https://github.com/Puppies-On-Acid/psysonic/issues/9) | PSY-007 | Window-kind refactor review |
| [#10](https://github.com/Puppies-On-Acid/psysonic/issues/10) | PSY-013 | Queue independence **unconfirmed regression watch** |
| [#11](https://github.com/Puppies-On-Acid/psysonic/issues/11) | PSY-006 | Explorer UI / Mood auto-refresh **unconfirmed watch** |

For already **upstream-merged** PSY-001 contributions, refer directly to their upstream PRs in WORKSTREAMS; do not duplicate completed issues simply for a local count. PSY-011 weighted sorting is deferred, not authorized; no active work issue is warranted yet. These are markdown cross-references; they are **not claimed to be native GitHub parent/sub-issue relations** (the available GitHub connector cannot set native sub-issue relationships).

## Creating/updating a work issue

- Use a concise title with stable **PSY-###** initiative ID. Mention links to [#1](https://github.com/Puppies-On-Acid/psysonic/issues/1), relevant parent coordination issues, approved decisions and the exact candidate branch/commit where available.
- Distinguish **proposed**, **owner-approved scope**, **implementation authorized**, **code present**, **latest-head tests/CI**, **manual validation**, **before/after benchmarked**, **independent review**, **PR permitted**, and **upstream merged**. Being on an issue does not imply permission to advance state.
- Record acceptance tests as targeted checkboxes only when applicable. Do not claim a checkbox passed without whole-criterion evidence. Owner signoff controls substantive closure/acceptance. Use factual updates during user-initiated sessions only.
- Include reproduction steps, negative cases, performance/architecture/UX implications, verification command and date, exact SHA, unresolved blockers, and one next action. Link existing upstream PRs and avoid already-merged or duplicate work.
- For unconfirmed bugs, say **watch / needs reproduction**; do not automatically escalate to an upstream bug or start coding. For future feature ideas, record in a deferred section without inventing authorization.
- On significant checkpoint: update the specific issue, summarize the consequential change in #1, and append HISTORY when permanent evidence warrants it. Update WORKSTREAMS only when lifecycle/linkage changes; do not copy all task prose into markdown.
- Treat fork GitHub Issues and document branch as **public**. Exclude credentials, tokens, server URLs, private logs, raw library names/identifiers, account data and live database dumps. Use anonymized aggregate results and link sanitized test evidence.
- A docs/status issue does not change upstream CONTRIBUTING requirements or owner restrictions. **Never open a PR, merge, delete/rewrite a branch, run destructive tests or deploy without explicit owner direction.**

## Suggested future issue template (manual, no code-branch change)

```md
# Goal and user impact
# Approved scope / exclusions and owner decision
# Branch, exact baseline/head SHA and upstream overlap
# Acceptance criteria: correctness, negative path, UX, performance, compatibility
# Evidence: tests/CI, manual reproduction, benchmark applicability/results, read-only review
# Risks, blockers, approvals required
# Next action
```

**GitHub default-branch note:** custom issue templates under `.github/ISSUE_TEMPLATE` would ordinarily need to exist on repository default `main` to appear in the issue-creation UI. This project hub deliberately remains on its own docs branch; do not merge it into main simply to provide templates.
