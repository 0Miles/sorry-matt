---
name: prove-it
description: Ticket-level independent review for the sorry-matt workflow. Reviews one ticket branch through an evidence chain (Finder → Verifier → Fix Verifier), a live run, and mutation limited to the ticket's own diff, then writes a fixed-format pass / fix / stuck verdict and finding list into the ticket's status record. Called by get-to-work when closing a round; posts no PR comments and produces no suggestions.
---

# prove-it: review one ticket, and prove it

The **independent review** of the sorry-matt workflow, run once per ticket when closing a round. The evidence chain
follows `review-pr`: Finders raise candidates, Verifiers rule on them independently, and after the batched fix a
Fix Verifier rechecks. The difference is the reader: here it is the host, not a PR author — no PR comments, no
`suggestion` blocks, nothing posted anywhere; the only output is the fixed-format verdict in section 6, written
into the ticket's status record.

**The burden is on you:** a pass needs evidence, not "found nothing". Whether the tests catch defects is proved by
the reviewer through mutation; the implementer's word and the number of new test lines count for nothing.

## 1. Inputs and opening the review

The caller supplies:

- **Ticket:** the tracker-native identifier and the full ticket text. Where acceptance criteria carry a source
  (the original ticket, or added at expansion), keep the source alongside each criterion when checking it.
- **Fixed point:** the line integration branch.
- **Ref under review:** the ticket branch.
- **Targeted-check results:** the commands and results the implementation agent reported.
- **Mode:** `initial`, or `recheck` (the recheck after a batched fix, with the previous review block attached;
  it follows section 7).
- **Reviewers:** by default only `primary`, this skill's own set of Finders.

Check each item; if any fails, do not open the review — output `verdict: stuck` in the section 6 format, naming
which one:

- `git rev-parse` resolves the fixed point and the ticket branch, and `git diff <fixed point>...<ticket branch>`
  is non-empty.
- The targeted checks are green. A red light belongs to the implementation agent; review only takes green tickets.

Create a **review worktree** in the scratchpad. The live run and mutation happen only there; the implementation
agent's worktree stays untouched:

```bash
git -C <repo> worktree add --detach <scratchpad>/review-<ticket> <ticket branch>
git -C <repo> diff <fixed point>...<ticket branch> > <scratchpad>/review-<ticket>.diff
```

Reuse existing dependency installs; where the new worktree has none, restore from the lockfile (frozen forms such as
`npm ci` or `pnpm install --frozen-lockfile`). Never add a dependency or download a new tool — that is a permanent
exception, and the plugin's guard hook blocks it too. New-file line numbers always come from
`git show <ticket branch>:<path>`.

Done when: the inputs are complete; a failed precondition has produced `stuck` and stopped the review; the review
worktree sits at the ticket branch tip and the diff is saved.

## 2. Finder: candidates in parallel

Give each lens to its own finder subagent, all dispatched in one message. When the diff is a single file of no
more than a few dozen lines, one finder applies every lens.

- **Line by line:** for every line of every hunk, ask which inputs, states, timings, or platforms break it. Check
  especially for inverted conditions, off-by-one, falsy zero, a missing `await`, a copy-pasted wrong variable, and
  a catch that swallows errors.
- **Deleted behaviour:** identify the invariant each deleted or rewritten block used to hold and locate where the
  new code rebuilds it; if nowhere, it is a candidate.
- **Cross-file contracts:** trace the callers and callees of each changed function and check whether new
  preconditions, return shapes, exceptions, or timing break either side.
- **Acceptance check:** locate, for each acceptance criterion, where the diff implements it and which test verifies
  it. List criteria that are missing or half done, ones that look done but are done wrong, and changes the ticket
  did not ask for (scope creep). Quote each criterion and its source.
