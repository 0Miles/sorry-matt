---
name: get-to-work
description: Clear a set of already-filed tickets as a per-ticket pipeline. Tickets that are ready and touch no overlapping files are implemented at the same time; each one is reviewed and integrated as soon as it is done, and every line delivers one GitHub aggregate PR or local integration branch.
disable-model-invocation: true
---

# get-to-work: finish every ticket already filed

The deterministic flow — dependency graph, stages, CI, time limits, retries, budget, git sequences, idempotence —
lives in this skill's `scripts/` (`${CLAUDE_SKILL_DIR}` is the base directory shown when this skill loads). **Each
script's header is its contract and source of truth**; this file holds what a script cannot do: when to call them,
what you judge, what a human rules on.

## 0. Start or resume

From the base directory, read the sibling [`../have-it-all-done/ASKING.md`](../have-it-all-done/ASKING.md) in full and
open per its section 0; this shared contract applies throughout. Composed by `have-it-all-done`, reuse its run ledger;
standalone, create or take one over per its section 7, with this skill's `SKILL.md` and `ASKING.md` as absolute paths
in field 10. The run's machine state, `<run>.state.json` next to the ledger, is written only through the scripts
(schema and stage rules: the header of `scripts/state.mjs`).

**Resume**: when the state file exists, do not freeze again: after the re-read of `ASKING.md` section 7,
`state.mjs resume <state>` shows where each ticket stands; go to section 1.

**Freeze** (a new run). A workspace with several repos gets one run per repo: a line never spans repos.

1. **The initial ticket set**: the tickets given as arguments (numbers, URLs or file paths); with none, only those
   published in this session (a Local Markdown path counts). With neither, ask the user for the list.
