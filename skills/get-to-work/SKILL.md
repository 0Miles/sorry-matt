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
close-out step 6, then read (a line never pushed, or settled as not covered by CI, is not read):

```bash
gh run list --branch <integration branch> --commit <SHA> --limit 100 --json databaseId,workflowName,status,conclusion
```

Only GitHub Actions is read; any other CI is invisible here and counts as no run. All of one SHA's runs together give
one result, classified in this order, the first match winning; record the result and its SHA in ledger field 4:

- **Query failed:** `gh` exits non-zero. Do not guess: record why, and read again next time.
- **No run:** the list is empty. A just-pushed SHA may not be registered yet, so treat it as still running first. Only
  when two dispatch points in a row read an empty list, and `gh run list --branch <integration branch> --limit 1
  --json databaseId` is empty too (the branch has never had a run), is the line settled as **CI does not cover the
  integration branch**; that holds through finishing the run, and the line's CI is not read again.
- **Red:** some run's `conclusion` is `failure`, `timed_out`, `startup_failure`, `action_required` or `stale`. Go
  through the red-light handling below.
- **Still running:** some run's `status` is not `completed`. Do not wait and do not poll; next time, read the
  then-latest SHA — every run covers the full suite, so a newer SHA covers the older ones.
- **Cancelled:** some run is `cancelled`. `gh run rerun <databaseId>`, and treat it as still running.
- **Green:** anything else — every run is `completed`, with `conclusion` `success`, `skipped` or `neutral`.

**Lines on local verification.** In the pipeline, a line with no `origin`, or one settled as not covered by CI, has
no CI to read: at the moments it would have been read — a dispatch point; every wake-up while the line is in
red-light handling — run the "local verification" of section 2 step 3 on the integration branch's latest SHA
(`git rev-parse <integration branch>`) instead, and record it. When ledger field 4 already holds a record for that
SHA, do not re-run; that record's result stands. A line whose local verification is red is treated exactly like a
line whose CI is red: it dispatches nothing new and its integration queue pauses until it is green or the culprit is
reverted, and it goes through the red-light handling below.

**Red-light handling.** A red line **dispatches nothing new** and its **integration queue pauses** until it is green
or the culprit is reverted. Tickets in flight keep implementing, being reviewed and being fixed, and those that pass
review wait in the queue; the red-light fixes and reverts below do not queue. Integrating another ticket onto a red
line would carry the same red into every SHA after the earliest red one, hide the new ticket's own red, and, should
the fix leave it red, map the red back to the original ticket by mistake.

1. **Earliest red SHA:** aggregate `gh run list --branch <integration branch> --limit 200 --json
   headSha,status,conclusion` by `headSha`, classifying each SHA as above; walking
   `git log --first-parent --format=%H origin/<integration branch>` from newest to oldest, find the earliest red
   SHA — the nearest SHA before it with a verdict is green. On a line with CI, a local verification record whose
   reason is `no-verdict` (section 2 step 3) counts as that SHA's verdict and is judged together with the other
   SHAs' CI verdicts; the lower bound is still the nearest SHA with a verdict that is green. A line on local
   verification runs no `gh run list`;
   read the per-SHA local verification records in ledger field 4 instead: walking
   `git log --first-parent --format=%H <integration branch>` from newest to oldest, find the earliest red SHA — the
   nearest recorded SHA before it is green; with no earlier green record, the lower bound is
   `git merge-base <integration branch> <base branch>`.
2. **Map it to a ticket:** `git log --merges --first-parent --format='%H %s' <previous green SHA>..<earliest red SHA>`
   lists that stretch's merge commits; map them by the rules in the header of `scripts/review-guide.mjs` (the
   merge SHAs recorded in the ledger's reconciliation table come first; only tickets with no recorded SHA fall back
   to the subject). The host's commits — completion records, stuck records, tickets filed along the
   way — are not merges, so landing in between changes nothing. With several tickets (the pushes between them have
   no verdict), start from the earliest. With no merge mapped to a ticket — the red came from a host commit, the
   simplify pass or the base sync — it **maps to no ticket**. A line on local verification runs the same command
   with the two SHAs from point 1 (the previous green SHA or the lower bound, and the earliest red SHA), under the
   same mapping rules.
3. Save the failing jobs and steps with `gh run view <databaseId> --log-failed`; the host takes only the failing
   lines. A local verification has no run (on a line on local verification, and the `no-verdict` one on a line with
   CI): while running the checks, save their output to
   `sorry-matt/runs/<run>/verify/<line-slug>-<SHA>.log` (in the shared directory, next to the ledger); the red one
   is the failure output, and the host takes only the failing lines.
