---
name: issue-chain
description: Build a chain from tracker and local evidence, establish blocker edges, and choose exactly one immediately executable next action
---

# issue-chain: Turn scattered work into one chain

## 1. Set the boundary

First read `docs/agents/issue-tracker.md` and select the tracker provider it configures. If the file is
missing, ask the user to run `/setup-matt-pocock-skills`, then stop. GitHub and Local Markdown are alternative
modes; inspect only the configured provider in a given run.

The optional argument may be a milestone, lane, set of ticket identifiers, or local path. Without one, cover
the entire repository. Also read the applicable `CLAUDE.md` or general `AGENTS.md` for ordering, triage, and
delivery rules.

Done when: the provider, scope, and sources of applicable repository rules are explicit.

## 2. Build the snapshot

Reconcile evidence in this order: command output, then repository documentation, then ticket prose. When
sources conflict, follow the higher-ranked source and mark the stale source in the snapshot.

- **Git:** inspect `git status`, the current branch, unpushed commits, `git worktree list`, and commits on
  every worktree and unmerged integration branch. Fetch and compare remote divergence only when a remote
  exists. A clean worktree may still belong to an active session.
- **GitHub tracker:** inspect in-scope open issues, labels, sub-issues, open PRs, CI, and recent comments.
- **Local Markdown tracker:** scan the configured one-ticket-per-file issue paths and read `Status`,
  `Blocked by`, acceptance criteria, and `Comments`. When the same ticket exists on an unmerged integration
  branch, also read that branch's `sorry-matt completion` or `sorry-matt blocker`, and identify which branch
  version the snapshot uses. A spec supplies context but is not a ticket.

For every snapshot item, record at least its provider-native identifier, tracker state, branch/worktree/PR
state, and evidence source.

Done when: every in-scope active ticket, every open PR in GitHub mode, every worktree, and every unmerged
integration branch is in the snapshot; every Local Markdown ticket names the branch version being used.

## 3. Establish edges

Every **edge** must cite a verifiable source: a ticket field, label, file overlap, or repository rule.

- `blocked-by`: work cannot start until its prerequisite completes. In Local Markdown, the edge clears only
  when the prerequisite has all criteria checked and a complete `sorry-matt completion` on the same
  integration branch as the downstream ticket.
- `awaiting ruling`: work requires a human decision first.
- `duplicate/replaced-by`: several tickets describe the same work; identify which remains and which ends.
- `mutually exclusive`: the work is independently valid but changes the same files, so it cannot run in
  parallel.

`ready-for-human` means only that a human must take over. For Local Markdown, determine completion or blockage
from the branch's `sorry-matt completion` or `sorry-matt blocker`, never from `Status` alone.

Done when: every edge has a source; every snapshot item either has an edge or is explicitly isolated.

## 4. Build the chain

Topologically sort by blockers, then arrange the result into one linear **chain**. Keep awaiting-ruling items
outside the chain. Within a level, choose in this order:

1. the ticket that unlocks the most downstream work;
2. a user-visible defect;
3. a small ticket that can be interleaved between large tickets;
4. provider-native order when the tie remains.

Keep the chain linear. Parallelism is only an annotation on each link relative to the previous link, not a
side chain. Use blocker and mutually-exclusive edges to mark `parallel` or `serial`, and give the reason.

Done when: every chained ticket has one position and a parallelism decision; every active item outside the
chain is classified as awaiting ruling, missing information, or out of scope.

## 5. Name the single next action

Output, in order:

1. the **state snapshot**;
2. the **edge list**, with sources and whether each edge is cleared;
3. the **chain**, with parallelism marked on every link;
4. one **next action**.

Preserve provider-native ticket identifiers: GitHub URLs/numbers or Local Markdown paths/`NN`. Choose the
first executable action in the chain. If no ticket can move, ask for the one smallest decision needed by the
highest-priority awaiting-ruling item.

Done when: exactly one next action is immediately executable, and every output item traces back to snapshot
evidence.
