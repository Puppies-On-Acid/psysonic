# How to use this hub without disturbing Psysonic code branches

The meta/project-hub branch is intentionally documentation-only and is anchored to the fork's historical main. It is **not** the source branch for regular builds or PRs. GitHub and Git clients will not automatically show its AGENTS.md while another branch (such as personal/integration) is checked out.

## In a new ChatGPT Psysonic conversation

The ChatGPT project instructions should direct the assistant to read the **latest branch-specific** AGENTS.md, [single live handoff issue #1](https://github.com/Puppies-On-Acid/psysonic/issues/1), WORKSTREAMS.md, DECISIONS.md, and upstream CONTRIBUTING.md; then verify current GitHub SHA/PR/CI state. STATUS.md is a **redirect** to #1, not a second living handoff. The issue itself is a navigation aid, not immutable truth. Independent chats about Navidrome, AudioMuse, Picard, Spindle or genre synthesis belong in other projects unless the task is specifically a Psysonic integration.

## In your local PowerShell (no branch checkout needed)

From your local Psysonic repository:

~~~powershell
cd D:\Projects\psysonic
git fetch origin meta/project-hub
git show origin/meta/project-hub:AGENTS.md
git show origin/meta/project-hub:project/STATUS.md # points to living issue #1
git show origin/meta/project-hub:project/WORKSTREAMS.md
~~~

Those commands display docs while leaving the checked-out development branch alone. If another AI tool is running from personal/integration, **explicitly provide the hub URL or direct it to git show**; it will not automatically discover an AGENTS.md that only exists on the hub branch. A GitHub link to the hub is also sufficient for connected assistants with repository access.

## How to update progress

At the end of a meaningful session, reconcile live GitHub, update **handoff issue #1** only for current verified checkpoint/next action and update **the relevant numbered work issue** for task-level evidence. Update WORKSTREAMS only when broad lifecycle/index links change; append HISTORY for substantive permanent checkpoints; add explicit owner-approved decisions to DECISIONS. Governance changes in AGENTS.md/QUALITY_GATES require approval. The `meta/project-hub` branch remains documentation-only; never make a code PR or merge into integration merely for tracker bookkeeping.

GitHub Issues are now enabled on this **public** repository and the owner explicitly approved the single authoritative handoff [#1](https://github.com/Puppies-On-Acid/psysonic/issues/1). The older full STATUS snapshot is [archived](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/archive/STATUS_2026-10-24-pre-issues.md); never maintain two competing live status records. Existing source/feature branches remain untouched. Issue #1 can be pinned manually in GitHub's interface if the owner wishes; pinning is not required for authority.
