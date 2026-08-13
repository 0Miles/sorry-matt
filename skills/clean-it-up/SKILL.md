---
name: clean-it-up
description: Safely remove merged local branches and obsolete worktrees after a Git task is finished. Use when the user wraps up a Git task (clean it up) or asks to clean merged branches or worktrees.
---

# Clean it up: Retire finished Git work safely

Optional arguments may identify the repository, merge target, and whether remote branches are in scope. Use
the current repository when none is given. By default, remove only local branches, linked worktrees, and stale
worktree administration records; do not delete remote branches.

Two rules govern the whole run: **merged is a state that requires proof**, and **a refusal is a verdict** —
use only non-forcing commands throughout, and **downgrade to keep** anything with insufficient evidence, a
dirty state, or a Git refusal; retrying with a stronger tool is outside this skill's authority.

## 1. Fix the merge target and authority

Resolve the repository root and common Git directory, then select exactly one **merge target**:

1. Prefer a ref explicitly named by the user.
2. Otherwise use the configured remote's symbolic default branch, such as `refs/remotes/origin/HEAD`.
3. If multiple remotes are plausible, the remote default is missing, or the target ref does not exist, ask the
   user to rule before deleting anything. Do not assume `main`, `master`, or the current branch.

When the target is a remote-tracking ref, first run a normal `git fetch --prune` for that remote. If fetching
fails, do not delete based on possibly stale remote state; inventory and report instead. An explicitly selected
local ref may still be evaluated using local evidence alone.

Default authority covers local cleanup only. Include remote deletion candidates only when the user explicitly
requests remote branch cleanup in this invocation. Do not touch tags, stashes, untracked files, GitHub PRs,
base branches, deployments, or releases.

Done when: the repository, one merge target, data freshness, and local or remote authority are explicit; no
deletion has occurred while any of them is ambiguous.

## 2. Build a complete inventory

Use Git's own records instead of directory globs to discover worktrees:

```bash
git worktree list --porcelain
git for-each-ref --format='%(refname:short)%09%(objectname)%09%(upstream:short)%09%(upstream:track)' refs/heads
git worktree prune --dry-run --verbose
```

For every absolute path from `git worktree list --porcelain`, run
`git -C <path> status --porcelain=v1 --untracked-files=all` and detect an active merge, rebase, cherry-pick,
revert, or bisect. Record:

- The primary worktree, current worktree, locked worktrees, and each checked-out branch or detached SHA.
- Staged, unstaged, or untracked content and any Git operation in each worktree.
- Every local branch's full ref, tip SHA, upstream, and worktree occupancy.
- Administration records the dry run says can be pruned. A temporarily inaccessible path is not stale.

Never interpolate a branch name or worktree path into a shell command string. Pass it as an argument and use
`--` to end option parsing wherever supported.

Done when: every local branch and worktree appears exactly once, with all dirty, locked, detached,
operation-in-progress, and primary states traceable.

## 3. Classify by evidence

A local branch is **merged** only when one of these proofs passes:

1. `git merge-base --is-ancestor refs/heads/<branch> <merge-target>` succeeds.
2. Ancestry fails because of a squash or rebase merge, but the authoritative forge reports a merged PR whose
   base is the merge target and whose recorded head OID **equals the current local branch tip**.

If the authenticated provider CLI or API cannot supply every part of the second proof, preserve the branch.
An old merged PR does not cover commits added to the branch afterward. None of these prove a merge: upstream
`gone`, a missing remote branch, similar commit messages, old age, a ticket-like name, or an apparently empty
diff.

Even with merge proof, protect the merge target, local and remote default branches, a branch with an unmerged
tip, any branch used by a dirty, locked, or operation-in-progress worktree, and every user-named keep branch.

A worktree is removable only when:

- It is neither the primary worktree nor the current working directory.
- It is unlocked, completely clean, and has no Git operation in progress.
- Its checked-out local branch is proved merged under these rules and is itself a deletion candidate.

List a missing-on-disk administration record separately as a prune candidate only when the dry run
explicitly identifies it.

First print a candidate table: `item | ref/path | merge proof | action | reason kept`. Local candidates may
proceed under this skill invocation. A remote candidate additionally requires explicit authority from this
invocation, a remote name, a full branch ref, and an expected SHA.

Done when: every item belongs to exactly one of remove, prune, or keep; every removal candidate has repeatable
merge proof, and every retained item has a concrete reason.

## 4. Clean in the safe order

**Last-minute recheck**: immediately before each action, recheck its SHA, worktree state, and merge proof.
Downgrade it to keep if anything changed.

1. For administration records shown by the dry run whose paths truly do not exist, run
   `git worktree prune --verbose`.
2. Run `git worktree remove -- <absolute-path>` for each linked-worktree candidate; when Git refuses,
   downgrade it to keep and record why.
3. Never remove the primary worktree. If its checked-out branch is a deletion candidate, switch first with
   `git switch <local-target>` only when the worktree is clean, a local branch for the merge target is
   available, and no other worktree uses that branch. Otherwise retain the current branch.
4. After confirming no worktree uses the branch, run `git branch -d -- <branch>` from a worktree checked out
   on the local merge target; when no such worktree exists or `-d` refuses, downgrade the branch to keep.
5. Only with explicit remote-cleanup authority, query the remote again and confirm the full remote ref still
   points to the expected SHA. Then delete branches one at a time with
   `git push <remote> --delete <exact-branch>`; stop that item if the SHA changed, the ref is ambiguous, or
   the query or push failed.

Each item is judged independently: one item's failure changes no other item's criteria. Every deletion goes
through the Git commands above; filesystem-level deletion (`.git/worktrees`, worktree directories) is outside
this skill's authority.

Done when: only exact actions from the candidate table were attempted; every deletion passed its last-minute
recheck; every Git refusal was downgraded to keep and recorded.

## 5. Verify and hand off

Repeat the worktree, branch, and status inventory. Confirm every retained worktree remains accessible, the
current worktree is intact, and every deleted branch is absent. Report:

- The merge target and evidence sources used.
- Removed worktrees, local branches, remote branches, and pruned records.
- Items preserved because they were dirty, locked, insufficiently proven, changed during cleanup, or refused
  by Git, with reasons.
- Any fetch, provider query, or other verification that could not be completed.

Done when: the post-cleanup inventory reconciles exactly with the actions taken; every remaining item has a
reason and the user can decide the next step directly.
