---
name: get-to-work
description: Clear a prepared ticket set round by round, implementing and reviewing in blocker order before delivering GitHub PRs or local integration branches
disable-model-invocation: true
---

# get-to-work: Complete every prepared ticket

## 0. Select the mode and freeze the ticket set

Starting from the base directory stated when this skill was loaded, read the sibling
[`../have-it-all-done/ASKING.md`](../have-it-all-done/ASKING.md) in full and run its section 0 opening. It is the
shared contract, and it applies throughout, whether the user ran this skill directly or `have-it-all-done` composed
it. When `have-it-all-done` composes this skill, keep its run ledger; running standalone, create one per
`ASKING.md` section 7.

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

Start a self-paced `/loop` with no interval and the prompt `get-to-work: close the round / open the round`.
While agents are running, use a longer fallback and wait for notifications. A closed round is the only handover
point, so write the ledger current before that round ends.

### Open the round

Every open-round starts by re-running `scripts/frontier.mjs`; the **frontier** is its `frontier` output:

- **GitHub:** tickets integrated into their line integration branch are still open on GitHub, so take the
  integrated tickets from the ledger's reconciliation table and pass them with `--done <n,...>`; pass stuck tickets
  with `--stuck <n,...>`.
- **Local Markdown:** run once per line, passing the whole frozen set with `--ref <that line's integration branch>`
  and `--line <that line's line>` (the value from the freeze); the frontier is the union of each line's `frontier`.
  Done and stuck come from the `sorry-matt completion` / `sorry-matt blocker` records in the ticket files on that
  branch, and `ready-for-human` does not count as done.

A ticket whose `stalled` is not null (`cycle`, `missing`, `blocked-external`, `blocked-upstream`) cannot become
startable within this run: list it as **awaiting ruling** with the reason and the blockers involved.

Work across lines is usually parallel; tickets on the same line or touching the same files are **mutually exclusive**
and must run in separate rounds.

For each frontier ticket:

1. From its line integration branch, create `<run>/<NN>-<slug>` and a ticket worktree.
2. Read the sibling [`IMPLEMENTER.md`](IMPLEMENTER.md), fill in its placeholders, and spawn one implementation
   agent with the filled-in text as its prompt, adding no rules of your own. The **status record** it defines is
   that ticket's own source of truth; everywhere else cites it.

Done when: every frontier ticket in the round has an independent branch, worktree, and responsible agent, and every
agent's prompt is the full `IMPLEMENTER.md` text with its placeholders filled; same-line or file-overlapping tickets
are absent from the same round.

### Close the round

After every agent in the round reports, take each ticket through these gates. The order is fixed — **targeted checks
→ one independent review → one batched fix → re-check by affected surface**; full verification happens once, while
finishing the run.

1. **Targeted checks:** confirm the affected-surface checks the agent reported are green. Red goes back to that
   agent first and comes to review green.
2. **Independent review:** call the Skill tool with `code-review`; the fixed point is the line integration branch
   and the spec source is the ticket URL or path. **One ticket gets this one reviewer by default**, its two axes
   covering standards and spec conformance together. Add a specialist reviewer only where a concrete risk calls for
   one, naming the risk and recording the rationale in the self-answer log; "another look, to be safe" is not a
   risk.
3. **Batched fix:** hand this ticket's findings back to the original context-holding agent all at once, fixed in one
   round rather than one finding at a time. Afterwards re-run only the targeted checks for the affected surface. At
   most two correction rounds.

   **Hard rail — a flaky red is chased to its root cause.** A test that goes red and green on the same commit is
   treated as a real failure: find the root cause, and fix the test when it lies there or fix the product and
   file a defect ticket when it lies there. Re-running, loosening a wait, adding a retry and raising a timeout
   all leave it unfixed. If two correction rounds do not find the root cause, mark the ticket stuck.
4. **Ticket PR (GitHub only):** push the ticket branch and create a PR against the line integration branch.
   Its body must include `Closes #N` and the review summary.
5. **Integrate:** merge the ticket branch in the integration worktree. Where there are conflicts, give them to a
   **merge agent** to resolve hunk by hunk: it gets the integration worktree, both sides' ticket text and commit
   messages, and this test — the choice is between two intents rather than two blocks of text, so trace each side
   to its primary source (the ticket text and the commit message), keep both where they are compatible, and where
   they are not, take the side that matches this merge's goal, with what lands limited to behaviour one side
   actually wrote. It reports the trade-off per hunk, and the host records those trade-offs in the self-answer
   log. Then run the targeted checks for the affected surface.