2. Run `scripts/frontier.mjs` on it; the blocker **edges** and **lines** come from its output, not from reading tickets.
3. Write each ticket's predicted files (section 2, "Predicted files").
4. Write a plan and run `scripts/freeze.mjs` (preflight, held files, exclusions, **joined lines**, candidate order).
   When `preflight.ok` is false, fix what `checks` lists and rerun; a holder git cannot see (another session you know
   of) goes into the plan's `held`. Each `excluded` ticket is **awaiting ruling**, with its holder and release
   condition. The plan's `base` is the base branch the lines merge into (required).
   **Base CI**: the `base-ci` check reads the CI of the base's latest SHA and never blocks the freeze. The CI comes
   from the git remote, not from where the tickets live: Local Markdown reads it too (`gh`, in the repo, finds the
   GitHub repo from its remotes); a repo with no `origin` has no CI to read, `ci` is null and it is no warning.
   When its `warning` is true (the base is red, or its CI could not be read):
   - Composed by `have-it-all-done`, follow the choice the ruling point recorded in ledger field 2; when field 2 has no
     such question (the base was not red at the ruling point), answer "continue" on the user's behalf and log it in
     the self-answer log.
   - Standalone, when it is red, list the question "continue, or fix the base first" (`ASKING.md` section 2(a);
     recommend "continue" and state that every line's CI will carry this red). When step 5 will ask the merge
     authority question, hold it until step 5 and ask both in one go; when step 5 asks nothing (`integrate` is not
     `ticket-pr`, or the permission settings already cover it), ask it here. Record the answer in ledger field 2;
     when it could not be read, answer
     "continue" on the user's behalf and log it, with the error message, in the self-answer log.
   - "Fix the base first": do not freeze. The base's red (branch, SHA, the run ids in `ci.failed`) goes on the
     human-work list, and every initial ticket is awaiting ruling, released when the base turns green. "Continue":
     a red the base brought in is judged by red-light handling as mapping to no ticket
     ([`RED-LIGHT.md`](RED-LIGHT.md) point 2).
   - **Bundles** (#205): the output's `bundleCandidates` are tickets of one line linked by overlapping predicted
     files. Rule on each group by the criteria of section 2, "Bundles" — whether to bundle and which of its tickets —
     write the rulings into the plan's `bundles` (one array of ticket ids per bundle), and rerun `freeze.mjs`: a group
     that does not qualify exits 2 with the reason; put it right. Log each ruling and its reason in the self-answer log;
     do not ask the user.
5. **Merge authority**: only when this run's `integrate` is `ticket-pr` (the profile step 6 will write; when none is
   written, the default `state.mjs`'s header gives for the tracker). Under `ticket-pr` a merge counts as authorized by
   default, and the authority is obtained at the start, not discovered blocked at the finish.
   - **Read the settings**: read `permissions.allow` in the permission settings — `~/.claude/settings.json` and the
     repo's `.claude/settings.json` and `.claude/settings.local.json` — and see whether it covers both `gh pr merge`
     and `gh stack merge`. Read both the `Bash(...)` and the `PowerShell(...)` forms, and judge by the form of the
     shell the host will send the merges with; when both commands are covered by an allow rule and no `ask` or `deny`
     rule names the same command, that is **standing authority**: do not ask. Reading the settings decides only
     whether to ask: whether a merge goes through is still decided by the permission settings at the prompting call
     (`ASKING.md` section 5; the agent does not judge authority).
   - **Not covered**: standalone, ask once "for the tickets frozen in this run, once a ticket's PR has passed review
     and its CI is green, may I send the merge (`gh pr merge`, or `gh stack merge` for one stacked with `gh stack`)?",
     recommending "yes", with the permission rule snippet from `ASKING.md` section 5, "From now on", and the note
     that once it is in the settings later runs no longer ask. The question goes through the pre-ask check of
     `ASKING.md` section 1 and is asked in one go with the freeze's other questions (step 4's base CI question).
     Composed by `have-it-all-done`, do not ask: follow the outcome the ruling point recorded in ledger field 5; when
     field 5 has no such question, treat it as a refusal and log that in the self-answer log.
   - **Yes**: it counts as "the user said to merge during this run" (`ASKING.md` section 5); record it in ledger
     field 5 (question, answer and time). **Refused or no answer**: record that in ledger field 5 too; PRs are still
     opened and stacked as usual, but every merge is left for a human, and no merge command is sent.
6. `state.mjs init`; if this run relaxes the flow, write it once here with `state.mjs profile` (`ASKING.md` section 4;
   when composed, the one written at the ruling point stands). `state.mjs add` each line's tickets,
   `state.mjs line --lines` for the joined lines, `state.mjs bundle <state> <lead> <the other tickets>...` for each of
   `freeze.mjs`'s `bundles`, then `scripts/integrate.mjs line-init` for each line.
7. When `docs/agents/commands.md` does not exist, generate it by the generation rules of `ASKING.md` section 0 and
   commit it on each line's integration branch (subject without a ticket ID), never on the user's current branch.
8. Standalone, rewrite `budget: spawns` and `budget: rounds` in ledger field 9 from the frozen ticket count per
   `ASKING.md` section 4.
9. `tick.mjs setup`, then `state.mjs check <state> freeze --base <base>`; on exit 4, put right every item it lists
   and rerun. Section 1 starts once it passes.

**Hard rail**: the frozen initial set never grows; tickets found or filed during the run are background only.

Done when: the tracker mode is chosen and verified; every initial ticket has its publication source, tracker-native
identifier and blocker map; every excluded ticket has its holder and release condition; every group of
`bundleCandidates` has its ruling, bundled or not, in the self-answer log, and every bundle is `state.mjs bundle`d; a `base-ci` warning has the
ruling point's choice, the user's answer or an on-behalf answer on record; when `integrate` is `ticket-pr` and the
permission settings do not cover both merge commands, ledger field 5 has the merge authority outcome (yes, refused or
no answer), and when standalone the freeze's questions were asked in one go; `check freeze` passes; when standalone,
both `budget:` lines are set from the frozen ticket count.

## 1. The loop: tick

Each ready ticket runs its own **pipeline**: dispatch → implement → close-out (review, fix, integrate), never batched
or waiting on another. `scripts/tick.mjs` computes what is due, the order within a wake-up and when a dispatch point
fires (its header).

Enter a `/loop` with no interval that paces itself, with the prompt "get-to-work: re-read `<absolute ledger path>` and
the rule files its field 10 lists, then advance the pipeline with tick"; with no ledger, re-read this skill's
`SKILL.md` and `ASKING.md` by absolute path instead. Every wake-up carries that sentence; resuming never relies on
memory.

Each wake-up:

1. `node "${CLAUDE_SKILL_DIR}/scripts/tick.mjs" run <state>`, with one `--reported <agent id>` for each agent whose
   completion notice arrived. Whether its report is taken is tick's call. `run` runs `next` again and again: it runs
   each list's batch-1 execs in bash, in order, and records them, until batch 1 still holds a spawn, a judge, an ask
   or an exec left to you, or `then` is `end` or `done`. The execs left to you are those tick marks `host`: a push to a
   protected branch (main, master or the run's base branch); `run` runs every other exec. Its output is the list that is left, with `ran` naming the execs it ran (id, exit code, the log file of
   their error output; one killed by a signal also has `signal`, and its exit code is recorded as 128 plus the signal
   number: not a normal end) and `lists` giving, in order, each list it made: its `reports`, `reconcile`, `dispatch`,
   `wrote` and the execs run from it. Read the reports taken, the reconciliations and the files written by earlier
   lists there, not only the last one. When `run` exits 1 saying bash cannot be used, run `next` instead this wake-up and run the execs' `command` yourself.

   When the Bash tool moves `run` to the background, wait for it to end and read its output before acting on the
   list. **Never start another `run` before a backgrounded one has ended**, and run no `next` or `record` meanwhile:
   both would write the same state file.

   When `run` exits non-zero, stdout is still JSON: `ran` and `lists` are what it ran and recorded before it stopped,
   and `blocked` is the exec it stopped at (null when it stopped in `next`). With `blocked.at` `execute`, that exec
   did not finish running and nothing of it is recorded; with `record`, it ran (its exit code is `blocked.exit` and
   its side effects happened) and recording it failed. tick keeps that it ran before recording it, so a later `run`
   only records it and does not run it again (unless the state file could not be written at all). The list that
   `run` never handed you does not count its batch-1 spawns as sent: they are handed out again as usual. `run`
   exiting **3** means `blocked`'s record was refused:
   - Do not edit the state by hand. Settle what `error` says, as for a refused `record`: never force it another way.
   - Once settled, run `run` again: it records `blocked` with `blocked.exit` and does not run it a second time
     (when `error` says it is already recorded, nothing is left to record).
   - A refusal you cannot settle is a ruling point: ask, per section 3.

   The output's `do` carries the same handling.
2. Do the `actions`, but send only the ones at `batch` 1 of each list, all in one turn. After each action, run the
   command in its `record` field. Leave the later batches this time: once the actions before them are recorded, they
   are handed out again in a later list (tick counts only a batch-1 background spawn as handed out). Record nothing
   you did not do, and do nothing that was not handed out. `reference` is what that action needs you to read.
   - **exec**: `run` has run them. An exec left in the list carries `host` (a push to a protected branch): run it with
     your own Bash tool, so the user's permission settings see it. Run `command` as written in bash (Git Bash on Windows) and record its exit code. An
     exec with `ran` already ran and was not recorded: do not run it again; handle its `note`, then run the command in
     its `record` field (the exit code is filled in). An exit code not in `okExit` comes
     back in the next list as a `failed` judge, whose `do` names the log file of an exec `run` ran.
   - **spawn**: send the Agent tool the `spawn` fields as they are, adding no rules: the implementation and expansion
     agents' fixed rules are in the plugin's agent definitions (`sorry-matt:implementer`, `sorry-matt:expander`),
     `scripts/brief.mjs` filled the spawn file's values, and its header holds the `description` rule. When the
     `subagent_type` is not in the available list, send the general-purpose agent and prompt of the `fallback` field
     instead (the definition body followed by the same values), with no model and the same `description`, and add
     `--type general-purpose` to the record.
   - **judge**: something for you to decide. Read the `reference`, do what `do` says, and record one of `outcomes`.
   - **ask**: something only a human can rule on: section 3.
3. Once each batch-1 action is recorded, run `run` again, until `then` is `end` or `done` (the run has finished). `end`'s last action closes the wake-up:
   the ledger's narrative fields brought up to date and, while agents are in flight, a **fallback wake-up** —
   `ScheduleWakeup`, else a background `sleep` through Bash with its task id in the record, else the same `/loop` in
   interval mode at the shortest stage time limit.

`record` exiting 3 is a refusal: the result fails the state's guards. Act on the message; never force it another way.

Done when: every wake-up ran `run` (`next` when bash could not be used) to `end` or `done`; each list had only its
batch-1 actions sent; every action `run` left and you did was written back by its `record`; only one `run` ran at a
time; after an exit 3, `run` ran again only once the refusal was settled; nobody edited the state file by hand.

## 2. What tick leaves to you

### Predicted files

The files a ticket will change, one repo-relative path per line (covering everything under it; `/` is the whole
repo), in `sorry-matt/runs/<run>/files/<ticket>.txt`. Sources, in order: paths the ticket text, expansion block and
criteria name; definitions and main uses (`git grep -l`, `git ls-files`) of the modules, skills, commands, settings keys
or identifiers it names; files the repo's rule files (`AGENTS.md`, `CLAUDE.md`…) require to change together, such as
translations. A directory only when the ticket names it whole; `/` only when nothing narrower can be inferred.
**Narrow to a symbol**: when the ticket text or a criterion confines the change to one function, block or markdown
heading of a file, write that line as `path#symbol` (a heading as written, without its leading `#`s); a nested one is
written from the outermost, `path#outer#inner`. Two tickets on the same path that both name a symbol, where neither
symbol chain starts with the other, do not overlap and are not joined at freeze; when either writes the bare path, the
whole file is compared as before. What git can see held (other worktrees, branches, PRs) is always whole files; a
ticket in flight that changes a file it predicted by symbol holds only those symbols. When unsure the change stays
inside the symbol, write the whole file: a wrong guess costs a conflict at integration and a send-back. A path itself
cannot contain `#`, and `/` takes no symbol. **Index
files stay off the list**: files every ticket adds a line to (glossaries, index tables, CI test lists, README tables,
manifest arrays) would make every ticket exclusive; the merge agent keeps both sides' lines. The list only grows: at
expansion, and wider after a send-back.

### Bundles

A bundle exists to save **reviews that are wasted or repeated**: one review surface reviewed once per ticket, the
same observation reported again in each ticket's review, or a review reporting what another ticket would change anyway.
A bundle's tickets are done by one implementation agent on one ticket branch, reviewed once (the review tier judged
on the whole diff) and integrated once; each ticket keeps its identity: criteria name their ticket, and the end state
and merge SHA are the lead's and every member's.

