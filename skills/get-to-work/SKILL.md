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
4. From the current branch tip, create one `<run>/<line-slug>` **integration branch** and integration worktree
   per line. Accumulate that line's results there ticket by ticket.
5. When running standalone, rewrite `budget: spawns` and `budget: rounds` in ledger field 9 from the frozen ticket
   count per `ASKING.md` section 4. When composed by `have-it-all-done`, they were set before the ruling point;
   leave them.

**Hard rail:** tickets discovered or filed during the run remain context; the initial set never expands after
the freeze.

Done when: the tracker mode is selected and verified; every initial ticket has a publication source,
provider-native identifier, line, and blocker map; every ticket excluded as held by another line has the source of
the hold and a clearing condition; every line has an integration branch and worktree created from the same base
tip; when running standalone, `budget: spawns` and `budget: rounds` have been set from the frozen ticket count.

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
run the repository's full checks locally once on this SHA instead, and the report says which case it was. Run
them in the integration worktree while its tree is exactly this SHA: when finishing the run, wait for a merge
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
maps to no ticket counts too. `prove-it`'s finders, verifiers and Fix Verifiers are dispatched in the foreground
(`prove-it` section 2): they run to completion inside the host's own turn, and the host is not woken while it waits
on them, so review has no time limit.

The **stage time limits** are four `budget:` lines in ledger field 9, in minutes (`ASKING.md` section 7):
`timeout-implement` (implementing), `timeout-fix` (fixing, red-light fixes included), `timeout-expand` (expanding)
and `timeout-merge` (the merge agent while integrating).

**Assignment record:** at every assignment, compute it with this skill's `scripts/deadline.mjs` and copy it, with
the agent id, into that ticket's row of the reconciliation table (for an expansion agent, into the row of every
ticket it covers):

```bash
node "${CLAUDE_SKILL_DIR}/scripts/deadline.mjs" record --worktree <worktree> --limit <stage time limit>
node "${CLAUDE_SKILL_DIR}/scripts/deadline.mjs" record --expansions '<ticket>=<n>' [--expansions '<ticket>=<n>' …] --limit <stage time limit>
```

- The output gives the assigned time, the stage time limit, the deadline, extended (`no`) and the **progress
  fingerprint**. Times are always UTC, written `YYYY-MM-DDTHH:MM:SSZ`.
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
person — mark the ticket **awaiting ruling** with stderr as the reason (which triggers a dispatch point per
"Dispatch"), or, for a red-light fix that maps to no ticket, put it on the human-work list per `ASKING.md`
section 4. Do not assign the work some other way instead.

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

Done when: every assignment left an assignment record (agent id, assigned time, stage time limit, deadline and
progress fingerprint) in the reconciliation table; every wake-up scanned every agent in flight after handling
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
  and `--line <that line's line>` (the value from the freeze); the frontier is the union of each line's `frontier`.
  Done and stuck come from the `sorry-matt completion` / `sorry-matt blocker` records in the ticket files on that
  branch, and `ready-for-human` does not count as done.

A ticket whose `stalled` is not null (`cycle`, `missing`, `blocked-external`, `blocked-upstream`) cannot become
startable within this run: list it as **awaiting ruling** with the reason and the blockers involved. Record
`warnings` in the ledger; they do not change the result.

