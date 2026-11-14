---
name: have-it-all-done
description: Take over one complete task, carrying prior grilling through planning and implementation to something a human can merge
disable-model-invocation: true
---

# have-it-all-done: Handle the whole task and report back

Optional argument: a task description, or an explicit pointer to prior grilling output or documents.

Secure implementation authority once, then answer matt skill confirmations for the user and record every
delegated decision. The authority level comes from the three layers in `ASKING.md` section 5; it is not hardcoded
here.

## 0. Autonomy

Once the risk gate clears it (step 1), this run aims to reach the handoff calling the user back at exactly two
points: step 2's ruling point and step 5's eyes-on acceptance. Six rules hold throughout, and they are handed
to every subagent this run spawns:

- **Make reversible internal decisions yourself.** Local files, commits on local branches, worktrees, tests, and
  merges or deploys already authorized: decide, record the choice in the self-answer log, and continue. Per
  `ASKING.md` section 2, four classes are worth asking about, and they are all asked at the ruling point.
- **A gate's refusal is an instruction.** When a process or quality gate denies a call and says how to proceed,
  follow that text and retry. It counts as stuck only when no such route exists, or following it still gets
  denied.
- **Hard stops go on the list; keep working on everything else.** Put each permanent exception from `ASKING.md`
  section 5 on the **human-work list**, then carry on with every other thing that can be done.
- **Run prompting calls last, back to back.** A call that raises a confirmation prompt by itself — a hook ask,
  the built-in delete check — is a **prompting call**, and it waits for the end even when the user approved it
  long ago ("send it when it's done"). Finish every other step first — uploads, file writes, doc updates,
  commits — then run the prompting calls consecutively, so the interruption lands once, at the end.
- **Expand needs-triage tickets in two stages.** What freezes is the ticket set's membership, not how deep each
  ticket goes. When an in-scope ticket carries nothing beyond its needs-triage marker, fill it only far enough to
  order it before the freeze: one line of scope, the blocker edges, marked ready-for-agent the way the tracker
  does. **Full expansion** — acceptance criteria and implementation-level rulings — waits for the moment that
  ticket is about to enter the frontier, is answered on their behalf per `ASKING.md` section 3, and has its
  rationale recorded in that ticket's status record. Upstream implementation rewrites the facts the downstream
  tickets rest on; the rulings made early are the ones that get redone. Mark it awaiting ruling only when a fact
  the expansion needs cannot be found anywhere; a needs-triage ticket filed during the run is background, held to
  the handoff per section 4.
- **The host's context has a budget.** Diffs, test logs, agent reports, and full ticket bodies stay in the
  subagents and the files that hold them; the host takes fixed-format summaries (fifteen lines at most) plus
  evidence paths, and pulls the few lines it needs with a command. Every report this run follows that budget. The
  **source of truth** for state is step 1's **run ledger**, not this conversation — compaction costs what it costs
  because every pass reads the entire context in and writes a long summary out, the prompt cache prefix then has to
  be rebuilt, and whatever the summary dropped gets looked up again. With the record in a file, compaction loses
  convenience, not state.

Done when: between the risk gate and the handoff, only the ruling point and the eyes-on acceptance called the
user back; every hard stop is on the human-work list; every prompting call ran after the other steps,
consecutively; every in-scope needs-triage ticket has cleared its first expansion stage, or is marked awaiting
ruling with the fact that could not be found; the host's context holds no diff, test log, or agent report source
text.

## 1. Pick up the handoff and pass the risk gate

Read four things, in order:

1. `docs/agents/issue-tracker.md`. If it is missing, ask the user to run `/setup-matt-pocock-skills`, then
   continue after configuration exists.
2. `sorry-matt/authority.md` under the common directory that
   `git rev-parse --path-format=absolute --git-common-dir` reports, for the **standing authority**. When it is
   missing, run on the defaults — do not stop.
3. `docs/agents/environment.md`, for the environment facts already on record. Skip it when missing.
4. Starting from the base directory stated when this skill was loaded, the sibling [`ASKING.md`](ASKING.md), in
   full. It is the asking contract shared with `take-this` and `get-to-work`, and it applies throughout.

