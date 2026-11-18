---
name: get-to-work
description: Clear a prepared ticket set round by round, implementing and reviewing in blocker order before delivering one aggregate GitHub PR or local integration branch per line
disable-model-invocation: true
---

# get-to-work: Complete every prepared ticket

## 0. Select the mode and freeze the ticket set

Starting from the base directory stated when this skill was loaded, read the sibling
[`../have-it-all-done/ASKING.md`](../have-it-all-done/ASKING.md) in full and run its section 0 opening. It is the
shared contract, and it applies throughout, whether the user ran this skill directly or `have-it-all-done` composed
it. When `have-it-all-done` composes this skill, keep its run ledger; running standalone, create one per
`ASKING.md` section 7 or take one over; either way field 10 must list the absolute paths of this skill's `SKILL.md`
and `ASKING.md`, adding whichever is missing.

Confirm a Git repository and clean working tree; when the tracker configuration selects GitHub, also confirm
`gh` is authenticated. Local Markdown mode needs no remote or `gh`. Section 2 gives each mode's deliveries.

When the configuration says the workspace spans several repositories, survey tickets repository by repository.
Lines never cross a repository; each repository gets its own integration branches and deliveries.

Then **freeze** the initial ticket set:

1. The optional argument accepts ticket numbers, URLs, or local file paths. With one, the initial set is
   exactly the named tickets. Without one, include only tickets with a publication record in this session;
   Local Markdown publication paths count. If none exist, ask the user for the set.
2. Run this skill's `scripts/frontier.mjs` over the frozen set (`${CLAUDE_SKILL_DIR}` is the base directory
   stated when this skill was loaded). Its `blockedBy` output is the blocker **edges** and its `line` output the
   **lines**; do not derive them from the ticket text yourself:

   ```bash
   node "${CLAUDE_SKILL_DIR}/scripts/frontier.mjs" github --repo <owner>/<repo> <n>...
   node "${CLAUDE_SKILL_DIR}/scripts/frontier.mjs" local <ticket-file>...
   ```

   The script's header documents the output format.
3. **Exclude what another line holds.** From `git worktree list`, the commits on unmerged integration branches,
   the heads of open PRs, and whatever other sessions this session knows about, derive the files somebody else is
   working in. Tickets overlapping those files are not frozen into this set: list them as **awaiting ruling**
   with the source of the hold and its clearing condition. When any ticket is excluded, re-run the script over the
   remaining set and take the lines from that run's `line` — an exclusion can split a line.
4. From the current branch tip, create one `<run>/<line-slug>` **integration branch** and integration worktree
   per line. Accumulate that line's results there round by round.

**Hard rail:** tickets discovered or filed during the run remain context; the initial set never expands after
the freeze.

Done when: the tracker mode is selected and verified; every initial ticket
has a publication source, provider-native identifier, line, and blocker map; every ticket excluded as held by
another line has a source and a clearing condition; every line has an integration branch and worktree created
from the same base tip.

## 1. Advance rounds with `/loop`

Start a self-paced `/loop` with no interval and the prompt `get-to-work: re-read <absolute ledger path> and the
rule files its field 10 lists, then close the round / open the round`; with no ledger, the prompt names the absolute
paths of this skill's `SKILL.md` and `ASKING.md` to re-read instead. Every wake-up carries that sentence, so the
resuming (`ASKING.md` section 7) never depends on memory.

While agents are running, use a longer fallback and wait for notifications. A closed round is the only handover
point, so write the ledger current before that round ends.

### Reading CI

Both the open-round and finishing the run go by **the CI result for the integration branch's latest SHA**. The
latest SHA is `git rev-parse origin/<integration branch>`; when it differs from the local integration branch, push
first per close the round step 6, then read:

```bash
gh run list --branch <integration branch> --commit <SHA> --limit 100 --json databaseId,workflowName,status,conclusion
```

Only GitHub Actions is read; any other CI is invisible here and counts as no run. All of one SHA's runs together give
one result, classified in this order, the first match winning; record the result and its SHA in ledger field 4:

- **Query failed:** `gh` exits non-zero. Do not guess: record why, and read again next time.
- **No run:** the list is empty. A just-pushed SHA may not be registered yet, so treat it as still running first. Only
  when two open-rounds in a row read an empty list, and `gh run list --branch <integration branch> --limit 1 --json
  databaseId` is empty too (the branch has never had a run), is the line settled as **CI does not cover the
  integration branch**; that holds through finishing the run, and the line's CI is not read again.
