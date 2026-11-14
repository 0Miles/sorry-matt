---
name: get-to-work
description: Clear a prepared ticket set round by round, implementing and reviewing in blocker order before delivering GitHub PRs or local integration branches
disable-model-invocation: true
---

# get-to-work: Complete every prepared ticket

## 0. Select the mode and freeze the ticket set

Read four things, in order:

1. `docs/agents/issue-tracker.md`. Its provider and conventions select GitHub or Local Markdown mode. If the file
   is missing, ask the user to run `/setup-matt-pocock-skills` first.
2. `sorry-matt/authority.md` under the common directory that
   `git rev-parse --path-format=absolute --git-common-dir` reports, for the **standing authority**. When it is
   missing, run on the defaults — do not stop.
3. `docs/agents/environment.md`, for the environment facts already on record. Skip it when missing.
4. Starting from the base directory stated when this skill was loaded, the sibling
   [`../have-it-all-done/ASKING.md`](../have-it-all-done/ASKING.md), in full. It is the asking contract, and it
   applies throughout, whether the user ran this skill directly or `have-it-all-done` composed it.

The **run ledger** is this run's source of truth for state: when `have-it-all-done` composes this skill, it hands
over `sorry-matt/runs/<run>.md` under the common directory; running standalone, create one there where the common
directory is writable, and where it is not, this run's output is the source of truth. At the end of every closed round, write
the reconciliation table, the self-answer log, and the run metrics back to it. The host's context has a budget of
its own: diffs, test logs, agent reports, and full ticket bodies stay in the subagents and files that hold them,
while the host takes fixed-format summaries (fifteen lines at most) and evidence paths. Every report this round
follows that budget.

Confirm a Git repository and clean working tree, then verify the mode-specific delivery conditions:

- **GitHub:** `gh` is authenticated; deliveries are ticket PRs and one aggregate PR per line.
- **Local Markdown:** no remote or `gh` is required; deliveries are line integration branches and no PRs are
  created.

The authority level comes from the three layers in `ASKING.md` section 5: where the standing authority has a row
with a source, follow it; where it does not, the caller supplies it — `have-it-all-done`'s ruling point, or the
user's instruction for this run. Force-pushes always stay with the human; real-money transactions, production
data, outbound sending, and third-party communication are permanent exceptions, ungrantable at any layer.

When the configuration says the workspace spans several repositories, survey tickets repository by repository.
Lines never cross a repository; each repository gets its own integration branches and deliveries.

Then **freeze** the initial ticket set:

1. The optional argument accepts ticket numbers, URLs, or local file paths. With one, the initial set is
   exactly the named tickets. Without one, include only tickets with a publication record in this session;
   Local Markdown publication paths count. If none exist, ask the user for the set.
2. Read blocker **edges** through the tracker contract and divide tickets into **lines**. Connected tickets
   share a line; isolated tickets form their own. When the set needs chaining, call the Skill tool with
   `issue-chain` and pass the frozen set explicitly so background work remains outside it.
3. **Exclude what another line holds.** From `git worktree list`, the commits on unmerged integration branches,
   the heads of open PRs, and whatever other sessions this session knows about, derive the files somebody else is
   working in. Tickets overlapping those files are not frozen into this set: list them as **awaiting ruling**
   with the source of the hold and its clearing condition.
4. From the current branch tip, create one `<run>/<line-slug>` **integration branch** and integration worktree
   per line. Accumulate that line's results there round by round.

**Hard rail:** tickets discovered or filed during the run remain context; the initial set never expands after
the freeze.

Done when: the tracker mode is selected and verified; the standing authority is recorded; every initial ticket
has a publication source, provider-native identifier, line, and blocker map; every ticket excluded as held by
another line has a source and a clearing condition; every line has an integration branch and worktree created
from the same base tip.

## 1. Advance rounds with `/loop`

Start a self-paced `/loop` with no interval and the prompt `get-to-work: close the round / open the round`.
While agents are running, use a longer fallback and wait for notifications. Every wake-up starts by reading the
ledger's next action rather than inferring from the context where this run stands; a closed round is the only
handover point, so write the ledger current before that round ends.

### Open the round

