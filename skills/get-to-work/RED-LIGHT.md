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
   - Maps to no ticket: the host, or a newly spawned `ci-fix` agent whose target is the integration branch, fixes it in
     the integration worktree, commits (subject without a ticket ID) and pushes.
   - A fix agent's dispatch has its assignment record and time limit as usual; one stopped for a timeout counts as a
     round ([`TIMEOUTS.md`](TIMEOUTS.md)). The flaky-red hard rail applies. Push after every round (skip it with no
     `origin`); the next verification decides: in the pipeline, tick's next CI read (a local verification when CI gives no verdict); at the
     finish, `FINISH.md` step 3 verifies again on the spot. Record `handled`.
5. **Still red after two rounds, mapped to a ticket: revert.** List the tickets of the same line that depend on it
   (from the frontier's `blockedBy`) and run
   `integrate.mjs revert <state> <ticket> --worktree <integration worktree> --reason <the CI red and failed jobs> --push`
   with one `--dependent` per dependent ticket (its ticket file with Local Markdown). It reverts every merge and the
   completion record, marks the ticket stuck and settles the dependents (integrated ones stuck as upstream reverted;
   those in flight awaiting ruling with their branch tip kept); its header has each step. On GitHub also file the raw
   issue of "mark stuck" in [`SEND-BACK.md`](SEND-BACK.md). The aggregate PR lists them as gaps, without `Closes`. To
   integrate a reverted ticket again later, first `git revert <the revert commit>`. Record `reverted`.
6. **Still red after two rounds, mapped to no ticket**: the line has **failed verification**; record `failed`, and tick
   sets its candidates and never-dispatched tickets aside as awaiting ruling and stops pausing the queue for the red.
   No `gh pr merge` and no merge queue: the aggregate PR says so and is left for a human to merge, and the human-work
   list names the failed jobs.

Done when: every revert went through `integrate.mjs revert` with every dependent ticket as a `--dependent`; every line
that failed verification has its failed jobs on the human-work list; every round's result is recorded.