`freeze.mjs` only lists candidates and the overlap evidence (`overlaps`, `edges`, `through`); you rule. When the
connected tickets exceed the cap (the plan's `bundleCap`, 3 by default), the script cuts them in candidate order into
groups, each with `cutFrom` (the whole group); when that cut does not suit, write the tickets you pick in `bundles`
directly, checked against the same cap and conditions.

- **Bundle**: the reviews would read the same code; a later ticket rewrites or removes what an earlier one adds (an
  expand–contract on the same files, say); or reviewing them apart would only repeat the same observation.
- **Do not bundle**: one of them is a delivery the user would want to land on its own; together their criteria clearly
  exceed what one review can cover (about 8; a blocked ticket not yet expanded is estimated from its scope); or one of
  them is unclear enough to hold the rest up — when one is stuck, the whole bundle is.
- A group whose `through` is not empty cannot be bundled whole: only a part that no such path crosses. When unsure, do
  not bundle: one more review costs less than a whole bundle stuck.

A bundle is this run's scheduling only: the tracker's tickets are not merged, closed or rewritten. The lead's status
record carries the bundle's review block; the implementation agent leaves a one-line pointer to it in every other
member's status record. At delivery every member is closed (the aggregate PR and FINISH.md's reconciliation table list
each one).

Stacked with `gh stack`, the bundle is
one layer: a downstream ticket that depends on any member waits for that layer's PR, and `stackParent` and
`waitingOn` name the lead; when judging "exactly one unmerged upstream", several upstreams in one bundle count as
one. <!-- pending #198 -->

