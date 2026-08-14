---
name: review-pr
description: Review a GitHub PR and publish evidenced, directly applicable feedback to it. Use when a user asks to review a PR, post review findings to the PR, or re-review it after fixes.
disable-model-invocation: true
---

# Review PR: Publish evidenced, directly applicable feedback

Follow one **evidence chain**: Finders surface candidates, Verifiers rule independently, severity determines placement,
and only then are surviving findings written back to the PR. A candidate is not yet a comment.

Except for generated artifacts that must be regenerated, every inline comment contains an **anchored new-file line
range**, a **concise explanation**, and a directly applicable `suggestion` block. Submit all inline comments together
as one review. Follow the repository's existing language and locale conventions for review text.

## 1. Fetch the PR and line-addressable source

```bash
gh pr view <n> --repo <owner>/<repo> --json number,title,body,baseRefName,headRefName,files,url
gh pr diff <n> --repo <owner>/<repo> > <scratchpad>/pr<n>.diff
git -C <repo> fetch origin pull/<n>/head:pr-<n> --force
```

Use `gh pr diff` to determine what changed and whether a change belongs to this PR. Do not use
`git diff <local-base>...pr-<n>` for ownership: a stale base or rebase can pull unrelated changes into that diff.

Take new-file line numbers and suggestion contents only from `git show pr-<n>:<path>`; copying from the diff can
carry line offsets or prefix markers into the result.

Done when: every changed file is readable through `git show pr-<n>:<path> | cat -n`, and every hunk maps to
new-file line numbers.

## 2. Finder: Search for candidates in parallel

Assign each lens to an independent general-purpose finder subagent and dispatch them together in one message.
For a tiny diff of one file and no more than a few dozen lines, one finder may apply every lens.

- **Line by line**: for every line in every hunk, ask which input, state, timing, or platform could make it fail.
  Check especially for inverted conditions, off-by-one errors, falsy zero, missing `await`, copy-pasted variable names,
  and swallowed errors.
- **Removed behavior**: identify the invariant each deleted or rewritten block used to preserve, then locate where
  the new code restores it. If nowhere does, report a candidate.
- **Cross-file contract**: trace callers and callees of changed functions. Check whether new preconditions, return
  shapes, exceptions, or timing break either side.
- **Claims versus implementation**: locate every change claimed by the PR description in the diff, and report every
  diff change the description did not claim. Treat issues or repository spec files linked from the PR body as claim
  sources whenever `gh` or `git show` can retrieve them.
- **Repository conventions**: apply every rule from the applicable `CLAUDE.md` or general `AGENTS.md` governing the
  changed files. Report a convention violation only when the exact rule can be quoted.

Finders cannot see the current conversation, so every prompt must be self-contained and include:

- The absolute repository path, `pr-<n>` ref, diff-file path, and PR title and body. Fix all reads of post-change source
  to `git show pr-<n>:<path>`.
- The full text of that finder's lens and the required outward trace: the complete post-change file, callee
  implementations, all callers, and relevant locale, design-token, and type definitions.
- The Finder searches but does not rule. It returns plausible candidates even when uncertain; an independent Verifier
  decides whether they hold.
- The output shape: `file`, `line` using new-file numbering, a one-sentence `summary`, and `failure_scenario` describing
  a user-visible consequence such as wrong output, a crash, or data loss rather than an intermediate state. Return at
  most six candidates, or an empty list when none exist.

Done when: every Finder has reported, duplicates with the same line and failure mechanism have been collapsed to the
candidate with the most concrete `failure_scenario`, and the line-by-line lens has inspected every hunk.

## 3. Verifier: Rule on every candidate independently

Assign every deduplicated candidate to its own independent general-purpose verifier subagent and dispatch them in
parallel.

The Verifier prompt must be self-contained and contain only the absolute repository path, `pr-<n>` ref, base branch,
the candidate's four fields, and the rules below. Exclude the Finder's reasoning to prevent anchoring.

Try to **disprove** the candidate first by finding and citing code that invalidates it. For uncertain technical facts—
API compatibility, regular-expression behavior, CSS interaction, or package syntax—run a disposable Node or Python
probe, or consult caniuse and source code. Only after disproof fails, test these gates:

1. **Traced**: cite a `file:line` the Verifier actually opened as evidence.
2. **Introduced by this PR**: run the same check on the base branch. The gate passes only when base is sound and the PR fails.
3. **Concrete failure scenario**: the path is reachable and its consequence is visible to the user.

There are exactly three rulings, each with `file:line` evidence: **confirmed** when all gates pass, **pre-existing**
when only the second gate fails, or **invalid**.

Done when: every candidate has exactly one ruling with evidence and an explicit result for all three gates.

## 4. Route by blocking severity

**Blocking** means the problem changes whether the author should merge or accept the current implementation. Only
confirmed, blocking candidates become inline comments.

