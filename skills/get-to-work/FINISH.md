# get-to-work: the finish

This file is the finish after the pipeline stops: read it in full when a tick `judge` points here. tick hands out the
order of the three line-level gates and the commands of the base sync and the full verification; this file holds only
what you judge or write.

Every line first passes the **three line-level gates**, in a fixed order:

1. **Simplify pass**: one quality pass over the whole line's changes — reuse, simplification, efficiency, level of
   abstraction. Duplication across tickets only shows after integration, so it runs once here. You do not call
   `simplify` yourself, and the line's diff stays out of your context: tick hands out a foreground spawn
   (`general-purpose`, its `description` `simplify <integration branch>` per the header of `brief.mjs`) whose spawn
   file tick has written. Send it as given and take only the two lines it returns. The simplify agent first judges
   from the line's whole change whether a simplify pass is needed:
   - Only documentation, only deletions, only configuration or data files, or no new logic: it **skips the simplify
     pass** and does not call `simplify`.
   - New or rewritten logic that may hold a duplicate implementation, a reusable function, or a branch or a layer of
     indirection that can go: it simplifies.
   - When unsure, it simplifies. There is no line-count threshold: what changed counts, not how much.

   To simplify, it calls the Skill tool with `simplify` in the integration worktree. The applied fixes go into **one
   separate commit** (subject `refactor: simplify <integration branch>`, no ticket ID; the body lists the fixes applied,
   and each rejected fix with one line on why); with nothing to apply, no commit. It reports one of three outcomes with
   a one-line reason, which you record with `--outcome` and `--value`: `applied` (a commit), `none` (simplified, no fix
   to apply), `skipped` (judged unneeded, `simplify` not called). tick lists the `skipped` lines at the closing
   `wrap-up`: their reasons go into the self-answer log, the lines into the closing summary. Under the run profile's
   `simplify: false` the step is left out and no agent is sent.