- **Red:** some run's `conclusion` is `failure`, `timed_out`, `startup_failure`, `action_required` or `stale`. Go
  through the red-light handling below.
- **Still running:** some run's `status` is not `completed`. Do not wait and do not poll; next time, read the
  then-latest SHA — every run covers the full suite, so a newer SHA covers the older ones.
- **Cancelled:** some run is `cancelled`. `gh run rerun <databaseId>`, and treat it as still running.
- **Green:** anything else — every run is `completed`, with `conclusion` `success`, `skipped` or `neutral`.

**Red-light handling.**

1. **Earliest red SHA:** aggregate `gh run list --branch <integration branch> --limit 200 --json
   headSha,status,conclusion` by `headSha`, classifying each SHA as above; walking
   `git log --first-parent --format=%H origin/<integration branch>` from newest to oldest, find the earliest red SHA —
   the nearest SHA before it with a verdict is green.
2. **Map it to a ticket:** `git log --merges --first-parent --format='%H %s' <previous green SHA>..<earliest red SHA>`
   lists that stretch's merge commits. One whose subject carries a ticket branch name
   (`Merge branch '<run>/<NN>-<slug>'`) is that ticket; the host's commits — completion records, stuck records,
   tickets filed along the way — are not merges, so landing in between changes nothing. With several tickets (the
   pushes between them have no verdict), start from the earliest. With no ticket-branch merge — the red came from a
   host commit, the simplify pass or the base sync — it **maps to no ticket**.
3. Save the failing jobs and steps with `gh run view <databaseId> --log-failed`; the host takes only the failing
   lines.
4. **Fix, two rounds at most:** when it maps to a ticket, hand it back to that ticket's original agent (if it is gone,
   spawn a new one per `IMPLEMENTER.md` with the failure summary attached to the ticket text), to fix on a
   `<run>/<NN>-<slug>-ci` branch freshly cut from the integration branch: the CI failure is the finding, and it goes
   through close the round step 3's batched fix (`recheck` attaching that ticket's previous review block) and steps
   4–7. When it maps to no ticket, the host or the agent that ran that step fixes it in the integration worktree,
   commits and pushes. The flaky-red hard rail applies. Every fix round ends with a push, and the next CI read
   gives its result.
5. **Still red after two rounds, mapped to a ticket: revert.** `git revert -m 1 <that ticket's merge commit>`, and take
   back its completion record:
   - **GitHub:** file the stuck record's raw issue per close the round; later open-rounds move the ticket from
     `--done` to `--stuck`.
   - **Local Markdown:** `git revert` the commit holding the completion record, then append `## sorry-matt blocker`
     per close the round, giving the red CI and the reverted commit as the reason. The frontier reads a blocker
     after the completion record as stuck, so a completion record the revert missed still does not count as done.

   Its row in the ledger's reconciliation table becomes stuck, and the aggregate PR lists it as a gap. Integrated
   tickets that depend on it become gaps as well: their merges stay, their reconciliation rows say "upstream
   reverted", GitHub moves them from `--done` to `--stuck`, and Local Markdown appends a blocker to each naming the
   upstream; the aggregate PR writes no `Closes` for any of them. Push, then read CI as usual. To integrate the
   reverted ticket again later, first undo the revert with `git revert <the revert commit>`; otherwise Git considers
   it already merged and brings none of its changes back.
6. **Still red after two rounds, mapped to no ticket:** the line has **failed verification**: send no `gh pr merge`,
   enter no merge queue, say so in the aggregate PR and leave it for a human to merge, with the failing jobs in the
   human-work list.

### Open the round

Every open-round starts by reading CI, per reading CI, for each line that has been pushed and is not settled as not
covered by CI. A red line goes through the red-light handling and dispatches nothing new until it is green or the
culprit is reverted; any other result opens the round as usual.

Then re-run `scripts/frontier.mjs`; the **frontier** is its `frontier` output:

- **GitHub:** tickets integrated into their line integration branch are still open on GitHub (closing waits for the
  aggregate PR's merge), so take the integrated tickets from the ledger's reconciliation table and pass them with
  `--done <n,...>`; pass stuck tickets with `--stuck <n,...>`.
- **Local Markdown:** run once per line, passing the whole frozen set with `--ref <that line's integration branch>`
  and `--line <that line's line>` (the value from the freeze); the frontier is the union of each line's `frontier`.
  Done and stuck come from the `sorry-matt completion` / `sorry-matt blocker` records in the ticket files on that
  branch, and `ready-for-human` does not count as done.

A ticket whose `stalled` is not null (`cycle`, `missing`, `blocked-external`, `blocked-upstream`) cannot become
startable within this run: list it as **awaiting ruling** with the reason and the blockers involved.

Work across lines is usually parallel; tickets on the same line or touching the same files are **mutually exclusive**
and must run in separate rounds.

For each frontier ticket, settle its acceptance criteria before work starts. Whoever writes the criteria must not be
the one who has to pass them, so the implementation agent only reads the criteria; it neither writes nor changes them:

1. **Acceptance:** read the ticket's criteria and where each came from with this skill's `scripts/acceptance.mjs`,
   not by reading the ticket text yourself:

   ```bash
   node "${CLAUDE_SKILL_DIR}/scripts/acceptance.mjs" github --repo <owner>/<repo> <n>
   node "${CLAUDE_SKILL_DIR}/scripts/acceptance.mjs" local --ref <that line's integration branch> <ticket file path>
   ```

   The output format is in the script's header. Tickets with `needsExpansion` true (not a single criterion, usually
   a ticket whose full expansion was deferred until it reached the frontier) go to an **expansion agent**: read
   the sibling [`EXPANDER.md`](EXPANDER.md), fill its placeholders with every such ticket in this round, and spawn
   one expansion agent with the filled-in text as its prompt, adding no rules of your own. It writes an expansion
   block on the tracker stating `by`, `run` and `round`. After it reports, re-run the script; a ticket still true,
   or reported as awaiting ruling, is listed as **awaiting ruling**, is not dispatched again in this run, and is
   dropped from the frontier at later open-rounds.
2. **Acceptance snapshot:** save the script's output for every ticket about to be dispatched as
   `sorry-matt/runs/<run>/acceptance/<ticket>.json`, where `<ticket>` is the ticket number or file name (in the
   common directory beside the ledger; in the scratchpad when there is no ledger), and never overwrite it once
   saved. It is the baseline the round's close compares against to tell whether the criteria were changed. Record
   the output's `sha256` in that ticket's row of the ledger's reconciliation table as well: the snapshot's path can
   be worked out, so the acceptance diff uses this value to prove the snapshot itself was not edited.
3. From its line integration branch, create `<run>/<NN>-<slug>` and a ticket worktree. With Local Markdown the
   expansion block is already committed on the integration branch, and the ticket branch is cut after it.
4. Read the sibling [`IMPLEMENTER.md`](IMPLEMENTER.md), fill in its placeholders, and spawn one implementation
   agent with the filled-in text as its prompt, adding no rules of your own. Fill the expansion-block placeholder
   from `expansions[].text` in that ticket's acceptance snapshot: on GitHub the expansion block is a comment, so the
   ticket text does not contain it. The **status record** it defines is that ticket's own source of truth;
   everywhere else cites it.

Done when: every line due a CI read had its latest SHA's result read and recorded in the ledger, a red line
dispatched nothing new until it was green or reverted, and a reverted ticket and the integrated tickets depending on
it are out of `--done`, their reconciliation rows marked stuck or gap; every ticket dispatched this round had acceptance criteria and an acceptance snapshot before its
implementation agent was spawned, and every criterion added by expansion came from the expansion agent and states
`by`, `run` and `round`; every frontier ticket in the round has an independent branch, worktree, and responsible
agent, or is listed as awaiting ruling; every implementation agent's prompt is the full `IMPLEMENTER.md` text with its
placeholders filled; same-line or file-overlapping tickets are absent from the same round.

### Close the round

After every agent in the round reports, take each ticket through these gates. The order is fixed — **targeted checks
→ one independent review → one batched fix → re-check by affected surface**. The full suite belongs to CI: every
integration pushes the integration branch, CI runs in the background, the host does not wait, and the next
open-round reads the result.

1. **Targeted checks:** confirm the affected-surface checks the agent reported are green. Red goes back to that
   agent first and comes to review green.
