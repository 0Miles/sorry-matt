---
name: take-this
description: Carry completed grilling into an executable spec and ticket set for a new task
disable-model-invocation: true
---

# take-this: Prepare a new task

The argument is a task description or an explicit pointer to prior grilling output or documents. Without an
argument, use the current conversation.

## 1. Lock the tracker and context

Starting from the base directory stated when this skill was loaded, read the sibling
[`../have-it-all-done/ASKING.md`](../have-it-all-done/ASKING.md) in full and run its section 0 opening; use the
tracker configuration for every publication target, identifier format, and triage designation. `ASKING.md`
governs throughout: if you can write a recommendation, answer on their behalf per section 3 rather than asking
first; only matters in section 2's four classes are held back for the ruling point to ask at once.

**Two contexts.** When the user runs this skill directly, every "ask the user…" in this file and in `ASKING.md`
means asking the user. When `have-it-all-done` composes it and it runs as the kickoff agent, there is no user to
ask: if the tracker configuration is missing, stop and report that to the host; when several grilling results
could match this task, pick one on the evidence and record it in the self-answer log, or report it as awaiting
ruling when the evidence cannot decide; every other "ask the user…" becomes an item in the report to the host.

Complete requirements context, spec, and tickets in that order while preserving one continuous context until the
tickets are published. When approaching the smart zone, before any compaction read and execute the
[pinned handoff workflow](references/upstream/handoff.md) in full, then resume at the interrupted step.

Done when: the configured tracker has been read, and the current context or handoff contains the task input,
prior grilling output, and everything required by the remaining steps.

## 2. Build the requirements context

**Carry forward first:** find completed `grill-me`, `grill-with-docs`, or `grill-them` output that clearly
belongs to this task. It may come from the current session, the argument, or a handoff. Reuse a matching
result directly. If several results could match, ask the user to identify the intended one (when composed,
follow the two-contexts rule in step 1).

Where no reusable result exists, **the default is not to open an interview**: build the requirements context
yourself out of the evidence in the tracker, the repository files, and git history, answering what is uncertain on
their behalf per `ASKING.md` section 3. Call the Skill tool with `grill-them` only on a **material disagreement** —
an interface across modules, the data model, externally visible behaviour, or a decision that is hard to reverse
with no test net under it. Where none of the four hit, do not open one, and record the rationale in the self-answer
log.

Normalize the selected source into one **requirements context**:

- From `grill-me`, capture the user-confirmed shared understanding, decisions, constraints, rejected options
  and rationales, and unresolved questions.
- From `grill-with-docs`, capture the same material plus the paths of every ADR, glossary, or other document
  created or changed during the grilling. Those documents are inputs to the spec, and the decisions they contain
  still get reconciled.
- From `grill-them`, capture the topic card, duel summary, ruling, awaiting-ruling items, and distillation
  documents. When the agent-grillee already took an explicit position on an awaiting-ruling item, adopt it;
  otherwise retain the item as an open question.

The requirements context covers task scope, settled decisions, hard constraints, verified facts and
sources, rejected options, open questions, and applicable document paths. Mark each item as coming from the
user, agent-grillee, or a named document.

Done when: the selected grilling source is recorded; reconciliation has placed every required item exactly
once in the requirements context; reused output is the sole grilling input for this run.

## 3. Write the spec

No interview — synthesize the requirements context and the current state of the codebase:

1. Explore the repository's current state. Use the project glossary's vocabulary throughout the spec, and respect
   the ADRs in the area you are touching.
2. Sketch the **seams** to test at: prefer existing seams, at the highest point available; where new seams are
   needed, propose them as high as you can. The fewer the better — the ideal number is one. Seams are answered on
   the user's behalf per `ASKING.md` section 3 and written into the spec's Testing Decisions, which the tickets and
   the implementation agents both follow.
3. Write the spec with the spec template in [`TEMPLATES.md`](TEMPLATES.md), publish it to the tracker, and mark it
   `ready-for-agent` through the provider's native mechanism.

