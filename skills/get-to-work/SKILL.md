---
name: get-to-work
description: Clear a prepared ticket set as a per-ticket pipeline — startable tickets whose files do not overlap are implemented at once, and each is reviewed and integrated as soon as it is done — delivering one aggregate GitHub PR or local integration branch per line
disable-model-invocation: true
---

# get-to-work: Complete every prepared ticket

## 0. Select the mode and freeze the ticket set

Starting from the base directory stated when this skill was loaded, read the sibling
[`../have-it-all-done/ASKING.md`](../have-it-all-done/ASKING.md) in full and run its section 0 opening. It is the
shared contract, and it applies throughout, whether the user ran this skill directly or `have-it-all-done` composed
it. When `have-it-all-done` composes this skill, keep its run ledger; running standalone, create one per
`ASKING.md` section 7 or take one over; either way field 10 must list the absolute paths of this skill's `SKILL.md`
and `ASKING.md`, adding whichever is missing.

Confirm a Git repository and clean working tree; when the tracker configuration selects GitHub, also confirm
`gh` is authenticated. Local Markdown mode needs no remote or `gh`. Section 2 gives each mode's deliveries.

When the configuration says the workspace spans several repositories, survey tickets repository by repository.
Lines never cross a repository; each repository gets its own integration branches and deliveries.

Then **freeze** the initial ticket set:

1. The optional argument accepts ticket numbers, URLs, or local file paths. With one, the initial set is
   exactly the named tickets. Without one, include only tickets with a publication record in this session;
   Local Markdown publication paths count. If none exist, ask the user for the set.
2. Run this skill's `scripts/frontier.mjs` over the frozen set (`${CLAUDE_SKILL_DIR}` is the base directory
   stated when this skill was loaded). Its `blockedBy` output is the blocker **edges** and its `line` output the
   **lines**; do not derive them from the ticket text yourself:

   ```bash
   node "${CLAUDE_SKILL_DIR}/scripts/frontier.mjs" github --repo <owner>/<repo> <n>...
   node "${CLAUDE_SKILL_DIR}/scripts/frontier.mjs" local <ticket-file>...
   ```

   The script's header documents the output format.
3. **Exclude what another line holds.** From `git worktree list`, the commits on unmerged integration branches,
   the heads of open PRs, and whatever other sessions this session knows about, derive the files somebody else is
   working in. Tickets overlapping those files are not frozen into this set: list them as **awaiting ruling**
   with the source of the hold and its clearing condition. When any ticket is excluded, re-run the script over the
   remaining set and take the lines from that run's `line` — an exclusion can split a line.
4. **Join lines:** a line delivers one aggregate PR, so tickets that change the same file belong on one line. Save
   the predicted files of every ticket in the frozen set per step 3 of dispatch, then compare tickets on different
   lines: two lines whose predicted files overlap (one path covers the other) become one line; repeat until no two
   lines overlap. A joined line takes the `line` that sorts first among its members as its id, and ledger field 4
   records which of the script's `line` values it is made of; from then on, wherever a `line` selects an
   integration branch, all of those values select the same one.
5. From the current branch tip, create one `<run>/<line-slug>` **integration branch** and integration worktree
   per line. Accumulate that line's results there ticket by ticket.
6. When running standalone, rewrite `budget: spawns` and `budget: rounds` in ledger field 9 from the frozen ticket
   count per `ASKING.md` section 4. When composed by `have-it-all-done`, they were set before the ruling point;
   leave them.
7. When `docs/agents/commands.md` does not exist, generate it per the generation rules in `ASKING.md` section 0
   and commit it to each line's integration branch, after that branch is created and before any ticket is
   dispatched: the subject carries no ticket ID, and the content is the same on every line. Do not commit it to
   the user's current branch. Ticket branches are cut from the integration branch, so the implementation agent's
   worktree has the file.

**Hard rail:** tickets discovered or filed during the run remain context; the initial set never expands after
the freeze.

Done when: the tracker mode is selected and verified; every initial ticket has a publication source,
provider-native identifier, line, and blocker map; every ticket excluded as held by another line has the source of
the hold and a clearing condition; every ticket has predicted files, and no two lines' predicted files overlap;
every line has an integration branch and worktree created from the same base
tip; when running standalone, `budget: spawns` and `budget: rounds` have been set from the frozen ticket count;
every line's integration branch has `docs/agents/commands.md`, and where it was missing it was generated and
committed before any ticket was dispatched.

## 1. Advance the pipeline with `/loop`

Every startable ticket runs its own **pipeline**: dispatch → implementation → close-out (review, fix,
integration). Tickets do not move in batches and do not wait on each other: tickets are **mutually exclusive** only
when their predicted files overlap, never merely for sharing a line, and overlap is judged across the lines of one
repository too; a ticket is closed out as soon as it is done, and every integration immediately recomputes the
frontier and dispatches whatever has become startable.

Every ticket has a **stage** in the reconciliation table: candidate → expanding (waiting on the expansion agent) →
implementing → in review → fixing → queued (waiting in the integration queue) → integrating → an end state
(delivered, stuck, awaiting ruling). **In flight** means implementing through integrating; a ticket sent back for a
redo returns to candidate. On resuming (`ASKING.md` section 7), the stage and the responsible agent's id are how
every ticket short of an end state is picked back up.