4. **Fix, two rounds at most:** when it maps to a ticket, hand it back to that ticket's original agent (if it is gone,
   spawn a new one per `IMPLEMENTER.md` with the failure summary attached to the ticket text), to fix on a
   `<run>/<NN>-<slug>-ci` branch freshly cut from the integration branch: the CI failure is the finding, and it goes
   through close-out step 3's batched fix (`recheck` attaching that ticket's previous review block) and steps 4–7,
   integrating without queueing. When it maps to no ticket, the host or the agent that ran that step fixes it in the
   integration worktree, commits (with no ticket ID in the subject) and pushes. The flaky-red hard rail applies. A
   fix agent stopped for running over its time limit counts as a round too (time limits).
   Every fix round ends with a push (skipped with no `origin`), and the next verification gives its result: in the
   pipeline that is the next CI read (for a line on local verification, the local verification run then, on the new
   SHA); when finishing the run, it is section 2 step 3 verifying again on the spot.
5. **Still red after two rounds, mapped to a ticket: revert.** `git revert -m 1 <that ticket's merge commit>`, and
   take back its completion record:
   - **GitHub:** file the raw issue per close-out's "mark it stuck"; later dispatch points move the ticket from
     `--done` to `--stuck`.
   - **Local Markdown:** `git revert` the commit holding the completion record, then append `## sorry-matt blocker`
     per close-out's "mark it stuck", giving the red CI and the reverted commit as the reason. The frontier reads a
     blocker after the completion record as stuck, so a completion record the revert missed still does not count as
     done.

   Its row in the ledger's reconciliation table becomes stuck, and the aggregate PR lists it as a gap. Integrated
   tickets that depend on it become gaps as well: their merges stay, their reconciliation rows say "upstream
   reverted", GitHub moves them from `--done` to `--stuck`, and Local Markdown appends a blocker to each naming the
   upstream; the aggregate PR writes no `Closes` for any of them. Tickets depending on it that are still in flight
   (queued ones included) leave the pipeline as **awaiting ruling**, with "upstream reverted" and the revert commit as
   the reason: an agent still running is not closed out when it reports; its branch tip is kept, as in close-out's
   send-back for a redo, at `refs/sorry-matt/<run>/<NN>-<slug>/upstream-reverted`, and then its worktree and branch
   are removed. Push, and the next verification gives the result as usual. To integrate the reverted ticket again
   later, first undo the revert with `git revert <the revert commit>`; otherwise Git considers it already merged and
   brings none of its changes back.
6. **Still red after two rounds, mapped to no ticket:** the line has **failed verification**: send no `gh pr merge`,
   enter no merge queue, say so in the aggregate PR and leave it for a human to merge, with the failing jobs in the
   human-work list. The line dispatches nothing from then on: its candidates and the tickets never dispatched on it
   are marked awaiting ruling, with "line failed verification" and the failing jobs as the reason; tickets in flight
   are closed out as usual, and the queue no longer pauses for the red. In the pipeline, this triggers a dispatch
   point, so the budget and the stop conditions are judged as usual.

Done when: every line due a CI read had its latest SHA's result read and recorded in the ledger; on a line on local
verification, every SHA verified has a record in ledger field 4, and so does a `no-verdict` local verification on a
line with CI; a red line
dispatched nothing new and advanced no integration queue until it was green or reverted; a reverted ticket and the
integrated tickets depending on it are out of `--done`, their reconciliation rows marked stuck or gap, with the
tickets in flight depending on it awaiting ruling and naming the upstream revert; a line that failed verification
dispatched nothing afterwards, and its candidates are all awaiting ruling.

### Budget and breaker

The limits and their usage live in ledger field 9 (`ASKING.md` section 7). Usage is updated at two points: first
thing at every dispatch point (the three steps below), and at the end of every ticket's close-out when the ledger is
written current (step 1 only; progress and the limits are judged only at dispatch points).

1. **Update usage:** update the spawn count and elapsed time per `ASKING.md` section 7, field 9 (which also says how
   the start time is recorded).
2. **Judge progress:** "once" means one dispatch point. A wake-up spent waiting on agents, or one that only moves
   close-outs along, does not count. Compare against the progress snapshot recorded at the last dispatch point —
   each line's integration-branch tip SHA, and the tickets in the reconciliation table that have reached an end state
   (delivered, stuck, awaiting ruling): when neither changed, add one to the consecutive no-progress count; when
   anything changed, reset it to zero. A ticket moving between stages short of an end state, or being sent back for a
   redo, is not progress; nor are commits on a ticket branch: an attempt that was never merged changed no delivery.
   Then record this snapshot in field 9; the first dispatch point only records it.
