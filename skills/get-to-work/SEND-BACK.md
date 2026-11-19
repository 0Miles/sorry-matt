# get-to-work: Sending back for a redo and marking stuck

This file is the send-back for a redo and the marking stuck of close-out in [`SKILL.md`](SKILL.md): read it in full
when a ticket is to be sent back for a redo or marked stuck. Section names with no file attached (dispatch) are in
`SKILL.md`.

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

**Mark it stuck** (wherever this skill says to mark a ticket stuck, do this):

- **GitHub:** file a separate raw issue recording the failure, its body polished per `ASKING.md` section 6.
- **Local Markdown:** append `## sorry-matt blocker` to the original ticket on the integration branch with the
  reason, attempted remedies, and relevant branches; set `Status` to `ready-for-human` and commit it.

After recording the stuck state, also remove the ticket worktree and local ticket branch. Push the host's other
commits on the integration branch (stuck records, tickets filed along the way) before that wake-up ends.

Done when: every ticket sent back has its `sent-back` ref, a
send-back record in its status record, its send-back count in the reconciliation table and widened predicted files,
and was sent back once at most.