The **frontier** contains unfinished initial tickets whose blockers are all cleared. Work across lines is
usually parallel; tickets on the same line or touching the same files are **mutually exclusive** and must run
in separate rounds.

For each frontier ticket:

1. From its line integration branch, create `<run>/<NN>-<slug>` and a ticket worktree.
2. Read the [pinned implement workflow](references/upstream/implement.md) in full. Spawn one subagent with that
   complete workflow, the worktree, provider-native ticket identifier and full text, and integration branch;
   require it to follow the workflow completely, plus three **sorry-matt extension contracts** that override the
   matching two lines of the pinned workflow:

   - **The independent review belongs to the host**, which runs it once while closing the round, so the
     implementation agent does not call `code-review` itself — reviewing code you just wrote is not independent,
     and letting two reviewers each read the same diff buys nothing on the second pass but the repetition.
   - **Inside the ticket, run only the targeted checks for the affected surface:** typecheck, the test files this
     ticket touches, the relevant lint. The host runs the full suite once while finishing the run, rather than once
     per ticket.
   - **Maintain this ticket's status record**, written current before delivery.

   When the ticket carries its needs-triage marker and no acceptance criteria, the implementation agent completes the
   **full expansion** before starting: answer on their behalf per `ASKING.md` section 3 to fill in the acceptance
   criteria and the implementation-level rulings, write them into the status record, then implement.

   Report within the context budget: ticket ID, commit SHA, targeted check results, status-record location, and
   anything awaiting ruling, with the source text left in the worktree and the scratchpad.

The **status record** is this ticket's own source of truth, kept where the tracker keeps things: on GitHub, a single
comment marked `<!-- sorry-matt:status -->`, updated in place rather than appended to each round; in Local Markdown, a
`## sorry-matt status` section in the ticket file. Six fields: current version (branch and SHA), key decisions,
progress, blockers, verification results, evidence paths. Everywhere else cites it. It is not outbound text, so it
follows `ASKING.md` section 6.

Done when: every frontier ticket in the round has an independent branch, worktree, and responsible agent, and every
agent received the three extension contracts; same-line or file-overlapping tickets are absent from the same round;
every ticket has a status record in place.

### Close the round

After every agent in the round reports, take each ticket through these gates. The order is fixed — **targeted checks
→ one independent review → one batched fix → re-check by affected surface**; full verification happens once, while
finishing the run.

1. **Targeted checks:** confirm the affected-surface checks the agent reported are green. Red goes back to that
   agent first and comes to review green.
2. **Independent review:** call the Skill tool with `code-review` and run its two-axis review; the fixed point is the
   line integration branch and the spec source is the ticket URL or path. **One ticket gets this one reviewer by
   default**, covering standards and spec conformance together. Add a specialist reviewer only where a concrete risk
   calls for one, naming the risk and recording the rationale in the self-answer log; "another look, to be safe" is
   not a risk.
3. **Batched fix:** hand this ticket's findings back to the original context-holding agent all at once, fixed in one
   round rather than one finding at a time. Afterwards re-run only the targeted checks for the affected surface. At
   most two correction rounds.

   **Hard rail — a flaky red is chased to its root cause.** A test that goes red and green on the same commit is
   treated as a real failure: find the root cause, and fix the test when it lies there or fix the product and
   file a defect ticket when it lies there. Re-running, loosening a wait, adding a retry and raising a timeout
   all leave it unfixed. If two correction rounds do not find the root cause, mark the ticket stuck.
4. **Ticket PR (GitHub only):** push the ticket branch and create a PR against the line integration branch.
   Its body must include `Closes #N` and the review summary.
5. **Integrate:** merge the ticket branch in the integration worktree. Where there are conflicts, hold the context
   budget and give them to a **merge agent** to resolve hunk by hunk: it gets the integration worktree, both sides'
   ticket text and commit messages, and this test — the choice is between two intents rather
   than two blocks of text, so trace each side to its primary source (the ticket text and the commit message), keep
   both where they are compatible, and where they are not, take the side that matches this merge's goal, with what
   lands limited to behaviour one side actually wrote. It reports the trade-off per hunk, and the host records those
   trade-offs in the self-answer log. Then run the targeted checks for the affected surface.