3. **Check the limits:** when the dispatch points already run reach `rounds`, spawns reach `spawns`, elapsed time
   reaches `hours`, or the consecutive no-progress count reaches `no-progress`, **stop**. Only when nothing stops
   the run, add one to the dispatch-point count and go on dispatching.

**Stopping:** this dispatch point dispatches and expands nothing, and no dispatch point follows it. Tickets in flight
go on through close-out until they are integrated, stuck or sent back, with CI reads and red-light handling as usual;
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

**Assignment record:** at every assignment, record in that ticket's row of the reconciliation table (for an
expansion agent, in the row of every ticket it covers):

- The agent id, the assigned time, the stage time limit and the deadline. Times are always UTC, in the format of
  `date -u +%Y-%m-%dT%H:%M:%SZ`, and the deadline is the assigned time plus the stage time limit; times in this
  format compare correctly as strings. Record extended as `no`.
- The **progress fingerprint**: the HEAD and the working-tree tree of the worktree the agent works in. For
  implementation and fixes that is the ticket worktree (for a red-light fix, the `-ci` branch's worktree; for one
  that maps to no ticket, the integration worktree); for merging, the integration worktree. Always run it with Bash
  — PowerShell's pipeline and encoding give the same tree a different result:

  ```bash
  git -C <worktree> rev-parse HEAD
  idx="$(git -C <worktree> rev-parse --path-format=absolute --git-path sorry-matt-fingerprint.index)"
  cp "$(git -C <worktree> rev-parse --path-format=absolute --git-path index)" "$idx" \
    && GIT_INDEX_FILE="$idx" git -C <worktree> add -A 2>/dev/null \
    && GIT_INDEX_FILE="$idx" git -C <worktree> write-tree
  rm -f "$idx"
  ```

  The second part writes the whole working tree (untracked files included, ignored ones not) as one tree in a
  temporary index and prints its hash; the real index is left alone. An untracked file whose content changes, a new
  file inside an already untracked directory, and a staged file changed again all change it. An expansion agent
  works in no worktree; record instead the `expansions` count `acceptance.mjs` reads for each ticket it covers.

Once the agent reports or is stopped, set that row's deadline to `—`. An **agent in flight** is any agent whose
deadline is not `—`.

**Deadline scan:** every wake-up — a `/loop` wake-up, an agent notification and a fallback wake-up all count — runs
it after handling the agents that reported. Take the current time (same format); an agent in flight whose deadline
is before it is **overdue**. For each overdue agent:

1. **Judge progress:** recompute the progress fingerprint with the same commands as at the assignment. A different
   HEAD (new commits) or a different tree (working-tree changes, a conflict half resolved) is progress; for an
   expansion agent, it is any ticket's `expansions` count going up.
2. **Progress, and this assignment not yet extended → extend once:** set the deadline to now plus the same stage time
   limit, and record extended as `yes`. An extended agent that is overdue again always goes to the next step,
   without judging progress.
3. **No progress, or already extended → stop it:** `TaskStop` the agent; if it happens to have finished already,
   close it out under wake-up step 2, "handle the agents that reported", instead. Once stopped, take the first of
   these cases that applies:
   - **The cause needs a person** — the ticket's status record names, under blockers, a decision for a person, a
     missing permission or a fact that cannot be found → mark it **awaiting ruling** with the cause.
   - **Integrating** → first check `git -C <integration worktree> rev-parse -q --verify MERGE_HEAD`: with output,
     `git -C <integration worktree> merge --abort`; with none (the merge agent has already committed),
     `git -C <integration worktree> reset --hard <the HEAD in the assignment record>`. The merge agent never pushes,
     so this only touches the local branch. The ticket is **sent back for a redo** per close-out, and the queue moves
     on to the next ticket.
   - **A red-light fix** (reading CI, red-light handling point 4) → this stop counts as one failed fix round, not as a
     reassignment. In the first round, start the second per point 4: when it maps to a ticket, spawn a new agent per
     `IMPLEMENTER.md` on the same worktree, with the failure summary and the timeout note from the next case attached
     to the ticket text; when it maps to no ticket, first clear what the stopped agent left with
     `git -C <integration worktree> reset --hard <the HEAD in the assignment record>`, then the host or a new agent
     fixes it. In the second round, revert or find the line failed verification per points 5 and 6. Do not mark it
     stuck: without a revert or a failed verification, the line stays red and its queue stays paused.
   - **This stage has not been reassigned for a timeout yet** (implementing, fixing and expanding each count
     separately) → **reassign** it once: for implementing and fixing, spawn a new implementation agent per
     `IMPLEMENTER.md` on the same worktree and branch, attaching a note to the ticket text — the previous agent was
     stopped for running over its time limit, its commits and uncommitted changes are left for the new agent to
     judge whether to build on, and an existing status record is taken over and updated in place; for fixing, also
     attach that round's findings. For expanding, give the tickets it covered that still have no expansion block to a
     new expansion agent, spawned the way step 1 of dispatch says, not by a second set of rules. A reassignment is a new assignment: record it as above, replace the agent id in the
     reconciliation table with the new one, and add one to that stage's timeout reassignment count. When the budget
     blocks the spawn, mark the ticket awaiting ruling per budget and breaker.
   - **This stage was already reassigned for a timeout** → for implementing and fixing, **mark it stuck**, giving the
     two timeouts as the reason; expanding tickets are marked **awaiting ruling**.
