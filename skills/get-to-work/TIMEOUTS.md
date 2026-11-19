# get-to-work: handling an overdue agent

This file is the second half of the deadline scan: read it in full when tick hands out a `timeout` `judge`. tick runs
the scan (`deadline.mjs scan`) and the extensions; every agent that comes here is to be stopped — no progress,
already extended, or a progress fingerprint that could not be computed (the `judge` names the `error`).

1. **Stop**: `TaskStop` the agent. If it had just finished, record `collected`; its report is taken as usual.
2. **Settle it**, the first case that applies winning; record the outcome in parentheses:
   - **The fingerprint could not be computed** (`error`): the worktree's state needs a human. No reassignment and no
     new dispatch into the same worktree — no assignment record can be computed there, and a dispatch without one does
     not stand. Implementing or fixing → `awaiting-ruling`, the reason being that `error`; integrating → first restore
     the integration worktree as under "integrating" below, then `awaiting-ruling`; a red-light fix → one failed fix
     round, with no further round: mapped to a ticket, revert per [`RED-LIGHT.md`](RED-LIGHT.md) point 5; mapped to no
     ticket, first `git -C <integration worktree> reset --hard <the assignment record's HEAD>`, then fail the line's
     verification per point 6.
   - **The cause needs a human** — the ticket's status record names under "blocked" a decision, a missing permission or
     a fact that cannot be found → `awaiting-ruling`, with the reason.
   - **Integrating**: if `git -C <integration worktree> rev-parse -q --verify MERGE_HEAD` prints something,
     `merge --abort`; if not (the merge agent already committed), `reset --hard <the assignment record's HEAD>`. The
     merge agent never pushes, so the restore is local. Send the ticket back for a redo per
     [`SEND-BACK.md`](SEND-BACK.md) (`send-back`).
   - **A red-light fix** (`RED-LIGHT.md` point 4): one failed fix round, not counted as a reassignment. In the first
     round, open the second — mapped to a ticket, spawn a new `ci-fix` agent by `IMPLEMENTER.md` (agent type and fallback per the spawn in `SKILL.md` section 1) on the same worktree,
     the failure summary and the timeout note added to the ticket text; mapped to no ticket, `reset --hard <the
     assignment record's HEAD>` first, then fix. In the second round, revert or fail the line per points 5 and 6;
     never mark it stuck.
   - **Not yet reassigned for a timeout in this stage** (the `judge` says so) → `reassign`: tick hands out the new
     assignment record and spawn on the same worktree and branch, the brief noting that the previous agent timed out
     and was stopped and that the new one decides whether to keep its commits and changes.
   - **Already reassigned in this stage** → implementing or fixing: stuck (`stuck`, per `SEND-BACK.md`, the reason
     being two timeouts); expanding: `awaiting-ruling`.
3. **Leave a record**: write a timeout-handling paragraph into the ticket's status record — agent id, stage, assigned
   time and deadline, the fingerprint at assignment and now, the handling — and add a row to the run-level self-answer
   log (the five columns of `ASKING.md` section 3).

Done when: every overdue agent was stopped with `TaskStop` and settled as above; after a merge agent was stopped, the
integration worktree is back at the assignment's HEAD; every handling is in the ticket's status record and the
self-answer log.
