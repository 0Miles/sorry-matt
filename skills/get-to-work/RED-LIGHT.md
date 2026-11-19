# get-to-work: Red-light handling

This file is the red-light handling of reading CI in [`SKILL.md`](SKILL.md): read it in full when a line turns red,
or while a line is in red-light handling. Section names and steps with no file attached (reading CI, time limits,
dispatch, close-out, budget and breaker, the wake-up steps) are in `SKILL.md`.

**Red-light handling.** A red line **dispatches nothing new** and its **integration queue pauses** until it is green
or the culprit is reverted. Tickets in flight keep implementing, being reviewed and being fixed, and those that pass
review wait in the queue; the red-light fixes and reverts below do not queue. Integrating another ticket onto a red
line would carry the same red into every SHA after the earliest red one, hide the new ticket's own red, and, should
the fix leave it red, map the red back to the original ticket by mistake.

1. **Earliest red SHA:** aggregate `gh run list --branch <integration branch> --limit 200 --json
   headSha,status,conclusion` by `headSha`, classifying each SHA by the result classification in `SKILL.md`, reading CI; walking
   `git log --first-parent --format=%H origin/<integration branch>` from newest to oldest, find the earliest red
   SHA — the nearest SHA before it with a verdict is green. On a line with CI, a local verification record whose
   reason is `no-verdict` (`SKILL.md`, reading CI, local verification) counts as that SHA's verdict and is judged together with the other
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
   simplify pass or the base sync — it **maps to no ticket**. A line on local verification uses the same command
   and rules, putting point 1's lower bound in when there is no previous green SHA.
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
   fix agent stopped for running over its time limit counts as a round too ([`TIMEOUTS.md`](TIMEOUTS.md)).
   Every fix round ends with a push (skipped with no `origin`), and the next verification gives its result: in the
   pipeline that is the next CI read (for a line on local verification, the local verification run then, on the new
   SHA); when finishing the run, it is [`FINISH.md`](FINISH.md) step 3 verifying again on the spot.
5. **Still red after two rounds, mapped to a ticket: revert.** `git revert -m 1 <that ticket's merge commit>`, and
   take back its completion record:
   - **GitHub:** file the raw issue per "mark it stuck" in [`SEND-BACK.md`](SEND-BACK.md); later dispatch points move the ticket from
     `--done` to `--stuck`.
   - **Local Markdown:** `git revert` the commit holding the completion record, then append `## sorry-matt blocker`
     per "mark it stuck" in `SEND-BACK.md`, giving the red CI and the reverted commit as the reason. The frontier reads a
     blocker after the completion record as stuck, so a completion record the revert missed still does not count as
     done.

   Its row in the ledger's reconciliation table becomes stuck, and the aggregate PR lists it as a gap. Integrated
   tickets that depend on it become gaps as well: their merges stay, their reconciliation rows say "upstream
   reverted", GitHub moves them from `--done` to `--stuck`, and Local Markdown appends a blocker to each naming the
   upstream; the aggregate PR writes no `Closes` for any of them. Tickets depending on it that are still in flight
   (queued ones included) leave the pipeline as **awaiting ruling**, with "upstream reverted" and the revert commit as
   the reason: an agent still running is not closed out when it reports; its branch tip is kept, as in `SEND-BACK.md`'s
   send-back for a redo, at `refs/sorry-matt/<run>/<NN>-<slug>/upstream-reverted`, and then its worktree and branch
   are removed. Push, and the next verification gives the result as usual. To integrate the reverted ticket again
   later, first undo the revert with `git revert <the revert commit>`; otherwise Git considers it already merged and
   brings none of its changes back.
6. **Still red after two rounds, mapped to no ticket:** the line has **failed verification**: send no `gh pr merge`,
   enter no merge queue (`FINISH.md`), say so in the aggregate PR and leave it for a human to merge, with the failing jobs in the
   human-work list. The line dispatches nothing from then on: its candidates and the tickets never dispatched on it
   are marked awaiting ruling, with "line failed verification" and the failing jobs as the reason; tickets in flight
   are closed out as usual, and the queue no longer pauses for the red. In the pipeline, this triggers a dispatch
   point, so the budget and the stop conditions are judged as usual.

Done when: a red line
dispatched nothing new and advanced no integration queue until it was green or reverted; a reverted ticket and the
integrated tickets depending on it are out of `--done`, their reconciliation rows marked stuck or gap, with the
tickets in flight depending on it awaiting ruling and naming the upstream revert; a line that failed verification
dispatched nothing afterwards, and its candidates are all awaiting ruling.