4. **Keep a record:** for every extension or stop, write a timeout-handling entry in that ticket's status record —
   the agent id, the stage, the assigned time and deadline, the progress fingerprints at the assignment and now, and
   the handling — and add a row to the run-level self-answer log (the five columns of `ASKING.md` section 3). Add
   one to field 9's timeout extensions or timeout stops.

Marking a ticket stuck or awaiting ruling, sending it back for a redo, and a red-light revert or failed verification
trigger a dispatch point per dispatch; a reassignment and a red-light fix's second round do not, and the ticket stays
at its stage.

**Fallback wake-up:** whenever a wake-up ends with agents still in flight, schedule the next wake-up for the earliest
deadline, so that the host wakes when the first time limit runs out even if no agent ever reports. A wake-up that
assigned any work always ends with an agent in flight, so every assignment is followed by one. The delay is the
earliest deadline minus now, in seconds:

- **`ScheduleWakeup`** (available in the dynamic `/loop` mode that section 1 enters): the delay must be between 60
  and 3600 seconds. Below 60, schedule 60; above 3600, schedule 3600, and when that wake-up finds nothing overdue,
  schedule again per this paragraph.
- Without `ScheduleWakeup`: run `sleep <seconds>` in the background with Bash (no upper bound), and record its task
  id in ledger field 9. Keep only one: before scheduling a new one, `TaskStop` the previous one field 9 records
  (skip it if it has finished). The notification when it ends is the wake-up; its first action is re-reading the
  ledger and the rule files per resuming in `ASKING.md` section 7, then the wake-up steps of section 1.
- When a background `sleep` is not available either: re-enter section 1's `/loop` in interval mode, with the same
  prompt and the shortest stage time limit as the interval. End that interval loop once no agent is in flight and
  the run has stopped per the stop conditions at the end of "Filing along the way".

With no agent in flight, `/loop` paces itself as before.

Done when: every assignment left an assignment record (agent id, assigned time, stage time limit, deadline and
progress fingerprint) in the reconciliation table; every wake-up scanned every agent in flight after handling
reports, expansion and red-light fix agents included; no report from a superseded agent was taken; every overdue
agent had its progress judged by its fingerprint and was extended at most once per assignment, and every other one
was `TaskStop`ped and reassigned, sent back for a redo, marked stuck, marked awaiting ruling, or (a red-light fix)
counted as one failed fix round; after a merge agent was stopped, the integration worktree was back at the HEAD of
its assignment; no ticket was reassigned for a timeout more than once per stage; every handling is in the ticket's
status record and the self-answer log; every wake-up that ended with agents in flight scheduled a fallback wake-up,
with at most one background `sleep` at a time.

### Dispatch

A **dispatch point** is triggered at these moments and runs once, at the end of that wake-up, at most one per
wake-up: the first wake-up; a ticket integrated into an integration branch or reverted; a ticket leaving the pipeline
(stuck, awaiting ruling, sent back for a redo); a red line turning green or being found to have failed verification;
an expansion agent reporting. No other wake-up dispatches.

Every dispatch point first checks the limits per budget and breaker; when the run does not stop, it reads each line
per reading CI. A red line goes through the red-light handling and dispatches nothing new until it is green or the
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
(reading CI, red-light handling point 6) and go no further. Whoever writes the criteria must not be the one who has to
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
   (close-out).
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
   stuck. **One ticket gets this one reviewer by default**, its lenses covering standards
   and spec conformance together. Add a specialist reviewer only where a concrete risk calls for one, naming the
   risk and recording the rationale in the self-answer log; "another look, to be safe" is not a risk.
