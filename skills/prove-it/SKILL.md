---
name: prove-it
description: Ticket-level independent review for the sorry-matt workflow. Reviews one ticket branch through an evidence chain (Finder → Verifier → Fix Verifier), a live run, and mutation limited to the ticket's own diff, then writes a fixed-format pass / fix / stuck verdict and finding list into the ticket's status record. Called by get-to-work during a ticket's close-out; posts no PR comments and produces no suggestions.
---

# prove-it: review one ticket, and prove it

The **independent review** of the sorry-matt workflow, run once per ticket during its close-out. The evidence chain
follows `review-pr`: Finders raise candidates, Verifiers rule on them independently, and after the batched fix a
Fix Verifier rechecks. The difference is the reader: here it is the host, not a PR author — no PR comments, no
`suggestion` blocks, nothing posted anywhere; the only output is the fixed-format verdict in section 6, written
into the ticket's status record.

**The burden is on you:** a pass needs evidence, not "found nothing". Whether the tests catch defects is proved by
the reviewer through mutation; the implementer's word and the number of new test lines count for nothing.

## 1. Inputs and opening the review

The caller supplies:

- **Ticket:** the tracker-native identifier, the full original ticket text, and the expansion block that starts
  with `<!-- sorry-matt:expansion -->`, if there is one.
- **Acceptance snapshot and diff:** the acceptance snapshot saved before implementation started, and the acceptance
  diff output taken against it after delivery (both `sorry-matt/acceptance@1`; the diff output adds a `check`). The
  snapshot's `items` are this review's acceptance criteria, each with its source: `from: original` came from the
  original ticket, `from: expansion` was added at expansion, with `by`, `run` and `round`.
- **Fixed point:** the line integration branch.
- **Ref under review:** the ticket branch.
- **Targeted-check results:** the commands and results the implementation agent reported. They only confirm green;
  the reviewer picks the live run's commands itself (section 3).
- **CI coverage:** whether CI runs the full suite on the line's integration branch after integration — `covered`,
  `uncovered` (the caller ruled "CI does not cover the integration branch") or `no-origin` (there is no `origin`).
  When it is not given, section 3's scope command decides from whether `origin` exists.
- **Mode:** `initial`, or `recheck` (the recheck after a batched fix, with the previous review block attached;
  it follows section 7).
- **Reviewers:** by default only `primary`, this skill's own set of Finders.

Check each item; if any fails, do not open the review — output `verdict: stuck` in the section 6 format, naming
which one:

- `git rev-parse` resolves the fixed point and the ticket branch, and `git diff <fixed point>...<ticket branch>`
  is non-empty.
- The targeted checks are green. A red light belongs to the implementation agent; review only takes green tickets.
- The acceptance snapshot and the acceptance diff output are both present, their `id` is this ticket, and the
  snapshot holds at least one criterion.

**Changed acceptance criteria fail the review.** When the acceptance diff output's `check.changed` is true (including
`check.snapshotIntact` false: the snapshot itself was edited), record one blocking finding (lens `acceptance`)
directly, without Finders or Verifiers: the evidence is the acceptance diff output's path and its `removed` /
`added`, and the fix direction is to restore the criteria on the tracker to the snapshot, with the implementation
agent reporting any criterion it needs changed as awaiting ruling. The review carries on as usual, and the acceptance
check always works from the snapshot, never from the changed version.

Open a **review worktree** in the scratchpad. The live run and mutation happen only there; the implementation
agent's worktree stays untouched. Inside the repo, run:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/worktree.mjs" open --path <scratchpad>/review-<ticket> --ref <ticket branch> > <scratchpad>/review-<ticket>-r<round>-worktree.json
git -C <repo> diff <fixed point>...<ticket branch> > <scratchpad>/review-<ticket>.diff
```

**A ticket's review worktree is built once:** the initial review creates it, each recheck (section 7) reuses it
through the same command, moved to the fixed tip, and it is removed only once the verdict is final (section 6).
What `open` decides and outputs is in the script header: `created` is new, `reused` is kept, `rebuilt` means the
previous round left changes behind and it was thrown away and built again. When the output's `install` is true,
restore dependencies from the lockfile (frozen forms such as `npm ci` or `pnpm install --frozen-lockfile`); when it is
false, keep the existing install. Never add a dependency or download a new tool — the review changes neither this
ticket's diff nor the repo's dependencies. New-file line numbers always come from `git show <ticket branch>:<path>`.

The **review tier** is judged here, once, from the diff, written into the review block as `tier`, and kept for the
whole ticket, rechecks included. It sets the number of finders and the lenses each applies, how verifiers and Fix
Verifiers are batched, and the mutation cap. At the root of the review worktree, run the **tier command**:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/tier.mjs" judge --base <fixed point> --head <ticket branch> > <scratchpad>/review-<ticket>-tier.json 2> <scratchpad>/review-<ticket>-tier.err
```

