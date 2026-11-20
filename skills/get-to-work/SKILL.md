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
   condition.
5. `state.mjs init`; if this run relaxes the flow, write it once here with `state.mjs profile` (`ASKING.md` section 4;
   when composed, the one written at the ruling point stands). `state.mjs add` each line's tickets,
   `state.mjs line --lines` for the joined lines, then `scripts/integrate.mjs line-init` for each line.
6. When `docs/agents/commands.md` does not exist, generate it by the generation rules of `ASKING.md` section 0 and
   commit it on each line's integration branch (subject without a ticket ID), never on the user's current branch.
7. Standalone, rewrite `budget: spawns` and `budget: rounds` in ledger field 9 from the frozen ticket count per
   `ASKING.md` section 4.
8. `tick.mjs setup`, then `state.mjs check <state> freeze --base <base>`; on exit 4, put right every item it lists
   and rerun. Section 1 starts once it passes.

**Hard rail**: the frozen initial set never grows; tickets found or filed during the run are background only.

Done when: the tracker mode is chosen and verified; every initial ticket has its publication source, tracker-native
identifier and blocker map; every excluded ticket has its holder and release condition; `check freeze` passes; when
standalone, both `budget:` lines are set from the frozen ticket count.

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
   each list's batch-1 execs (`push` aside) in bash, in order, and records them, until batch 1 still holds a spawn, a
   judge, an ask or a `push`, or `then` is `end` or `done`. Its output is the list that is left, with `ran` naming the
   execs it ran (id, exit code, the log file of their error output). When `run` exits 1 saying bash cannot be used,
   run `next` instead this wake-up and run the execs' `command` yourself.
2. Do the `actions`, but send only the ones at `batch` 1 of each list, all in one turn. After each action, run the
   command in its `record` field. Leave the later batches this time: once the actions before them are recorded, they
   are handed out again in a later list (tick counts only a batch-1 background spawn as handed out). Record nothing
   you did not do, and do nothing that was not handed out. `reference` is what that action needs you to read.
   - **exec**: `run` has run them. An exec left in the list is a `push`, left for you so the guard hook sees it: run
     `command` as written in bash (Git Bash on Windows) and record its exit code. An exit code not in `okExit` comes
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
batch-1 actions sent; every action `run` left and you did was written back by its `record`; nobody edited the state
file by hand.

## 2. What tick leaves to you

### Predicted files

The files a ticket will change, one repo-relative path per line (covering everything under it; `/` is the whole
repo), in `sorry-matt/runs/<run>/files/<ticket>.txt`. Sources, in order: paths the ticket text, expansion block and
criteria name; definitions and main uses (`git grep -l`, `git ls-files`) of the modules, skills, commands, settings keys
or identifiers it names; files the repo's rule files (`AGENTS.md`, `CLAUDE.md`…) require to change together, such as
translations. A directory only when the ticket names it whole; `/` only when nothing narrower can be inferred. **Index
files stay off the list**: files every ticket adds a line to (glossaries, index tables, CI test lists, README tables,
manifest arrays) would make every ticket exclusive; the merge agent keeps both sides' lines. The list only grows: at
expansion, and wider after a send-back.

### Close-out checks and review

- **Targeted checks**: review only once the affected-scope checks the implementation agent reports are green; red goes
  back to the same agent.
- **Independent review**: fill in the sibling [`REVIEWER.md`](REVIEWER.md) and spawn one review host agent in the
  foreground. It calls `prove-it`; you never load `prove-it` and take only its review report (six lines at most). CI
  coverage is `no-origin`, `uncovered` (settled as CI not covering the integration branch) or `covered`.
- **Act on the report**: `findings` go to the batched fix; when `observations` or `pre-existing` is not 0, read only
  those two parts of the review block and file one raw ticket for them ("Filing along the way"). A ticket has this one
  reviewer by default; add a specialist reviewer only for a concrete risk, named and logged in the self-answer log —
  "another look would be safer" is not a risk.

### Batched fix

Hand the review block's location to the original agent, which keeps its context: it reads each finding's `summary`,
`evidence` and `fix` verbatim and closes them all in one round; you do not paraphrase. The state guards the round
limit.

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
and `pre-existing` (one ticket per reviewed ticket, each item with its location, one sentence and evidence path; those a
recheck brings go into the same one) get a raw ticket only, linked back to the source:

- **GitHub**: `gh issue create`, without `ready-for-agent`; the body polished per `ASKING.md` section 6.
- **Local Markdown**: the next unused number by the tracker's convention, `Status` set to `needs-triage`, committed to
  the integration branch of the line that found it and pushed before that wake-up ends when there is an `origin`.

These tickets stay outside the initial set and the frontier.

### References read when reached

When a `judge`'s `reference` points to one of these, read it in full and follow it: red-light handling
[`RED-LIGHT.md`](RED-LIGHT.md), timeouts [`TIMEOUTS.md`](TIMEOUTS.md), send-back and stuck [`SEND-BACK.md`](SEND-BACK.md),
the finish [`FINISH.md`](FINISH.md).

Done when: every fix got the `findings` by location, verbatim; every ticket with observations or pre-existing items
has one raw ticket; every specialist reviewer names its risk; every conflict resolution lives only in its merge commit,
its trade-offs logged; every raw ticket links its source and stays out of the frozen set.

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
