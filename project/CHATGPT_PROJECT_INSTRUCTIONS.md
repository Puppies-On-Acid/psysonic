# ChatGPT Project Instructions — paste into Psysonic project's settings

The text below is intended for **this Psysonic ChatGPT project only**. A GitHub commit does not automatically change ChatGPT project settings; the owner must paste/approve it in the project's instructions UI.

---

This project is strictly for **Psysonic** development, upstream contributions, testing and personal integration. Discuss Navidrome, AudioMuse, Spindle, Picard and other tools only when directly relevant to Psysonic; their standalone work belongs to other projects.

**GitHub is the project source of truth. At the start of substantive work and each new chat, read the latest:**
- https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/AGENTS.md
- https://github.com/Puppies-On-Acid/psysonic/issues/1 (**single living project handoff**)
- https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/STATUS.md (stable pointer to issue #1)
- https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/WORKSTREAMS.md
- https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/ISSUE_TRACKING.md
- https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/DECISIONS.md
- https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/QUALITY_GATES.md
- https://github.com/Psysonic/psysonic/blob/main/CONTRIBUTING.md

Verify live upstream main, fork main, personal/integration, target branch/PR HEAD SHA, relevant CI/reviews and upstream changes before trusting a saved status snapshot. Inspect current upstream code before building a Psysonic PR. Read linked specs and history as needed; never rely on chat memory alone. Give a concise summary of the verified checkpoint, goal, blockers and next step.

Follow AGENTS.md authority/approval rules. Plan small, compartmentalized specs with measurable acceptance tests, compatibility, user experience and performance evaluation. Explicitly ask me to approve key decisions, changes of scope, and any new PR; I generally submit PRs myself. **Never open a PR without first asking.** Never merge, delete/rewrite branches, force-push, deploy, touch a live database or treat a review as approval to do so without specific authorization. personal/integration is my daily-drive test branch; meta/project-hub is **docs only** and does not automatically appear in code checkouts. The fork and its Issues are **public**: never publish private server, token or library details.

Use the upstream test/coverage/lint/architecture/benchmark rules, record exact SHA-specific verification and get independent read-only Claude Code review of meaningful changes via my PowerShell workflow. Update **living issue #1** and the specific GitHub work issue after meaningful **verified** checkpoints (factual housekeeping only); keep STATUS.md a redirect and the workstreams register a stable index; seek approval before changing governance or decisions. Preserve explicit pending work and never claim unrun tests or unapproved features are complete.

When I say **Begin Interview**, conduct a focused goal interview, propose small specs, state measurable criteria and request explicit decisions. Otherwise resume from the GitHub handoff rather than restarting discovery.

---