The output format, how each signal is computed, the thresholds, and the flags that override them are in the script
header. Read the output as it is; never recompute it:

- `tier`: goes into the review block. `reasons` are the conditions that put it at this tier.
- `finders`: section 2 dispatches Finders from it.
- `verifiers.max`, `fixVerifiers`: sections 4 and 7 batch by them.
- `mutationCap`: section 3's mutation cap; `null` means prose only, with no executable lines.

When the tier command exits non-zero, take `tier` as `full`, `finders` as
`[["line-by-line","deleted-behaviour"],["cross-file"],["acceptance","conventions"]]`, the mutation cap as 10, and
use `--tier full` in sections 4 and 7; add the path of `<scratchpad>/review-<ticket>-tier.err` to the status record's
"evidence paths" field.

Done when: the inputs are complete; a failed precondition has produced `stuck` and stopped the review; changed
acceptance criteria have been recorded as an `acceptance` finding; `worktree.mjs open` put the review worktree at the
ticket branch tip, dependencies were handled per `install`, and the diff is saved; `tier` comes from the tier command's output, or is `full` when it failed.

## 2. Finder: candidates in parallel

Dispatch one finder per inner array of the tier output's `finders`, applying the lenses that array lists; dispatch
them all in one message, the Agent tool's `description` being `finder` followed by the ticket's identifier. The lenses
in `pruned` were pruned mechanically from the diff; dispatch them nowhere and put them in no prompt: no deleted lines
means no deleted-behaviour lens, no rule file covering the changed files means no repo-conventions lens, and with no
signature changed the cross-file lens is folded into line by line.

This skill's finders, verifiers (section 4) and Fix Verifiers (section 7) are always dispatched in the foreground:
the caller waits within its own turn until every one of them is back. `get-to-work` puts no time limit on review
because of this rule.

**All three are plugin agent definitions.** The Agent tool's `subagent_type` is `sorry-matt:finder`,
`sorry-matt:verifier` and `sorry-matt:fix-verifier` respectively; the definitions sit in the plugin root's `agents/`,
two levels above this skill's base directory: `../../agents/finder.md`, `../../agents/verifier.md`,
`../../agents/fix-verifier.md`. The tools and the fixed rules (working rules, ruling rules, report format) live in the
definitions: a spawn prompt passes only the values each section lists (paths, lenses, candidates or findings), restates no
rule and names no model. A definition's `tools:` line gives no Edit and no Write tool, but it keeps a shell — review
has to run tests and `git` — and a shell can write files, so this is no read-only guarantee: "review does not change
the ticket's diff" still rests on the definitions' written rules, with section 6's `worktree.mjs status` check
(`git status --porcelain`) to catch a breach. When these agent types are not in the available list, dispatch a
general-purpose agent instead and name no model: the prompt is the definition's body below its frontmatter (with
`${CLAUDE_PLUGIN_ROOT}` replaced by the plugin root's absolute path) followed by the same spawn prompt, under the same
`description`.

All three report only the fields their definition names. Reasoning, probe programs and probe output go into files
under the notes directory `<scratchpad>/review-<ticket>-notes/` (the spawn prompt gives this path), and the report gives
the paths: the caller's context holds only the fields a ruling needs.

For all three, the Agent tool's `description` always starts with the role word, followed by the ticket's identifier
(`#N` on GitHub, the ticket file name in Local Markdown): `finder #72`, `verifier #72`, `fix-verifier #72`. The
plugin's hook records it in the run's counters file, and `get-to-work` relies on this prefix when finishing to break
the run's spawns down by role and by ticket; one written wrong is counted as a general-purpose agent of unknown use.

- **Line by line** (`line-by-line`): for every line of every hunk, ask which inputs, states, timings, or platforms
  break it. Check especially for inverted conditions, off-by-one, falsy zero, a missing `await`, a copy-pasted wrong
  variable, and a catch that swallows errors. When the cross-file lens is folded in, also check that a changed
  function's return values, exceptions, and timing still hold at its direct callers.