The **candidates** are the frontier tickets at the candidate stage, in frontier order; expanding tickets, tickets in
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
   `agents/expander.md`, which sets the expansion agent's model and tools, so the host specifies neither. When that
   agent type is not in the available list, use a general-purpose agent instead, with no model specified and the
   same prompt. It writes an expansion block on the tracker stating `by`, `run` and `round`, where `round` is this dispatch
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
3. **Predicted files:** in the integration worktree, the host predicts which files the ticket will touch and saves
   them as `sorry-matt/runs/<run>/files/<ticket>.txt`: one repository-relative path per line, each covering itself
   and everything under it, `/` for the whole repository. The sources, in order:
   - paths the ticket text, its expansion block and its criteria name;
   - for the modules, skills, commands, config keys or identifiers the ticket names, their definitions and main uses
     as `git grep -l` and `git ls-files` find them;
   - files the repository's rule files (`AGENTS.md`, `CLAUDE.md` and the like) require to change along with them,
     such as translations, index tables and CI configuration.

   Err wide: a wide prediction costs a little parallelism, a narrow one collides at integration and sends the
   ticket back for a redo. When nothing can be inferred, write `/`. Do not have the implementation agent report its
   files before starting: that costs one more spawn and round trip, and its guess before reading the code is no
   better than the host's. Once saved the list does not change, except to widen it when the ticket is sent back
   (`SEND-BACK.md`).
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
   the next dispatch point. Overlap is judged across lines too: two lines changing the same file at once leaves
   their two aggregate PRs in conflict, and holding one back keeps changes to the same place from running in
   parallel. A ticket integrated into its own line's integration branch no longer holds its files; a conflict that
   remains between aggregate PRs is handled by section 2's base sync and the human merge.
5. From the latest tip of its line integration branch, create the `<run>/<NN>-<slug>` ticket branch and a ticket
   worktree. With Local Markdown the expansion block is already committed on the integration branch, and the ticket
   branch is cut after it.
6. Read the sibling [`IMPLEMENTER.md`](IMPLEMENTER.md), fill in its placeholders, and spawn one implementation
   agent in the background with the filled-in text as its prompt, adding no rules of your own. Fill the
   expansion-block placeholder from `expansions[].text` in that ticket's acceptance snapshot: on GitHub the
   expansion block is a comment, so the ticket text does not contain it. The **status record** it defines is that
   ticket's own source of truth; everywhere else cites it. For a ticket dispatched again after being sent back:
   when the original agent is still there, give it the send-back record and the rebuilt worktree with SendMessage
   instead of spawning; only when it is gone, spawn a new one per `IMPLEMENTER.md` with the send-back record in its
   placeholder. The reconciliation table records each ticket's stage and its responsible agent's id, along with the
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
   and hand it to the review all the same, with `check.changed` true. Then call the Skill tool with `prove-it` in
   mode `initial`, passing the ticket (identifier, the original ticket text and the expansion block), the paths of
   the acceptance snapshot and of the acceptance diff output, the fixed point (the line integration branch), the
   ticket branch, and the targeted-check results from step 1. The reviewer does the live run, and mutation limited
   to this ticket's diff, and it writes a fixed-format `pass` / `fix` / `stuck` verdict and finding list into the
   ticket's status record. `pass` goes on to integration, `fix` to the batched fix, and `stuck` is cleared using the
   condition it states, then `prove-it` is called again per its section 5. If it cannot be cleared, mark the ticket
   stuck (`SEND-BACK.md`). **One ticket gets this one reviewer by default**, its lenses covering standards
   and spec conformance together. Add a specialist reviewer only where a concrete risk calls for one, naming the
   risk and recording the rationale in the self-answer log; "another look, to be safe" is not a risk.
3. **Batched fix:** hand this ticket's findings back to the original context-holding agent all at once, fixed in one
   round rather than one finding at a time. Afterwards re-run the targeted checks for the affected surface and the
   acceptance diff, then call the Skill tool with `prove-it` in mode `recheck`, attaching the previous review block
   and the new acceptance diff output: it reruns the live run and mutation only on the lines the findings concern,
   and is not a second review. At most two correction rounds; still failing after two, mark the ticket stuck (`SEND-BACK.md`).

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
   Where there are conflicts, give them to a **merge agent** to resolve hunk by hunk: it gets the integration
   worktree, both sides' ticket text and commit messages, and this test — the choice is between two intents rather
   than two blocks of text, so trace each side to its primary source (the ticket text and the commit message), keep
   both where they are compatible, and where they are not, take the side that matches this merge's goal, with what
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
correction round had one `recheck`, every call came with that call's acceptance diff output against the acceptance
snapshot, and every verdict is in the status record; its targeted checks are back to green, and it has either a
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