2. **Independent review:** first run the acceptance diff — re-read the ticket with `acceptance.mjs` plus
   `--against <acceptance snapshot> --sha <the sha256 in the reconciliation table>` (for Local Markdown, with
   `--ref <ticket branch>`) and save the output. Exit code 3 means the snapshot itself was edited; save the output
   and hand it to the review all the same, with `check.changed` true. Then call the Skill tool with `prove-it` in
   mode `initial`, passing the ticket (identifier, the original ticket text and the expansion block), the paths of
   the acceptance snapshot and of the acceptance diff output, the fixed point (the line integration branch), the
   ticket branch, and the targeted-check results from step 1. The reviewer does the live run and mutation limited
   to this ticket's diff, and it writes a fixed-format
   `pass` / `fix` / `stuck` verdict and finding list into the ticket's status record. `pass` goes on to integration,
   `fix` to the batched fix, and `stuck` is cleared using the condition it states: a `stuck` before the review
   opens does not count as a review, so once cleared run `initial` again; a `stuck` mid-review, once cleared,
   resumes only the part it recorded as unfinished. If it cannot be cleared, mark the ticket stuck. **One ticket gets this one reviewer by default**, its lenses covering
   standards and spec conformance together. Add a specialist reviewer only where a concrete risk calls for one,
   naming the risk and recording the rationale in the self-answer log; "another look, to be safe" is not a risk.
3. **Batched fix:** hand this ticket's findings back to the original context-holding agent all at once, fixed in one
   round rather than one finding at a time. Afterwards re-run the targeted checks for the affected surface and the
   acceptance diff, then call the Skill tool with `prove-it` in mode `recheck`, attaching the previous review block
   and the new acceptance diff output: it reruns the live
   run and mutation only on the lines the findings concern, and is not a second review. At most two correction
   rounds.

   **Hard rail — a flaky red is chased to its root cause.** A test that goes red and green on the same commit is
   treated as a real failure: find the root cause, and fix the test when it lies there or fix the product and
   file a defect ticket when it lies there. Re-running, loosening a wait, adding a retry and raising a timeout
   all leave it unfixed. If two correction rounds do not find the root cause, mark the ticket stuck.
4. **Integrate:** in the integration worktree, merge with `git merge --no-ff <ticket branch>`, one merge commit per
   ticket. Where there are conflicts, give them to a
   **merge agent** to resolve hunk by hunk: it gets the integration worktree, both sides' ticket text and commit
   messages, and this test — the choice is between two intents rather than two blocks of text, so trace each side
   to its primary source (the ticket text and the commit message), keep both where they are compatible, and where
   they are not, take the side that matches this merge's goal, with what lands limited to behaviour one side
   actually wrote. It reports the trade-off per hunk, and the host records those trade-offs in the self-answer
   log. Then run the targeted checks for the affected surface.