### Close-out checks and review

- **Targeted checks**: review only once the affected-scope checks the implementation agent reports are green; red goes
  back to the same agent. Before recording green (fixed, for a fix round a recheck follows), write the report it
  returned, verbatim, to the file the collect names: the review's spawn file takes its targeted checks from there,
  and the record is refused without it.
- **Bundles**: the lead stands for the bundle. The spawn files' ticket face, acceptance snapshot and comparison are the
  whole bundle's, each criterion naming its `ticket`; tick dispatches only once every member has its acceptance
  snapshot and predicted files.
- **Review method**: before the review tick hands out an exec that judges the **review tier** with `prove-it`'s
  `tier.mjs judge` (once per initial review; a recheck and a retry after stuck keep it), then picks the review method
  by the profile's `review`: under `review: minimal` always the minimal review; under `review: full` light gets the
  minimal review — its report file, its `--kind minimal` record and its freshness check, as they are; its record
  takes no counts, and it has no assignment record or time limit — and standard and full get the prove-it review
  below, with the review tier in its spawn file and the counts and assignment record of the two items below. You do
  not judge the tier yourself.
- **Independent review**: tick writes a values file and `brief.mjs review` turns it into the review host agent's
  spawn file — the fixed rules of the sibling [`REVIEWER.md`](REVIEWER.md) followed by this review's values (repo,
  tracker, ticket face, status record, acceptance snapshot, comparison, fixed point, ticket branch, targeted checks and the
  SHA they ran at, CI coverage, review tier, and for a recheck the previous review block) — then hands you a foreground spawn. Send it as the action
  says, filling in no value and adding no rule. It calls `prove-it`; you never load `prove-it`, take only its review
  report (six lines at most), and record its verdict with `--outcome` and the report's `counts:` line as
  `--observations <n> --pre-existing <n>` (both, 0 when there are none; with one missing the record is refused with
  2), and `--candidates <n> --confirmed <n> --invalid <n> --blocking <n>` (#156: all four together, some of them
  refused with 2; none when the report's `counts:` line has none of them), and `--covered <n>` (#205: when the report
  has `covered=`). A minimal review reports blocking findings only and takes none of these counts.
