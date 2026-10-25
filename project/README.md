# Psysonic Project Hub

This branch is the **owner's Psysonic-only project control room**. It records how we work, the current state, accepted decisions, historical evidence, and the next task. The main repository's code and upstream contribution instructions remain authoritative for implementation; this hub is NOT an upstream project policy and is NOT a feature branch.

## Start here

| Record | Responsibility | Update policy |
| --- | --- | --- |
| [AGENTS.md](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/AGENTS.md) | Mandatory AI/engineering conduct, authority and approval limits | Owner approval for policy changes |
| [STATUS.md](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/STATUS.md) | **Single living handoff:** current SHA snapshot, blockers, exact next action | Update when meaningful status changes |
| [WORKSTREAMS.md](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/WORKSTREAMS.md) | Stable work IDs, delivered/integrated/pending feature tally | Update on workstream milestone changes |
| [DECISIONS.md](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/DECISIONS.md) | Approved/proposed decisions, alternatives, deferrals and supersession | Only owner can approve a decision |
| [QUALITY_GATES.md](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/QUALITY_GATES.md) | Engineering evaluation criteria, test matrix, benchmarks and review | Owner approval for policy changes |
| [HISTORY.md](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/HISTORY.md) | Dated, append-only history of substantial verified checkpoints | Append evidence; never silently rewrite |
| [REVIEW_REQUEST.md](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/REVIEW_REQUEST.md) | Copy/paste skeleton for independent read-only review | Improve only with owner-approved policy |
| [HOW_TO_USE.md](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/HOW_TO_USE.md) | How to load governance without switching code branches | Factual/reference changes |
| [CHATGPT_PROJECT_INSTRUCTIONS.md](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/project/CHATGPT_PROJECT_INSTRUCTIONS.md) | Short copy/paste instructions for the ChatGPT project settings | User pastes/approves in project UI |

## Locations and primary sources

- [Official Psysonic code](https://github.com/Psysonic/psysonic/tree/main); [upstream contributing guide](https://github.com/Psysonic/psysonic/blob/main/CONTRIBUTING.md); [upstream CI workflows](https://github.com/Psysonic/psysonic/tree/main/.github/workflows).
- [Personal Psysonic fork](https://github.com/Puppies-On-Acid/psysonic); [daily integration branch](https://github.com/Puppies-On-Acid/psysonic/tree/personal/integration).
- [Docs-only hub](https://github.com/Puppies-On-Acid/psysonic/tree/meta/project-hub). Its ancestor is the fork's historical main; **do not use it as a code baseline**.
- As of 2026-10-24, this fork has GitHub Issues disabled; our living handoff is **STATUS.md**, not an issue. Owner may revisit whether to enable Issues later.

## The working loop

**Load verified context → select a small approved task → specify measurable success and failure conditions → seek explicit owner approval for decisions → implement only authorized code → check correctness/UX/performance → request independent read-only review where appropriate → seek permission before opening an upstream PR → record exact evidence and next action.**

The docs branch stays separate from product code. The owner controls PR submissions and the final disposition of branches and changes. A new assistant session begins with STATUS plus live GitHub verification, not an attempted replay of every prior chat. **Begin Interview** requests focused discovery of a new goal or unresolved design.