5. **Complete delivery:**
   - **GitHub:** the ticket stays open; closing it is the aggregate PR's job (section 2). This ticket's summary lives in its commit message (`IMPLEMENTER.md` section 2).
   - **Local Markdown:** on the integration branch, check every verified acceptance criterion in the ticket
     (the expansion block's included),
     set `Status` to `ready-for-human`, and append `## sorry-matt completion` with the implementation commit,
     integration branch, and passed checks. Commit this delivery record.
6. **Push:** with an `origin`, `git push -u origin <integration branch>`, in both modes; Local Markdown with no
   remote skips it, and finishing the run takes section 2 step 3's local verification. Push once per integration, never batching
   several tickets into one push: a red light has to point at one integration. Do not wait for CI after pushing.
7. Remove the ticket worktree and local ticket branch.

Anything that comes up mid-run takes the three exits in `ASKING.md` section 4. Running standalone, with no ruling
point, whatever cannot be answered accumulates until the next open-round and is asked there in one go.

If the ticket still fails review after two correction rounds, or a conflict cannot be resolved safely, mark
it **stuck**:

- **GitHub:** file a separate raw issue recording the failure, its body polished per `ASKING.md` section 6.
- **Local Markdown:** append `## sorry-matt blocker` to the original ticket on the integration branch with the
  reason, attempted remedies, and relevant branch; set `Status` to `ready-for-human` and commit it.

After recording the stuck state, also remove the ticket worktree and local ticket branch. Push the host's other
commits on the integration branch (stuck records, tickets filed along the way) before the round closes.

Done when: every ticket in the round went through exactly one independent review (`prove-it` in `initial`; a
`stuck` before the review opens does not count), each
correction round had one `recheck`, every call came with that call's acceptance diff output against the acceptance snapshot,
and every verdict is in the status record; its targeted checks are back to
green, and has either a reviewed, provider-native delivery or a traceable stuck record; every ticket that gained a
specialist reviewer names the risk; every ticket's status record is written current; successful tickets are
integrated and their ticket worktrees and local branches removed; on a line with an `origin`, every integration
was pushed on its own, and when the round closes `origin/<integration branch>` and the local integration branch are
the same SHA.

### Filing along the way

File out-of-scope bugs, prefactors, technical debt, and any defect whose root cause a flaky red exposed outside
this scope, only as raw tickets linked to the source finding:

- **GitHub:** use `gh issue create` without `ready-for-agent`; polish the body per `ASKING.md` section 6.
- **Local Markdown:** follow the tracker convention to create the next unused ticket file, set `Status` to
  `needs-triage`, and commit it on the line integration branch where it was found.

Keep these raw tickets outside both the initial set and this run's frontier.

Stop the loop when every initial ticket has a completed delivery. Also stop when the frontier is empty but
stuck or **awaiting ruling** tickets remain.

Done when: every initial ticket reconciles exactly once to delivered, stuck, or awaiting ruling; every raw
ticket filed along the way links its source and none has entered the frozen set.

## 2. Finish the run

Every line passes **three line-level gates** first, in this order:

1. **Simplify:** in the integration worktree, call the Skill tool with `simplify` to make one quality pass over
   everything the line accumulated — reuse, simplification, efficiency, altitude — which it applies directly.
   Duplication across tickets is only visible after integration, so this pass runs here once rather than once per
   ticket. Record any dropped simplification in the self-answer log.
2. **Sync the base:** the integration branch was cut from the base tip in section 0, and the base may have moved
   during the run; a green only counts on the latest base. In the integration worktree, merge the latest base tip
   into the integration branch: with an `origin`, `git fetch origin <base branch>` then
   `git merge origin/<base branch>`; in Local Markdown mode with no remote, merge the local `<base branch>`. Record
   the merged base SHA in ledger field 4. Conflicts go to the **merge agent** from section 1, close the round step 4,
   under the same criterion: one side is the line (its tickets' text and commit messages), the other is the base
   (`git log --format=%B <merge-base>..<merged base ref>`), and the goal of this merge is the line's intent landing
   on the latest base. The host records the tradeoffs in the self-answer log. When the merge agent reports a
   conflict it cannot resolve safely, run `git merge --abort`; the line is then **unsynced**: ledger field 4 records
   the base SHA it tried and "unsynced", the delivery and the human-work list name the conflicting files, and the
   delivery is always left for a human to merge (see the merge paragraph below).
3. **Full verification:** the CI result for the integration branch's latest SHA is what counts. Push the
   integration branch as steps 1–2 left it, per close the round step 6, and read it per section 1, reading CI.
   While it is still running, run `gh run watch <databaseId> --exit-status` once for each unfinished run to wait it
   out — one blocking call per run, no repeated polling, in the background where the environment allows. With no
   run, read once more a little later. On red, go through section 1's red-light handling: after the last round
   there is no next open-round, so read again right here after every fix round's push, and after a revert; mapped
   to no ticket and still red after two rounds, the line has **failed verification**.

   **Local verification** (this skill's one source of truth for it; everywhere else points here): with no `origin`,
   a line settled as not covered by CI, or no verdict for this SHA (a failed query, or still no run on the second
   read), run the repository's full checks locally once on this SHA instead, and the report says which case it
   was. A local red is fixed per points 4–6 of the red-light handling, and re-run after each fix.

   The report gives the verified SHA, its source (CI, or local with the reason) and the merged base SHA; an unsynced
   line is verified all the same, on its unsynced tree, and the report gives the base SHA it tried and "unsynced".
   The only green that counts this run is the result for that last SHA.

**The evidence-expiry rule.** A green holds only for the SHA it ran on. Every new commit on the integration branch —
another ticket integrating, a conflict resolution, a fix for a red CI, the line-level simplify, the base sync —
expires the earlier greens, ticket-level review greens included; only the result for the integration branch's latest
SHA holds.

Then deliver each line according to its mode:

- **GitHub:** create one aggregate PR from the line integration branch into the base branch. Its body gives each
  completed ticket a section: a summary and `Closes #N`. The host writes the summary from every commit message the
  ticket integrated into the line, batched-fix commits included:
  `git log --format=%B -E --grep='#N([^0-9]|$)' <base branch>..<line integration branch>`.
  Stuck and awaiting-ruling tickets are listed as **gaps**, with no `Closes`. Polish the aggregate PR body per
  `ASKING.md` section 6; every `Closes #N` line must survive the polish.
- **Local Markdown:** leave the line integration branch for human review and merge. Record its branch name and
  tip SHA, then remove the integration worktree. Ticket state travels with the implementation on that branch;
  do not simulate a PR or close operation.

Once a line is delivered, clean up: call the Skill tool with `clean-it-up` and let its evidence rules retire the
ticket worktrees and merged local branches this run created. **Deliverables awaiting human review are out of
scope for cleanup:** Local Markdown line integration branches and the source branches of unmerged aggregate PRs
are kept — for unmerged items, `clean-it-up` itself downgrades to keep. Remote branches still require the user's
explicit authority for this request; do not open a question for it.

Once the aggregate PR's CI goes green, GitHub mode sends the merge with `gh pr merge`; an unsynced line, or one that failed verification, sends
nothing and does not enter a merge queue, and its aggregate PR is left for a human to merge. It is a prompting
call, sent after cleanup; Claude Code's permission settings decide whether it is let through, and in
`bypassPermissions` and `auto` mode the hook always blocks it (`ASKING.md` section 5). When it is let through,
report the merge; when it is blocked or refused, the delivery stays with the human and the output carries the
permission rule snippet that would let it through. Do not open a question for it.

**Merge queue.** Before sending, check whether the base branch has a merge queue:

```bash
gh api graphql -f query='query($owner:String!,$name:String!,$branch:String!){repository(owner:$owner,name:$name){mergeQueue(branch:$branch){url}}}' -f owner=<owner> -f name=<repo> -f branch=<base branch>
```

A null `mergeQueue` means it has none: follow the paragraph above; nothing changes. With one, the merge goes
through the queue: the same `gh pr merge <PR>`, with no merge strategy and no `--admin` — gh adds the PR to the
queue, which groups it with the latest base and the PRs ahead of it into a merge group and verifies that again
before merging. The permission settings still decide whether it is let through, and the hook still blocks it in
`bypassPermissions` and `auto` mode; skipping the queue with `--admin`, or entering it with GraphQL's
`enqueuePullRequest` and so around the permission check on `gh pr merge`, is always blocked.

The queue runs checks only on `merge_group` events, so before sending, confirm its checks will run:

- A workflow on the base ref has `merge_group` in its `on:`
  (`git grep -l merge_group origin/<base branch> -- .github/workflows`): send.
- No such workflow, and the base branch has no required checks: send. The required checks are the union of the
  rulesets'
  `gh api repos/<owner>/<repo>/rules/branches/<base branch> --jq '[.[]|select(.type=="required_status_checks")|.parameters.required_status_checks[].context]'`
  and branch protection's
  `gh api repos/<owner>/<repo>/branches/<base branch> --jq '.protection.required_status_checks.contexts'`.
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
verification's SHA and source (CI, or local with the reason), the
**reconciliation table** covering the entire initial set and this run's **metrics** (`ASKING.md` section 7), the
authorization outcomes (section 5), and every raw ticket filed along the way with a recommendation that the user
run `/triage`. Running standalone, change the ledger's first line to `<!-- sorry-matt:run ended -->` after this
output; when `have-it-all-done` composes this skill, leave it for that skill's handoff.

Done when: every line went through one line-level simplify, one base sync and one full verification, ending green
or marked as failed verification and left for a human to merge; the full verification is the CI result for the
latest SHA of the integration branch synced to the latest base, or, under step 3's local-verification conditions, a
local run on that same SHA with the reason reported, and its report naming the verified SHA and the base SHA; an unsynced line names its conflicting files and the base SHA it tried, was verified on its unsynced
tree, and is left for a human to merge; every line has exactly one human-mergeable delivery, or was merged after the
permission settings let it through (through the merge queue when the base has one) and reported; every completed
ticket of a merged aggregate PR is closed, and where an aggregate PR is left to a human and the keyword does not
apply, the human-work list carries the close commands; the reconciliation table covers the frozen set exactly
once, every row pointing at that ticket's status record; every ticket worktree and local ticket branch is removed;
Local Markdown integration worktrees are removed while their integration branches remain; the output lists the
authorization outcomes and this run's metrics; running standalone, the ledger's first line is the ended marker.