- **Repo conventions:** apply the rules in any `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, or
  `CODING_STANDARDS.md` covering the changed files. List only what can quote the rule's text; skip anything tooling
  already enforces.

Finders cannot see this conversation, so each prompt is self-contained: the absolute paths of the repo and the
review worktree, the fixed point, the ticket branch, the diff file path, the full ticket text, the full text of
that lens, and the scope it must trace outward (complete new files, implementations of called functions, every
caller, and type definitions). A finder only raises candidates and never rules; it reports what it is unsure of.

Report format: `file`, `line` (new-file line number), `lens`, a one-sentence `summary`, and a `failure_scenario`
describing an observable consequence (wrong output, a crash, data loss — not an intermediate state). At most six
per finder; an empty list when there are none.

Each reviewer is one set of Finders, and every candidate carries a `by` field naming its reviewer. Today there is
only `primary`; another reviewer is just another source of candidates, and everything from section 3 on stays the
same.

Done when: every finder has reported; candidates on the same line with the same failure mechanism are deduplicated,
keeping the one with the most concrete `failure_scenario`; every hunk has been through the line-by-line lens at
least once.

## 3. Live run and mutation

The reviewer does this step; it is never handed to the implementer.

### Live run

In the review worktree, run the project's test, typecheck, and lint scripts once each. This is the baseline for
mutation:

- All green → go on to mutation.
- Red → the red light is itself a candidate (lens `live-run`) for the Verifier. Mutation means nothing on a red
  baseline, so skip it this time and record why in the mutation record.

### Mutation

**Scope is limited to lines in this ticket's diff that tests cover.** In the review worktree, list the changed
lines and their coverage (`${CLAUDE_SKILL_DIR}` is the base directory shown when this skill loads):

```bash
node "${CLAUDE_SKILL_DIR}/scripts/mutate.mjs" lines --base <fixed point> [--lcov <lcov file>]
```

The output format is in the script header. Coverage comes from a coverage tool the repo already has installed (c8,
nyc, jest / vitest coverage, coverage.py) or one built into the runtime (Node 22's
`node --test --experimental-test-coverage --test-reporter=lcov`); pass the lcov it produces as `--lcov`. With
neither, `covered` is `null`: a line counts as covered only when the reviewer traces a call chain from a test to it,
and the record says `coverage=inferred`.

Choosing lines:

1. Take only covered, executable code lines; never mutate test files, comments, docs, configuration, or generated
   files. Uncovered lines are not mutated; their count goes into the record. When the ticket changes executable code
   lines and none of them is covered, that fact is itself a candidate (lens `mutation`).
2. **At most one mutant per line, and at most 10 per ticket.** Over the cap, take in order: lines a Finder candidate
   points at → lines an acceptance criterion directly depends on → conditions, boundaries, and return values → other
   statements; within a priority, spread across hunks.
3. For each line pick the operator most likely to slip past the tests: invert a condition, shift a boundary
   (`<` ↔ `<=`), replace a return value with a constant or empty value, delete a statement (a call, an assignment,
   an `await`). A mutant must change some observable behaviour.

**Use a mutation tool when the repo already has one installed** — already a dependency in the repo's manifest or a
command already on PATH, and runnable locally right now (`node_modules/.bin/stryker`, `cargo mutants --version`
succeeding, `mutmut` in the project's venv). Do not install one. Narrow the tool to the chosen lines with its own scope options: StrykerJS takes
`--mutate <file>:<start>-<end>` (its `--incremental` compares against the previous report file, not a git ref, so it
only speeds a run up and never narrows the scope); cargo-mutants takes `--in-diff <diff file>`; mutmut takes the
changed file paths. Where a tool makes several mutants on one line, count one per line (a survivor if the line has
one), and the total still stays within the cap.

**Without a tool, mutate by hand** through the script. Write a plan in the scratchpad; the format is in the script
header:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/mutate.mjs" run --base <fixed point> [--lcov <lcov file>] --plan <scratchpad>/mutants.json --ledger <scratchpad>/review-<ticket>-r<round>-ledger.json --cmd "<test command>" > <scratchpad>/mutants-result.json
```

