---
name: review-pr
description: Review a GitHub PR and publish evidenced, directly applicable feedback to it. Use when a user asks to review a PR, or to re-review one after the author has pushed fixes.
disable-model-invocation: true
---

# Review PR: Publish evidenced, directly applicable feedback

Follow one **evidence chain**: Finders surface candidates, Verifiers rule independently on whether a finding holds,
Fix Verifiers rule independently on whether its fix is right, and only then are surviving findings written back to the
PR. A candidate is not yet a comment, and neither is a fix no one has tried to disprove.

Except for generated artifacts that must be regenerated, every inline comment contains an **anchored new-file line
range**, a **concise explanation**, and a directly applicable `suggestion` block. Submit all inline comments together
as one review. Follow the repository's existing language and locale conventions for review text.

When the author has already acted on an earlier round and asks for another pass, this is a **follow-up review**: same
evidence chain, different candidate sources, body structure, and closing conditions. Read
[FOLLOW-UP.md](FOLLOW-UP.md) in full before starting and follow it; it names which steps it overrides.

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

Assign each lens to an independent finder subagent and dispatch them together in one message.
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

Assign every deduplicated candidate to its own independent verifier subagent and dispatch them in parallel.

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

A single Verifier reading the wrong ref or the wrong branch produces a wholly wrong ruling. When a ruling's cited
`file:line` does not match `pr-<n>`, re-verify that candidate with a different Verifier.

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

After drafting the factual content of the review body and each inline-comment explanation, call the Skill tool with
`no-bullshit` and cut the draft down to the point; keep the language and locale this skill established at the top.
Limit the rewrite to human-facing prose; exclude `suggestion` blocks, code, commands, and any other content that must
remain verbatim.

Then check the six things that **must survive the cut**: the technical facts, `file:line` evidence, degree of
uncertainty, blocking severity, strength of obligation, and assignment of responsibility. Restore anything lost, then
cut again.

- The suggestion must contain the complete desired content of the replaced range. Preserve every unchanged line and
  its indentation byte for byte.
- Cut the range at a self-contained boundary such as a whole function, CSS rule, or HTML element.
- Keep each inline-comment explanation to three to five sentences in this order: **symptom → root cause with
  `file:line` → why the change matters**. This is an information order, not a set of headings or fixed sentence
  patterns. Put the code change only in the suggestion block.
- Split cross-file fixes into separate, independently applicable comments and cross-reference them. When one suggestion
  invalidates another line, name that line in the prose.
- For generated artifacts such as lockfiles and build output, provide the regeneration command instead of a suggestion.

Done when: the review body and every inline-comment explanation have been through `no-bullshit`, with zero missing and
zero added entries among the six; every suggestion has been compared side by side with
`git show pr-<n>:<path> | sed -n '<start>,<end>p'`; every line outside the intended edit matches byte for byte; the
resulting file is syntactically valid; and every cross-file fix has corresponding cross-referenced comments.

## 6. Fix Verifier: Disprove the fix

A finding earns its comment by surviving disproof; so must its fix. This step turns the same disprove-first discipline
on the suggestions.

Assign every suggestion to its own independent subagent and dispatch them in parallel. The prompt must
be self-contained and contain the absolute repository path, `pr-<n>` ref, the finding's `failure_scenario`, and the
suggestion's full content and line range. Exclude the author's reasoning to prevent anchoring.

Try to disprove the fix first, answering all four with `file:line`:

1. Does the fix close every failure window the finding enumerated?
2. Does it open a new one?
3. Is the fix falsifiable? Name the observable difference between applying it and not: output, an error, timing, or a
   type. A fix with no nameable difference is a style preference, so withdraw it — that is precisely the fix that comes
   back inverted next round.
4. Does applying it break any other caller?

There are exactly two rulings: **sound**, or **unsound** — withdraw the suggestion, name the correct fix where one
exists, and otherwise demote the finding to a body observation.

