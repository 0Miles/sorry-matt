---
name: get-to-work
description: Clear a prepared ticket set round by round, implementing and reviewing in blocker order before delivering GitHub PRs or local integration branches
disable-model-invocation: true
---

# get-to-work: Complete every prepared ticket

## 0. Select the mode and freeze the ticket set

First read `docs/agents/issue-tracker.md`. Its provider and conventions select GitHub or Local Markdown mode.
If the file is missing, ask the user to run `/setup-matt-pocock-skills` first.

Confirm a Git repository and clean working tree, then verify the mode-specific delivery conditions:

- **GitHub:** `gh` is authenticated; deliveries are ticket PRs and one aggregate PR per line.
- **Local Markdown:** no remote or `gh` is required; deliveries are line integration branches and no PRs are
  created.

Authority stops at line integration branches and, in GitHub mode, PRs. The human retains merges into the base
branch, force-pushes, deployments, and releases.

Then **freeze** the initial ticket set:

1. The optional argument accepts ticket numbers, URLs, or local file paths. With one, the initial set is
   exactly the named tickets. Without one, include only tickets with a publication record in this session;
   Local Markdown publication paths count. If none exist, ask the user for the set.
2. Read blocker **edges** through the tracker contract and divide tickets into **lines**. Connected tickets
   share a line; isolated tickets form their own. When `/issue-chain` is needed, pass the frozen set explicitly
   so background work remains outside it.
3. From the current branch tip, create one `<run>/<line-slug>` **integration branch** and integration worktree
   per line. Accumulate that line's results there round by round.

**Hard rail:** tickets discovered or filed during the run remain context; the initial set never expands after
the freeze.

Done when: the tracker mode is selected and verified; every initial ticket has a publication source,
provider-native identifier, line, and blocker map; every line has an integration branch and worktree created
from the same base tip.

## 1. Advance rounds with `/loop`

Start a self-paced `/loop` with no interval and the prompt `get-to-work: close the round / open the round`.
While agents are running, use a longer fallback and wait for notifications.

### Open the round

The **frontier** contains unfinished initial tickets whose blockers are all cleared. Work across lines is
usually parallel; tickets on the same line or touching the same files are **mutually exclusive** and must run
in separate rounds.

For each frontier ticket:

1. From its line integration branch, create `<run>/<NN>-<slug>` and a ticket worktree.
2. Spawn one subagent with the worktree, provider-native ticket identifier and full text, and integration
   branch. Tell it to resolve and follow
   `~/.claude/plugins/cache/mattpocock/mattpocock-skills/*/skills/engineering/implement/SKILL.md`.
   The subagent modifies and commits only in its worktree; the host owns review and delivery.
3. When the ticket is a bug or regression, use `skills/engineering/diagnosing-bugs/SKILL.md` from the same
   cache instead. Establish a tight feedback loop first and add a regression test after the fix.

Done when: every frontier ticket in the round has an independent branch, worktree, and responsible agent;
same-line or file-overlapping tickets are absent from the same round.

### Close the round

After every agent in the round reports, take each ticket through these gates:

1. **Review:** run the two-axis mattpocock `code-review`; the fixed point is the line integration branch and
   the spec source is the ticket URL or path. Return findings to the original context-holding agent, then
   review again, allowing at most two correction rounds.
2. **Ticket PR (GitHub only):** push the ticket branch and create a PR against the line integration branch.
   Its body must include `Closes #N` and the review summary.
3. **Integrate:** merge the ticket branch in the integration worktree. On conflicts, follow mattpocock
   `resolving-merge-conflicts`, preserve both intentions, and run the repository checks.
4. **Complete delivery:**
   - **GitHub:** push the integration branch and retain the ticket PR, now merged by ancestry, as the review
     record.
   - **Local Markdown:** on the integration branch, check every verified acceptance criterion in the ticket,
     set `Status` to `ready-for-human`, and append `## sorry-matt completion` with the implementation commit,
     integration branch, and passed checks. Commit this delivery record. This is a sorry-matt extension;
     upstream defines no terminal state for ordinary local implementation tickets.
5. Remove the ticket worktree and local ticket branch.

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

Done when: every ticket in the round has either a reviewed, provider-native delivery or a traceable stuck
record; successful tickets are integrated and their ticket worktrees and local branches removed; Local
Markdown blockers clear only under the completion contract.

### Filing along the way

File out-of-scope bugs, prefactors, and technical debt only as raw tickets linked to the source finding:

- **GitHub:** use `gh issue create` without `ready-for-agent`.
- **Local Markdown:** follow the tracker convention to create the next unused ticket file, set `Status` to
  `needs-triage`, and commit it on the line integration branch where it was found.

Keep these raw tickets outside both the initial set and this run's frontier.

Stop the loop when every initial ticket has a completed delivery. Also stop when the frontier is empty but
stuck or **awaiting ruling** tickets remain.

Done when: every initial ticket reconciles exactly once to delivered, stuck, or awaiting ruling; every raw
ticket filed along the way links its source and none has entered the frozen set.

## 2. Finish the run

Deliver each line according to its mode:

- **GitHub:** create one aggregate PR from the line integration branch into the base branch. Link the ticket
  PRs and use `Closes #N` only for completed tickets; list stuck and awaiting-ruling tickets as gaps.
- **Local Markdown:** leave the line integration branch for human review and merge. Record its branch name and
  tip SHA, then remove the integration worktree. Ticket state travels with the implementation on that branch;
  do not simulate a PR or close operation.

Report each line's aggregate PR or integration branch, a **reconciliation table** covering the entire initial
set, and every raw ticket filed along the way with a recommendation to run `/triage`.

Done when: every line has exactly one human-mergeable delivery; the reconciliation table covers the frozen set
exactly once; every ticket worktree and local ticket branch is removed; Local Markdown integration worktrees
are removed while their integration branches remain.
