---
name: ask-miles
description: Route among sorry-matt skills and identify the best next skill for the current situation
disable-model-invocation: true
---

# ask-miles: What should I use now?

Choose the path matching the current stage:

- **Clarify requirements, plans, or decisions without answering every question yourself** → `/grill-them`.
  Let two subagents duel and receive only their conclusions and awaiting-ruling items; no implementation.
- **Start a task, or continue after grill-me or grill-with-docs, with no spec or tickets** → `/take-this`.
  Carry forward existing grilling; otherwise run grill-them, then to-spec and to-tickets.
- **Complete prepared tickets** → `/get-to-work`. Implement and review in rounds, delivering GitHub PRs or
  Local Markdown integration branches until the initial set is complete or explicitly stuck.
- **Delegate existing grilling through planning and implementation** → `/have-it-all-done`. After a risk gate,
  run take-this then get-to-work autonomously. Broad, ambiguous, or weakly testable work will burn tokens and
  produce garbage.
- **Order scattered tracker tickets and local work** → `/issue-chain`. Use the configured tracker to build a
  linear work chain and identify exactly one next action; this path is read-only.
- **Review an incoming GitHub PR** → `/review-pr <PR>`. It automatically reviews the changes in the PR and
  posts suggestions and change requests on GitHub.

For triage, bug diagnosis, wayfinding, or prototyping, use `/ask-matt`, the matt skills router.