Start a self-paced `/loop` with no interval and the prompt `get-to-work: re-read <absolute ledger path> and the
rule files its field 10 lists, then advance the pipeline`; with no ledger, the prompt names the absolute paths of
this skill's `SKILL.md` and `ASKING.md` to re-read instead. Every wake-up carries that sentence, so the resuming
(`ASKING.md` section 7) never depends on memory.

Implementation, expansion, fix and merge agents always run in the background, each under a **stage time limit**;
an **agent in flight** is any agent whose deadline in the reconciliation table is not `—`, expansion agents and
red-light fix agents included (time limits). Every wake-up does, in order:

1. When a line is in red-light handling, read that line per reading CI.
2. Handle the agents that reported: take only reports whose agent id matches the one recorded in that ticket's
   row; when an old agent already `TaskStop`ped or replaced by a reassignment reports, do not take it, and note it in
   that ticket's status record (agent id, time of the report, ignored). A ticket whose implementation or fix agent
   reported moves on through close-out; an expansion or merge agent's report goes back to the step waiting on it.
3. **Deadline scan:** handle overdue agents in flight per time limits.
4. Integrate reviewed tickets through each line's **integration queue** (close-out steps 4–8).
5. When a **dispatch point** has been triggered, run one at the end (dispatch).
6. Write the ledger current. There is no batch boundary: the end of every wake-up is the handover point.
7. While any agent is still in flight, schedule a **fallback wake-up** (time limits), and only then end the
   wake-up.

### Reading CI