2. **Sync the base**: merge the latest base tip into the integration branch; a green only counts on the latest base. A
   conflict goes to a merge agent under the criterion of [`SKILL.md`](SKILL.md) section 2, "Merge conflicts": one side
   is this line (each ticket's text and commit messages), the other the base
   (`git log --format=%B <merge-base>..<the synced base ref>`), the goal being the line's intent on the latest base; its
   `description` targets the integration branch, per the header of `brief.mjs`. When the merge agent cannot resolve
   it safely, the line is **unsynced**: the deliverable and the human-work list name the conflicted files and the base
   SHA tried, and the delivery is always left for a human to merge.
3. **Full verification**: only the result for the integration branch's latest SHA counts — another ticket's
   integration, a conflict resolution, a red-light fix, the simplify pass and the base sync all make an earlier green
   expire. Red goes to [`RED-LIGHT.md`](RED-LIGHT.md). The report gives the SHA verified, the source (CI, or local and
   why; for local also the `source` of the `verify.mjs` output) and the synced base SHA; an unsynced line is verified
   on its unsynced tree all the same.

Then deliver each line by mode:

- **GitHub**: open the **aggregate PR** "line integration branch → base branch", its body built around a **per-ticket
  guide**. First run `scripts/review-guide.mjs sorry-matt/runs/<run>/guide/<line-slug>.plan.json` in the integration
  worktree (the plan's fields are in the script's header: `base` is `origin/<base branch>`, `web` comes from
  `gh repo view --json url --jq .url`, `tickets` are the tickets of this line the state shows as integrated, gaps
  included, with their merge SHAs, ticket branch, title, the frozen frontier's `blockedBy` and the status-record link).
  On exit 3, check the merge SHAs and branch names in the state against `missing` and `warnings`, fix the plan and run
  again; when one still cannot be found, write "commit range not found" in that ticket's section, never a guessed
  range. Write the body from the output, in this fixed order:
  1. **Review-size note**: when `size.over` is true, the first paragraph states the line count and the threshold and
     suggests reviewing ticket by ticket along the guide's commit ranges.
  2. **Per-ticket guide**: one section per delivered ticket, in the `order` of `tickets`. Each has: a heading (order,
     ticket number and title); each merge's `compare` link with its commit count and `stat`, a red-light fix's `-ci`
     merge listed apart; what changed — gathered by running `git log --format=%B <range>` once per `range`, never by
     searching commits for the ticket number (another ticket's commit body mentioning it would be swept in); the
     status-record link; for a `resolved` merge, its `remergeDiff` command and a note that it can only be seen locally
     (git 2.36 or later); the send-back count; and `Closes #N` at the end.
  3. **Line-level commits**: each of `lineCommits` with its link and purpose, a conflict resolution with its
     `remergeDiff` command.
  4. **Gaps**: stuck and awaiting-ruling tickets, without `Closes`; one with a merge on the line gets its commit range.

  Polish the aggregate PR body per `ASKING.md` section 6; after polishing, the size note is still first and every
  commit link and every `Closes #N` line are still there.
- **Local Markdown**: keep the line's integration branch for human review and merge; record the branch name and tip
  SHA, then remove the integration worktree. Ticket status stays on that branch with the implementation; no PR or close
  is simulated.

Once the lines are delivered, call the Skill tool with `clean-it-up` and, by its evidence rules, clear the ticket
worktrees and merged local branches this run made. **Deliverables awaiting human review are out of scope**: Local
Markdown's line integration branches and aggregate PR source branches not yet merged are always kept. Remote branches
still need the user's explicit authority in this run; do not open a question for it.

**Merge**: on GitHub, once the aggregate PR's CI is green, whether `gh pr merge` is sent is decided by `ASKING.md`
section 5, "Actions that need authority"; an unsynced line or one that failed verification is never sent and is left
for a human to merge. Before sending, run `scripts/merge-gate.mjs --repo <owner>/<repo> --base <base branch>`:
`decision` `merge` or `queue` sends the same `gh pr merge <PR>` (`queue` with no merge strategy and no `--admin`);
`human` sends nothing and goes on the human-work list with its `reason` and `requiredChecks` or the failed query. It is
a prompting call, sent after the cleanup. Afterwards report it merged, or still in the queue with the PR URL; an
aggregate PR still in the queue is handled as "left for a human to merge" for closing tickets.

**Closing tickets** comes after `gh pr merge` is sent. GitHub resolves `Closes` only for a PR into the repo's default
branch, found with `gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`:

- The aggregate PR merged: confirm every delivered ticket is closed. When the base is not the default branch, or a
  ticket is still open after the merge, the host closes each by the tracker contract's Close, with a comment pointing
  to the aggregate PR.
- The aggregate PR left for a human, and the base is not the default branch: the human-work list gives the commands to
  close the tickets after the merge.

**Final output**: each line's aggregate PR or integration branch, the synced base SHA (or that it is unsynced), the full
verification's SHA and source, the **reconciliation table** covering every initial ticket (`state.mjs show`, with each
ticket's send-back count, each row pointing to its status record), **this run's metrics and budget** (the state's
`usage`, with `stop` after a stop) with the **spawn breakdown**, the authorization outcomes (ledger field 5), the
**lines that skipped the simplify pass** (the `wrap-up`'s `meta.simplifySkipped`, each with its reason; left out when
there are none), and the list of raw tickets filed during the run, asking the user to run `/triage`. The spawn breakdown is `byType` and
`byTicket` of `scripts/spawns.mjs <ledger directory>/<run>.counters.json`, attached as they are; with no counters file,
or a non-zero exit, say this run has no spawn breakdown and why, never an estimate. Standalone, after the output change
the ledger's first line to `<!-- sorry-matt:run ended -->`; when composed by `have-it-all-done`, leave it for its
hand-off.

Done when: the simplify fixes and the base sync are each their own commit; every aggregate PR body has a per-ticket
guide written from the `review-guide.mjs` output, with the size note first when `size.over` is true; every unsynced line
names its conflicted files and the base SHA tried and is left for a human to merge; every line has exactly one
deliverable for a human to merge, or its merge was sent per the `merge-gate.mjs` decision and reported; the delivered
tickets of every merged aggregate PR are closed, and where the keyword does not apply the human-work list has the
closing commands; the output lists the reconciliation table, the authorization outcomes and the metrics (with the spawn
breakdown or why there is none), and the lines that skipped the simplify pass, with their reasons in the self-answer
log; standalone, the ledger's first line is the ended marker.