Run it at the root of the review worktree. Give `--cmd` the narrowest test command that covers the chosen lines.
The script runs the baseline first. It refuses a mutant that is not on a changed line of this ticket's diff or that
lcov marks uncovered, and a plan with two mutants on one line, with an `original` that does not match the current
line, or whose count plus what the ledger already spent exceeds the cap; `--cap` can only lower it. After each
mutant it writes the original bytes back, compares their SHA-256, and records the mutant in the ledger. **One
ledger per review round:** a round may be split into several `run`s, but never switch ledgers or open another
round to get around the cap. Exit code 3 means a restore failed: stop at once, discard the whole review worktree,
and the verdict is `stuck`. When it
finishes, confirm `git -C <review worktree> status --porcelain` prints nothing.

Outcomes: `killed` and `timeout` mean the tests caught it; `survived` is a candidate (lens `mutation`) whose
`failure_scenario` names a concrete input on which the original and the mutant produce different observable results
and no existing test stops it.

Done when: the live-run result is recorded; mutation touched only covered lines in this ticket's diff, at most one
per line and no more than the cap; every mutant has an outcome; `git status --porcelain` in the review worktree is
empty; every surviving mutant has become a candidate.

## 4. Verifier: an independent ruling per candidate

Give each candidate (including the live-run and mutation candidates from section 3) to its own verifier subagent,
dispatched in parallel. Verifiers only handle candidates; none rereads the whole diff.

The prompt is self-contained and holds only the absolute paths of the repo and the review worktree, the ticket
branch, the fixed point, the candidate's fields, and the ruling rules below. Leave out the finder's reasoning to
avoid anchoring.

**Disprove first:** find and cite the code that would overturn the candidate. Settle uncertain technical facts by
running a throwaway program. For a surviving mutant, disproving means showing it is an equivalent mutant — no input
makes the original and the mutant differ observably. Only when disproof fails, go through the gates in order:

1. **Traced:** cite a `file:line` the verifier actually opened.
2. **Introduced by this ticket:** run the same check on the fixed point; it passes only if the fixed point is fine
   and the ticket branch fails. A mutation candidate (a surviving mutant, or changed lines with no coverage) sits on
   a changed line of this ticket's diff, which the script guarantees, and so passes this gate.
3. **Concrete failure scenario:** the failure path is genuinely reachable and the consequence is observable.

There are three rulings, each with `file:line` evidence: **confirmed** (all three gates pass), **pre-existing**
(fails only the second gate), and **invalid**. When a ruling's `file:line` does not match the ticket branch, have
another verifier re-check that candidate.

Routing:

- **Confirmed and blocking** (it changes whether this ticket should be integrated) → a finding. A confirmed
  surviving mutant always counts as blocking: the tests do not pin the behaviour this ticket changed.
- **Confirmed but not blocking** → an observation; it triggers no fix.
- **Pre-existing** → handed to the host for get-to-work's filing along the way.
- **Invalid** → dropped; for a mutation candidate, its disposition goes into the mutation record (for example
  "equivalent, invalid").

Each finding carries a one-sentence **fix direction** that states the observable before/after difference (an
output, an error, a test going from red to green). One that cannot state it is a style preference; withdraw it.
For a surviving mutant, the fix direction is a test that kills it, with its input.

Done when: every candidate has exactly one ruling with evidence and the result of each gate; every finding has a
falsifiable fix direction; every mutant has a disposition in the mutation record.

## 5. Verdict

- `pass`: no confirmed, blocking finding.
- `fix`: at least one confirmed, blocking finding.
- `stuck`: the review cannot finish — a precondition failed, a restore failed, the review worktree cannot run the
  tests. State the reason, what would clear it, and which section the review reached. A `stuck` before the review
  opens (section 1) does not count as a review; once cleared, run `initial` again. A `stuck` mid-review, once
  cleared, resumes only the unfinished sections, keeping the candidates, rulings, and mutation record already in
  the block, and dispatches no Finders again.

Done when: the verdict is exactly one of the three and follows from the routing in section 4, not from
self-assessment.

