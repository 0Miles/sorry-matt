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
`ASKING.md` section 7, with field 10 listing the absolute paths of this skill's `SKILL.md` and `ASKING.md`.

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
resumption step (`ASKING.md` section 7) never depends on memory. While agents are running, use a longer fallback and wait for notifications. A closed round is the only handover
point, so write the ledger current before that round ends.

### Open the round

Every open-round starts by re-running `scripts/frontier.mjs`; the **frontier** is its `frontier` output:

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
   shared directory beside the ledger; in the scratchpad when there is no ledger), and never overwrite it once
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

Done when: every ticket dispatched this round had acceptance criteria and an acceptance snapshot before its
implementation agent was spawned, and every criterion added by expansion came from the expansion agent and states
`by`, `run` and `round`; every frontier ticket in the round has an independent branch, worktree, and responsible
agent, or is listed as awaiting ruling; every implementation agent's prompt is the full `IMPLEMENTER.md` text with its
placeholders filled; same-line or file-overlapping tickets are absent from the same round.

### Close the round

After every agent in the round reports, take each ticket through these gates. The order is fixed — **targeted checks
→ one independent review → one batched fix → re-check by affected surface**; full verification happens once, while
finishing the run.

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
4. **Integrate:** merge the ticket branch in the integration worktree. Where there are conflicts, give them to a
   **merge agent** to resolve hunk by hunk: it gets the integration worktree, both sides' ticket text and commit
   messages, and this test — the choice is between two intents rather than two blocks of text, so trace each side
   to its primary source (the ticket text and the commit message), keep both where they are compatible, and where
   they are not, take the side that matches this merge's goal, with what lands limited to behaviour one side
   actually wrote. It reports the trade-off per hunk, and the host records those trade-offs in the self-answer
   log. Then run the targeted checks for the affected surface.
5. **Complete delivery:**
   - **GitHub:** push the integration branch. The ticket stays open; closing it is the aggregate PR's job
     (section 2). This ticket's summary lives in its commit message (`IMPLEMENTER.md` section 2).
   - **Local Markdown:** on the integration branch, check every verified acceptance criterion in the ticket
     (the expansion block's included),
     set `Status` to `ready-for-human`, and append `## sorry-matt completion` with the implementation commit,
     integration branch, and passed checks. Commit this delivery record.
6. Remove the ticket worktree and local ticket branch.

Anything that comes up mid-run takes the three exits in `ASKING.md` section 4. Running standalone, with no ruling
point, whatever cannot be answered accumulates until the next open-round and is asked there in one go.

If the ticket still fails review after two correction rounds, or a conflict cannot be resolved safely, mark
it **stuck**:

- **GitHub:** file a separate raw issue recording the failure, its body polished per `ASKING.md` section 6.
- **Local Markdown:** append `## sorry-matt blocker` to the original ticket on the integration branch with the
  reason, attempted remedies, and relevant branch; set `Status` to `ready-for-human` and commit it.

After recording the stuck state, also remove the ticket worktree and local ticket branch.

Done when: every ticket in the round went through exactly one independent review (`prove-it` in `initial`; a
`stuck` before the review opens does not count), each
correction round had one `recheck`, every call came with that call's acceptance diff output against the acceptance snapshot,
and every verdict is in the status record; its targeted checks are back to
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

Once the aggregate PR's CI goes green, GitHub mode sends the merge with `gh pr merge`. It is a prompting call, sent
after cleanup; Claude Code's permission settings decide whether it is let through, and in `bypassPermissions` and
`auto` mode the hook always blocks it (`ASKING.md` section 5). When it is let through, report the merge; when it is
blocked or refused, the delivery stays with the human and the output carries the permission rule snippet that
would let it through. Do not open a question for it.

**Closing tickets** comes after `gh pr merge` is sent. GitHub reads `Closes` only in a PR that targets the
repository's default branch; find that branch with `gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`:

- Aggregate PR merged: confirm every completed ticket is closed. When the base is not the default branch, or a
  ticket is still open after the merge, the host closes it per the tracker contract's Close, with a comment
  pointing at the aggregate PR.
- Aggregate PR left for a human to merge, with a base that is not the default branch: the human-work list carries
  the close commands to run after the merge.

Report each line's aggregate PR or integration branch, the **reconciliation table** covering the entire initial set
and this run's **metrics** (`ASKING.md` section 7), the authorization outcomes (section 5), and every raw ticket
filed along the way with a recommendation that the user run `/triage`.

Done when: every line went through one line-level simplify and one full verification and ended green, and has
exactly one human-mergeable delivery, or was merged after the permission settings let it through and reported; every
completed ticket of a merged aggregate PR is closed, and where an aggregate PR is left to a human and the keyword
does not apply, the human-work list carries the close commands; the
reconciliation table covers the frozen set exactly once, every row pointing at that ticket's status record; every
ticket worktree and local ticket branch is removed; Local Markdown integration worktrees are removed while their integration
branches remain; the output lists the authorization outcomes and this run's metrics.
