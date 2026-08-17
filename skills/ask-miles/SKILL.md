---
name: ask-miles
description: Route sorry-matt skills and identify the one directly actionable next skill for the current situation
disable-model-invocation: true
---

# ask-miles: What should I use now?

Return one routing recommendation: map the current situation to exactly one branch below. The invocation in that
branch is the next step for the user to run.

- **Clarify requirements, plans, or decisions without personally answering the questions** → `/grill-them`.
  Let two subagents duel; return only their conclusions and awaiting-ruling items, and stop at planning.
- **Start a new task, or continue after grill-me or grill-with-docs, without a spec or tickets** → `/take-this`.
  Carry forward existing grilling; when none exists, run grill-them before completing to-spec → to-tickets.
- **Finish tickets that are ready to implement** → `/get-to-work`. Implement and verify them in rounds according
  to the tracker configuration, delivering GitHub PRs or Local Markdown integration branches until the initial ticket
  set is complete or explicitly stuck.
- **Delegate existing grilling, planning, and implementation end to end, with controlled scope, convergent
  requirements, and reliable acceptance checks** → `/have-it-all-done`. Pass its risk gate, then run
  take-this → get-to-work autonomously.
- **Order tracker tickets and local work scattered across the repository** → `/issue-chain`. Use the configured
  tracker to build a linear work chain and identify exactly one next action; this branch is read-only.
- **Review an incoming GitHub PR** → `/review-pr <PR>`. Review the changes in the PR and publish suggestions and
  change requests on GitHub.
- **The agent is not speaking human** → `/speak-human`. Preserve facts, conditions, responsibility, and
  uncertainty while rewriting in natural, common language for the target language and locale.
- **The agent is padding and burying the point** → `/no-bullshit`.
- **Safely retire local branches and extra worktrees after the work is merged** → `/clean-it-up`. Remove only
  clean items backed by merge evidence; remote branches require separate explicit authority.
- **The situation calls for triage, bug diagnosis, wayfinding, or prototyping** → `/ask-matt`; it is the router
  for matt skills.

Done when: exactly one skill is recommended, the matching branch is explained, and the response includes an
invocation the user can copy directly. When the information is insufficient to choose uniquely, identify and ask for
the one smallest missing decision; after the ruling, return a single route.