Dispatch points and finishing the run go by **the CI result for the integration branch's latest SHA**; while a line
is in red-light handling, every wake-up reads that line as well. The latest SHA is
`git rev-parse origin/<integration branch>`; when it differs from the local integration branch, push first per
close-out step 6, then read (a line never pushed, or settled as not covered by CI, is not read). This skill's
`scripts/ci.mjs` classifies the result; do not work it out from the run list yourself:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/ci.mjs" verdict <integration branch> <SHA>
```

Run it inside the repository; elsewhere, add `--repo <owner>/<repo>`. Only GitHub Actions is read; any other CI is
invisible here and counts as no run. The script turns all of one SHA's runs into one result, the `verdict` of its
output; the order of the rules and the output format are in the script's header. The script only reads: what follows
a result is yours to do. Record the result and its SHA in ledger field 4, then go by the result:

- **Query failed** (`query-failed`): do not guess: record the reason given in `error`, and read again next time.
- **No run** (`no-run`): `reason` is `empty` (the list is empty) or `no-success` (every run completed and not one
  is a `success` — a SHA whose runs are all `skipped` or `neutral` has no run; it is not green). A just-pushed SHA
  may not be registered yet, so treat it as still running first. <!-- pending #100 -->Only
  when two dispatch points in a row read an empty list, and `gh run list --branch <integration branch> --limit 1
  --json databaseId` is empty too (the branch has never had a run), is the line settled as **CI does not cover the
  integration branch**; that holds through finishing the run, and the line's CI is not read again.
- **Red** (`red`): go through the red-light handling in [`RED-LIGHT.md`](RED-LIGHT.md).
- **Still running** (`running`): do not wait and do not poll; next time, read the
  then-latest SHA — every run covers the full suite, so a newer SHA covers the older ones.
- **Cancelled** (`cancelled`): run `gh run rerun <id>` for every id listed in the output's `rerun`, and treat it as
  still running.
- **Green** (`green`): at least one run is a `success`, with nothing red, still running or cancelled. Carry on as
  usual.

**Lines on local verification.** In the pipeline, a line with no `origin`, or one settled as not covered by CI, has
no CI to read: at the moments it would have been read — a dispatch point; every wake-up while the line is in
red-light handling — run the "local verification" below on the integration branch's latest SHA
(`git rev-parse <integration branch>`) instead, and record it. A line whose local verification is red is treated exactly like a
line whose CI is red, and goes through the red-light handling in `RED-LIGHT.md`.

**Local verification** (this skill's one source of truth for it; everywhere else points here): with no `origin`, a
line settled as not covered by CI, or no verdict for this SHA (a failed query, or still no run on the second read),
run the repository's full checks locally once on this SHA instead, and the report says which case it was. The
repository's full checks are the "Full checks" of `docs/agents/commands.md` when this SHA's tree has that file,
each command run as written; without the file, or when its "Full checks" reads `none`, find them yourself from the
manifest and the CI configuration, as before, and give the source as `self-found` — `none` never means "no checks,
record a green".
The full verification report states, next to the source, whether the commands came from `commands.md` or were
found by the host (`self-found`). Run them in the integration worktree while its tree is exactly this SHA: when finishing the run, wait for a merge
agent still resolving a conflict; at a dispatch point or wake-up in the pipeline, when the integration worktree's
tree is not this SHA (an integration is under way), do not wait and do not verify this time — the line keeps its
previous result, dispatching as usual unless it is in red-light handling — and the dispatch point that
integration triggers verifies the then-latest SHA. Lines in the first two cases are verified per SHA throughout the pipeline, per
section 1, reading CI, not only when finishing the run.

**Every local verification appends one per-SHA local verification record for the line to ledger field 4**, a
single line: `local: <integration branch> <full SHA> <green or red> <reason>` — the leading `local:` says the
source is local, and the reason is `no-origin`, `ci-not-covering` or `no-verdict` (the three cases above). One
record per SHA, and a new record never overwrites an old one; a SHA that already has a record is not re-run,
and that record's result stands. Save the output as the checks run (`RED-LIGHT.md`, red-light handling point 3). A local red goes
through the whole of `RED-LIGHT.md`'s red-light handling (points 1–6); after each fix round, re-run locally on the new
SHA.

**Red-light handling** lives in the sibling [`RED-LIGHT.md`](RED-LIGHT.md): when a line turns red, or while a line is in red-light
handling, read it in full on reaching this point and follow it.

Done when: every line due a CI read had its latest SHA's result read and recorded in the ledger; on a line on local
verification, every SHA verified has a record in ledger field 4, and so does a `no-verdict` local verification on a
line with CI.

### Budget and breaker

The limits and their usage live in ledger field 9 (`ASKING.md` section 7). Usage is updated at two points: first
thing at every dispatch point (the three steps below), and at the end of every ticket's close-out when the ledger is
written current (step 1 only; progress and the limits are judged only at dispatch points).

1. **Update usage:** update the spawn count and elapsed time per `ASKING.md` section 7, field 9 (which also says how
   the start time is recorded).
2. **Judge progress and the limits:** this skill's `scripts/deadline.mjs` judges them; do not compare by hand:

   ```bash
   node "${CLAUDE_SKILL_DIR}/scripts/deadline.mjs" progress <plan.json>
   ```

   You write the plan file; its format and the rules are in the script's header: the progress snapshot field 9
   records from the last dispatch point (`null` at the first one), each line's integration-branch tip SHA now, the
   tickets in the reconciliation table that have reached an end state (delivered, stuck, awaiting ruling), field 9's
   consecutive no-progress count so far, the usage (dispatch points, spawns, and the elapsed time step 1 worked out)
   and the four limits. Run it at dispatch points only: not on a wake-up spent waiting on agents, nor on one that
   only moves close-outs along. The input holds tips and end-state tickets and nothing else — a ticket moving
   between stages short of an end state, a send-back for a redo and commits on a ticket branch are not in it: an
   attempt that was never merged changed no delivery.
3. **Act on the output:** record `noProgress` (the consecutive no-progress count) and `snapshot` (this progress
   snapshot) in field 9. When `stop` is `true`, **stop**; `stoppedBy` lists the limits that stopped the run. Only
   when it is `false`, set the dispatch-point count to the output's `rounds` and go on dispatching.

**Stopping:** this dispatch point dispatches and expands nothing, and no dispatch point follows it. Tickets in flight
go on through close-out until they are integrated, stuck or sent back, with CI reads and red-light handling (`RED-LIGHT.md`) as usual;
a ticket sent back is not dispatched again. Mark every ticket of the frozen set never dispatched (expanding ones
included), sent back and waiting for a redo, or whose spawn was blocked, **awaiting ruling**, with the limit that
stopped the run and the usage at the time as the reason. Record the stop reason in field 9; for the no-progress
breaker, write for each undelivered ticket which step it was stuck at over these last dispatch points and what it was
waiting on, pointing at its status record. From then on, wind down per the stop conditions at the end of "Filing along
the way".

When the plugin's hook blocks a spawn on budget grounds while dispatching or during a close-out: do not retry it and
do not route around it. Agents already dispatched are closed out as usual; tickets not dispatched, and tickets whose
close-out cannot go on without the blocked agent, are marked as in the previous paragraph, and the next dispatch point
stops at step 3. When a finishing step needs a spawn and is blocked, put it on the human-work list per `ASKING.md`
section 4.

Done when: every dispatch point first updated field 9's usage and judged progress and all four limits, and every
ticket's close-out updated usage at its end; after stopping nothing more was dispatched, every undelivered ticket is
awaiting ruling with the limit that stopped the run, and field 9 has the stop reason; no spawn blocked on budget was
retried or routed around.

### Time limits

Claude Code cannot put a time limit on a subagent, so the host scans for one at every wake-up. An **assignment** gives
work to a background agent: spawning an implementation, expansion or merge agent, or handing a batched fix, a
red-light fix or a send-back record back to the original agent with SendMessage; a fix handed to an agent when a red
maps to no ticket counts too. The review host agent of close-out (close-out step 2) is spawned in the foreground, and
the finders, verifiers and Fix Verifiers under it are dispatched in the foreground too (`prove-it` section 2): the whole
review runs to completion inside the host's own turn, and the host is not woken while it waits on it, so review has no
time limit and no assignment record.

**A spawn's `description`:** every time you spawn an agent, the Agent tool's `description` starts with that agent's
role word, followed by the ticket's identifier (`#N` on GitHub, the ticket file name in Local Markdown), as in
`implement #72`. The role words: `expand` (an expansion agent, followed by every ticket it covers, as in
`expand #75 #83`), `implement` (an implementation agent, including one spawned anew after a send-back and one
reassigned while implementing), `fix` (an agent reassigned while fixing), `ci-fix` (an agent newly spawned for a
red-light fix; when the red maps to no ticket, followed by that line's integration branch), `merge` (a merge
agent) and `review` (the review host agent); the `finder`, `architect`, `verifier` and `fix-verifier` it spawns are in `prove-it`'s
own rules. Those second-level spawns still carry the host's session id, so the hook counts them against the run's
spawns and blocks them at the limit all the same. The plugin's hook records each
spawn's agent type and this `description` in `<run>.counters.json` beside the ledger, and the spawn breakdown when
finishing (`FINISH.md`) relies on this prefix to tell which kind of work a general-purpose agent did and for which
ticket: a spawn with a wrong prefix is counted under `general-purpose`.