Then deal with the **run ledger**: this run's source of truth for state, at `sorry-matt/runs/<run>.md` under the
common directory (resolved the same way as the second read). When a ledger for this task already exists, pick it
up instead of rebuilding from the conversation's compaction summary; otherwise create one. Nine fields:

1. **Next action**: one line, followed on resume.
2. Task scope, and where the grilling source landed.
3. The three risk lights and the approval record.
4. Lines, integration branches, and tip SHAs.
5. The authority used this run.
6. The run-level self-answer log.
7. The human-work list.
8. The reconciliation table, one row per ticket, pointing at that ticket's status record.
9. Run metrics.

It lives beside `authority.md`, for the reasons `ASKING.md` section 5 gives under L1. Write it current at the end
of every step and every closed round; after a compaction, a `/loop` wake-up, or any other resume, the first action is to read it
again rather than inferring from the context summary where this run stands.

Select exactly one task in this order:

1. With an argument, use its task and any grilling output or documents it explicitly supplies.
2. Without an argument, when the current session contains one completed `grill-me`, `grill-with-docs`, or
   `grill-them` result that clearly belongs to a single task, pick up that task, its decisions, and its
   documents as a handoff.
3. Otherwise, call the Skill tool with `issue-chain` and no arguments. Include the executable links, plus any
   needs-triage ticket expanded yourself per section 0, and reserve the remaining **awaiting ruling** items for
   the final report.

After selecting the task, open the risk gate exactly once. Judge each light:

- **Excessive change surface:** multiple modules, a broad refactor, data migration, deployment, or a security
  boundary.
- **Ambiguous requirements:** branches remain that would change implementation direction, completion is not
  verifiable, or the grilling result to carry forward is unclear.
- **Weak acceptance evidence:** the task is both large and vague without a dependable test net, or success
  rests primarily on subjective UI or copy judgment.

When grilling output exists, use its decisions and evidence in the assessment. On any red light, report all three
lights and, per `ASKING.md` section 2(a), **open the proposal at full scope:** give the complete range first, then
list each red light's specific reason and evidence. Recommend reducing scope only when it hits a permanent or
project exception, and name which one. The alternatives stay available but are not the recommendation:
`/take-this` with user participation, clarifying with `/grill-me`, `/grill-with-docs`, or `/grill-them`, or
`/wayfinder` for a large unresolved task. Continue after explicit approval; proceed directly when all are green.
That approval covers later matt skill confirmations, but not the permanent exceptions.

Done when: the tracker configuration, the standing authority, one task, and the grilling source are recorded; the
run ledger is picked up or created, with all nine fields filled or explicitly `none`; all three lights have a
red-or-green result; every red light has an explicit user approval record and a proposal that opened at full
scope.

## 2. Prepare the tickets (skip when they already exist)

The whole opening goes to a **kickoff agent**: starting from the base directory stated when this skill was
loaded, it reads the sibling `../take-this/SKILL.md` and follows its complete sequence — establish the
requirements context, complete to-spec, then complete to-tickets. When step 1 picked up `grill-me`,
`grill-with-docs`, or `grill-them`, first write where that result landed (path or URL) and the decisions already
settled in this session into the ledger's second field; the kickoff agent takes the requirements context from
there rather than from the host retelling it. It reports the spec identifier, the ticket list with blocker edges,
the frontier, and the self-answer log, within the context budget; the spec and the ticket bodies stay on the
tracker.

One run opens one kickoff agent. When it stops short or reports incompletely, start another from the ledger's
next action instead of re-running what is already published.

Seam and ticket-cut confirmations are answered on their behalf per `ASKING.md` section 3: if you can write a
recommendation, answer it instead of asking first. Beginning after the risk gate passes, record every one in the
five-column **self-answer log** — decision, rationale, cost to reverse, evidence location — layered per
`ASKING.md` section 3: an implementation detail that affects one ticket only and is reversible there goes in that
ticket's status record, and the run-level log takes only the self-answers whose cost to reverse crosses tickets or
deliveries. Decisions the user made during prior grilling are requirements evidence, not self-answers.