6. **Complete delivery:**
   - **GitHub:** push the integration branch and retain the ticket PR, now merged by ancestry, as the review
     record.
   - **Local Markdown:** on the integration branch, check every verified acceptance criterion in the ticket,
     set `Status` to `ready-for-human`, and append `## sorry-matt completion` with the implementation commit,
     integration branch, and passed checks. Commit this delivery record.
7. Remove the ticket worktree and local ticket branch.

Anything that comes up mid-run takes the three exits in `ASKING.md` section 4. Running standalone, with no ruling
point, whatever cannot be answered accumulates until the next open-round and is asked there in one go.

If the ticket still fails review after two correction rounds, or a conflict cannot be resolved safely, mark
it **stuck**:

- **GitHub:** file a separate raw issue recording the failure, its body polished per `ASKING.md` section 6.
- **Local Markdown:** append `## sorry-matt blocker` to the original ticket on the integration branch with the
  reason, attempted remedies, and relevant branch; set `Status` to `ready-for-human` and commit it.

After recording the stuck state, also remove the ticket worktree and local ticket branch.

Done when: every ticket in the round went through exactly one independent review with its targeted checks back to
green, and has either a reviewed, provider-native delivery or a traceable stuck record; every ticket that gained a
specialist reviewer names the risk; every ticket's status record is written current; successful tickets are
integrated and their ticket worktrees and local branches removed.

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

Every line passes **two line-level gates** first, in this order:

1. **Simplify:** in the integration worktree, call the Skill tool with `simplify` to make one quality pass over
   everything the line accumulated — reuse, simplification, efficiency, altitude — which it applies directly.
   Duplication across tickets is only visible after integration, so this pass runs here once rather than once per
   ticket. Record any dropped simplification in the self-answer log.
2. **Full verification:** run the repository's full checks once. On red, hand that stretch of changes back to its
   original agent and re-run; this single pass is the only green that counts this run.

**The evidence-expiry rule.** Once a ticket has passed its ticket-level review, any later change on the integration
branch to the files it touched — another ticket integrating, a conflict resolution, the line-level simplify — expires
that ticket's green, and only the line-level full verification still holds. What to re-run follows the real blast
radius of that change: by default only the targeted checks for the affected surface, with another full verification
reserved for a new fix, a failure, or an unresolved risk.

Then deliver each line according to its mode:

- **GitHub:** create one aggregate PR from the line integration branch into the base branch. Link the ticket
  PRs and use `Closes #N` only for completed tickets; list stuck and awaiting-ruling tickets as gaps. Polish the
  aggregate PR body per `ASKING.md` section 6.
- **Local Markdown:** leave the line integration branch for human review and merge. Record its branch name and
  tip SHA, then remove the integration worktree. Ticket state travels with the implementation on that branch;
  do not simulate a PR or close operation.

Once the aggregate PR's CI goes green, GitHub mode sends the merge with `gh pr merge`. It is a prompting call, sent
after cleanup; Claude Code's permission settings decide whether it is let through, and in `bypassPermissions` and
`auto` mode the hook always blocks it (`ASKING.md` section 5). When it is let through, report the merge; when it is
blocked or refused, the delivery stays with the human and the output carries the permission rule snippet that
would let it through. Do not open a question for it.

Once a line is delivered, clean up: call the Skill tool with `clean-it-up` and let its evidence rules retire the
ticket worktrees and merged local branches this run created. **Deliverables awaiting human review are out of
scope for cleanup:** Local Markdown line integration branches and the source branches of unmerged aggregate PRs
are kept — for unmerged items, `clean-it-up` itself downgrades to keep. Remote branches still require the user's
explicit authority for this request; do not open a question for it.

Report each line's aggregate PR or integration branch, the **reconciliation table** covering the entire initial set
and this run's **metrics** (`ASKING.md` section 7), the authorization outcomes (section 5), and every raw ticket
filed along the way with a recommendation that the user run `/triage`.

Done when: every line went through one line-level simplify and one full verification and ended green, and has
exactly one human-mergeable delivery, or was merged after the permission settings let it through and reported; the
reconciliation table covers the frozen set exactly once, every row pointing at that ticket's status record; every
ticket worktree and local ticket branch is removed; Local Markdown integration worktrees are removed while their integration
branches remain; the output lists the authorization outcomes and this run's metrics.
