# get-to-work: send back for a redo, and mark stuck

This file covers sending back for a redo and marking stuck: read it in full when a tick `judge` points here. The git and
state part is done by `scripts/integrate.mjs`, each step in its header; this file holds only what it cannot do.

**Send back for a redo.** The predicted files were wrong, and the ticket ran into another ticket's changes only at
integration. Do not force a resolution: redo the ticket from the latest integration branch.

1. `integrate.mjs send-back <state> <ticket> --conflicts <conflicted files> --predicted <each line of the predicted files>`:
   it keeps the old attempt at a ref, moves the stage back to candidate, and removes the worktree and branch. A ticket
   is sent back once: a second time is refused, so mark it stuck instead.
2. **Send-back record**: from its output, add a paragraph to the ticket's status record — the `ref` and `sha`,
   `conflicts`, `lineTip`, `uncovered` (files the old attempt changed that the predicted files did not cover) — and
   write the same paragraph to `sorry-matt/runs/<run>/sendback/<ticket>.md`, which tick hands to the new
   implementation agent at the redispatch.
3. **Widen the prediction**: write the output's `predicted` back to the ticket's predicted files.
4. tick redispatches it at the next dispatch point: the acceptance snapshot is reused, and the branch of the same name
   is rebuilt from the latest tip of the integration branch. The old attempt is reference only, never merged.

**Mark stuck** (whenever this skill says "mark stuck", do this):

- `integrate.mjs stuck <state> <ticket> --reason <reason>`: keeps the branch tip, removes the worktree and branch, and
  marks the ticket stuck. With Local Markdown add `--worktree <integration worktree> --local <ticket file> --attempts
  <the attempts made>`, and it appends `## sorry-matt blocker` to the original ticket and commits it; while `prove-it`'s
  review worktree is still there add `--review-worktree <scratchpad>/review-<ticket>`; with an `origin` add `--push`.
- **GitHub**: also file a raw issue recording the failure, with the reason and the attempts made, the body polished
  per `ASKING.md` section 6.

Done when: every ticket sent back has its send-back record in its status record and widened predicted files; every stuck
ticket went through `integrate.mjs stuck`, with a raw issue on GitHub.
