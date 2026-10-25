# How to use this hub without disturbing Psysonic code branches

The meta/project-hub branch is intentionally documentation-only and is anchored to the fork's historical main. It is **not** the source branch for regular builds or PRs. GitHub and Git clients will not automatically show its AGENTS.md while another branch (such as personal/integration) is checked out.

## In a new ChatGPT Psysonic conversation

The ChatGPT project instructions should direct the assistant to read the **latest branch-specific** AGENTS.md, STATUS.md, WORKSTREAMS.md, DECISIONS.md, and upstream CONTRIBUTING.md; then verify current GitHub SHA/PR/CI state. A living handoff is a navigation aid, not immutable truth. Independent chats about Navidrome, AudioMuse, Picard, Spindle or genre synthesis belong in other projects unless the task is specifically a Psysonic integration.

## In your local PowerShell (no branch checkout needed)

From your local Psysonic repository:

~~~powershell
cd D:\Projects\psysonic
git fetch origin meta/project-hub
git show origin/meta/project-hub:AGENTS.md
git show origin/meta/project-hub:project/STATUS.md
git show origin/meta/project-hub:project/WORKSTREAMS.md
~~~

Those commands display docs while leaving the checked-out development branch alone. If another AI tool is running from personal/integration, **explicitly provide the hub URL or direct it to git show**; it will not automatically discover an AGENTS.md that only exists on the hub branch. A GitHub link to the hub is also sufficient for connected assistants with repository access.

## How to update progress

At the end of a meaningful session, reconcile with GitHub and edit **STATUS.md** only for the latest owner decisions/checked evidence and next action. Edit WORKSTREAMS for accepted or changed initiative milestones and append HISTORY only when a real checkpoint occurred. Governance changes in AGENTS.md and QUALITY_GATES require owner approval. All edits are confined to the **meta/project-hub** branch and its commit history; never create a PR or merge into integration merely to update this ledger.

If the owner later enables GitHub Issues, propose whether to migrate the single live handoff to a pinned issue; **do not maintain two competing authoritative handoffs**.
