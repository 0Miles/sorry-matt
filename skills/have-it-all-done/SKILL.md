---
name: have-it-all-done
description: Take over one complete task behind a single risk gate, carrying prior grilling through take-this and get-to-work; use issue-chain only when no task context exists
disable-model-invocation: true
---

# have-it-all-done: Handle the whole task and report back

Optional argument: a task description, or an explicit pointer to prior grilling output or documents.

Secure implementation authority once, then answer matt skill
confirmations for the user and record every delegated decision. Authority ends at GitHub PRs or Local Markdown
integration branches. The **human-only actions** are deployment, data migration, external publication, and final
merges.

## 1. Pick up the handoff and pass the risk gate

First read `docs/agents/issue-tracker.md`. If it is missing, ask the user to run
`/setup-matt-pocock-skills`, then continue after configuration exists.

Select exactly one task in this order:

1. With an argument, use its task and any grilling output or documents it explicitly supplies.
2. Without an argument, when the current session contains one completed `grill-me`, `grill-with-docs`, or
   `grill-them` result that clearly belongs to a single task, pick up that task, its decisions, and its
   documents as a handoff.
3. Otherwise, run `/issue-chain` without arguments. Include only executable links and reserve
   **awaiting ruling** items for the final report.

After selecting the task, open the risk gate exactly once. Judge each light:

- **Excessive change surface:** multiple modules, a broad refactor, data migration, deployment, or a security
  boundary.
- **Ambiguous requirements:** branches remain that would change implementation direction, completion is not
  verifiable, or the grilling result to carry forward is unclear.
- **Weak acceptance evidence:** the task is both large and vague without a dependable test net, or success
  rests primarily on subjective UI or copy judgment.

When grilling output exists, use its decisions and evidence in the assessment. On any red light, state the
specific reason and ask whether the user still authorizes the autonomous run. Offer the best alternative:
reduce scope, use `/take-this` with user participation, clarify with `/grill-me`, `/grill-with-docs`, or
`/grill-them`, or use `/wayfinder` for a large unresolved task. Continue after explicit approval; proceed
directly when all are green. That approval covers later matt skill confirmations, but not the **human-only
actions**.

Done when: the tracker configuration, one task, and the grilling source are recorded; all three lights have a
red-or-green result; every red light has an explicit user approval record.

## 2. Prepare the tickets (skip when they already exist)

Starting from the base directory stated when this skill was loaded, read the sibling `../take-this/SKILL.md`
and follow its complete sequence: establish the requirements context, complete to-spec, then complete
to-tickets.
When step 1 picked up `grill-me`, `grill-with-docs`, or `grill-them`, pass its decisions, evidence, and documents
explicitly to `take-this`, preserving that single requirements context.

Answer seam and ticket-cut confirmations conservatively, reversibly, and in line with repository conventions.
Beginning after the risk gate passes, record every confirmation the agent answers for the user, together with its
rationale, in the **self-answer log**. Decisions the user made during prior grilling are requirements evidence,
not self-answers.

Done when: tickets are published to the configured tracker and every blocker edge is explicit; `take-this`
points to the same grilling result selected in step 1 as its requirements context; every agent-answered
confirmation after the risk gate has an answer and rationale in the self-answer log.

## 3. Clear the tickets

Read the sibling `../get-to-work/SKILL.md` and follow it, giving it the tickets created in step 2, or the
executable links selected in step 1, as its explicit argument in tracker-native identifiers: GitHub issue
numbers or URLs, or Local Markdown paths. Preserve its full quality gate: automated checks before review,
then a GitHub PR or Local Markdown integration-branch update only after review passes.

Done when: `get-to-work` has stopped; every supplied ticket appears in its reconciliation table with a
delivered, stuck, or awaiting-ruling result and supporting evidence.

## 4. Hand off

The final report includes:

- Task scope, selected grilling source, and all three risk-light results.
- The complete **self-answer log**, or an explicit `none`.
- Each line's delivery: a GitHub aggregate PR, or a Local Markdown integration branch and tip SHA, plus the
  complete reconciliation table.
- Raw tickets created through filing along the way, the `/triage` recommendation, and every awaiting-ruling
  item.

Done when: all four categories are present; every line has a traceable deliverable and acceptance evidence that
lets someone outside the run decide whether to merge its aggregate PR or local integration branch; all
**human-only actions** still await a human.
