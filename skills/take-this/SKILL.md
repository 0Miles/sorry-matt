---
name: take-this
description: Carry completed grilling into an executable spec and ticket set for a new task
disable-model-invocation: true
---

# take-this: Prepare a new task

The argument is a task description or an explicit pointer to prior grilling output or documents. Without an
argument, use the current conversation.

## 1. Lock the tracker and context

First read `docs/agents/issue-tracker.md`. If it does not exist, ask the user to run
`/setup-matt-pocock-skills`, then continue once the configuration exists. Use that configuration for every
publication target, identifier format, and triage designation. Then read two more: `sorry-matt/authority.md`
under the common directory that `git rev-parse --path-format=absolute --git-common-dir` reports (run on the
defaults when it is missing), and, starting from the base directory stated when this skill was loaded, the
sibling [`../have-it-all-done/ASKING.md`](../have-it-all-done/ASKING.md) in full.

`ASKING.md` governs throughout: for every confirmation in to-spec and to-tickets, if you can write a
recommendation, answer it on their behalf per section 3 and record it in the **self-answer log** rather than
asking first. Only matters in section 2's four classes are held back for the ruling point to ask at once.

Complete requirements context, to-spec, and to-tickets in that order while preserving one continuous
context through to-tickets. When approaching the smart zone, before any compaction read and execute the
[pinned handoff workflow](references/upstream/handoff.md) in full, then resume at the interrupted step.

Done when: the configured tracker has been read, and the current context or handoff contains the task input,
prior grilling output, and everything required by the remaining steps.

## 2. Build the requirements context

**Carry forward first:** find completed `grill-me`, `grill-with-docs`, or `grill-them` output that clearly
belongs to this task. It may come from the current session, the argument, or a handoff. Reuse a matching
result directly. If several results could match, ask the user to identify the intended one. Call the Skill
tool with `grill-them` only when no reusable result exists.

Normalize the selected source into one **requirements context**:

- From `grill-me`, capture the user-confirmed shared understanding, decisions, constraints, rejected options
  and rationales, and unresolved questions.
- From `grill-with-docs`, capture the same material plus every ADR, glossary, or other document created or
  changed during the grilling. Feed those documents to `to-spec`, and still reconcile the decisions they
  contain.
- From `grill-them`, capture the topic card, duel summary, ruling, awaiting-ruling items, and distillation
  documents. When the agent-grillee already took an explicit position on an awaiting-ruling item, adopt it;
  otherwise retain the item as an open question.

The requirements context covers task scope, settled decisions, hard constraints, verified facts and
sources, rejected options, open questions, and applicable document paths. Mark each item as coming from the
user, agent-grillee, or a named document.

Done when: the selected grilling source is recorded; reconciliation has placed every required item exactly
once in the requirements context; reused output is the sole grilling input for this run.

## 3. Write the spec

Read the [pinned to-spec workflow](references/upstream/to-spec.md) in full and follow it with the requirements
context as input.

Done when: the spec is published to the configured tracker, accounts for every requirements-context item,
is marked `ready-for-agent` through the provider's native mechanism, and its GitHub URL or Local Markdown
path is recorded.

## 4. Cut tickets

Read the [pinned to-tickets workflow](references/upstream/to-tickets.md) in full and follow it with the newly
published spec as input.

Done when: every ticket is published to the same configured tracker; each scope and blocker edge has been
confirmed; every GitHub identifier/URL or Local Markdown `NN`/path is recorded.

## 5. Hand off the frontier

Output the requirements-context source, spec identifier, complete ticket list with blocker edges,
**frontier**, the **self-answer log** for this run (five columns: decision, rationale, cost to reverse,
evidence location), and one immediately executable **next action**. Run each ticket in a fresh session with
`/implement`; use `/issue-chain` when the full picture must be rebuilt.

That log doubles as the ruling point's question pool: when `have-it-all-done` composes this skill, it takes the
highest items by cost to reverse from this log and asks them alongside section 2's four classes, all at once.

Done when: every published ticket appears in the output with a provider-native identifier that downstream
skills can read directly; the frontier agrees with the blocker edges; the next action names one ticket from
that frontier; every answer given on their behalf is in the log with all five columns.