- **Sibling scope**: the prove-it review's spawn file carries `sibling scope`, the run's other tickets not at an end
  state and not in this bundle. What one of them is to do anyway the review rules `covered`: not a finding and not an
  observation — unless it hits `acceptance`, `regression`, `red` or `safety`: each ticket lands on its own.
- **The review's assignment record**: before the spawn tick writes the assignment record (`deadline.mjs record` in the
  ticket worktree with the `timeout-review` limit, then `state.mjs assign`), so the review host agent has a time limit
  like every other agent. When its report comes back with the spawn, record `--agent`, `--outcome` and the counts above;
  when the Agent tool put it in the background and the spawn returned only an agent id, record `--agent` alone (the
  counts are refused with 2 there): it is in flight, tick scans its deadline and schedules the fallback wake-up all the
  same, and when its completion notice arrives you pass it to tick with `--reported`, and a `collect` records the
  verdict, again with `--observations <n> --pre-existing <n>` (refused with 2 when one is missing).
- **Act on the report**: `findings` go to the batched fix. When `observations` or `pre-existing` is not 0, tick hands
  you an `observations` judge: read only those two parts of the review block, file one raw ticket for the line
  ("Filing along the way") and record it with `--value <issue id>`. When a later review on the same line (another
  ticket's, a recheck, a retry) brings more, the judge tick hands out names that raw ticket: the new items go into it,
  not into another, and recording a different id is refused (3). An item at the same location or about the same
  problem is not written again: its sources gain the ticket. One such judge at a time per line. The judge does not
  hold the ticket up: the review's verdict goes on as usual. The spawn file's reviewer is `primary`; `prove-it` adds the specialist reviewer itself by review tier
  (`architecture` at `full`).

### Batched fix

Hand the review block's location to the original agent, which keeps its context: it reads each finding's `summary`,
`evidence` and `fix` verbatim and closes them all in one round; you do not paraphrase. Under `review: minimal`, and for
a ticket whose review tier is light under `review: full`, the review is the minimal review and there is no review
block: hand the original agent the path of the reviewer's report file
(`tick/review/<ticket key>-<tag>.report.md`), not a review block's location, and it reads each finding there verbatim.
The state guards the round limit.

**Hard rail — a flaky red is always run down to its root cause.** Red and green on one commit is a real failure: a
root cause in the test's writing fixes the test; in the product, fix it or file a defect ticket. Reruns, relaxed waits,
retries and longer timeouts are not fixes; no root cause within the fix rounds means stuck.

### Merge conflicts

`integrate.mjs merge` aborts a conflict and exits 4; tick then has you dispatch a **merge agent**. The single source
of the merge-conflict criterion: judge two intents, not two texts. Trace both sides' primary sources (ticket text,
commit messages) first; compatible, keep both (both sides' lines in an index file stay); not, take the side that serves
this merge's goal, landing only behavior one side actually wrote. The merge agent runs `git merge --no-ff --no-edit <ticket branch>` again in the integration worktree,
resolves each hunk and ends with `git commit --no-edit`: the resolution lives only in that merge commit and the ticket
branch is never rewritten. It reports each trade-off, which you log in the self-answer log; when it cannot resolve them
safely it runs `git merge --abort` and the ticket is sent back for a redo. The finish's base sync uses the same
criterion, with the line on one side and the base on the other.

### Filing along the way

Out-of-scope bugs, prefactors, tech debt, flaky reds whose root cause lies out of scope, and the review's `observations`
and `pre-existing` (when tick's `observations` judge hands them out: one ticket per line, each item with its location,
one sentence, evidence path and source ticket; what later reviews on the line bring goes into the same one, duplicates
merged into one item; at the finish tick hands out an `observations-final` judge to mark each item, against the line's
final tip, "still present" or "resolved by <ticket> (<SHA>)") get a raw ticket only, linked back to the source:

- **GitHub**: `gh issue create`, without `ready-for-agent`; the body polished per `ASKING.md` section 6.
- **Local Markdown**: the next unused number by the tracker's convention, `Status` set to `needs-triage`, committed to
  the integration branch of the line that found it and pushed before that wake-up ends when there is an `origin`.

These tickets stay outside the initial set and the frontier.

### References read when reached

When a `judge`'s `reference` points to one of these, read it in full and follow it: red-light handling
[`RED-LIGHT.md`](RED-LIGHT.md), timeouts [`TIMEOUTS.md`](TIMEOUTS.md), send-back and stuck [`SEND-BACK.md`](SEND-BACK.md),
the finish [`FINISH.md`](FINISH.md).

Done when: every fix got the `findings` by location, verbatim; every line with observations or pre-existing items
has exactly one raw ticket, checked item by item against the final tip at the finish; every conflict resolution lives only in its merge commit, its trade-offs logged; every raw ticket links its source and stays out of the frozen set.

## 3. Rulings and stopping

- Mid-run matters take the three exits of `ASKING.md` section 4, and so does an `ask` action: what cannot be answered
  awaits a ruling, what only a human can do goes on the human-work list. Standalone, with no ruling point, unanswerable
  matters are gathered and asked once, before the next dispatch point.
- A spawn the plugin's hook blocks for the budget: no retry, no detour. Set its ticket aside with `state.mjs release`
  and `state.mjs stage awaiting-ruling --reason <the hook's message>`; tick's next limit check stops the run. A blocked
  spawn the finish needs goes on the human-work list.
- tick carries the stop and the finish: after a stop nothing is dispatched, tickets in flight are closed out and the
  undispatched ones await a ruling; once every ticket is at an end state, tick hands out the finish's actions and
  gates, the last `judge` pointing to [`FINISH.md`](FINISH.md).

Done when: every initial ticket is reconciled to exactly one of delivered, stuck or awaiting ruling (`check finish`;
after a stop, `check stopped` too); no spawn blocked by the budget was retried or rerouted.