The **stage time limits** are four `budget:` lines in ledger field 9, in minutes (`ASKING.md` section 7):
`timeout-implement` (implementing), `timeout-fix` (fixing, red-light fixes included), `timeout-expand` (expanding)
and `timeout-merge` (the merge agent while integrating).

**Assignment record:** at every assignment, compute it with this skill's `scripts/deadline.mjs` and copy it, with
the agent id and the agent type, into that ticket's row of the reconciliation table (for an expansion agent, into the row of every
ticket it covers):

```bash
node "${CLAUDE_SKILL_DIR}/scripts/deadline.mjs" record --worktree <worktree> --limit <stage time limit>
node "${CLAUDE_SKILL_DIR}/scripts/deadline.mjs" record --expansions '<ticket>=<n>' [--expansions '<ticket>=<n>' …] --limit <stage time limit>
```

- The output gives the assigned time, the stage time limit, the deadline, extended (`no`) and the **progress
  fingerprint**. Times are always UTC, written `YYYY-MM-DDTHH:MM:SSZ`.
- The agent type is the `subagent_type` the Agent tool actually used at the spawn (`sorry-matt:expander` for an
  expansion agent, `general-purpose` when it fell back to a general-purpose agent); an assignment handed back to the
  original agent with SendMessage keeps that agent's type.
- In the first form, `<worktree>` is the worktree the agent works in: for implementation and fixes the ticket
  worktree (for a red-light fix, the `-ci` branch's worktree; for one that maps to no ticket, the integration
  worktree); for merging, the integration worktree. The progress fingerprint is its HEAD and the tree of its whole
  working tree (untracked files included, ignored ones not), computed as the script's header says; the real index
  and the working tree are left alone.
- An expansion agent works in no worktree; use the second form: `--expansions` takes the `expansions` count
  `acceptance.mjs` reads for each ticket it covers, and those numbers are its progress fingerprint. Always quote
  `<ticket>=<n>`: unquoted, a shell reads `#12=0` as a comment.