3. **Batched fix:** hand this ticket's findings back to the original context-holding agent all at once, fixed in one
   round rather than one finding at a time. Afterwards re-run the targeted checks for the affected surface and the
   acceptance diff, then call the Skill tool with `prove-it` in mode `recheck`, attaching the previous review block
   and the new acceptance diff output: it reruns the live run and mutation only on the lines the findings concern,
   and is not a second review. At most two correction rounds; still failing after two, mark the ticket stuck.

   **Hard rail — a flaky red is chased to its root cause.** A test that goes red and green on the same commit is
   treated as a real failure: find the root cause; when it lies in how the test is written, fix the test; when it
   lies in the product, fix the product or file a defect ticket. Re-running, loosening a wait, adding a retry and
   raising a timeout all leave it unfixed. If two correction rounds do not find the root cause, mark the ticket
   stuck.
4. **Integrate:** a ticket that passed review joins its line's **integration queue**: a line integrates one ticket at
   a time, in the order they joined; the queue of a line in red-light handling pauses (reading CI). When its turn
   comes its stage becomes integrating, and it is merged in the integration worktree with
   `git merge --no-ff --no-edit <ticket branch>`: one merge commit per ticket, carrying git's default message
   `Merge branch '<ticket branch>'`. Once merged, record its SHA (`git rev-parse HEAD`) among that ticket's merge
   SHAs in the ledger's reconciliation table, red-light `-ci` merges included: red-light mapping and the
   **per-ticket guide** at finishing both go by it, and the subject is only the fallback when no SHA was recorded.
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
   conflict safely, run `git merge --abort`; the ticket is **sent back for a redo** (below), and the queue moves on
   to the next ticket.
