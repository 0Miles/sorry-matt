# get-to-work: red-light handling

This file is what to do when a line turns red: read it in full when tick hands out a `red-light` `judge`, and do one
round each time. A red line dispatches no new ticket and its integration queue pauses until it is green or reverted;
tick holds both. Tickets in flight are implemented, reviewed and fixed as usual. The red-light fixes and reverts below
do not queue.

1. **Earliest red SHA**: computed by `scripts/ci.mjs earliest-red`, never by walking the log yourself. The plan
   `sorry-matt/runs/<run>/ci/<line-slug>.plan.json` has the fields of the script's header: `local` copies this line's
   `local` lines from the `state.mjs resume` output, and the `tickets`' `merges` are the merge SHAs the state records;
   a line on local verification sets `ci` to `false`. A line on local verification is verified only at the finish, so
   it turns red only there: before tick hands out `red-light`, it has verified the line's integration SHAs locally one
   by one from the oldest up to the first red one, and the `judge` names that earliest red SHA; the copied `local`
   holds those records, so `earliestRed` is that SHA. When `earliestRed` is `null`, no ticket is matched this time:
   in the pipeline the next wake-up reads again; at the finish ([`FINISH.md`](FINISH.md) step 3) run `earliest-red`
   once more on the spot, and if it is still `null`, treat it as **maps to no ticket** and go through points 3–6.
   When `truncated` is `true` the script has already extended the range to `lowerBound`; do not judge further or
   re-query by hand.
2. **Map to a ticket**: the output's `tickets` run oldest first; start from the earliest, which is the first one (the
   matching rules are in the header of `scripts/review-guide.mjs`). When `unmatched` is `true` — the red came from a
   host commit, the simplify pass or the base sync, or the line has no green and the base was already red at the
   merge base (`baseCi.verdict` is `red`) — it **maps to no ticket**.
3. **Failure output**: on a line with CI, save `gh run view <id> --log-failed` for every id in `failed` of the
   `earliestRed` entry of the same output, and, when `baseCi` is red, for every id in its `failed` as well; a local red
   is the `log` of the `verify.mjs` output. The host takes only the failing lines.
4. **Fix, at most two rounds**:
   - Maps to a ticket: `integrate.mjs ci-init` cuts `<ticket branch>-ci` and its worktree from the integration branch;
     hand it to that ticket's original agent, or, when it is gone, spawn a new one by `IMPLEMENTER.md` with the
     `ci-fix` role word of `brief.mjs` (agent type and general-purpose fallback per the spawn in `SKILL.md` section 1),
     the failure summary added to the ticket text. Every key of the `brief.mjs implement` values file is filled, from
     these sources:
     - `out`: the spawn file's path, in the run directory (for example
       `sorry-matt/runs/<run>/tick/brief/<ticket key>-ci-<round>.md`)
     - `role`: `ci-fix`
     - `snapshot`: the ticket's acceptance snapshot, `sorry-matt/runs/<run>/acceptance/<ticket key>.json`
     - `worktree`, `branch`: the absolute path of the `<ticket branch>-ci` worktree `ci-init` cut, and that branch
     - `integration`: the integration branch of the ticket's line (the base branch under `integrate: direct`)
     - `bodyFile`: a file holding the full ticket text with the failure summary added
     - `sendBackFile`: `null`
     - `acceptance`: `criteria` when the snapshot's `items` hold criteria; `ticket-text` only under `expand: skip` with
       none in the snapshot (the way tick picks it for an implementation agent)

     The CI failure is the finding: it goes through the batched fix (`recheck` with the ticket's previous review
     block), then `integrate.mjs merge --ci --push`, without queueing.
   - Maps to no ticket: the host neither fixes it nor dispatches anyone itself. Write the failing lines taken in point 3
     to the file this judge's `meta.failure` names and record `unmatched` (with that file missing or empty the record
     is refused). tick then hands out the line's ci-fix: `deadline.mjs record` in the integration worktree (time limit
     `timeout-fix`), `state.mjs assign --line` to put the assignment record on the line (`lines[<line>].assignment`),
     and a background general-purpose spawn whose description is the `ci-fix` role word followed by the integration
     branch, with a brief tick writes (the integration worktree, the red SHA, the failing lines, the round; the commit
     subject carries no ticket ID; no push). Send the spawn as handed out and record it with `--agent`. While it is in
     flight the line gets no red-light handling, push or CI read, and the finish waits for it; when it reports, tick
     hands out a `collect` (`fixed` / `blocked`). A new commit is pushed by tick and its CI read; with no new commit,
     tick hands out the `red-light` judge again at the same SHA to open the next round. Once both rounds are used the
     judge no longer offers `unmatched`: go to point 6.
   - A fix agent's dispatch has its assignment record and time limit as usual; one stopped for a timeout counts as a
     round ([`TIMEOUTS.md`](TIMEOUTS.md)). The flaky-red hard rail applies. Mapped to a ticket, push after every round
     (skip it with no `origin`) and record `handled`; mapped to no ticket, tick pushes. The next verification decides:
     in the pipeline, tick's next CI read (a local verification when CI gives no verdict); at the finish, `FINISH.md`
     step 3 verifies again on the spot.