After `take-this` delivers and before step 3, run the single **ruling point** from `ASKING.md` section 4: ask
everything pending at once, each with a recommendation, taking the four highest by cost to reverse when there are
more. Actions that need authority are asked here too, with options split into "this time" and "from now on"; on
"from now on", write the grant to `sorry-matt/authority.md` in the common directory straight away.

Done when: tickets are published to the configured tracker and every blocker edge is explicit; the kickoff
agent's requirements context points to the same grilling result selected in step 1; every agent-answered
confirmation after the risk gate has an answer and rationale in the run-level self-answer log or that ticket's
status record; the ruling point ran exactly once and every grant upgraded to standing is on record.

## 3. Clear the tickets

Read the sibling `../get-to-work/SKILL.md` and follow it, giving it the tickets created in step 2, or the
executable links selected in step 1, as its explicit argument in tracker-native identifiers: GitHub issue
numbers or URLs, or Local Markdown paths. Preserve its full quality gate: automated checks before review,
then a GitHub PR or Local Markdown integration-branch update only after review passes.

While `get-to-work` runs, anything that comes up takes one of the three exits in `ASKING.md` section 4. Section
0's six rules apply here as well: hand them to `get-to-work`, and every implementation subagent it spawns gets
them too. Hand it the ledger path along with them: at the end of each closed round it writes the reconciliation
table, the self-answer log, and the run metrics back to that same ledger.

Done when: `get-to-work` has stopped; every supplied ticket appears in its reconciliation table with a
delivered, stuck, or awaiting-ruling result and supporting evidence; no question was asked while it ran.

## 4. Hand off

The final report is the ledger brought to a close, with **one source of truth per finding**: written once where
it belongs, with the other sections citing identifiers and paths — no embedded diffs, test logs, or agent reports.
It includes:

- Task scope, selected grilling source, and all three risk-light results.
- **The authority used this run:** every grant actually relied on, one row each with action, level, source words,
  and date, plus the absolute path of the authority file in the common directory. An explicit `none` when no
  standing authority was used.
- **The run-level self-answer log**, or an explicit `none`. Ticket-level self-answers stay in each ticket's status
  record and are cited here by location. Then one **review pass**: a single multi-select, "which of these
  self-answers do you want flipped?", offering the four with the highest cost to reverse.
- **The human-work list:** every item carries steps someone can follow to completion. Where the steps are many or
  run through a third-party interface, call the Skill tool with `wizard` to generate an interactive wizard and
  point the list at it.
- Each line's delivery: a GitHub aggregate PR, or a Local Markdown integration branch and tip SHA, plus the
  **reconciliation table**, one row per ticket: ticket ID, deliverable, verification result, and where that
  ticket's status record is.
- Raw tickets created through filing along the way, the `/triage` recommendation, and every awaiting-ruling
  item.
- **Run metrics:** the ones `get-to-work` hands back, plus this run's compactions and handovers. Those are
  countable; a token count stays marked unknown unless the execution environment reports it, and is never
  inferred from elapsed time or agent count.

Done when: all seven categories are present; the authority table matches the actions actually taken, row by row;
every line has a traceable deliverable and acceptance evidence that lets someone outside the run decide whether
to merge its aggregate PR or local integration branch; every human-work item has followable steps or a wizard; no
section of the report duplicates text that is of record elsewhere.

## 5. Eyes-on acceptance (conditional)

Run this only when a ticket's acceptance criterion cannot be verified mechanically, and only after step 4 — the
handoff report goes out first, so the user knows what each item is being checked against. Per
`ASKING.md` section 4: one item per turn, with the operating steps and a URL or window the user can open
directly, waiting for the response before the next one. It is an acceptance procedure rather than a ruling, so the
one-ruling-point limit does not apply.

Feed each result back into the reconciliation table. A ticket that fails is marked stuck under `get-to-work`'s
rules; no code changes here.

Done when: every criterion that cannot be verified mechanically has the user's per-item response and a landing
place, or is explicitly recorded as not applicable.