**An assignment with no assignment record does not stand.** Run `record` first; only when it succeeds, spawn or
SendMessage, then add the agent id to that row — so no agent ever runs without its record in the reconciliation
table. When `record` exits non-zero, stdout is empty and you do not assign: exit code 2 is a bad argument, so correct
it and run again; exit code 1 means this worktree's progress fingerprint cannot be computed, and its state needs a
person: do not assign the work some other way instead. Settle it by the work you were about to assign, with stderr
as the reason (an expansion agent's `record` reads no worktree, so it never exits 1):

- **Implementation, a batched fix** (a red-light fix excepted) → mark the ticket **awaiting ruling**.
- **A merge agent** → first `git -C <integration worktree> merge --abort` to put the integration worktree back to
  where it was before the merge, then mark the ticket **awaiting ruling**; the queue moves on to the next ticket.
- **A red-light fix** → it counts as one failed fix round and no further round is started: when it maps to a ticket,
  go straight to the revert in `RED-LIGHT.md`, red-light handling point 5; when it maps to no ticket, find the line
  to have failed verification per point 6.

All three trigger a dispatch point per "Dispatch".

Once the agent reports or is stopped, set that row's deadline to `—`. An **agent in flight** is any agent whose
deadline is not `—`.

**Deadline scan:** every wake-up — a `/loop` wake-up, an agent notification and a fallback wake-up all count — runs
it after handling the agents that reported. Write the assignment record of every agent in flight into a plan file
(format in the script's header; for an expansion agent, add each of its tickets' `expansions` count now) and run:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/deadline.mjs" scan <plan.json>
```

An agent whose `overdue` is `true` in the output is **overdue**, and its `action` is the handling the script judged:
`extend` (extend once) or `stop`. The script only computes: it stops no agent and writes no ledger.

- **A non-zero exit:** stdout is empty and no agent has been judged. Stop or extend no agent on that basis: fix the
  plan file as stderr says and run it again; it must succeed before this wake-up ends.
- **An agent whose `error` is not `null`:** it is overdue, but its progress fingerprint could not be computed (the
  worktree is gone, git refuses, a file is locked), and its `action` is `null`; the other agents are judged as usual.
  When the cause is a wrong worktree in the plan file, correct it; then run `scan` once more. If the `error` is still
  there, handle the agent as a `stop` — progress that cannot be shown earns no extension — and write the `error`
  into its timeout handling. An agent with an `error` is not counted in `fallback`.

For each overdue agent:
handle it per the sibling [`TIMEOUTS.md`](TIMEOUTS.md) — extending, the cases after a stop,
keeping a record; when the deadline scan finds an overdue agent, read it in full on reaching this point and follow it.

**Fallback wake-up:** whenever a wake-up ends with agents still in flight, schedule the next wake-up, so that the
host wakes when the first time limit runs out even if no agent ever reports. A wake-up that assigned any work always
ends with an agent in flight, so every assignment is followed by one. The delay comes from the `fallback` in `scan`'s
output (`null` means no agent is in flight after the scan); when this wake-up assigned work after the deadline scan (a
reassignment, a dispatch point), run `scan` again on the latest reconciliation table and take that run's `fallback`.

- **`ScheduleWakeup`** (available in the dynamic `/loop` mode that section 1 enters): schedule
  `fallback.scheduleWakeup` seconds — it accepts only 60 to 3600 seconds, and the script has already clamped the
  value. When that wake-up finds nothing overdue, schedule again per this paragraph.
- Without `ScheduleWakeup`: run `sleep <fallback.seconds>` in the background with Bash (no upper bound), and record
  its task id in ledger field 9. Keep only one: before scheduling a new one, `TaskStop` the previous one field 9 records
  (skip it if it has finished). The notification when it ends is the wake-up; its first action is re-reading the
  ledger and the rule files per resuming in `ASKING.md` section 7, then the wake-up steps of section 1.
- When a background `sleep` is not available either: re-enter section 1's `/loop` in interval mode, with the same
  prompt and the shortest stage time limit as the interval. End that interval loop once no agent is in flight and
  the run has stopped per the stop conditions at the end of "Filing along the way".

With no agent in flight, `/loop` paces itself as before.

Done when: every assignment left an assignment record (agent id, agent type, assigned time, stage time limit,
deadline and progress fingerprint) in the reconciliation table; every spawn's `description` starts with its role word,
followed by the ticket's identifier; every wake-up scanned every agent in flight after handling
reports, expansion and red-light fix agents included; no report from a superseded agent was taken; every wake-up that ended with agents in flight scheduled a fallback wake-up,
with at most one background `sleep` at a time.

### Dispatch

A **dispatch point** is triggered at these moments and runs once, at the end of that wake-up, at most one per
wake-up: the first wake-up; a ticket integrated into an integration branch or reverted; a ticket leaving the pipeline
(stuck, awaiting ruling, sent back for a redo); a red line turning green or being found to have failed verification;
an expansion agent reporting. No other wake-up dispatches.

Every dispatch point first checks the limits per budget and breaker; when the run does not stop, it reads each line
per reading CI. A red line goes through the red-light handling (`RED-LIGHT.md`) and dispatches nothing new until it is green or the
culprit is reverted; any other result dispatches as usual.

Then re-run `scripts/frontier.mjs`; the **frontier** is its `frontier` output:

- **GitHub:** tickets integrated into their line integration branch are still open on GitHub (closing waits for the
  aggregate PR's merge), so take the integrated tickets from the ledger's reconciliation table and pass them with
  `--done <n,...>`; pass stuck tickets with `--stuck <n,...>`.
- **Local Markdown:** run once per line, passing the whole frozen set with `--ref <that line's integration branch>`
  and `--line <that line's line>` (the value from the freeze; for a joined line, run once for each `line` it is
  made of, all with that one integration branch as `--ref`); the frontier is the union of each output's `frontier`.
  Done and stuck come from the `sorry-matt completion` / `sorry-matt blocker` records in the ticket files on that
  branch, and `ready-for-human` does not count as done.

A ticket whose `stalled` is not null (`cycle`, `missing`, `blocked-external`, `blocked-upstream`) cannot become
startable within this run: list it as **awaiting ruling** with the reason and the blockers involved. Record
`warnings` in the ledger; they do not change the result.

Order the **candidates** so that a ticket more tickets of the frozen set name as a blocker comes earlier, ties in
frontier order: when files overlap, the ticket that unblocks the most goes first.
The candidates are the frontier tickets at the candidate stage; expanding tickets, tickets in
flight and tickets in an end state are not. Candidates on a line that failed verification are marked awaiting ruling
(`RED-LIGHT.md`, red-light handling point 6) and go no further. Whoever writes the criteria must not be the one who has to
pass them, so the implementation agent only reads the criteria; it neither writes nor changes them. For each
candidate, in order:

1. **Acceptance:** read the ticket's criteria and where each came from with this skill's `scripts/acceptance.mjs`,
   not by reading the ticket text yourself:

   ```bash
   node "${CLAUDE_SKILL_DIR}/scripts/acceptance.mjs" github --repo <owner>/<repo> <n>
   node "${CLAUDE_SKILL_DIR}/scripts/acceptance.mjs" local --ref <that line's integration branch> <ticket file path>
   ```

   The output format is in the script's header. Tickets with `needsExpansion` true (not a single criterion, usually
   a ticket whose full expansion was deferred until it reached the frontier) go to an **expansion agent**: read
   the sibling [`EXPANDER.md`](EXPANDER.md), fill its placeholders with every such ticket at this dispatch point, and
   spawn one expansion agent in the background with the filled-in text as its prompt, adding no rules of your own.
   The Agent tool's `subagent_type` is `sorry-matt:expander` — the plugin's agent definition file
   `agents/expander.md`, which sets the expansion agent's model and tools, so the host specifies neither; the
   `description` is `expand` followed by the identifier of every ticket in this batch (time limits). When that
   agent type is not in the available list, use a general-purpose agent instead, with no model specified and the
   same prompt and `description`, and record the agent type as `general-purpose` in the assignment record of every
   ticket in this batch: it then runs on the host's model with every tool, not on what the definition file sets, and
   the reconciliation table and the run metrics have to show that. It writes an expansion block on the tracker stating `by`, `run` and `round`, where `round` is this dispatch
   point's number (field 9). These tickets move to the expanding stage and go no further at this dispatch point, so
   the next dispatch point does not spawn an expansion for them again. The expansion agent's report triggers a
   dispatch point, where they return to candidate and re-run the script from this step; a ticket still true, or
   reported as awaiting ruling, is listed as **awaiting ruling**, is not dispatched again in this run, and is
   dropped from the frontier at later dispatch points.