## 6. Output and the status record

A fixed format whose keys are English and identical in src and dist, so the caller and later agents can read it
mechanically:

```text
<!-- sorry-matt:review -->
review: <round>  mode: initial | recheck
verdict: pass | fix | stuck
base: <fixed point>@<sha>  head: <ticket branch>@<sha>
stuck: <reason and how to clear it, or none>

reviewer: primary
findings:
- F1 blocking <file>:<line> [<lens>]
  summary: <one sentence>
  evidence: <file:line the verifier opened; path of the live-run or mutation output>
  fix: <fix direction, with the observable before/after difference>
observations:
- <file>:<line> <one sentence> (evidence: <file:line>)
pre-existing:
- <file>:<line> <one sentence> (evidence: <file:line>)

live run: <command> -> green | red (<log path>)
mutation (round <n>): tool=<manual | stryker | cargo-mutants | mutmut> cap=10 mutated=<n> survived=<n> uncovered=<n> coverage=<lcov | inferred>
- <file>:<line> <operator> -> killed | timeout | survived: <disposition: F2 | equivalent, invalid | ...>
restored: yes | no
```

An empty list is written `none`. With a second reviewer, each gets its own `reviewer:` section, and findings stay
separate, never merged or reranked; `verdict` follows from every reviewer's findings.

Write this block into the "verification results" field of the ticket's status record, replacing the previous
`sorry-matt:review` block and incrementing `round`. Every `mutation (round <n>)` section of the replaced block is
carried into the new one verbatim, ahead of this round's, so a recheck never overwrites the initial review's full
mutation record. Add the paths of the diff, live-run, and mutation output to the
"evidence paths" field. On GitHub, update in place the comment whose first line is `<!-- sorry-matt:status -->`
(`gh api --method PATCH repos/<owner>/<repo>/issues/comments/<id> -F body=@<file>`); on Local Markdown, write it
into the ticket file's `## sorry-matt status` section. This is a machine record for the next agent, with no polish
pass. Return the same block to the caller.

Finally remove the review worktree: `git -C <repo> worktree remove <scratchpad>/review-<ticket>`.

Done when: the block follows the format above; the status record holds exactly one, current review block that keeps
every round's mutation record; no PR
comment, review, or `suggestion` block was produced; the review worktree is removed.

## 7. Recheck

After the batched fix, the caller invokes this skill again in `recheck` mode with the previous review block. This
is not a second review: no Finders run, and only the lines the previous findings concern are verified again.
Rebuild the review worktree per section 1 at the fixed ticket branch tip.

1. **Fix Verifier:** give each finding to its own subagent, dispatched in parallel. The prompt is self-contained:
   the review worktree path, the finding's `summary`, `evidence`, and `fix`, and the diff of the fix commits
   (`git diff <previous head>..<ticket branch>`); leave out the implementer's explanation. Try to disprove the fix
   first, answering each of the four with `file:line`:
   1. Is every failure window in the finding closed?
   2. Did the fix open a new one?
   3. What is the observable difference before and after? If there is none, it was not fixed.
   4. Will any other caller break?

   Two rulings: **closed** or **open**. A new window from question 2 goes through the three gates of section 4,
   and if confirmed and blocking becomes a new finding in this round.
2. **Live run:** run only the tests covering the finding lines, plus any tests the fix added.
3. **Mutation:** mutate only the lines the findings concern, under the rules of section 3 (one per line, cap 10),
   with a new ledger for this round. If a previously surviving mutant's line is unchanged, rerun the same mutant; this time it must be killed.

Verdict: every finding closed, the live run green, every mutant on finding lines killed, and no new blocking finding
→ `pass`; otherwise `fix`. The caller controls how many fix rounds there are. Output follows section 6 with
`mode: recheck`, and each earlier finding's `summary` is prefixed `closed` or `open`.

Done when: every earlier finding has one Fix Verifier ruling with evidence; the live run and mutation touched only
the lines the findings concern; the verdict and block are written into the status record per section 6.