Done when: the spec is published to the configured tracker, accounts for every requirements-context item, names
its seams under Testing Decisions, and is marked `ready-for-agent` through the provider's native mechanism; its
GitHub URL or Local Markdown path is recorded.

## 4. Cut tickets

With the newly published spec as input, cut **tracer-bullet** vertical slices:

- Each ticket cuts a narrow but complete path through every layer (schema, API, UI, tests), is demoable or
  verifiable on its own, and fits in a single fresh context window. Prefactoring goes first: make the change easy,
  then make the easy change.
- **About 3–5 acceptance criteria per ticket.** Each criterion is a surface the review checks one by one, and only a
  small ticket can be reviewed in full and run in parallel with others. A ticket with a small scope may have fewer
  than three; do not pad it. More than five means the ticket should be split: split it into two or more, and do not
  cram — do not fold distinct behaviours into one criterion, and do not drop an outcome that needs checking just to
  get down to five. For a blocked ticket whose criteria are deferred, estimate from its scope, and split it now if it
  clearly exceeds five.
- **Wide refactors are the exception:** when one mechanical change (renaming a field, changing a shared type)
  fans across the whole codebase and no vertical slice can land green, sequence it as **expand–contract**. First
  add the new form beside the old (expand); then migrate call sites in batches sized by blast radius, each batch
  its own ticket blocked by the expand and green because the old form still exists; finally delete the old form
  (contract), blocked by every batch. When even the batches cannot stay green alone, keep the sequence but let
  them share one integration branch, with all of them blocking a final integrate-and-verify ticket; green is
  promised only there.
- Each ticket lists its **blocker edges**: the tickets that must complete before it can start. A ticket with no
  blockers can start immediately.
- Granularity, blocker edges, and any merging or splitting are answered on the user's behalf per `ASKING.md`
  section 3, not asked ticket by ticket.
- Depth reaches only as far as the next executable ticket: frontier tickets get their acceptance criteria written
  now, while blocked tickets carry scope, blocker edges, and open questions; their criteria wait until they are
  about to enter the frontier, when `get-to-work`'s expansion agent fills them in at dispatch, before
  implementation starts — never the implementation agent. Upstream implementation rewrites the facts the
  downstream tickets rest on; details written early are the details that get rewritten.
- Neither tickets nor the spec name specific file paths or code snippets; they go stale fast. The exception: where
  a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer,
  schema, type shape), excerpt only the decision-rich part and say where it came from.

Publish in dependency order (blockers first) with the ticket templates in [`TEMPLATES.md`](TEMPLATES.md):

- **Local Markdown:** one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`
  in dependency order, never one combined file.
- **GitHub:** one issue per ticket. Use the platform's native blocking relationship for edges, falling back to the
  ticket's Blocked by section where there is none. When the source was an existing issue, make each ticket its
  sub-issue the way the tracker configuration says. Apply `ready-for-agent`.
- Do not close or modify the parent issue.

Done when: every ticket is published to the same configured tracker; frontier tickets have complete acceptance
criteria while blocked tickets carry at least scope, blocker edges, and open questions; every blocker edge has been
confirmed; every GitHub identifier/URL or Local Markdown `NN`/path is recorded.

## 5. Hand off the frontier

Output the requirements-context source, spec identifier, complete ticket list with blocker edges,
**frontier**, the **self-answer log** for this run (layered per `ASKING.md` section 3 — only the answers whose cost
to reverse crosses tickets come here), and one immediately executable **next action**: ask the user to run
`/get-to-work` to clear the tickets, and `/issue-chain` when the full picture must be rebuilt.

That log doubles as the ruling point's question pool: when `have-it-all-done` composes this skill, it takes the
highest items by cost to reverse from this log and asks them alongside the pending items in `ASKING.md`
section 2's four classes, all at once.

Done when: every published ticket appears in the output with a provider-native identifier that downstream
skills can read directly; the frontier agrees with the blocker edges, and the next action points at an
immediately executable ticket; every answer given on their behalf is in the log with all five columns.