5. **Still red after two rounds, mapped to a ticket: revert.** List the tickets of the same line that depend on it
   (from the frontier's `blockedBy`) and run
   `integrate.mjs revert <state> <ticket> --worktree <integration worktree> --reason <the CI red and failed jobs> --push`
   with one `--dependent` per dependent ticket (its ticket file with Local Markdown). It reverts every merge and the
   completion record, marks the ticket stuck and settles the dependents (integrated ones stuck as upstream reverted;
   those in flight awaiting ruling with their branch tip kept); its header has each step. On GitHub also file the raw
   issue of "mark stuck" in [`SEND-BACK.md`](SEND-BACK.md). The aggregate PR lists them as gaps, without `Closes`. To
   integrate a reverted ticket again later, first `git revert <the revert commit>`. Record `reverted`.
6. **Still red after two rounds, mapped to no ticket** (the judge no longer offers `unmatched`): the line has **failed verification**; record `failed`, and tick
   sets its candidates and never-dispatched tickets aside as awaiting ruling and stops pausing the queue for the red.
   No `gh pr merge` and no merge queue: the aggregate PR says so and is left for a human to merge, and the human-work
   list names the failed jobs.

## The `integrate: ticket-pr` handling

Under `integrate: ticket-pr` (#197) there is no integration branch; a red comes in two kinds, and the numbered
procedure above does not apply:

- **A red PR head** (`awaiting-ci` reads `red`): this red belongs to this ticket alone — no `ci.mjs earliest-red`,
  no earliest red SHA. tick first saves the failing output with `gh run view <id> --log-failed` (the `<id>`s from
  the verdict output's `failed`), then hands out the `pr-red` judge. Record `fix`: the CI failure is the finding
  and goes through the batched fix — back to that ticket's original agent (a SendMessage while it is there, a
  respawn as usual when it is gone), pointed at the saved failing output, not at review findings, under the
  ticket's fix-round cap and the `timeout-fix` time limit. tick pushes the fix commit back to the same PR with
  `integrate.mjs pr-push`, the ticket returns to `awaiting-ci`, and the verdict is read again at the newly pushed
  head. Still red with the fix rounds used: record stuck or awaiting-ruling.
- **A base that turns red after a merge** (once any ticket's merge is recorded, tick reads the base with
  `ci.mjs base` every wake-up; it reads `red`): the mapping follows ruling 1 — `earliest-red` scans the base itself
  (the plan's `line` is the base branch, its lower bound the parent of the oldest recorded merge), and the causing
  ticket is matched by merge order and merge SHA in the stretch from the first green up to the earliest red,
  starting from the earliest. tick hands out `integrate.mjs revert`: it reverts each merge, newest first, on the
  revert branch `<ticket branch>-revert`, pushes that branch and opens a revert PR against the base — **never a
  direct base push**; the ticket is marked stuck, and the tickets depending on it (`stackParent` and `waitingOn`,
  transitively) go to the same command as `--dependent` and get the existing "upstream reverted" handling. Per
  ruling 2 the revert PR is not reviewed — its content is a mechanical revert — but waits for its own CI to be
  green; its merge is a prompting call all the same: with merge authorization send `gh pr merge <PR>` (never
  `--admin`, never auto-merge), without it record left-for-human onto the human-work list. tick then reads the base
  again each wake-up (and at once when the base tip moves within a wake-up: the read is keyed by the tip), and the
  red episode ends only once it is green; meanwhile no new push phase starts, and the finish waits too (not for a
  revert left for a person: it is on the human-work list already). A base still red after the revert lands, or red
  at another SHA, is a new episode: the scan reruns, tickets already reverted on the base are never mapped again,
  and each ticket is reverted once; a ticket whose revert PR an earlier episode opened and that has not merged yet
  is finished first, never stranded by the new red. When it maps to no ticket — no merge of this run in the stretch
  that is not reverted already, or no green down past the oldest merge with the lower bound itself red (the red was
  there before this run's merges) — the host rules; record settled, and tick keeps reading the base each wake-up
  until it is green. Before the finish, the base must have been read once at its current tip, with a verdict that
  is not running.

Done when: every revert went through `integrate.mjs revert` with every dependent ticket as a `--dependent`; every line
that failed verification has its failed jobs on the human-work list; every round's result is recorded.