6. **Complete delivery:**
   - **GitHub:** push the integration branch and retain the ticket PR, now merged by ancestry, as the review
     record.
   - **Local Markdown:** on the integration branch, check every verified acceptance criterion in the ticket,
     set `Status` to `ready-for-human`, and append `## sorry-matt completion` with the implementation commit,
     integration branch, and passed checks. Commit this delivery record. This is a sorry-matt extension;
     upstream defines no terminal state for ordinary local implementation tickets.
7. Remove the ticket worktree and local ticket branch.

**Anything worth asking accumulates until the next open-round**, handled through the three exits in `ASKING.md`
section 4; when `have-it-all-done` composes this skill, it all goes to that single ruling point.

In Local Markdown, a blocker clears only when the prerequisite ticket's complete `sorry-matt completion` is
readable on the same integration branch and every acceptance criterion is checked. `ready-for-human` alone
remains incomplete.

If the ticket still fails review after two correction rounds, or a conflict cannot be resolved safely, mark
it **stuck**:

- **GitHub:** file a separate raw issue recording the failure.
- **Local Markdown:** append `## sorry-matt blocker` to the original ticket on the integration branch with the
  reason, attempted remedies, and relevant branch; set `Status` to `ready-for-human` and commit it.

After recording the stuck state, also remove the ticket worktree and local ticket branch. Keep tickets
downstream of a stuck ticket blocked.

Done when: every ticket in the round went through exactly one independent review with its targeted checks back to
green, and has either a reviewed, provider-native delivery or a traceable stuck record; every ticket that gained a
specialist reviewer names the risk; every ticket's status record is written current; successful tickets are
integrated and their ticket worktrees and local branches removed; Local Markdown blockers clear only under the
completion contract.

### Filing along the way

File out-of-scope bugs, prefactors, technical debt, and any defect whose root cause a flaky red exposed outside
this scope, only as raw tickets linked to the source finding:

- **GitHub:** use `gh issue create` without `ready-for-agent`.
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
that ticket's green: it no longer serves as this run's acceptance evidence, and only the line-level full verification
still holds. What to re-run follows the real blast radius of that change: by default only the targeted checks for the
affected surface, with another full verification reserved for a new fix, a failure, or an unresolved risk.

Then deliver each line according to its mode:

- **GitHub:** create one aggregate PR from the line integration branch into the base branch. Link the ticket
  PRs and use `Closes #N` only for completed tickets; list stuck and awaiting-ruling tickets as gaps.
- **Local Markdown:** leave the line integration branch for human review and merge. Record its branch name and
  tip SHA, then remove the integration worktree. Ticket state travels with the implementation on that branch;
  do not simulate a PR or close operation.

Where the standing authority permits merging, GitHub mode merges the aggregate PR once its CI goes green and
reports the result. Where that authority is absent, the delivery stays with the human and the output names which
grant is missing; do not open another round of questions for it.

Outbound text — raw issue bodies, PR bodies, tracker comments — follows `ASKING.md` section 6.

Once a line is delivered, clean up: call the Skill tool with `clean-it-up` and let its evidence rules retire the
ticket worktrees and merged local branches this run created. **Deliverables awaiting human review are out of
scope for cleanup:** Local Markdown line integration branches and the source branches of unmerged aggregate PRs
are kept — for unmerged items, `clean-it-up` itself downgrades to keep. Remote branches still require the user's
explicit authority for this request; do not open a question for it.

Report each line's aggregate PR or integration branch, a **reconciliation table** covering the entire initial set
(one row per ticket: ticket ID, deliverable, verification result, status-record location), the authority actually used
this run, this run's **metrics** (spawns, review rounds, fix rounds, full verification runs, compactions), and every
raw ticket filed along the way with a recommendation to run `/triage`.

Done when: every line went through one line-level simplify and one full verification and ended green, and has
exactly one human-mergeable delivery, or was merged and reported under the standing authority; the reconciliation
table covers the frozen set exactly once, every row pointing at that ticket's status record; every ticket worktree
and local ticket branch is removed; Local Markdown integration worktrees are removed while their integration
branches remain; the output lists the authority used this run and this run's metrics.