- **Deleted behaviour** (`deleted-behaviour`): identify the invariant each deleted or rewritten block used to hold and locate where the
  new code rebuilds it; if nowhere, it is a candidate.
- **Cross-file contracts** (`cross-file`): trace the callers and callees of each changed function and check whether new
  preconditions, return shapes, exceptions, or timing break either side.
- **Acceptance check** (`acceptance`): locate, for each criterion in the acceptance snapshot, where the diff implements it and which
  test verifies it. List criteria that are missing or half done, ones that look done but are done wrong, and changes
  the ticket did not ask for (scope creep). Quote each criterion and its source (`original`, or `expansion` with
  `by` and `round`).
- **Repo conventions** (`conventions`): apply the rule files listed in the tier output's `signals.ruleFiles` (the
  `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, and `CODING_STANDARDS.md` covering the changed files). List only what can quote the rule's text; skip anything tooling
  already enforces.

Finders cannot see this conversation; the spawn prompt holds only values: the absolute paths of the repo and the review
worktree, the fixed point, the ticket branch, the diff file path, the full ticket text, the notes directory, and the
full text of every lens it applies (listed above). The scope to trace outward, raising candidates without ruling, the
report fields and the cap of six per finder are written in the definition. Each reported candidate has `file`, `line`
(new-file line number), `lens`, `summary`, `failure_scenario` and `suspected` (suspected spec-level or
pre-existing); `suspected` is `spec` (with the text that specifies it), `pre-existing` (with its location on the
fixed point) or `none`.

Each reviewer is one set of Finders, and every candidate carries a `by` field naming its reviewer. Today there is
only `primary`; another reviewer is just another source of candidates, and everything from section 3 on stays the
same.

Done when: every finder has reported; candidates on the same line with the same failure mechanism are deduplicated,
keeping the one with the most concrete `failure_scenario`; every candidate has a `suspected`; every hunk has been
through the line-by-line lens at least once.

## 3. Live run and mutation

The reviewer does this step; it is never handed to the implementer.

### Live run

**The full suite belongs to CI; the review runs only the affected scope.** At the root of the review worktree, first
judge the scope:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/scope.mjs" --base <fixed point> --ci <section 1's CI coverage> > <scratchpad>/review-<ticket>-scope.json
```

Leave out `--ci` when the caller gave no CI coverage. The rules for the scope and for where the commands come from
are in the script header; read the output as it is:

- `scope: full`: CI does not cover the integration branch, or there is no `origin`, so no one else runs the full
  suite before the line finishes; run the project's test, typecheck and lint once each, as before. Take the commands
  from the output's `commands`; when it is `null`, find them yourself from the manifest and the CI configuration.
- `scope: affected`: CI runs the full suite after integration, so run only typecheck, the tests that cover the changed
  files, and the lint of the changed files. Derive the commands by applying the output's `targeted` (the text of the
  command contract's "Targeted checks") to `changed`; when it is `null`, derive them yourself from the manifest and
  the test configuration. `tests` lists candidate test files; one counts only once an import chain or the contract's
  mapping confirms it covers a changed file. Skip typecheck or lint when the project has none.

The reviewer picks the commands; never copy the one the implementation agent reported. Copy the output's `scope`,
`ci` and `source` into the `live run` line (section 6), so it shows whether this was the full suite or the affected
scope, and whether the commands came from the contract or were derived. This is the baseline for mutation:

- All green → go on to mutation.
- Red → the red light is itself a candidate (lens `live-run`) for the Verifier. Mutation means nothing on a red
  baseline, so skip it this time; the mutation record says `skipped: red baseline` (format in section 6).

### Mutation

**No executable lines, no mutation.** When every change in this ticket's diff falls in docs, comments,
configuration, or generated files and not one executable code line changed, do not run `mutate.mjs lines` and
write no plan; the mutation record says `skipped: no executable lines` (format in section 6). The live run still
runs.

**Scope is limited to lines in this ticket's diff that tests cover.** In the review worktree, list the changed
lines and their coverage (`${CLAUDE_SKILL_DIR}` is the base directory shown when this skill loads):

```bash
node "${CLAUDE_SKILL_DIR}/scripts/mutate.mjs" lines --base <fixed point> [--lcov <lcov file>]
```