2. **Acceptance snapshot:** save the script's output as `sorry-matt/runs/<run>/acceptance/<ticket>.json`, where
   `<ticket>` is the ticket number or file name (in the common directory beside the ledger; in the scratchpad when
   there is no ledger), and never overwrite it once saved. It is the baseline close-out compares against to tell
   whether the criteria were changed. Record the output's `sha256` in that ticket's row of the ledger's
   reconciliation table as well: the snapshot's path can be worked out, so the acceptance diff uses this value to
   prove the snapshot itself was not edited. A ticket dispatched again after being sent back keeps its snapshot and
   is not expanded again.
3. **Predicted files:** the files the ticket will touch, kept in `sorry-matt/runs/<run>/files/<ticket>.txt`: one
   repository-relative path per line, each covering itself and everything under it, `/` for the whole repository.
   At the freeze (section 0, join lines) the host already saved one for every ticket, working in the integration
   worktree; for a ticket expanded at this dispatch point, add the paths its expansion block names that the list
   does not cover. The sources, in order:
   - paths the ticket text, its expansion block and its criteria name;
   - for the modules, skills, commands, config keys or identifiers the ticket names, their definitions and main uses
     as `git grep -l` and `git ls-files` find them;
   - files the repository's rule files (`AGENTS.md`, `CLAUDE.md` and the like) require to change along with them,
     such as translations.

   **Predict files:** write a directory only when the ticket names the whole directory, and `/` only when nothing
   can be inferred. **Index files stay off the list:** files to which every ticket adds a line of its own — a
   vocabulary table, an index table, CI's list of tests, a README table, an array in a manifest — are touched by
   nearly every ticket, and listing them would make all tickets mutually exclusive; where two tickets each added a
   line, the merge agent keeps both (close-out step 4). The list only grows: at expansion, and when the ticket is
   sent back (`SEND-BACK.md`). The host makes the prediction; the implementation agent reports nothing before
   starting.
4. **File overlap:** write one plan per repository, `sorry-matt/runs/<run>/overlap/<n>.plan.json` (`<n>` is the
   dispatch-point number; with several repositories the name starts with `<repo>-`), covering every line in that
   repository: `running` lists the tickets in flight with their predicted files, their ticket worktrees and their
   line's integration branch as `base`; `candidates` lists the candidates with their predicted files. Run this
   skill's `scripts/overlap.mjs` and save its output beside the plan as the same name ending in `.json`:

   ```bash
   node "${CLAUDE_SKILL_DIR}/scripts/overlap.mjs" <plan file>
   ```

   The output format is in the script's header. A ticket in flight holds the files its worktree has already touched
   as well as its predicted files. Every ticket in `start` is dispatched at this dispatch point, so tickets on the
   same line whose files do not overlap start together; tickets in `wait` stay candidates and are judged again at
   the next dispatch point. Overlap is judged across lines too: once lines are joined, no two lines' predicted
   files overlap, so what can still collide is a file a ticket in flight actually touched and its prediction did not
   cover; holding one back keeps changes to the same place from running in parallel.
5. From the latest tip of its line integration branch, create the `<run>/<NN>-<slug>` ticket branch and a ticket
   worktree. With Local Markdown the expansion block is already committed on the integration branch, and the ticket
   branch is cut after it.