### Conflicts within the round

Each Fix Verifier sees only its own suggestion, never the others. Once every ruling is back, and before the live run,
compare the round's surviving suggestions pairwise. Three kinds of conflict, each with its own resolution:

- **Overlapping ranges**: two `start_line..line` ranges intersect in the same file. GitHub applies each suggestion
  independently, so intersecting ones produce wrong content whichever order the author commits them in. Merge them into
  one, or keep one and turn the other into plain prose.
- **Incompatible fixes**: two suggestions reach incompatible conclusions about the same symbol, contract, or invariant.
  Keep the one with the stronger evidence; withdraw or demote the other to the body.
- **Dependent fixes**: applying A is what invalidates B's anchor lines, premise, or necessity — A removing the last user
  of B's line, for instance. Re-cut B's range against the content after A is applied and name A in B's comment; merge
  them into one where they cannot be decoupled.

The surviving suggestions must apply together, or the live run proves nothing.

### Live run

When the project defines test, typecheck, lint, or format scripts, run all of them twice: once before applying this
round's suggestions and once after. The first run establishes which red lights already existed; only then can the
second one attribute.

Run in a detached worktree, reusing the existing dependency install, leaving the user's checkout untouched:

```bash
git -C <repo> worktree add --detach <scratchpad>/verify pr-<n>
```

Withdraw or repair any suggestion that turns the run red, until it is all green.

### Mutation

Where the project has tests, delete or invert the lines each finding points at and run the tests:

- Still all green: the author's tests do not **pin** that finding. This strengthens the finding; ask for the test in
  the same comment. Lines of new test code are not evidence of coverage, mutation is.
- Red: it is pinned. Record that in the body.

Mutate once more after applying the suggestions, to answer whether this round's fixes are locked in.

Done when: every suggestion has one Fix Verifier ruling with `file:line` evidence; the round's surviving suggestions
have been compared pairwise, with no intersecting ranges, incompatible pairs cut to one, and dependent ones named and
re-cut against the applied content; every script that exists ran once before and once after, and the run after is all
green; every finding has a mutation result; and every suggestion ruled unsound or turning the run red has been
withdrawn or repaired.

## 7. Reconcile before submitting

Two mechanical checks, both completed before the payload is generated.

**Self-consistency.** Compare every suggestion in this round against every suggestion submitted in earlier rounds and
every reversal recorded against them (conflicts within the round were resolved in step 6). Where one touches the same
symbol or the same block, it is one of three things:

- **Extends**: submit normally.
- **Reverses**, meaning it moves, inverts, or replaces an earlier fix: this holds only when the incoming diff touched
  that code, or you hold evidence the earlier round did not. Say plainly in the comment that the earlier one was wrong,
  attach that new evidence, and count this round's self-reversals in the body. Without new evidence it is not a
  reversal but a **flip-flop**.
- **Flip-flops**, meaning it returns to a fix an earlier round already abandoned: withdraw it and do not resubmit.
  Oscillating over one place across rounds proves that no round's evidence supported either form. Put that uncertainty
  in the body for the author to settle, with no suggestion attached.

The classification takes the Fix Verifier's rulings and the earlier rounds' submission record rather than
self-assessment.

**Honesty.** Check item by item:

- The finding count claimed in the body matches the length of the `comments` array.
- Every sentence in the body's non-blocking sections is backed by named Verifier or Fix Verifier evidence. Delete any
  statement resting on a Finder's word alone, or demote it to open.

Done when: every suggestion overlapping history is labeled extends, reverses, or flip-flops; every reversal carries
evidence the earlier round did not have and is stated in both the comment and the body; every flip-flop has been
withdrawn with its uncertainty recorded in the body; the body's numbers match the `comments` array; and every sentence
in the non-blocking sections carries named evidence.

## 8. Submit the review and verify its anchors

Create a Python file that generates the payload JSON. Let Python encode backticks, backslashes,
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
