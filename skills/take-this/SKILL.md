---
name: take-this
description: Carry completed grilling into an executable spec and ticket set for a new task
disable-model-invocation: true
---

# take-this: Prepare a new task

The argument is a task description or an explicit pointer to prior grilling output or documents. Without an
argument, use the current conversation.

## 1. Lock the tracker and context

First read `docs/agents/issue-tracker.md`. If it does not exist, run
`/setup-matt-pocock-skills` before continuing. Use that configuration for every publication target,
identifier format, and triage designation.

Complete requirements context, to-spec, and to-tickets in that order while preserving one continuous
context through to-tickets. When approaching the smart zone, use `/handoff` before any compaction, transfer
the complete context to a new session, and resume at the interrupted step.

Done when: the configured tracker has been read, and the current context or handoff contains the task input,
prior grilling output, and everything required by the remaining steps.

## 2. Build the requirements context

**Carry forward first:** find completed `grill-me`, `grill-with-docs`, or `grill-them` output that clearly
belongs to this task. It may come from the current session, the argument, or a handoff. Reuse a matching
result directly. If several results could match, ask the user to identify the intended one. Run `grill-them`
only when no reusable result exists.

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

## 3. Write the spec with to-spec

Run the mattpocock-skills `to-spec` with the complete requirements context, including its seam and user
confirmation. Put open questions under Further Notes or Out of Scope. Keep only adopted options in the
requirements.

Done when: the spec is published to the configured tracker, accounts for every requirements-context item,
is marked `ready-for-agent` through the provider's native mechanism, and its GitHub URL or Local Markdown
path is recorded.

## 4. Cut tickets with to-tickets

Run `to-tickets` against the published spec and complete its ticket-cut and blocker confirmation.

Done when: every ticket is published to the same configured tracker; each scope and blocker edge has been
confirmed; every GitHub identifier/URL or Local Markdown `NN`/path is recorded.

## 5. Hand off the frontier

Output the requirements-context source, spec identifier, complete ticket list with blocker edges,
**frontier**, and one immediately executable **next action**. Run each ticket in a fresh session with
`/implement`; use `/issue-chain` when the full picture must be rebuilt.

Done when: every published ticket appears in the output with a provider-native identifier that downstream
skills can read directly; the frontier agrees with the blocker edges; the next action names one ticket from
that frontier.