6. Read the sibling [`IMPLEMENTER.md`](IMPLEMENTER.md), fill in its placeholders, and spawn one implementation
   agent in the background with the filled-in text as its prompt, adding no rules of your own; the `description` is
   `implement` followed by the ticket's identifier (time limits). Fill the
   expansion-block placeholder from `expansions[].text` in that ticket's acceptance snapshot: on GitHub the
   expansion block is a comment, so the ticket text does not contain it. Fill the project command contract
   placeholder with the absolute path of `docs/agents/commands.md` in the ticket worktree, or none when the file
   is not there. The **status record** it defines is that
   ticket's own source of truth; everywhere else cites it. For a ticket dispatched again after being sent back:
   when the original agent is still there, give it the send-back record and the rebuilt worktree with SendMessage
   instead of spawning; only when it is gone, spawn a new one per `IMPLEMENTER.md` (its `description` likewise
   `implement` followed by the ticket's identifier) with the send-back record in its placeholder. The reconciliation table records each ticket's stage and its responsible agent's id, along with the
   assignment record from time limits.

Done when: every dispatch point first judged the limits per budget and breaker, then read the lines due a read per
reading CI, before dispatching anything; every dispatched ticket had acceptance criteria, an acceptance snapshot and
predicted files before its implementation agent was spawned, every criterion added by expansion came from the
expansion agent and states `by`, `run` and `round`, and no expanding ticket was sent to expansion twice; every
dispatch point has an `overlap.mjs` plan and output for every repository, every ticket in `start` was dispatched, and
no dispatched ticket overlapped a ticket in flight on any line of its repository; every frontier ticket is expanding
or in flight, waiting in `wait` with its overlap as the reason, or listed as awaiting ruling; every implementation
agent's prompt is the full `IMPLEMENTER.md` text with its placeholders filled.

### Close-out

Once its implementation agent reports, the ticket goes through these gates one after another, waiting for no ticket
on its line or elsewhere. The order is fixed — **targeted checks → one independent review → batched fix →
re-check by affected surface → integration**. The full suite belongs to CI: every integration pushes the
integration branch, CI runs in the background, the host does not wait, and the next dispatch point reads the result.

1. **Targeted checks:** confirm the affected-surface checks the agent reported are green. Red goes back to the
   original agent first to be fixed until green; only green tickets come to review.
2. **Independent review:** first run the acceptance diff — re-read the ticket with `acceptance.mjs` plus
   `--against <acceptance snapshot> --sha <the sha256 in the reconciliation table>` (for Local Markdown, with
   `--ref <ticket branch>`) and save the output. Exit code 3 means the snapshot itself was edited; save the output
   and hand it to the review all the same, with `check.changed` true. Then read the sibling
   [`REVIEWER.md`](REVIEWER.md), fill in its placeholders, and spawn one **review host agent** **in the foreground**
   with the filled-in text as its prompt, adding no rules; its `description` is `review` followed by the ticket's
   identifier. The placeholders: mode `initial`, the ticket (identifier, and the file holding the original ticket text
   and the expansion block), the paths of the acceptance snapshot and of the acceptance diff output, the fixed point
   (the line integration branch), the ticket branch, the targeted-check results from step 1, where the ticket's
   status record is, and the line's CI coverage — `no-origin` when there is no `origin`, `uncovered` when the line
   was ruled "CI does not cover the integration branch", `covered` otherwise; on a line with CI the review runs only
   the affected scope and leaves the full suite to the CI run after integration. It calls the Skill tool with
   `prove-it`, and in its own context dispatches the finders and verifiers, does the live run and mutation limited to
   this ticket's diff, rules, and writes the fixed-format `pass` / `fix` / `stuck` verdict and finding list into the
   ticket's status record. The host does not load `prove-it`; it takes only the agent's final **review report**: six
   lines at most, the first `<!-- sorry-matt:review-report -->`, holding the verdict, the counts of findings,
   observations and pre-existing items, and where the review block is — never the findings' text. `pass` goes on to
   integration, `fix` to the batched fix, and `stuck` is cleared using the condition the report states, then the
   agent is spawned again in the same mode (in mode `recheck` the previous review block is always "in the status
   record"; in mode `initial` it is none when the report's `completed` is `none`, and "in the status record" otherwise,
   so it resumes per `prove-it` section 5); when the reason is
   `budget`, mark the ticket awaiting ruling per "Budget and breaker"; anything else that cannot be cleared —
   `no Agent tool` (the spawn depth limit reached) included — marks the ticket stuck (`SEND-BACK.md`). **One ticket
   gets this one reviewer by default**, its lenses covering standards and spec conformance together. Add a specialist
   reviewer only where a concrete risk calls for one, naming the risk, recording the rationale in the self-answer log,
   and writing it into the brief's reviewer placeholder; "another look, to be safe" is not a risk. On a `full`-tier
   ticket `prove-it` adds the `architecture` specialist reviewer itself from its tier output; it goes into no
   placeholder and no self-answer log.

   **The host carries out the review report.** `prove-it`'s `tier` sets how deep the review goes, and its verifiers
   judge what is blocking; the host's job is to act on the verdict: `findings` go to the fix (step 3); when the count
   of `observations` or `pre-existing` is not 0, the host reads just those two parts of the review block and files them
   into one raw ticket per "Filing along the way". The ticket moves on by `verdict`.
3. **Batched fix:** hand the review block's `findings` back to the original context-holding agent all at once: give
   it where the review block is and have it read the `summary`, `evidence` and `fix` text of each finding there; the
   host does not restate them. The fix's scope is closing them, in one round. Afterwards re-run the targeted checks for
   the affected surface and the acceptance diff, then spawn the review host agent in the foreground as in step 2, in
   mode `recheck`, with the new acceptance diff output, the same CI coverage, and the previous review block set to
   "in the status record": it verifies only whether those findings are closed. **A ticket gets at most two correction rounds**, counted in the
   ticket's verification result in the reconciliation table; a new finding raised by a recheck counts within the
   same rounds. When the second round's `recheck` is still `fix`, mark the ticket stuck (`SEND-BACK.md`), attaching
   the findings still open to the stuck record.

   **Hard rail — a flaky red is chased to its root cause.** A test that goes red and green on the same commit is
   treated as a real failure: find the root cause; when it lies in how the test is written, fix the test; when it
   lies in the product, fix the product or file a defect ticket. Re-running, loosening a wait, adding a retry and
   raising a timeout all leave it unfixed. If two correction rounds do not find the root cause, mark the ticket
   stuck (`SEND-BACK.md`).
4. **Integrate:** a ticket that passed review joins its line's **integration queue**: a line integrates one ticket at
   a time, in the order they joined; the queue of a line in red-light handling pauses (`RED-LIGHT.md`). When its turn
   comes its stage becomes integrating, and it is merged in the integration worktree with
   `git merge --no-ff --no-edit <ticket branch>`: one merge commit per ticket, carrying git's default message
   `Merge branch '<ticket branch>'`. Once merged, record its SHA (`git rev-parse HEAD`) among that ticket's merge
   SHAs in the ledger's reconciliation table, red-light `-ci` merges included: red-light mapping and the
   **per-ticket guide** at finishing (`FINISH.md`) both go by it, and the subject is only the fallback when no SHA was recorded.
   That merge's second-parent range, `<merge>^1..<merge>^2`, is exactly this ticket's commits.
   Where there are conflicts, give them to a **merge agent** to resolve hunk by hunk (the Agent tool's `description` is
   `merge` followed by the ticket's identifier, time limits): it gets the integration
   worktree, both sides' ticket text and commit messages, and this test — the choice is between two intents rather
   than two blocks of text, so trace each side to its primary source (the ticket text and the commit message), keep
   both where they are compatible (in an index file, every line either side added stays), and where they are not, take the side that matches this merge's goal, with what
   lands limited to behaviour one side actually wrote. The resolution lives only in this merge commit (finished
   with `git commit --no-edit`), and the ticket branch is never rewritten; a local
   `git show --remerge-diff <merge>` (git 2.36+) shows just the resolution, which GitHub's web views cannot show.
   The merge agent reports the trade-off per hunk, and the host records those trade-offs in the self-answer log.
   Then run the targeted checks for the affected surface; anything more to change goes into a separate commit
   on the integration branch, with no ticket ID in its subject. When the merge agent reports it cannot resolve the
   conflict safely, run `git merge --abort`; the ticket is **sent back for a redo** (`SEND-BACK.md`), and the queue moves on
   to the next ticket.
5. **Complete delivery:**
   - **GitHub:** the ticket stays open; closing it is the aggregate PR's job (section 2). This ticket's summary
     lives in its commit message (`IMPLEMENTER.md` section 2).
   - **Local Markdown:** on the integration branch, check every verified acceptance criterion in the ticket (the
     expansion block's included), set `Status` to `ready-for-human`, and append `## sorry-matt completion` with the
     implementation commit, integration branch, and passed checks. Commit this delivery record.
6. **Push:** with an `origin`, `git push -u origin <integration branch>`, in both modes; Local Markdown with no
   remote skips it, and finishing the run takes reading CI's local verification. Push once per integration,
   never batching several tickets into one push: a red light has to point at one integration. Do not wait for CI
   after pushing.
7. Remove the ticket worktree and local ticket branch.
8. **Refill:** this integration changed the frontier and the files in flight, so run a dispatch point at the end of
   this wake-up.

**Sending back for a redo** and **marking a ticket stuck** live in the sibling [`SEND-BACK.md`](SEND-BACK.md): when a
ticket is to be sent back for a redo or marked stuck, read it in full on reaching this point and follow it.

Anything that comes up mid-run takes the three exits in `ASKING.md` section 4. Running standalone, with no ruling
point, whatever cannot be answered accumulates until the next dispatch point and is asked there in one go.

Done when: every ticket that reported entered close-out without waiting for other tickets; every ticket went through
exactly one independent review (`prove-it` in `initial`; a `stuck` before the review opens does not count), each
correction round had one `recheck`, every review was hosted by a foreground review host agent and came with that
review's acceptance diff output against the acceptance snapshot, every verdict is in the status record, and the host
received only review reports of six lines at most; what went to each fix was the text of the review block's
`findings` (given by location, read by the original agent), no ticket had more than two correction rounds and each count is in the reconciliation table, and every
ticket with observations or pre-existing items has one raw ticket; its targeted checks are back to green, and it has either a
provider-native delivery that passed acceptance or a traceable stuck record; every ticket that gained a specialist
reviewer names the risk; each line integrated at most one ticket at a time, and no queued ticket was integrated into
a line in red-light handling; every integration is a `--no-ff` merge commit with git's default message and its SHA
recorded in the reconciliation table, any conflict resolution lives only in that merge commit, and no ticket branch
was rewritten; every integration was followed by a dispatch point; every ticket's status record is written current; successful tickets are
integrated and their ticket worktrees and local branches removed; on a line with an `origin`, every integration was
pushed on its own, and at the end of every wake-up `origin/<integration branch>` and the local integration branch are
the same SHA.

### Filing along the way

File out-of-scope bugs, prefactors, technical debt, and any defect whose root cause a flaky red exposed outside
this scope, only as raw tickets linked to the source finding:

- **GitHub:** use `gh issue create` without `ready-for-agent`; polish the body per `ASKING.md` section 6.
- **Local Markdown:** follow the tracker convention to create the next unused ticket file, set `Status` to
  `needs-triage`, and commit it on the line integration branch where it was found.

The `observations` and `pre-existing` of a `prove-it` review block: one raw ticket per reviewed ticket, listing each
item's location, its one sentence and its evidence path, and linking back to that ticket's status record. When a
recheck raises new observations, add them to the same raw ticket.

Keep these raw tickets outside both the initial set and this run's frontier.

Stop the loop when every initial ticket has a completed delivery. Also stop when no ticket is expanding or in
flight, no line is in red-light handling, and no candidate can be dispatched — there is none, or every remaining
candidate is on a line that cannot dispatch (failed verification) — but stuck or **awaiting ruling** tickets remain.
Also stop when budget and breaker has stopped the run and the tickets in flight are all closed out.

Done when: every initial ticket reconciles exactly once to delivered, stuck, or awaiting ruling; every raw
ticket filed along the way links its source and none has entered the frozen set.

## 2. Finish the run

Once the pipeline stops, finish the run. The three line-level gates, delivery, cleanup, merging, the merge queue,
closing tickets and the final output live in the sibling [`FINISH.md`](FINISH.md): read it in full on reaching this
point and follow it.
