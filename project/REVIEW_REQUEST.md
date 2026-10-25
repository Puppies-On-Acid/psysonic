# Reusable independent code review request — Claude Code (read only)

Prepare a self-contained, **copy/paste** prompt for the owner's Claude Code PowerShell workflow only after collecting the **actual** target and baseline SHAs. Never send a literal placeholder as if it were a verified value. A ChatGPT self-check is not independent reviewer evidence.

~~~text
Review Psysonic implementation, READ ONLY. DO NOT write or format files,
apply fixes, create commits, modify GitHub issues/PRs, change branches,
merge, delete anything, deploy, or perform any privileged/live-library action.

Repository: Puppies-On-Acid/psysonic (official upstream: Psysonic/psysonic).
Target branch: <exact owner-selected code branch>.
Exact target HEAD SHA: <40-character SHA checked live>.
Exact comparison baseline SHA: <40-character base checked live>.
Approved scope: <owner-confirmed feature/spec and exclusions>.
Relevant upstream PRs/source changes: <links and dates>.
Changed files/callers/contracts to inspect: <list>.
Reported checks (not claims of independent review): <command, env, outcome, URLs>.
Runtime benchmark: <required/smoke/N/A, exact baselines/scenarios/results or gaps>.
Known risks and negative paths: <list>.

First read upstream CONTRIBUTING.md and project governance from the
meta/project-hub branch (AGENTS.md and project/QUALITY_GATES.md),
then independently verify live GitHub refs and the actual diff. Do not
assume that AGENTS.md exists in this code checkout.

Give:
1. Exact SHA and scope verification; changed file and upstream-delta summary.
2. Findings ordered Critical/High/Medium/Low/Info with file:line evidence,
   reproducible failure scenario, user impact and proposed correction.
3. Missing tests, performance risks, Tauri contract/SQLite/caching risks,
   accessibility/i18n concerns, and any scope creep.
4. Separate verdicts: correctness, regression/architecture, performance,
   security where applicable, and readiness for PR review.
5. Verified checks vs unverified assertions, unresolved issues and
   conditions for acceptance. No implementation or edits.
~~~

The owner returns Claude's report. Compare review target to live HEAD; if the code changes, new findings or a new SHA require reassessment. Prepare a **new** request referencing exact SHA and previous findings instead of assuming the prior approval carries forward.