The output format is in the script header. Coverage comes from a coverage tool the repo already has installed (c8,
nyc, jest / vitest coverage, coverage.py) or one built into the runtime (Node 22's
`node --test --experimental-test-coverage --test-reporter=lcov`); pass the lcov it produces as `--lcov`. When
`docs/agents/commands.md` exists and its "Coverage" is not `none`, produce the lcov with its command. With
neither, `covered` is `null`: a line counts as covered only when the reviewer traces a call chain from a test to it,
and the record says `coverage=inferred`.

Choosing lines:

1. Take only covered, executable code lines; never mutate test files, comments, docs, configuration, or generated
   files. Uncovered lines are not mutated; their count goes into the record. When the ticket changes executable code
   lines and none of them is covered, that fact is itself a candidate (lens `mutation`).
2. **At most one mutant per line, and a per-ticket cap of the tier output's `mutationCap`** (pass it to the script as
   `--cap`; `light` has the lowest cap). Over the cap, take in order: **lines this ticket's new or changed tests claim
   to guard** (the code lines such a test calls directly and asserts on; the lines holding the behaviour its name,
   assertion message or commit message says it guards) → lines a Finder candidate points at → lines an acceptance
   criterion directly depends on → conditions, boundaries, and return values → other statements; within a priority,
   spread across hunks. The first priority leads because a new test that claims to guard a line yet cannot kill its
   mutant is the most direct evidence that the tests do not pin the change.
3. For each line pick the operator most likely to slip past the tests: invert a condition, shift a boundary
   (`<` ↔ `<=`), replace a return value with a constant or empty value, delete a statement (a call, an assignment,
   an `await`). A mutant must change some observable behaviour.

