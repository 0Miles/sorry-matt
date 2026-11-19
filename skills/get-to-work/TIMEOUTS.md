# get-to-work: Handling an overdue agent

This file is the second half of the deadline scan in time limits in [`SKILL.md`](SKILL.md): read it in full when the
scan finds an overdue agent, and handle each overdue agent with the four steps below. Section names and steps with no
file attached (dispatch, budget and breaker, the wake-up steps, the assignment record) are in `SKILL.md`.

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
     so this only touches the local branch. The ticket is **sent back for a redo** per [`SEND-BACK.md`](SEND-BACK.md), and the queue moves
     on to the next ticket.
   - **A red-light fix** ([`RED-LIGHT.md`](RED-LIGHT.md), red-light handling point 4) → this stop counts as one failed fix round, not as a
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
     new expansion agent, spawned the way step 1 of dispatch says. A reassignment is a new assignment: record it as
     above, replace the agent id in the reconciliation table with the new one, and add one to that stage's timeout reassignment count. When the budget
     blocks the spawn, mark the ticket awaiting ruling per budget and breaker.
   - **This stage was already reassigned for a timeout** → for implementing and fixing, **mark it stuck** (`SEND-BACK.md`), giving the
     two timeouts as the reason; expanding tickets are marked **awaiting ruling**.
4. **Keep a record:** for every extension or stop, write a timeout-handling entry in that ticket's status record —
   the agent id, the stage, the assigned time and deadline, the progress fingerprints at the assignment and now, and
   the handling — and add a row to the run-level self-answer log (the five columns of `ASKING.md` section 3). Add
   one to field 9's timeout extensions or timeout stops.

Marking a ticket stuck or awaiting ruling, sending it back for a redo, and a red-light revert or failed verification
trigger a dispatch point per dispatch; a reassignment and a red-light fix's second round do not, and the ticket stays
at its stage.

Done when: every overdue
agent had its progress judged by its fingerprint and was extended at most once per assignment, and every other one
was `TaskStop`ped and reassigned, sent back for a redo, marked stuck, marked awaiting ruling, or (a red-light fix)
counted as one failed fix round; after a merge agent was stopped, the integration worktree was back at the HEAD of
its assignment; no ticket was reassigned for a timeout more than once per stage; every handling is in the ticket's
status record and the self-answer log.
