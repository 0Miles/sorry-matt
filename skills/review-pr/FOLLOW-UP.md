# Follow-up review: the round after the author's fixes

Run the complete evidence chain again, changing only candidate sources and closeout:

- In Step 1, also fetch the previous reviews, comments, and **every comment's reply thread**:
  `gh api /repos/<owner>/<repo>/pulls/<n>/reviews` and
  `gh api /repos/<owner>/<repo>/pulls/<n>/comments` (replies carry `in_reply_to_id`; attribute each to its thread).
  Every prior blocking comment is a mandatory candidate: has the original problem been fixed, and did the fix introduce
  a new one?
- **Once the author has replied, the burden is on you.** Handle such a comment in one of two ways: **accept it and
  withdraw**, or **rebut in the same thread with new evidence**. Resubmitting a comment the author explicitly declined
  reads as never having read the reply.
- In Step 2, focus Finders on incremental commits and the area around each fix. The claims-versus-implementation lens
  still scans the complete `gh pr diff` to catch unclaimed changes bundled into fix commits, such as lockfiles or
  opportunistic edits.
- Open the body with **source and scale**: is the incoming diff a small edit following the comments, or a rewrite?
  Label every finding as new code, a regression, a pre-existing problem, or something the previous round missed. A
  thousand-line revision is a new PR in all but name, and more blocking findings is the expected result.
- In Steps 4 and 8, reconcile every prior finding as fixed, unfixed, or partially fixed with verification evidence in
  the body. Route new findings normally.
- Use `APPROVE` when every prior issue is fixed and there is no new blocking finding; otherwise choose the event by
  the Step 8 rules. An approval body still includes the itemized verification evidence.

Done when: every prior finding has a current ruling and evidence; every comment the author replied to has been accepted
and withdrawn or rebutted with new evidence; all new changes have been inspected; and the submitted event matches the
remaining blocking state.