Put confirmed non-blocking structural suggestions and follow-up work, pre-existing observations, and useful positive
verification in the review body. When a Verifier disproves a candidate with strong evidence, the body may record a
“no change needed” conclusion. Discard other invalid candidates with no informational value.

Done when: every ruling is assigned to exactly one of inline comment, review body, or discard, and every inline comment
is both confirmed and blocking.

## 5. Write human-facing feedback and directly applicable suggestions

A GitHub `suggestion` block replaces the entire `start_line..line` range. After the author selects Commit suggestion,
the block contents become the range's new state.

After drafting the factual content of the review body and each inline-comment explanation, run `speak-human`. Set the
PR author as the audience and pass the language and locale established above. The semantic ledger must preserve the
technical facts, `file:line` evidence, degree of uncertainty, blocking severity, strength of obligation, and assignment
of responsibility. Limit the rewrite to human-facing prose; exclude `suggestion` blocks, code, commands, and any other
content that must remain verbatim.

- The suggestion must contain the complete desired content of the replaced range. Preserve every unchanged line and
  its indentation byte for byte.
- Cut the range at a self-contained boundary such as a whole function, CSS rule, or HTML element.
- Keep each inline-comment explanation to three to five sentences in this order: **symptom → root cause with
  `file:line` → why the change matters**. This is an information order, not a set of headings or fixed sentence
  patterns. Put the code change only in the suggestion block.
- Split cross-file fixes into separate, independently applicable comments and cross-reference them. When one suggestion
  invalidates another line—for example by removing the last user of an import—name that line in the prose.
- For generated artifacts such as lockfiles and build output, provide the regeneration command instead of a suggestion.

Done when: the review body and every inline-comment explanation have been reconciled through `speak-human`, with zero
missing and zero added semantic-ledger entries; every suggestion has been compared side by side with
`git show pr-<n>:<path> | sed -n '<start>,<end>p'`; every line outside the intended edit matches byte for byte; the
resulting file is syntactically valid; and every cross-file fix has corresponding cross-referenced comments.

## 6. Submit the review and verify its anchors

Use the Write tool to create a Python file that generates the payload JSON. Let Python encode backticks, backslashes,
and quotes in suggestion text so a shell heredoc cannot damage them.

```python
payload = {
    "body": "<review body: overall assessment + non-blocking items>",
    "event": "REQUEST_CHANGES",
    "comments": [
        {
            "path": "apps/foo/bar.vue",  # repository-relative path
            "start_line": 127,            # new-file line number
            "line": 138,
            "side": "RIGHT",
            "start_side": "RIGHT",
            "body": "explanation + ```suggestion block",
        },
    ],
}
```

For a single-line comment, omit `start_line` and `start_side`. The range must fall within a RIGHT-side diff hunk,
or GitHub rejects the entire request with 422.

Choose `event` from the surviving findings: `REQUEST_CHANGES` for any blocking finding, `COMMENT` for observations
and suggestions only, and `APPROVE` when no problems remain. If the user asked for request changes but the evidence
supports no blocking finding, use `COMMENT` and explain why in the body.

```bash
gh api --method POST /repos/<owner>/<repo>/pulls/<n>/reviews \
  --input <scratchpad>/review.json --jq '{id, state, html_url}'
```

Verify every anchor after submission:

```bash
gh api /repos/<owner>/<repo>/pulls/<n>/comments \
  --jq '.[] | "\(.path):\(.start_line)-\(.line)"'
```

A `null` value for `line` means the comment is outdated and no longer displays correctly on the PR. Correct its line
numbers and resubmit it.

Finally, give the user the review link, a one-sentence summary of every finding, and every area not verified in a
browser or runtime environment.

Done when: the review has been submitted with the correct event, every intended comment appears on the PR with a
non-null `line`, and the user report contains the review link, all findings, and every unverified area.

## Follow-up review

Run the complete evidence chain again, changing only candidate sources and closeout:

- In Step 1, also fetch the previous reviews and comments with
  `gh api /repos/<owner>/<repo>/pulls/<n>/reviews` and
  `gh api /repos/<owner>/<repo>/pulls/<n>/comments`. Every prior blocking comment is a mandatory candidate: has the
  original problem been fixed, and did the fix introduce a new one?
- In Step 2, focus Finders on incremental commits and the area around each fix. The claims-versus-implementation lens
  still scans the complete `gh pr diff` to catch unclaimed changes bundled into fix commits, such as lockfiles or
  opportunistic edits.
- In Steps 4 and 6, reconcile every prior finding as fixed, unfixed, or partially fixed with verification evidence in
  the body. Route new findings normally.
- Use `APPROVE` when every prior issue is fixed and there is no new blocking finding; otherwise choose the event by
  the Step 6 rules. An approval body still includes the itemized verification evidence.

Done when: every prior finding has a current ruling and evidence, all new changes have been inspected, and the
submitted event matches the remaining blocking state.
