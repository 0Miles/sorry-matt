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
  Carry forward existing grilling; when none exists, build the requirements context from evidence, open
  grill-them only on a material disagreement, then write the spec and tickets.
- **Finish tickets that are ready to implement** → `/get-to-work`. Implement and verify them ticket by ticket in
  parallel according to the tracker configuration, delivering one aggregate GitHub PR or Local Markdown
  integration branch per line until the initial ticket set is complete or explicitly stuck.
- **Delegate existing grilling, planning, and implementation end to end, with controlled scope, convergent
  requirements, and reliable acceptance checks** → `/have-it-all-done`. After clearing its risk gate, it runs
  take-this → get-to-work autonomously and asks you what needs your ruling only at a single ruling point.
- **Order tracker tickets and local work that are scattered all over** → `/issue-chain`. Use the configured
  tracker to build a linear work chain and identify exactly one next action; read-only throughout.
- **Review an incoming GitHub PR** → `/review-pr <PR>`. Review the changes in the PR and publish suggestions and
  change requests on GitHub.
- **Re-review one ticket inside a sorry-matt run on its own (no PR comments)** → `/prove-it <ticket>`. Reviews the
  ticket branch against the integration branch as fixed point, through the evidence chain, a live run, and mutation
  limited to the ticket's diff, and writes the verdict into the ticket's status record; `get-to-work` calls it by
  itself during close-out.
- **The agent is padding and burying the point** → `/no-bullshit`. Answer first and cut
  ceremony and padding; facts, conditions, and uncertainty stay.
- **Safely retire local branches and extra worktrees after the work is merged** → `/clean-it-up`. Remove only
  clean items backed by merge evidence; remote branches require separate explicit authority.
- **Use the frontend skills in a frontend project for the first time, or rebuild the project's component map from
  scratch** → `/set-up-ui-skills`. Explore the component library, tokens, and shared components, ask everything
  in one batch, and write `docs/agents/ui.md` once the draft is approved.
- **An existing piece of UI is ugly or awkward and should be reworked with behavior unchanged** →
  `/make-this-shit-pretty <page or component>`. Walk the whole journey for problems, get one ruling from you,
  then rewrite in small verified steps.
- **The situation calls for triage, bug diagnosis, wayfinder, or prototyping** → `/ask-matt`; it is the router
  for matt skills.

Done when: exactly one skill, the best fit for the situation, is recommended, the matching branch is explained,
and the response includes an invocation the user can copy directly. When the information is insufficient to choose
uniquely, name the gap and ask the user to fill the single smallest one; after the ruling, return a single route.
