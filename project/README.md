# Psysonic Project Hub

This branch is the **owner's Psysonic-only project control room**. It records how we work, the current state, accepted decisions, historical evidence, and the next task. The main repository's code and upstream contribution instructions remain authoritative for implementation; this hub is NOT an upstream project policy and is NOT a feature branch.

## Start here

| Record | Responsibility | Update policy |
| --- | --- | --- |
| [AGENTS.md](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/AGENTS.md) | Mandatory AI/engineering conduct, authority and approval limits | Owner approval for policy changes |
| [GitHub handoff issue #1](https://github.com/Puppies-On-Acid/psysonic/issues/1) | **Single living handoff:** verified checkpoint, blockers, exact next action and issue links | Update on meaningful verified changes |
| [STATUS.md](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/STATUS.md) | Stable pointer to issue #1; old snapshot archived | No separate status maintenance |
| [WORKSTREAMS.md](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/WORKSTREAMS.md) | Stable work IDs, delivered/integrated/pending feature tally | Update on workstream milestone changes |
| [DECISIONS.md](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/DECISIONS.md) | Approved/proposed decisions, alternatives, deferrals and supersession | Only owner can approve a decision |
| [QUALITY_GATES.md](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/QUALITY_GATES.md) | Engineering evaluation criteria, test matrix, benchmarks and review | Owner approval for policy changes |
| [HISTORY.md](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/HISTORY.md) | Dated, append-only history of substantial verified checkpoints | Append evidence; never silently rewrite |
| [ISSUE_TRACKING.md](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/ISSUE_TRACKING.md) | How to organize public tracking issues, evidence and approvals | Owner-approved rules, factual references |
| [REVIEW_REQUEST.md](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/REVIEW_REQUEST.md) | Copy/paste skeleton for independent read-only review | Improve only with owner-approved policy |
| [HOW_TO_USE.md](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/HOW_TO_USE.md) | How to load governance without switching code branches | Factual/reference changes |
| [CHATGPT_PROJECT_INSTRUCTIONS.md](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/CHATGPT_PROJECT_INSTRUCTIONS.md) | Short copy/paste instructions for the ChatGPT project settings | User pastes/approves in project UI |

## Locations and primary sources

- [Official Psysonic code](https://github.com/Psysonic/psysonic/tree/main); [upstream contributing guide](https://github.com/Psysonic/psysonic/blob/main/CONTRIBUTING.md); [upstream CI workflows](https://github.com/Psysonic/psysonic/tree/main/.github/workflows).
- [Personal Psysonic fork](https://github.com/Puppies-On-Acid/psysonic); [daily integration branch](https://github.com/Puppies-On-Acid/psysonic/tree/personal/integration).
- [Docs-only hub](https://github.com/Puppies-On-Acid/psysonic/tree/meta/project-hub). Its ancestor is the fork's historical main; **do not use it as a code baseline**.
- GitHub Issues were enabled on the **public** fork on 2026-10-24 by the owner. See [live handoff #1](https://github.com/Puppies-On-Acid/psysonic/issues/1), [Explorer coordination #2](https://github.com/Puppies-On-Acid/psysonic/issues/2), and the [open issue list](https://github.com/Puppies-On-Acid/psysonic/issues). Historical snapshots remain in the Project Hub archive.

## The working loop

**Load verified context → select a small approved task → specify measurable success and failure conditions → seek explicit owner approval for decisions → implement only authorized code → check correctness/UX/performance → request independent read-only review where appropriate → seek permission before opening an upstream PR → record exact evidence and next action.**

The docs branch stays separate from product code. The owner controls PR submissions and the final disposition of branches and changes. A new assistant session begins with [handoff #1](https://github.com/Puppies-On-Acid/psysonic/issues/1) plus live GitHub verification, not an attempted replay of every prior chat. **Begin Interview** requests focused discovery of a new goal or unresolved design.