5. **Complete delivery:**
   - **GitHub:** the ticket stays open; closing it is the aggregate PR's job (section 2). This ticket's summary
     lives in its commit message (`IMPLEMENTER.md` section 2).
   - **Local Markdown:** on the integration branch, check every verified acceptance criterion in the ticket (the
     expansion block's included), set `Status` to `ready-for-human`, and append `## sorry-matt completion` with the
     implementation commit, integration branch, and passed checks. Commit this delivery record.
6. **Push:** with an `origin`, `git push -u origin <integration branch>`, in both modes; Local Markdown with no
   remote skips it, and finishing the run takes section 2 step 3's local verification. Push once per integration,
   never batching several tickets into one push: a red light has to point at one integration. Do not wait for CI
   after pushing.
7. Remove the ticket worktree and local ticket branch.
8. **Refill:** this integration changed the frontier and the files in flight, so run a dispatch point at the end of
   this wake-up.

**Send back for a redo.** The predicted files were wrong, and the ticket ran into another ticket's changes only at
integration. Do not force the resolution: the ticket is redone from the latest integration branch.

1. **Keep a record:** keep the old attempt with
   `git update-ref refs/sorry-matt/<run>/<NN>-<slug>/sent-back-<k> <ticket branch>` (`<k>` counts the send-backs);
   add a send-back record to the ticket's status record — that ref and its SHA, the conflicting files, the
   integration branch's SHA at the time, and the files the old attempt touched that the predicted files did not
   cover; in the ledger's reconciliation table, add one to the row's send-back count and set its stage back to
   candidate.
2. **Widen the prediction:** add the conflicting files and the files the old attempt touched to the ticket's
   predicted files.
3. Remove the ticket worktree, and `git branch -D` the local ticket branch — its content is kept in the ref above.
4. The next dispatch point dispatches it again per dispatch: it keeps its acceptance snapshot, and the branch and
   worktree are rebuilt under the same name from the integration branch's latest tip. The old attempt is reference
   only and is never merged.

A ticket is sent back once at most: if, after the redo, its conflict again cannot be resolved, mark it stuck.

Anything that comes up mid-run takes the three exits in `ASKING.md` section 4. Running standalone, with no ruling
point, whatever cannot be answered accumulates until the next dispatch point and is asked there in one go.

**Mark it stuck** (wherever this skill says to mark a ticket stuck, do this):

- **GitHub:** file a separate raw issue recording the failure, its body polished per `ASKING.md` section 6.
- **Local Markdown:** append `## sorry-matt blocker` to the original ticket on the integration branch with the
  reason, attempted remedies, and relevant branches; set `Status` to `ready-for-human` and commit it.

After recording the stuck state, also remove the ticket worktree and local ticket branch. Push the host's other
commits on the integration branch (stuck records, tickets filed along the way) before that wake-up ends.

Done when: every ticket that reported entered close-out without waiting for other tickets; every ticket went through
exactly one independent review (`prove-it` in `initial`; a `stuck` before the review opens does not count), each
correction round had one `recheck`, every call came with that call's acceptance diff output against the acceptance
snapshot, and every verdict is in the status record; its targeted checks are back to green, and it has either a
provider-native delivery that passed acceptance or a traceable stuck record; every ticket that gained a specialist
reviewer names the risk; each line integrated at most one ticket at a time, and no queued ticket was integrated into
a line in red-light handling; every integration is a `--no-ff` merge commit with git's default message and its SHA
recorded in the reconciliation table, any conflict resolution lives only in that merge commit, and no ticket branch
was rewritten; every integration was followed by a dispatch point; every ticket sent back has its `sent-back` ref, a
send-back record in its status record, its send-back count in the reconciliation table and widened predicted files,
and was sent back once at most; every ticket's status record is written current; successful tickets are
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

Every line passes **three line-level gates** first, in this order:

1. **Simplify:** in the integration worktree, call the Skill tool with `simplify` to make one quality pass over
   everything the line accumulated — reuse, simplification, efficiency, altitude — which it applies directly.
   Duplication across tickets is only visible after integration, so this pass runs here once rather than once per
   ticket. Record any dropped simplification in the self-answer log. Commit the applied simplifications as **one
   commit of their own** (a subject such as `refactor: simplify <integration branch>`, with no ticket ID; no
   simplification, no commit), never amended into any merge or ticket commit.
2. **Sync the base:** the integration branch was cut from the base tip in section 0, and the base may have moved
   during the run; a green only counts on the latest base. In the integration worktree, merge the latest base tip
   into the integration branch: with an `origin`, `git fetch origin <base branch>` then
   `git merge origin/<base branch>`; in Local Markdown mode with no remote, merge the local `<base branch>`; either
   way with `--no-edit`. Record the merged base SHA in ledger field 4. Conflicts go to the **merge agent** from
   section 1, close-out step 4, under the same criterion and the same rule that the resolution lives only in this
   merge commit: one side is the line (its tickets' text and commit messages), the other is the base
   (`git log --format=%B <merge-base>..<merged base ref>`), and the goal of this merge is the line's intent landing
   on the latest base. The host records the tradeoffs in the self-answer log. When the merge agent reports a
   conflict it cannot resolve safely, run `git merge --abort`; the line is then **unsynced**: ledger field 4 records
   the base SHA it tried and "unsynced", the delivery and the human-work list name the conflicting files, and the
   delivery is always left for a human to merge (see the merge paragraph below).
3. **Full verification:** the CI result for the integration branch's latest SHA is what counts. Push the
   integration branch as steps 1–2 left it, per close-out step 6, and read it per section 1, reading CI.
   While it is still running, run `gh run watch <databaseId> --exit-status` once for each unfinished run to wait it
   out — one blocking call per run, no repeated polling, in the background where the environment allows. With no
   run, read once more a little later. On red, go through section 1's red-light handling.

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
   record per SHA, and a new record never overwrites an old one; a SHA that already has a record is not re-run. Save
   the output as the checks run (red-light handling point 3). A local red goes through the whole of section 1's
   red-light handling (points 1–6); after each fix round, re-run locally on the new SHA and record that result in
   field 4 as well.

   The report gives the verified SHA, its source (CI, or local with the reason) and the merged base SHA; an unsynced
   line is verified all the same, on its unsynced tree, and the report gives the base SHA it tried and "unsynced".
   The only green that counts is the result for that last SHA.

**The evidence-expiry rule.** A green holds only for the SHA it ran on. Every new commit on the integration branch —
another ticket integrating, a conflict resolution, a fix for a red CI, the line-level simplify, the base sync —
expires the earlier greens, ticket-level acceptance greens included; only the result for the integration branch's
latest SHA holds.

Then deliver each line according to its mode:

- **GitHub:** create one aggregate PR from the line integration branch into the base branch; the body is built
  around a **per-ticket guide**. First run this skill's `scripts/review-guide.mjs` in the integration worktree:

  ```bash
  node "${CLAUDE_SKILL_DIR}/scripts/review-guide.mjs" sorry-matt/runs/<run>/guide/<line-slug>.plan.json
  ```

  The plan and its output (the same name ending in `.json`) live in the common directory beside the ledger, in the
  format the script's header documents: `base` is the merged base ref (`origin/<base branch>`), `web` comes from `gh
  repo view --json url --jq .url`, and `tickets` lists every ticket in the reconciliation table that was integrated
  into this line (including those that later became gaps), with the merge SHAs the reconciliation table recorded
  (`merges`), its ticket branch, its title, the `blockedBy` from the frontier output at the freeze, and a link to its
  status record. The script maps the first-parent merges to tickets by the rules in its header, and a ticket's commits
  are `<merge>^1..<merge>^2`; every other first-parent commit (simplify, base sync, host commits, fixes mapped to no
  ticket, reverts) is a **line-level commit**. Exit code 3 means a ticket in `missing` has no merge on the line, and
  `warnings` lists any recorded SHA not on the line: check its merge SHAs and branch name against the ledger, correct
  the plan and re-run; if it is still not found, say "commit range not found" in that ticket's section rather than
  guessing a range.

  Write the body from the output, in this fixed order:

  1. **Review-threshold notice:** when `size.over` is true — the PR diff's insertions plus deletions
     (`git diff --shortstat <base>...<line integration branch>`) exceed the threshold, 400 lines by default, about
     what one review sitting can cover — the body's first paragraph gives the line count and the threshold, and
     recommends reviewing commit range by commit range, one ticket at a time, following the per-ticket guide,
     rather than the whole diff at once.
  2. **Per-ticket guide:** one section per completed ticket, in the `order` of `tickets` — the topological order of
     the blocker edges, so a ticket others depend on is read first. Each section gives:
     - heading: the reading position, the ticket number and the title;
     - commit range: each merge's `compare` link, with its commit count and `stat`; a red-light `-ci` merge gets
       its own entry;
     - what changed: the host's summary of every commit message the ticket integrated into the line. Take them by
       running `git log --format=%B <range>` once for each `range` (`<merge>^1..<merge>^2`) in the ticket's
       `merges`, red-light `-ci` merges included; never search commits by ticket number — another ticket's commit
       whose body mentions the number (say `Refs #8`) would be swept in. Batched fixes are made on the ticket
       branch before integration, so they already sit inside the ticket's merge ranges and need no separate
       search. A ticket in `missing` is handled as "commit range not found" above, with no alternative way to
       take its commits;
     - acceptance evidence: the link to its status record;
     - a merge whose `resolved` is true is marked as carrying a conflict resolution, with its `remergeDiff`
       command and a note that it only works locally (git 2.36+) and GitHub's web views cannot show it; a ticket
       sent back for a redo notes its send-back count;
     - `Closes #N` at the end of the section.
  3. **Line-level commits:** each entry of `lineCommits` with its link and what it is for; those carrying a
     conflict resolution with their `remergeDiff` command, likewise noted as local only.
  4. **Gaps:** stuck and awaiting-ruling tickets, with no `Closes`; those with a merge on the line (upstream
     reverted, reverted) with their commit range.

  Polish the aggregate PR body per `ASKING.md` section 6; after the polish the threshold notice is still at the top
  of the body, and every commit link and every `Closes #N` line is still there.
- **Local Markdown:** leave the line integration branch for human review and merge. Record its branch name and
  tip SHA, then remove the integration worktree. Ticket state travels with the implementation on that branch;
  do not simulate a PR or close operation.

Once a line is delivered, clean up: call the Skill tool with `clean-it-up` and let its evidence rules retire the
ticket worktrees and merged local branches this run created. **Deliverables awaiting human review are out of
scope for cleanup:** Local Markdown line integration branches and the source branches of unmerged aggregate PRs
are kept — for unmerged items, `clean-it-up` itself downgrades to keep. Remote branches still require the user's
explicit authority for this request; do not open a question for it.

Once the aggregate PR's CI goes green, GitHub mode sends the merge with `gh pr merge` when there is standing
authority (a `permissions.allow` rule in the permission settings that covers `gh pr merge`) or the user said to
merge during this run; with neither, it sends nothing, the aggregate PR is left for a human to merge, and the
output carries the permission rule snippet that would let it through. An unsynced line, or one that failed
verification, sends nothing and does not enter a merge queue, and its aggregate PR is left for a human to merge. It
is a prompting call, sent after cleanup; Claude Code's permission settings decide whether it is let through, and
when the merge would deploy to production right away the hook asks for one more confirmation (`ASKING.md`
section 5). When it is let through, report the merge; when it is blocked or refused, the delivery stays with the
human and the output carries the permission rule snippet that would let it through. Do not open a question for it.

**Merge queue.** Before sending, check whether the base branch has a merge queue:

```bash
gh api graphql -f query='query($owner:String!,$name:String!,$branch:String!){repository(owner:$owner,name:$name){mergeQueue(branch:$branch){url}}}' -f owner=<owner> -f name=<repo> -f branch=<base branch>
```

A null `mergeQueue` means it has none: follow the paragraph above; nothing changes. With one, the merge goes
through the queue: the same `gh pr merge <PR>`, with no merge strategy and no `--admin` — gh adds the PR to the
queue, which groups it with the latest base and the PRs ahead of it into a merge group and verifies that again
before merging. Whether to send it, and whether it is let through, follow the paragraph above; do not skip the
queue with `--admin`, and do not enter it with GraphQL's `enqueuePullRequest` and so around the permission check
on `gh pr merge`.

The queue runs checks only on `merge_group` events, so before sending, confirm its checks will run:

- A workflow on the base ref has `merge_group` in its `on:`
  (`git grep -l merge_group origin/<base branch> -- .github/workflows`): send.
- No such workflow, and the base branch has no required checks: send. The required checks are the union of the
  rulesets' `gh api repos/<owner>/<repo>/rules/branches/<base branch> --jq
  '[.[]|select(.type=="required_status_checks")|.parameters.required_status_checks[].context]'` and branch
  protection's `gh api repos/<owner>/<repo>/branches/<base branch> --jq
  '.protection.required_status_checks.contexts'`.
- No such workflow, but there are required checks (perhaps from third-party CI, whose response to `merge_group`
  cannot be seen from here): do not send; the PR would only sit in the queue. List it in the human-work list with
  the missing trigger and those required checks.

When any of these queries fails, do not guess: do not send, and list it in the human-work list. Failure means `gh`
exiting non-zero, a GraphQL response carrying `errors`, or `git grep` exiting above 1 (1 means "none", 0 means
"found"). Treat a null `contexts` as empty. After sending, report either the merged PR or that it is still queued,
with its URL; for an aggregate PR still in the queue, close tickets as for one left for a human to merge.

**Closing tickets** comes after `gh pr merge` is sent. GitHub reads `Closes` only in a PR that targets the
repository's default branch; find that branch with `gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`:

- Aggregate PR merged: confirm every completed ticket is closed. When the base is not the default branch, or a
  ticket is still open after the merge, the host closes it per the tracker contract's Close, with a comment
  pointing at the aggregate PR.
- Aggregate PR left for a human to merge, with a base that is not the default branch: the human-work list carries
  the close commands to run after the merge.

Report each line's aggregate PR or integration branch, its merged base SHA (or marked unsynced), and the full
verification's SHA and source (CI, or local with the reason); the **reconciliation table** covering the entire initial
set (with each ticket's send-back count); this run's **run metrics and budget** (`ASKING.md` section 7, field 9, with
the stop reason when it stopped); the authorization outcomes (ledger field 5); and every raw ticket filed along the
way, asking the user to run `/triage`. Running standalone, change the ledger's first line to `<!-- sorry-matt:run
ended -->` after this output; when `have-it-all-done` composes this skill, leave it for that skill's handoff.

Done when: every line went through one line-level simplify, one base sync and one full verification, ending green
or marked as failed verification and left for a human to merge; the simplify pass and the base sync are each their
own commit, mixed into no ticket's commits; the aggregate PR body has a per-ticket guide written from the
`review-guide.mjs` output, giving every completed ticket, in blocker order, a clickable commit range, a summary and
its status-record link, with the threshold notice at the top when `size.over` is true; the full verification is
the CI result for the latest SHA of the integration branch synced to the latest base, or, under step 3's
local-verification conditions, a local run on that same SHA with the reason reported; on a line on local
verification, every SHA verified has a record in ledger field 4, and so does the `no-verdict` one on a line with CI;
its report names the verified SHA and the base
SHA; an unsynced line names its conflicting files and the base SHA it tried, was verified
on its unsynced tree, and is left for a human to merge; every line has exactly one human-mergeable delivery, or
was merged after the permission settings let it through (through the merge queue when the base has one) and
reported; every completed ticket of a merged aggregate PR is closed, and where an aggregate PR is left to a human
and the keyword does not apply, the human-work list carries the close commands; the reconciliation table covers
the frozen set exactly once, every row pointing at that ticket's status record; every ticket worktree and local
ticket branch is removed; Local Markdown integration worktrees are removed while their integration branches remain;
the output lists the authorization outcomes and this run's metrics and budget; running standalone, the ledger's
first line is the ended marker.