**Use a mutation tool when the repo already has one installed** — already a dependency in the repo's manifest or a
command already on PATH, and runnable locally right now (`node_modules/.bin/stryker`, `cargo mutants --version`
succeeding, `mutmut` in the project's venv). Do not install one. Narrow the tool to the chosen lines with its own
scope options: StrykerJS takes `--mutate <file>:<start>-<end>` (its `--incremental` compares against the previous
report file, not a git ref, so it only speeds a run up and never narrows the scope); cargo-mutants takes
`--in-diff <diff file>`; mutmut takes the changed file paths. Where a tool makes several mutants on one line, count
one per line (a survivor if the line has one), and the total still stays within the cap.

**Without a tool, mutate by hand** through the script. Write a plan in the scratchpad; the format is in the script
header:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/mutate.mjs" run --base <fixed point> [--lcov <lcov file>] --plan <scratchpad>/mutants.json --ledger <scratchpad>/review-<ticket>-r<round>-ledger.json --cmd "<test command>" > <scratchpad>/mutants-result.json
```

Run it at the root of the review worktree. Give `--cmd` the narrowest test command that covers the chosen lines,
taken from the live run's commands or a narrowed form of one. The script runs the baseline first. It refuses a mutant that is not on a changed line of this ticket's diff or that
lcov marks uncovered, and a plan with two mutants on one line, with an `original` that does not match the current
line, or whose count plus what the ledger already spent exceeds the cap; `--cap` can only lower it. After each
mutant it writes the original bytes back, compares their SHA-256, and records the mutant in the ledger. **One
ledger per review round:** a round may be split into several `run`s, but never switch ledgers or open another
round to get around the cap.

On a non-zero exit, act on the output; section 6 says how to record each case:

- **1 with `baseline: "red"`** (the live run was green, the script's own baseline is red): when `--cmd` is narrower
  than the live run's commands, the chosen command is wrong — switch to one that covers the same lines and was green
  in the live run, and run again with the same ledger (a red baseline runs no mutant and spends none of the cap). When
  `--cmd` is the very command that was green in the live run, red and green on the same commit is a flaky red: it
  becomes a candidate (lens `live-run`, evidence the paths of the live-run log and this output), and this round
  mutates no further.
- **1 with `error`** (a runtime error; the files it touched are restored): record the mutants that ran from
  `results`, and do not make up the ones that did not; the verdict is `stuck`, the reason being unfinished
  mutation, and once cleared, section 5 resumes only mutation, with the same ledger.
- **3** (a restore failed): stop at once; the verdict is `stuck`. The review worktree is not used again: after the
  block is written, section 6 removes it, and the next round's `open` builds it again.

Never infer a clean worktree from the exit code: `restored` always comes from section 6's `worktree.mjs status`.

Outcomes: `killed` and `timeout` mean the tests caught it; `survived` is a candidate (lens `mutation`) whose
`failure_scenario` names a concrete input on which the original and the mutant produce different observable results
and no existing test stops it.

Done when: the live-run result is recorded; with no executable lines, mutation was skipped and the record says
`skipped: no executable lines`; the live run's scope and command source come from `scope.mjs`'s output, and its
commands were not copied from the implementation agent; mutation touched only covered lines in this ticket's diff, at
most one per line and no more than the cap, with lines the ticket's new tests claim to guard first over the cap; every
mutant has an outcome; a non-zero `mutate.mjs` exit was handled per the three cases above; every surviving mutant has
become a candidate.

## 4. Verifier: an independent ruling per candidate

The script **batches** the candidates (including the live-run and mutation candidates from section 3). Give each
candidate an `id`, write the `id`, `file`, and `suspected` of each as a JSON array, and at the root of the review
worktree run:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/tier.mjs" batch --tier-file <scratchpad>/review-<ticket>-tier.json --items <scratchpad>/review-<ticket>-candidates.json
```

When the tier command failed, pass `--tier full` instead of `--tier-file`. Each batch in the output's `batches` goes
to one verifier (`sorry-matt:verifier`), all dispatched in parallel, with `verifier` followed by the ticket's
identifier as the `description`. Candidates marked `suspected` go together to one verifier (the batch's `short`); the
rest are grouped by file (the batch's `normal`), and the batches never outnumber the tier output's `verifiers.max`.
Batching only sets the number of verifiers and never merges candidates.

The spawn prompt holds only values: the absolute paths of the repo and the review worktree, the ticket branch, the fixed
point, the ticket text and acceptance snapshot (or their file paths), the notes directory, and the fields of that
batch's candidates. Leave out the finder's reasoning to avoid anchoring; pass `suspected` and the text or location
attached to it as they are. The ruling rules — the short path, disprove-first and the three gates, the four rulings,
the five blocking rules, the fix direction and the report format — live in the definition, and the spawn prompt does not
restate them.

For every candidate in its batch a verifier reports one ruling — **confirmed**, **pre-existing**, **spec-level** or
**invalid** — with `file:line` evidence; a confirmed one names the `rule` it meets (one of `acceptance`, `regression`,
`red`, `safety`, `unpinned`, or `none`), and one that meets a rule is blocking and carries a fix direction. The last
line, `noticed`, holds other problems it saw while ruling, which the caller treats as observations. Only when a
citation does not match the source it names, have another verifier re-check that candidate.

Routing:

- **Confirmed and blocking** → a finding, carrying its `rule`.
- **Confirmed but not blocking** → an observation.
- **Spec-level** → an observation marked `(spec-level)` at the end of its sentence.
- **Pre-existing** → listed under `pre-existing`.
- **Invalid** → dropped; for a mutation candidate, its disposition goes into the mutation record (for example
  "equivalent, invalid").

Only findings trigger a fix. Observations and pre-existing items go to the caller for get-to-work's filing along the
way, and the ticket moves on by the verdict.

Done when: every candidate has exactly one ruling with `file:line` evidence, and either the result of each gate or
the two checks of the short path; candidates in a batch were each ruled on separately; every finding has the `rule`
it meets, that rule's quote and a falsifiable fix direction; every mutant has a disposition in the mutation record.

## 5. Verdict

- `pass`: no confirmed, blocking finding, and the acceptance diff shows no change.
- `fix`: at least one confirmed, blocking finding; section 1's `acceptance` finding counts as one.
- `stuck`: the review cannot finish — a precondition failed, a restore failed, the review worktree cannot run the
  tests. State the reason, what would clear it, and which section the review reached. A `stuck` before the review
  opens (section 1) does not count as a review; once cleared, run `initial` again. A `stuck` mid-review, once
  cleared, resumes only the unfinished sections, keeping the candidates, rulings, and mutation record already in
  the block, and dispatches no Finders again. On `stuck`, section 6 removes the review worktree, and a resumed review
  builds it again with `open`.

**The verifiers' rulings decide the verdict.** The caller copies each ruling into the block as it stands: the
findings are the ones a verifier ruled blocking, the observations are the other confirmed ones. When the caller
thinks an observation should block integration, it dispatches one more verifier to rule again on that one
candidate's `rule`, and that ruling stands.

Done when: the verdict is exactly one of the three and follows from section 1's acceptance diff and the routing in
section 4; every finding's `rule` in the block comes from a verifier's report.

## 6. Output and the status record

A fixed format whose keys are English and identical in src and dist, so the caller and later agents can read it
mechanically:

```text
<!-- sorry-matt:review -->
review: <round>  mode: initial | recheck  tier: light | standard | full
verdict: pass | fix | stuck
base: <fixed point>@<sha>  head: <ticket branch>@<sha>
stuck: <reason and how to clear it, or none>
acceptance: unchanged | changed (<acceptance diff path>)  original=<n> expansion=<n> (<by>, round <n>)

reviewer: primary
findings:
- F1 blocking <file>:<line> [<lens>] rule=<acceptance | regression | red | safety | unpinned>
  summary: <one sentence>
  evidence: <file:line the verifier opened; path of the live-run or mutation output>
  fix: <fix direction, with the observable before/after difference>
observations:
- <file>:<line> <one sentence> (evidence: <file:line>)
pre-existing:
- <file>:<line> <one sentence> (evidence: <file:line>)

live run: scope=<affected | full | findings> ci=<covered | uncovered | no-origin> source=<commands.md | self-found> -> green | red (<log path>)
- <command> -> green | red
mutation (round <n>): tool=<manual | stryker | cargo-mutants | mutmut> cap=<n> mutated=<n> survived=<n> uncovered=<n> coverage=<lcov | inferred>
- <file>:<line> <operator> -> killed | timeout | survived | restore-failed: <disposition: F2 | equivalent, invalid | ...>
- error: <message> (<mutation output path>)
restored: yes | no | n/a
```

The `live run` line gives the scope, the CI coverage and the command source, with one line per command under it:
`scope` is `full` or `affected` from section 3's `scope.mjs` output, and `findings` in a recheck (section 7); `ci` is
the output's `ci`; `source` is `commands.md` when the commands came from the contract, `self-found` when the reviewer
found or derived them. `- error:` appears only when `mutate.mjs` ended in a runtime error; `restore-failed` is used
only for the mutant behind an exit code 3 (the output's `restoreFailed`). An empty list is written `none`. An
`acceptance` finding's location is the acceptance diff output's path, not a `file:line`. A spec-level observation is
marked `(spec-level)` at the end of its sentence, before `(evidence: …)`.

When a round runs no mutation, its `mutation` section is a single line with no mutant list:

- No executable lines: `mutation (round <n>): skipped: no executable lines`
- Red live run: `mutation (round <n>): skipped: red baseline`
- Green live run, red `mutate.mjs` baseline, and a flaky red (section 3):
  `mutation (round <n>): skipped: red baseline (mutate.mjs, <mutation output path>)`. When a switched command ran
  green, write the rerun's result in the full format instead.
- `stuck` before the review opened, or mid-review before mutation:
  `mutation (round <n>): skipped: stuck before mutation`

When `mutate.mjs` ends in a runtime error or a failed restore, use the full format: `mutated` is the number of
`results` in the output, plus the one whose restore failed.

**`restored` always comes from the script, never from an inference.** Whether mutation ran, was skipped, or the review
went `stuck` in any section, run this inside the repo before writing the block:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/worktree.mjs" status --path <scratchpad>/review-<ticket> > <scratchpad>/review-<ticket>-r<round>-restored.json
```

Copy the output's `restored`: `yes` is an empty `git status --porcelain`; `no` means tests, lint or mutation left
changes behind — add the output's path to the "evidence paths" field, and the next round's `open` throws the
worktree away and builds it again; `n/a` means this round had no review worktree (`stuck` before the review opened).
In a round where `mutate.mjs` exited 3, `restored` is always `no`.

With a second reviewer, each gets its own `reviewer:` section, and findings stay separate, never merged
or reranked; `verdict` follows from every reviewer's findings.

Write this block into the "verification results" field of the ticket's status record, replacing the previous
`sorry-matt:review` block and incrementing `round`. Every `mutation (round <n>)` section of the replaced block is
carried into the new one verbatim, ahead of this round's, so a recheck never overwrites the initial review's full
mutation record. Add the paths of the diff, live-run, and mutation output to the "evidence paths" field. On
GitHub, update in place the comment whose first line is `<!-- sorry-matt:status -->`
(`gh api --method PATCH repos/<owner>/<repo>/issues/comments/<id> -F body=@<file>`); on Local Markdown, write it
into the ticket file's `## sorry-matt status` section. This is a machine record for the next agent, with no polish
pass. Return the same block to the caller.

**Remove the review worktree once the verdict is final.** When `verdict` is `pass` or `stuck`, or this is the second
recheck (the previous block is a `mode: recheck` `fix`) and the verdict is still `fix` — no recheck follows — run this
inside the repo after the block is written:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/worktree.mjs" close --path <scratchpad>/review-<ticket>
```

Any other `fix` keeps it for the next recheck to reuse.

Done when: the block follows the format above; the `live run` line shows whether the scope was `full`, `affected` or
`findings`; `restored` comes from `worktree.mjs status`; the status record holds exactly one, current review block
that keeps every round's mutation record; no PR comment, review, or `suggestion` block was produced; once the verdict
is final the review worktree is removed, and any other `fix` keeps it.

## 7. Recheck

After the batched fix, the caller invokes this skill again in `recheck` mode with the previous review block. A
recheck answers one question: is each of the previous findings closed? Its scope is those findings and the diff of
the fix commits (`git diff <previous head>..<ticket branch>`), so each round has less to verify than the one before.
Reuse the initial review's worktree through section 1's `worktree.mjs open`, which moves it to the fixed ticket branch
tip; never build another. `tier` stays what the initial review set.

1. **Fix Verifier:** write the `id` and `file` of each finding (except an `acceptance` finding, which takes step 4)
   as a JSON array and batch them with
   `node "${CLAUDE_SKILL_DIR}/scripts/tier.mjs" batch --tier <the kept tier> --stage fix --items <scratchpad>/review-<ticket>-r<round>-findings.json`:
   one batch per ticket for `light` and `standard`, one per file for `full`. One Fix Verifier
   (`sorry-matt:fix-verifier`) per batch, dispatched in parallel; it answers for each finding in its batch separately,
   and each gets its own ruling. The `description` is `fix-verifier` followed by the ticket's identifier. Save the diff
   of the fix commits as `<scratchpad>/review-<ticket>-r<round>-fix.diff`. The spawn prompt holds only values: the absolute
   paths of the repo and the review worktree, the ticket branch, the previous head, the fix diff's path, the notes
   directory, and each finding's `summary`, `evidence`, `rule` and `fix`; leave out the implementer's explanation. The
   answering rules — re-run the scenario recorded in `evidence`, the two questions, the second one ruled by the
   verifier's three gates and five blocking rules with the previous head standing in for the fixed point at the
   second gate — live in the definition, and the spawn prompt does not restate them.

   For each finding it reports **closed** or **open** with `file:line`, and any confirmed new finding of this round on
   the fix diff's changed lines that meets a rule (with its `rule` and fix direction). The report's last line,
   `noticed`, holds other spellings of the same finding, lines outside the fix diff, and problems that meet no rule,
   which the caller treats as observations.
2. **Live run:** run only the tests covering the finding lines, plus any tests the fix added. The `live run` line
   says `scope=findings`, `ci` as section 1's CI coverage, and `source` for where these commands came from.
3. **Mutation:** rerun only the mutants that survived last time; this time each must be killed. Where the line's
   content changed, apply the same operator to the line that replaced it. Use a new ledger for this round. Lines the
   fix added are covered by question 2 of step 1.
4. **Acceptance diff:** read the new acceptance diff output the caller attached. The `acceptance` finding is closed
   only when `check.changed` is false; when it is true the finding stays open, and if there was none before, record
   one as a new finding in this round per section 1.

Verdict: every finding closed, the live run green, every mutant that survived last time killed, the acceptance diff
showing no change, and no new finding → `pass`; otherwise `fix`. Output follows section 6 with `mode: recheck`; each
earlier finding's `summary` is prefixed `closed` or `open`, and every `noticed` line goes into `observations`.

**A ticket gets at most two `recheck`s.** When the second one's verdict is still `fix`, write the block as usual and
the caller marks the ticket stuck under get-to-work's rules; this round's new findings count within the same rounds
as the earlier ones.

Done when: every earlier finding has one Fix Verifier ruling with evidence (an `acceptance` finding is ruled on by
the new acceptance diff output); the live run touched only the lines the findings concern, and mutation reran only
the mutants that survived last time; every new finding of this round sits on a changed line of the fix diff and
carries a `rule`; the verdict and block are written into the status record per section 6.
