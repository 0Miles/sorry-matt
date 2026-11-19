# get-to-work: Finish the run

This file is every step of section 2, "Finish the run", in [`SKILL.md`](SKILL.md): read it in full when the pipeline
stops and the run is finished. "Step N" here means a step of this file's three line-level gates; section names and
steps with no file attached (section 0, and section 1's reading CI and close-out steps) are in `SKILL.md`.

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
   run, read once more a little later. On red, go through the red-light handling in [`RED-LIGHT.md`](RED-LIGHT.md).

   **Local verification:** its conditions, how to run it and the per-SHA record format follow "local verification"
   in reading CI in [`SKILL.md`](SKILL.md), the one source of truth for it.

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
