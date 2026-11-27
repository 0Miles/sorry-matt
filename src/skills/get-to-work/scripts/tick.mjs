#!/usr/bin/env node
// tick: the action list of one wake-up of get-to-work's pipeline. It reads the run state (state.mjs), git and the
// files of the run directory, and says what the host does now: which agent reports to take and which to ignore,
// which agents to extend or stop, which ticket to integrate, whether a dispatch point runs and what it dispatches,
// what the finish does, and how long the fallback wake-up waits. Every action points to the reference it needs.
// The host runs the actions and writes each result back with `tick.mjs record`; `tick.mjs run` does that for the
// exec actions but those marked `host` (a push to a protected branch). tick spawns nothing and stops no agent. `next` and `record`
// run no network call and change no branch; `run` executes exec actions, which may reach the network (ci.mjs, gh)
// and merge branches (integrate.mjs).
// No dependencies: runs on a bare Node 20+ with git on PATH (and, for `run`, bash).
//
// Usage
//   node tick.mjs setup  <state> --tracker github|local --root <repo working tree> --base <base branch>
//                        [--repo <owner>/<repo>] [--ledger <ledger.md>] [--tickets-dir <repo-relative dir>]
//                        [--worktrees <dir>] [--spec <identifier or path>]
//   node tick.mjs next   <state> [--reported <agent id>]... [--now <UTC>]
//   node tick.mjs run    <state> [--reported <agent id>]... [--now <UTC>]
//   node tick.mjs record <state> <action id> [flags] + <action id> [flags]…   (several results in one call, in order)
//   node tick.mjs record <state> <action id> [--exit <code>] [--outcome <word>] [--agent <id>] [--type <agent type>]
//                        [--value <text>] [--findings <id>,<id>] [--fixed <id>,<id>] [--unfixed <id>,<id>]
//                        [--observations <n>] [--pre-existing <n>]
//                        [--candidates <n> --confirmed <n> --invalid <n> --blocking <n>] [--covered <n>] [--now <UTC>]
//
// setup writes the run's configuration into the state file once at the freeze (again to change it; the bookkeeping
// below is kept). `--repo` is required with github, `--tickets-dir` (where the ticket files are, e.g.
// `.scratch/feat/issues`) with local. `--ledger` is where the `budget:` lines are read (limits and stage time
// limits; the defaults of ASKING section 7 without it). `--worktrees` is the directory the ticket worktrees are made
// in, default `<root>/../<root name>.worktrees/<run>`. `--spec` goes into the expansion brief (default none).
//
// What tick reads, and which side wins
//   The state file is the source of truth for stages, reviews, assignments, merge SHAs and usage. git is the source
//   of truth for branches: when the two disagree, tick follows git and says so in `reconcile`:
//   - a ticket queued or integrating whose branch is already merged into its target is not merged again: tick
//     gives `integrate.mjs merge` once more, which finds that merge and does what is left (record, delivery
//     record, delivered, push, cleanup). Merged means: with the ticket branch present, `git merge-base --is-ancestor
//     <ticket branch> <target>` and a first-parent merge of the target that brought it in; with the branch gone, a
//     first-parent merge matched by the rules of merges.mjs (the header of review-guide.mjs).
//   - an integration branch whose tip differs from the state's `tip` (another ticket's merge, a host commit) gets
//     the state's tip moved to git's; CI evidence for the old SHA no longer counts.
//   - a delivered ticket whose recorded merge SHA is not in its target's history is asked about (`ask`): a ruling,
//     not a guess.
//   The target of a line is its integration branch, or the base branch under profile `integrate: direct`.
//
// The profile (state.mjs `profile`) trims the list; the host never learns of the steps left out:
//   review: minimal  every ticket gets the minimal review, and no review tier is judged (below): one reviewer `spawn`
//                    (foreground, description `review <ticket>`, the role word of brief.mjs) instead of the review
//                    host's spawn (below), with a brief tick writes: the ticket text's file (fetched
//                    again first on GitHub; the spawn waits for it), the acceptance source (the snapshot's `items`, or
//                    the ticket text as expand: skip has it below), blocking findings only, `verdict: pass | fix`, the
//                    full report written to `tick/review/<ticket key>-<tag>.report.md` beside the brief and also
//                    returned. `record review:…` is refused (3) when that file is missing or empty with
//                    `--outcome fix`, or, when it is there, its `verdict:` line is missing or not the outcome, or it
//                    was written before this round's review spawn was first issued (`issued.<id>.at`, written once
//                    per round: the initial review, each recheck and each retry; the same spawn handed out again by
//                    one more `next` keeps it; an interrupted round's file): the host writes the report returned this
//                    round there verbatim. The fix round (send, the
//                    note of a new agent), file-issue and mark-stuck name that file as the findings' source, not the
//                    status record's review block
//   recheck: false   after a fix round, the fix report leads straight to queued (or to the issue for unfixed ones)
//   onUnfixed: file-issue  findings still open → a `judge` to file a raw issue; queued only once its id is recorded
//   expand: skip     no expansion; a ticket whose snapshot has no criteria goes on with its own text (brief.mjs is
//                    given `acceptance: ticket-text`, so the spawn file says the ticket text is the acceptance); one
//                    with criteria (the ticket's own, or a previous run's expansion block) keeps them: `criteria`
//   ci: skip         no CI read and no local verification, in the pipeline or at the finish
//   simplify: false  no simplify agent at the finish. Otherwise each line's finish starts with one simplify `spawn`
//                    (foreground, general-purpose, description `simplify <line>`, the role word of brief.mjs) with a
//                    brief tick writes under `tick/simplify/`: the integration worktree, the line's whole diff, and the
//                    rule to judge first (skip only documentation, only deletions, only configuration or data files,
//                    or no new logic; simplify new or rewritten logic that may hold a duplicate implementation, a
//                    reusable function, a branch or a layer of indirection that can go; when unsure, simplify; no
//                    line-count threshold). The agent reports applied (one commit `refactor: simplify <line>`), none
//                    or skipped, with a one-line reason; the wrap-up lists the skipped lines and their reasons
//                    (`meta.simplifySkipped`) for the closing summary and the self-answer log
//   integrate: direct  merges go into the base branch; the finish neither syncs the base nor opens aggregate PRs
//   integrate: ticket-pr  every ticket is its own pull request (#193, #195) and walks its own merge through the
//                    waiting stages awaiting-ci and awaiting-merge (#196, stepPrMerge); the finish has no line
//                    delivery (no simplify pass, base sync or full verification: the PR head's CI stood in).
//                    A red PR head belongs to this ticket alone (#197, prAwaitCi): no earliest-red scan — the
//                    failing runs' output is saved with `gh run view <id> --log-failed` (the ids from the verdict's
//                    `failed` field) and the ticket goes to a fix round for its original agent (the ticket's
//                    fix-round cap and the timeout-fix limit as ever); the fix commit is pushed to the same PR by
//                    stepTicketPr and the verdict read again at the new head. A base that turns red after a merge
//                    is a base-red episode (#197, prBaseRed): the earliest-red scan runs against the base, the red
//                    is mapped to the causing ticket by merge order and merge SHA, and integrate.mjs revert opens a
//                    revert PR (never a base push), merged as a prompting call once its own CI is green.
//                    Upstreams (#198, prUpstreams): only a merged ticket is done upstream. A ticket with exactly
//                    one unmerged upstream in this run (a bundle counts once) is stacked on it — stackParent, cut
//                    from the upstream branch, its PR by gh stack submit — when freeze.json's gh-stack check passed
//                    and no other live ticket is stacked on that upstream; any other waits at waiting-upstream
//                    (waitingOn) until its upstreams are merged, then starts from the new base. gh stack missing
//                    brings one `gh-stack-missing` judge (the install on the human-work list).
//                    A stack merges from the bottom up (#199): a stacked ticket walks the merge path once the ticket
//                    below it has merged (its fixed point is then origin/<base>), its push phase (gh stack sync) only
//                    while no agent is at work in its stack, and a PR in a stack merges with `gh stack merge <PR>
//                    --yes --squash`. Review freshness: the stacked ticket's own patch-id (integrate.mjs patch-id) is
//                    taken when its review passes and again after the sync; the same id keeps the review, any other
//                    is a recheck (integrating → in-review, the initial review's tier) — as is a base sync whose
//                    conflict a merge agent resolved.
//                    The finish (#200): the finish gate (no line checks), one `pr-polish` judge per PR left for a
//                    person, and the wrap-up with `meta.tickets` (the reconciliation rows: PR link, stack, merge
//                    state, PR head CI) and `meta.humanWork` (the merges left for a person, a stack's bottom first)
//
// The review tier picks the review (#139)
//   Under review: full, before a ticket's review tick hands out an exec of prove-it's `tier.mjs judge --base <fixed
//   point> --head <ticket branch>` in the repo (step `tier`, stdout `tick/tier/<ticket key>-<k>.json`, k the number
//   of the initial review). It is judged at each initial review; a recheck, and a retry after stuck, keep the tier of
//   the initial review they follow. light gets the minimal review as review: minimal has it (its report file, its
//   `--kind minimal` record, its freshness check); standard and full get the prove-it review below, with that output
//   as the values file's `tier`. An output that cannot be read counts as full, with `tier` null: prove-it judges it.
//   The review is recorded with `--tier` (state.mjs review; for a review host that went to the background, by its
//   collect): under review: full a minimal review lets the ticket queue only with tier light. A light ticket's minimal
//   review is a minimal review throughout: its record takes no counts (#142), and it has no assignment record or time
//   limit (#143); those go with the prove-it review.
//
// The review (#138)
//   A ticket in review whose review is the prove-it review gets the review host agent: an exec of `brief.mjs review` with the values
//   file tick writes (`tick/review/<ticket key>-<tag>.values.json`: mode, repo, tracker, ticket face, status record,
//   acceptance snapshot, comparison, fixed point, ticket branch, targeted checks, CI coverage, previous review block,
//   reviewer, scratchpad, review tier — their keys in the header of brief.mjs), then a foreground `spawn` (step `review`,
//   general-purpose, description `review <ticket>`, outcomes pass | fix | stuck) whose prompt is to read that spawn
//   file: nothing is left for the host to fill in, and the diff and the review's output stay with the review host.
//   Record it with `--agent`, `--outcome` (`--findings` with fix) and the counts of its report's `counts:` line,
//   `--observations <n> --pre-existing <n>` (#142: both required, exit 2 without; a minimal reviewer's record takes
//   neither, exit 2 with either), and `--candidates <n> --confirmed <n> --invalid <n> --blocking <n>` (#156: all four
//   or none, under the same rules; state.mjs keeps them on the review, null without). The review is also recorded
//   with the reasons of its tier.mjs judge output, one `--tier-reason` each and whole (#156, #173: a reason with a space
//   or a comma is passed as it is). The targeted checks come from the report of the
//   round under review: the collect of an implementation round (and of a fix round a recheck follows) names
//   `tick/report/<ticket key>-<assigned>.md`, and record green / fixed is refused (3) until that file holds the
//   report with its `targeted checks:` line. A ticket in review with no such file on record (a timeout's collected
//   report, a state from before) gets an `agent-report` judge to write it first, refused the same way. The status
//   record is the host's `state.mjs set --status-record` when there is one, else the ticket's comment that starts with
//   `<!-- sorry-matt:status -->` (GitHub) or the ticket file in the ticket worktree (Local Markdown); the scratchpad
//   is `<worktrees>/review/<ticket key>`; the reviewer is primary.
//   The review host has an assignment record like every other agent (#143): before its spawn, `deadline.mjs record` in
//   the ticket worktree with the `timeout-review` limit and `state.mjs assign` (`--reassign` for the review handed out
//   again after a timeout, its tag ending `-t`). Recorded with `--outcome` (it returned its report), the assignment is
//   named, released and the agent collected at once. Recorded with `--agent` alone (the Agent tool put it in the
//   background), it is in flight: the ticket gets no other review action, the deadline scan covers it and the
//   wake-up ends with the fallback wake-up; its completion notice (`--reported`) brings a `collect` (stage in-review,
//   outcomes pass | fix | stuck, `--findings` with fix) that records the review, with `--observations <n>
//   --pre-existing <n>` as for the spawn (#142: both required, exit 2 without; the record of a spawn that went to the
//   background takes neither, exit 2 with either). An overdue one is a `timeout` judge
//   per TIMEOUTS.md: reassign once (in-review counts in `timeoutReassignments`), then stuck; awaiting-ruling; or
//   collected, which leaves it in flight and brings the collect next.
//
// A wake-up
//   The host runs `run` (with `--reported` for each agent whose completion notice arrived; `next` when bash cannot be
//   used), sends only the actions at batch 1 of the list, records each, and runs `run` again; the later batches are handed out again by the lists
//   after it, once what they wait for is recorded (#128). It goes on until `then` is "end": the last action is then
//   the wake-up's closing one (ledger narrative and the fallback wake-up), and recording it starts the next wake-up.
//   `then` "done" means the run is over (the finish's wrap-up was recorded).
//   Order within a wake-up: reports; red lines (CI read, red-light handling); the deadline scan; each ticket by its
//   stage (in-review, fixing, implementing, expanding, then the integration queue per target); the dispatch point,
//   only when nothing else is left to do and at most once per wake-up; the finish once every ticket is at an end
//   state.
//   A dispatch point runs when: it is the first; since the last one a ticket was merged or delivered, went stuck or
//   awaiting ruling, was sent back, or came back from expansion; a red line turned green or a line failed
//   verification; or no ticket is in flight while candidates remain. It is: usage and the progress check
//   (deadline.mjs progress; a stop ends the dispatching for good), CI per line, frontier.mjs, stalled tickets to
//   awaiting ruling, acceptance per candidate (expansion for those with no criteria), the snapshot, predicted
//   files, overlap.mjs, and a ticket branch, brief and implementation agent for each `start` ticket.
//   A line on local verification (no `origin`, or settled as CI not covering it) has no CI read and no local
//   verification at a dispatch point: its full suite runs once, at the finish (#141). When that is red, the
//   earliest-red scan runs before the red-light judge: the line's integration SHAs (the ticket merges the state
//   records, in first-parent order) are verified one at a time from the oldest, each in a detached worktree
//   `<worktrees>/<line-slug>-at-<sha12>` (git worktree add, verify.mjs, git worktree remove --force), until one is
//   red; the judge names that SHA (meta.earliestRed), or the tip when none is red. A fix round's new tip is
//   verified before anything else; a green record at the tip ends the red light.
//
// Observations and pre-existing (#142)
//   A review recorded with observations or pre-existing above 0 (state.mjs keeps both counts on the review) gets a
//   `judge` (step `observations`, id `observations:<ticket>:<review number>`, outcome `filed` with `--value <issue
//   id>`): read only those two sections of its review block and file one raw ticket (SKILL.md, Filing along the way).
//   It does not hold the ticket up: the verdict's stage move is in the same list. One judge per such review, in review
//   order, the next handed out once the one before is recorded; once a raw ticket is on file for the ticket (tick's
//   flag `observationsIssue`), the judge names it, the new items go into it, and `filed` with another id is refused
//   (3). The wrap-up waits for the filings in its list.
//
// A red light that maps to no ticket (#144)
//   The `red-light` judge (RED-LIGHT.md) has the outcome `unmatched` while the line has a fix round left (two per red
//   episode): the host writes the failing lines to the file the judge's `meta.failure` names (record is refused, 3,
//   while it is missing or empty) and records it. tick then hands out the line's ci-fix: `deadline.mjs record` in the
//   integration worktree with the `timeout-fix` limit, `state.mjs assign --line` (the assignment record is the line's,
//   `lines[<line>].assignment`), and a background general-purpose spawn, description `ci-fix <line>`, whose brief tick
//   writes to `tick/ci-fix/` (the worktree, the red SHA, the failing lines, the round; commit with no ticket id, no
//   push). While that assignment is in flight the line gets no red-light judge, push or CI read, and the finish waits
//   for it; the deadline scan covers it and gives the fallback wake-up. Its report is a `collect` (fixed | blocked);
//   an overdue stop is a `timeout` judge (stopped | failed | collected) per TIMEOUTS.md. Either way the round is over:
//   a new commit is pushed and read as any tip is; no new commit (blocked, or stopped and reset to the assignment's
//   HEAD) brings the red-light judge again at the same SHA (id suffix `:r<round>`). With both rounds used the judge has
//   no `unmatched`: record failed.
//
// Output of next (stdout, JSON, format "sorry-matt/tick@1"; fields are only ever added, never renamed)
//   { "format": "sorry-matt/tick@1", "command": "next", "run": "<run>", "wakeup": <n>, "now": "<UTC>",
//     "profile": { ...the effective profile },
//     "reports":   [{ "agent": "<id>", "accepted": true | false, "tickets": [<ticket>],
//                     "why": "current" | "duplicate" | "superseded" | "stopped" | "unknown",
//                     "line"?: "<integration branch>" }],       // a line's ci-fix agent: no tickets
//     "reconcile": [{ "ticket" | "line": "<id>", "state": "<what the state says>", "git": "<what git says>",
//                     "follow": "git" | "ruling" }],
//     "dispatch":  null | { "round": <n>, "reasons": ["<why>"], "closed": true | false },
//     "wrote":     ["<file tick wrote: a plan, a values file, an acceptance snapshot>"],
//     "actions":   [<action>],
//     "fallback":  null | { "deadline", "seconds", "scheduleWakeup" },     // deadline.mjs scan's, for this wake-up
//     "then":      "tick" | "end" | "done" }
//   An action:
//   { "id": "<stable id>", "kind": "exec" | "spawn" | "judge" | "ask", "step": "<registry name>",
//     "batch": <n>,                       // the host sends batch 1, all in one turn; n > 1 comes again in a later list
//     "after": ["<action id>"],           // the ones it waits for (this list only)
//     "tickets": [<ticket>], "line": "<integration branch>" | null,
//     "reference": [{ "path": "<file>", "part": "<where in it>" } | { "skill": "<name>", "part": "…" }],
//     "record": "<the record command to run afterwards, with <placeholders>>",
//     exec:  "argv": [...], "command": "<one POSIX shell line>", "stdout": "<file>" | null, "cwd": "<dir>" | null,
//            "okExit": [0, …]             // run it in bash (Git Bash on Windows); record its exit code
//            "ran": { "exit", "signal"?, "log" }, "note"   // only on one `run` ran and could not record (#146): do
//                                         // not run it again; its `record` line carries the exit
//     spawn: "spawn": { "subagent_type", "description", "prompt", "background": true | false,
//                       "fallback": { "subagent_type": "general-purpose", "prompt" } }   // implement and expand only
//            when `subagent_type` (sorry-matt:implementer, sorry-matt:expander) is not an available agent type, the
//            host sends `fallback`'s type and prompt instead (the definition body followed by the values, written by
//            brief.mjs) with the same description, and records the spawn with `--type general-purpose`
//     judge, ask: "do": "<what to settle>", "outcomes": ["<word>"] }
//   The same id is never issued for a different thing; an action the host already recorded is not issued again.
//   Every exec's `stdout` directory exists when `next` returns, later batches' included, so the redirect of its
//   `command` does not fail (deps.mkdir).
//   A background spawn handed out before at batch 1 (the state keeps each action's batch), runnable then
//   (everything it waited for done) and still not recorded means the host was interrupted between the spawn and its
//   record: it comes back as a `judge` (step "spawn-check": is that agent running? `spawned` with `--agent`, or
//   `none` to have the spawn issued again), never as a second spawn. One listed at a later batch was never handed
//   out, and is issued again as the same spawn. A foreground spawn (the review host, the minimal reviewer, the
//   simplify agent) ends with the host's turn, so it is issued again as it is.
//
// record
//   Writes back one action's result. exec: `--exit <code>` (an exit not in `okExit` makes the next list carry a
//   `judge` to settle the failure). spawn: `--agent <id>` (the reviewer spawn also `--outcome` and `--findings`, and the
//   prove-it review `--observations` and `--pre-existing`, all of which the prove-it review host's leaves out when it
//   went to the background: its collect takes them instead; the simplify spawn also `--outcome applied|none|skipped`
//   and `--value <one-line reason>`).
//   judge and ask: `--outcome <one of outcomes>`, with what the outcome needs: `--agent` for a spawn the judge did,
//   `--value` for a reason, an issue id or a task id, `--findings` with a review's fix, `--fixed` / `--unfixed` with
//   a fix report under `recheck: false`, `--type` when the spawn had to use another agent type. The state writes
//   that follow from it (release, stage, review, report, agent, local, usage…) go through state.mjs, so its guards
//   hold; recording the same result twice changes nothing, a different result for a recorded action is refused.
//   Output: { "format", "command": "record", "id", "applied": ["<state.mjs command run>"], "wakeup" }
//
// run
//   `next`, then the exec actions at batch 1 of its list, in list order, each through deps.execute (`bash -c
//   <command>`) and recorded with its exit code by the same path as `record --exit`; then `next` again, but only when
//   batch 1 held nothing but such execs and `then` is "tick". `--reported` goes to the first `next` only. Without
//   `--now`, each `next` and record reads the clock again (the deadline scan and the fallback wake-up are of the time
//   that list is made). It stops after a list whose batch 1 holds a spawn, a judge, an ask or an exec left to the host,
//   or whose `then` is "end" or "done": the host's actions. It records no wakeup-end. An exec is left to the host when
//   it carries `host: true`: a push to a protected branch (main, master or the run's base branch), which the host runs
//   with its own Bash tool, under the user's own permission settings. A push of a line has no `host`, and run
//   pushes it. tick sets `host` itself; it reads no hook. An exit not in `okExit` is recorded as it
//   is; the next list carries its `failed` judge, which stops run; nothing is retried. An exec killed by a signal
//   is no normal end: it is recorded as 128 + the signal number (no `okExit` holds it) and its log says so.
//   Each exec's stderr (and its stdout when its `stdout` is null) goes to `<run>/tick/run/<action id as a file
//   name>.log`, which the `failed` judge names.
//   Each exec is kept as run (`tick.ran`) before its record: when the record fails, `next` lists it first with `ran`,
//   and the next `run` records it with that exit without running it again (unless the state could not be written at
//   all). Its own lists' batch-1 spawns count as handed out only once run returns the list: when run fails, the
//   next list hands them out again as spawns, not as spawn-checks.
//   Output: the last `next` output with "command": "run", its `actions` less the execs run (batches are not
//   renumbered), plus "ran": [{ "id", "exit", "signal"?, "log" }] in the order run, and "lists": one entry per list made, in
//   order, the last being the output's own: [{ "now", "reports", "reconcile", "dispatch", "wrote", "ran": ["<id run
//   from that list>"] }] (#147): what an earlier list took, reconciled, dispatched and wrote is not lost.
//   A non-zero exit after run started (exit 1: an error; 3: a refusal; 2: a usage error from record or next) still
//   prints JSON on stdout, the message on stderr as ever:
//   { "format", "command": "run", "exit": <code>, "error": "<message>", "ran": [...], "lists": [...],
//     "blocked": null | { "id", "step", "at": "execute" | "record", "exit": <code> | null, "log", "record" },
//     "do": "<what to do>" }                                  // "do" only with exit 3 at blocked's record
//   `ran` and `lists` are what it ran and recorded before it stopped. `blocked` is the exec it stopped at (null when
//   it stopped in `next`): at "execute", it did not finish running and nothing of it is recorded; at "record", it ran
//   (`exit`, side effects included) and its record failed. Exit 3 is `record` refused at blocked: do not edit the
//   state; settle what `error` says as for a refused record, then run `run` again, which records blocked with its
//   exit and does not run it again (nothing is left to record when `error` says it is already recorded); a refusal
//   that cannot be settled is a ruling point.
//   bash must start, and on win32 be Git Bash, MSYS or Cygwin (`uname -s`): WSL's bash flattens Windows paths. When
//   it is not, run exits 1, `blocked` at "execute" of its first exec; what it recorded before stays.
//
// Flags
//   A flag's value is the token after it, unless that token is missing or starts with `--`: `--reported --now <UTC>`
//   is "--reported needs a value" (exit 2), never `--now` taken as an agent id. A value starting with one dash (`-1`)
//   is a value.
//
// The bookkeeping lives in the state file under `tick` (state.mjs keeps keys it does not know), written only by
// this script: { "format", "config", "wakeup", "inbox": [agent ids reported, not yet taken],
//   "agents": { "<id>": { "tickets", "line"?, "role", "type", "status": "current" | "collected" | "stopped", "at" } },
//   "issued": { "<action id>": {…, "held"?: true} },   // held: a batch-1 spawn of a list run has not returned (#146)
//   "done": { "<action id>": { "at", "exit"?, "outcome"?, "value"?, "log"? } },
//   "ran": { "<action id>": { "exit", "signal"?, "log", "at", "argv", "stdout", "cwd" } },  // run ran it, not recorded
//   "flags": { "<ticket>": {…} }, "failed": { "<line>": "<UTC>" },
//   "red": { "<line>": { "sha", "at", "ciFix"?: { "round", "status": "pending" | "dispatched" | "ended", "sha",
//                                                  "failure" } } },     // the ci-fix of a red light with no ticket
//   "baseRed": { "sha", "at", "n", "sent"?, "left"?, "settled"? } | absent, "baseRedN": <n>,
//   "baseSeen": { "tip", "verdict" } | absent,     // #197: the base-red episode under integrate: ticket-pr; n counts
//                                                  // episode instances (it keys the fetch and the unmatched judge);
//                                                  // baseSeen is the last base read and the tip it was taken at
//   "expansions": { "<round>": [<ticket>] }, "dispatches": { "<ticket>": <n> },
//   "dispatch": <open dispatch point> | null, "lastDispatch": {…} | null, "finished": "<UTC>" | null }
// So a resumed host needs nothing but the state file, the ledger and git: `next` gives the same list again.
//
// The registry (OPERATIONS below) holds one builder per operation the host is handed, each an `exec` of the script
// that owns it: integrate.mjs ticket-init (the ticket branch and worktree, the branch recorded) and merge (merge,
// record, Local Markdown delivery, delivered, push, cleanup; a conflict aborts and exits 4, and the ticket goes to
// a merge agent, after whose commit the same command is run again), verify.mjs (local verification and its per-SHA
// record; exit 4 asks the host for the checks, exit 5 skips the SHA this wake-up), and the gates of state.mjs check
// (`stopped` and `finish` before the wrap-up; `finish` only under the profile's integrate: aggregate-pr and ci: read,
// which is what gates.mjs's finish assertions assume). A gate that fails exits 4: the next list carries the
// `failed` judge, and the host puts right what the gate's output lists before retry.
//
// Files: the run directory is `<state dir>/<run>/` (`acceptance/`, `files/`, `overlap/`, `sendback/` as SKILL.md
// names them); tick's own plans and outputs go under its `tick/`. On GitHub the ticket face every spawn file embeds is
// `tick/body/<n>.md`: tick writes it from `gh issue view --json title,body,comments` (saved beside it as
// `tick/body/<n>.json`): the title, the body, the comments, then the expansion blocks. In Local Markdown it is the
// ticket file itself.
//
// Exit codes: 0 output written; 1 the state, the ledger or git could not be read, a state write failed, or (run) bash
// could not be used; 2 bad arguments; 3 refused (record of an action not issued, an outcome not allowed, a state.mjs
// refusal).
// On 1, 2 or 3 nothing is written to stdout.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { constants as osConstants } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { UsageError, parseJson, failure, runIfEntry } from './cli.mjs';
import { load, update, main as stateMain, TERMINAL, profileOf, FINDING_COUNTS, isText } from './state.mjs';
import { main as deadlineMain } from './deadline.mjs';
import { ticketOwners } from './merges.mjs';
import { description as roleDescription, fallbackPath, AGENT_TYPES, reportField } from './brief.mjs';
import { MARKER } from './acceptance.mjs';

export const FORMAT = 'sorry-matt/tick@1';
const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const SKILL = dirname(SCRIPTS);
const SELF = join(SCRIPTS, 'tick.mjs');
const js = (name) => join(SCRIPTS, name);
// prove-it's tier.mjs (#139): tick judges the review tier before the review, from this skill's sibling.
const TIER_SCRIPT = resolve(SKILL, '..', 'prove-it', 'scripts', 'tier.mjs');
const TIERS = ['light', 'standard', 'full'];
// `agents/<name>.md` is a plugin agent definition, two levels up from this skill (src: src/agents; dist: agents).
const doc = (file, part) => ({
  path: file === 'ASKING.md' ? resolve(SKILL, '..', 'have-it-all-done', 'ASKING.md') : file.startsWith('agents/') ? resolve(SKILL, '..', '..', file) : join(SKILL, file),
  part,
});

// Protected branches: main, master and the run's base branch. A push to one is marked `host`: `run` leaves it to the
// host's own Bash tool (#129, #146), as integrate.mjs leaves its push of one (isProtected there).
const isProtected = (c, branch) => branch === 'main' || branch === 'master' || branch === c.cfg.base;

const BUSY = ['expanding', 'implementing', 'in-review', 'fixing', 'queued', 'integrating', 'awaiting-ci'];
const IN_FLIGHT = ['implementing', 'in-review', 'fixing', 'queued', 'integrating', 'awaiting-ci'];
// #196: a ticket at awaiting-merge holds no in-flight slot (it blocks no dispatch point), but its planned files
// stay occupied in dispatch file-overlap until the merge lands.
const OCCUPIES = [...IN_FLIGHT, 'awaiting-merge'];
export const LIMIT_DEFAULTS = Object.freeze({
  spawns: 200,
  rounds: 40,
  hours: 12,
  'no-progress': 3,
  'timeout-implement': 30,
  'timeout-fix': 20,
  'timeout-expand': 15,
  'timeout-merge': 15,
  'timeout-review': 60,
  'wake-check': 20, // the fallback wake-up's longest wait, minutes
});
// The ledger's `budget: <name> <integer>` line, in the shape hooks/runs.mjs reads it.
const BUDGET_LINE = /^\s*(?:[-*+]\s+)?(?:`\s*)?budget:\s*(?:`\s*)?([a-z][a-z-]*)\s+(\d+)\s*(?:`\s*)?$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const formatTime = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** The command is well-formed but not allowed: exit 3. */
class Refused extends Error {}

// ---- small helpers --------------------------------------------------------------------------------------------------

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const keyOf = (id) => String(id).replace(/^#/, '').replace(/[\\/:*?"<>|\s#]+/g, '_');
const numOf = (id) => String(id).replace(/^#/, '');
const slugOf = (text) => String(text).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
const hist = (t) => t.history.length;
const lastEntry = (t, stage) => t.history.findLastIndex((h) => h.to === stage);
const currentReview = (t) => {
  const r = t.reviews.at(-1);
  return r && r.after > lastEntry(t, 'in-review') ? r : null;
};
const currentReport = (t) => {
  const r = t.fixReports.at(-1);
  return r && r.after > lastEntry(t, 'fixing') ? r : null;
};
const list = (text, where) => {
  const items = String(text).split(',').map((x) => x.trim()).filter(Boolean);
  if (!items.length) throw new UsageError(`${where}: expected comma-separated ids`);
  return items;
};

/** One POSIX shell word. */
const q = (s) => (/^[A-Za-z0-9_/.:=@%+,-]+$/.test(String(s)) ? String(s) : `'${String(s).replace(/'/g, `'\\''`)}'`);
const commandLine = (argv, stdout, cwd) => `${cwd ? `cd ${q(cwd)} && ` : ''}${argv.map(q).join(' ')}${stdout ? ` > ${q(stdout)}` : ''}`;

/** The run directory `<state dir>/<run>/`; tick's own files are under its `tick/`. */
const runDir = (path, run) => join(dirname(path), run);

function readJsonFile(deps, path) {
  try {
    return parseJson(deps.read(path));
  } catch {
    return null;
  }
}

// ---- git ------------------------------------------------------------------------------------------------------------

/** One row per ref of `git for-each-ref`: its name, object type, object and the worktree it is checked out in. */
const REF_FORMAT = ['%(refname)', '%(objecttype)', '%(objectname)', '%(worktreepath)'].join('%00');

/**
 * What one `next` reads of git. #160: the branch and origin refs, which worktree each branch is checked out in, and
 * whether `root` is a repository come from one `git for-each-ref`; on Windows each git process costs tens of
 * milliseconds, and `next` runs many times a wake-up. Only a ref that is not a commit (rev-parse peels it), `origin`
 * without remote-tracking refs (configured but never fetched, or not there), ancestry, merges and MERGE_HEAD ask git
 * again. A branch's worktree counts while its `.git` is there: `git worktree list` calls one whose `.git` is gone
 * prunable, and a bare main worktree has none.
 */
export function gitView(root, deps) {
  const memo = new Map();
  const tryGit = (cwd, args) => {
    const k = `${cwd}\0${args.join('\0')}`;
    if (!memo.has(k)) {
      let v;
      try {
        v = deps.git(cwd, args).trim();
      } catch {
        v = null;
      }
      memo.set(k, v);
    }
    return memo.get(k);
  };
  const listed = tryGit(root, ['for-each-ref', `--format=${REF_FORMAT}`, 'refs/heads', 'refs/remotes/origin']);
  if (listed === null) throw new Error(`${root} is not a git working tree`);
  const refs = new Map(); // ref name → its commit, or undefined when it names another object (rev-parse peels it)
  const checkedOut = new Map(); // branch → the worktree it is checked out in
  for (const row of listed.split('\n')) {
    if (!row) continue;
    const [name, type, sha, wt] = row.split('\0');
    refs.set(name, type === 'commit' ? sha : undefined);
    if (wt && name.startsWith('refs/heads/')) checkedOut.set(name.slice('refs/heads/'.length), wt);
  }
  const commitOf = (name) => (!refs.has(name) ? null : (refs.get(name) ?? tryGit(root, ['rev-parse', '-q', '--verify', `${name}^{commit}`])));
  let origin;
  const hasOrigin = () => (origin ??= [...refs.keys()].some((k) => k.startsWith('refs/remotes/origin/')) || tryGit(root, ['remote', 'get-url', 'origin']) !== null);
  const ref = (b) => (b ? commitOf(`refs/heads/${b}`) : null);
  const view = {
    root,
    get hasOrigin() {
      return hasOrigin();
    },
    wtOf: (branch) => {
      const wt = checkedOut.get(branch);
      return wt && deps.exists(join(wt, '.git')) ? wt : null;
    },
    ref,
    remote: (b) => (b && hasOrigin() ? commitOf(`refs/remotes/origin/${b}`) : null),
    commit: (r) => tryGit(root, ['rev-parse', '-q', '--verify', `${r}^{commit}`]),
    ancestor: (a, b) => tryGit(root, ['merge-base', '--is-ancestor', a, b]) !== null,
    mergeHead: (wt) => (wt ? tryGit(wt, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']) : null),
    merges: (tip) =>
      (tryGit(root, ['log', '--first-parent', '--merges', '--format=%H %P%x09%s', '-n', '2000', tip]) ?? '')
        .split('\n')
        .filter(Boolean)
        .map((row) => {
          const [shas, ...subject] = row.split('\t');
          const [sha, ...parents] = shas.split(' ');
          return { sha, parents, subject: subject.join('\t') };
        }),
  };
  return view;
}

/** The merge commit that brought ticket `t` into `target`, or null when it is not merged. */
function mergedSha(c, id, t, target) {
  const g = c.git;
  const tip = g.ref(target);
  if (!tip) return null;
  const merges = g.merges(tip).reverse(); // oldest first
  const branchSha = g.ref(t.branch);
  if (branchSha) {
    if (!g.ancestor(branchSha, tip)) return null;
    const exact = merges.find((m) => m.parents[1] === branchSha);
    if (exact) return { sha: exact.sha, by: 'branch' };
    const brought = merges.find((m) => m.parents.length === 2 && g.ancestor(branchSha, m.parents[1]) && !g.ancestor(branchSha, m.parents[0]));
    return brought ? { sha: brought.sha, by: 'branch' } : null;
  }
  const { owners } = ticketOwners([{ id, branch: t.branch, merges: [] }], (r) => g.commit(r) ?? r);
  const found = merges.find((m) => owners(m).owners.some((o) => o.id === id));
  return found ? { sha: found.sha, by: 'subject' } : null;
}

// ---- the registry -----------------------------------------------------------------------------------------------------

function exec(id, step, argv, { stdout = null, cwd = null, okExit = [0], tickets = [], line = null, after = [], note = null, host = false } = {}) {
  return { id, kind: 'exec', step, tickets, line, after, argv, stdout, cwd, okExit, command: commandLine(argv, stdout, cwd), ...(note ? { note } : {}), ...(host ? { host: true } : {}) };
}
function judge(id, step, what, outcomes, reference, { tickets = [], line = null, after = [], kind = 'judge', meta = null, needs = null } = {}) {
  return { id, kind, step, tickets, line, after, do: what, outcomes, reference, ...(meta ? { meta } : {}), ...(needs ? { needs } : {}) };
}
const stateArgv = (c, ...args) => ['node', js('state.mjs'), args[0], c.path, ...args.slice(1)];

/** The checks a Local Markdown delivery record names, when the state has no `verification` for the ticket. */
function checksText(t) {
  const r = t.reviews.at(-1);
  return `targeted checks green (status record)${r ? `; ${r.kind} ${r.mode} review: ${r.verdict}` : ''}`;
}

/** One builder per operation the host is handed: an exec of the script that owns it. */
export const OPERATIONS = {
  // integrate.mjs ticket-init: the ticket branch from the line's tip, its worktree, the branch recorded.
  // Under integrate: ticket-pr (#193, #195) the cut point is the ticket's own: origin/<base> for a ticket that is not
  // stacked, the upstream ticket branch for a stacked one — integrate.mjs decides by the ticket's #188 fields; --base
  // names the base branch it needs for the first case. Nothing merges the ticket into an integration branch.
  createTicketBranch: (c, { id, branch, worktree, tag }) =>
    exec(
      `branch:${id}:${basename(worktree)}:${tag}`,
      'ticket-branch',
      ['node', js('integrate.mjs'), 'ticket-init', c.path, id, '--branch', branch, '--worktree', worktree, ...(c.profile.integrate === 'ticket-pr' ? ['--base', c.cfg.base] : []), '--repo', c.cfg.root],
      { tickets: [id] },
    ),
  // integrate.mjs merge: merge, record, deliver, delivered, push, clean; a conflict is aborted and exits 4
  merge: (c, { id, t, wt, tag }) =>
    exec(
      `merge:${id}:${tag}`,
      'merge',
      [
        'node',
        js('integrate.mjs'),
        'merge',
        c.path,
        id,
        '--worktree',
        wt,
        ...(c.cfg.tracker === 'local' ? ['--local', c.ticketPath(id), ...(t.verification ? [] : ['--checks', checksText(t)])] : []),
        ...(c.profile.integrate === 'direct' ? [] : ['--push']),
      ],
      { stdout: c.tick('merge', `${keyOf(id)}-${slugOf(tag)}.json`), okExit: [0, 4], tickets: [id], line: t.line },
    ),
  push: (c, { target, tag, after }) => exec(`push:${target}:${tag}`, 'push', ['git', '-C', c.git.wtOf(target) ?? c.cfg.root, 'push', '-u', 'origin', target], { line: target, after, host: isProtected(c, target) }),
  // verify.mjs: local verification of one SHA and its per-SHA record
  verifyLocal: (c, { line, sha, reason, wt, tag, selfFound = null }) =>
    exec(
      `verify${selfFound ? '-self' : ''}:${line}@${sha}:${tag}`,
      'verify-local',
      ['node', js('verify.mjs'), c.path, line, '--worktree', wt ?? c.cfg.root, '--reason', reason, '--sha', sha, ...(selfFound ? ['--self-found', selfFound] : [])],
      { stdout: c.tick('verify', `${slugOf(line)}-${sha.slice(0, 12)}-${tag}${selfFound ? '-self' : ''}.json`), okExit: [0, 4, 5], line },
    ),
  // state.mjs check: a stage-exit gate (gates.mjs)
  gate: (c, { gate, after = [] }) => exec(`gate:${gate}`, 'gate', ['node', js('state.mjs'), 'check', c.path, gate, '--repo', c.cfg.root], { after }),
};

/** A line on local verification: no `origin`, or settled as CI not covering it. Its full suite runs once, at the finish. */
const onLocal = (c, L) => !c.git.hasOrigin || L.ciNotCovering !== null;
const localReason = (c) => (c.git.hasOrigin ? 'ci-not-covering' : 'no-origin');

/**
 * Local verification of `sha` on `line` through verify.mjs: true while it is under way this wake-up, false once the
 * SHA has a record or verify.mjs found the worktree not at the SHA (exit 5: the line keeps its last result; a later
 * wake-up tries again). Exit 4 (no usable contract) hands the checks to the host, then runs with --self-found.
 */
function localVerify(c, line, sha, reason, wt, final = false) {
  const tag = `${final ? 'final-' : ''}w${c.book.wakeup}`;
  if (c.state.lines[line].local.some((x) => x.sha === sha)) return false;
  // red lines and the finish both verify a new tip: one verification of a SHA per list
  if (c.actions.some((a) => a.step === 'verify-local' && a.line === line && a.argv.includes(sha))) return true;
  const first = OPERATIONS.verifyLocal(c, { line, sha, reason, wt, tag });
  if (!c.done(first.id)) return c.emit(first) !== null;
  const exit = c.book.done[first.id].exit;
  if (exit !== 4) return false;
  const list = c.tick('verify', `${slugOf(line)}-${sha.slice(0, 12)}.self-found.txt`);
  const found = c.emit(
    judge(
      `self-find:${line}@${sha}`,
      'self-find',
      `${line} has no usable project command contract at ${sha} (verify.mjs exited 4). Find the repo's full automatic checks from the manifest and the CI settings and write them to ${list}, one command per line. Record written.`,
      ['written'],
      [{ path: js('verify.mjs'), part: 'header, step 3' }, doc('ASKING.md', 'section 0 (the project command contract)')],
      { line },
    ),
  );
  if (found) return true;
  const second = OPERATIONS.verifyLocal(c, { line, sha, reason, wt, tag, selfFound: list });
  return c.emit(second) !== null;
}

// ---- context --------------------------------------------------------------------------------------------------------

function context(path, state, now, deps) {
  if (!isObject(state.tick) || state.tick.format !== FORMAT) throw new UsageError(`${path} has no tick configuration: run tick.mjs setup first`);
  const book = structuredClone(state.tick);
  const cfg = book.config;
  const profile = profileOf(state); // #201: the integrate default follows the run's tracker
  const W = runDir(path, state.run);
  const limits = { ...LIMIT_DEFAULTS };
  if (cfg.ledger) {
    let text;
    try {
      text = deps.read(cfg.ledger);
    } catch (e) {
      throw new Error(`could not read the ledger ${cfg.ledger} (${e.message})`);
    }
    const seen = new Set();
    for (const row of text.split(/\r?\n/)) {
      const m = BUDGET_LINE.exec(row);
      if (m && !seen.has(m[1])) {
        seen.add(m[1]);
        limits[m[1]] = Number(m[2]);
      }
    }
  }
  const c = {
    path,
    state,
    book,
    cfg,
    profile,
    now,
    nowMs: Date.parse(now),
    W,
    deps,
    limits,
    git: gitView(cfg.root, deps),
    actions: [],
    reports: [],
    reconcile: [],
    wrote: [],
    dispatch: null,
    fallback: null,
  };
  c.tick = (...p) => join(W, 'tick', ...p);
  c.snapshot = (id) => join(W, 'acceptance', `${keyOf(id)}.json`);
  c.predicted = (id) => join(W, 'files', `${keyOf(id)}.txt`);
  // #205: a bundle's lead stands for it in the state; its members are kept on the lead
  c.members = (id) => state.tickets[id]?.members ?? [];
  c.group = (id) => [id, ...c.members(id)];
  c.leadOf = (id) => (id in state.tickets ? id : (Object.entries(state.tickets).find(([, t]) => (t.members ?? []).includes(id))?.[0] ?? null));
  c.ticketOf = (id) => state.tickets[c.leadOf(id)];
  /** The acceptance the agents read: the ticket's snapshot, or a bundle's snapshot of all its tickets. */
  c.acceptanceFile = (id) => (c.members(id).length ? join(W, 'acceptance', `${keyOf(id)}.bundle.json`) : c.snapshot(id));
  c.sendBack = (id) => join(W, 'sendback', `${keyOf(id)}.md`);
  c.target = (line) => (profile.integrate === 'direct' ? cfg.base : line);
  c.ticketPath = (id) => `${cfg.ticketsDir.replace(/\\/g, '/').replace(/\/+$/, '')}/${id}`;
  c.write = (file, text) => {
    deps.write(file, text);
    c.wrote.push(file);
  };
  c.status = (id) => {
    const d = book.done[id];
    if (!d) return 'open';
    const ok = book.issued[id]?.okExit;
    if (d.exit !== undefined && ok && !ok.includes(d.exit)) return 'failed';
    return 'done';
  };
  c.done = (id) => c.status(id) === 'done';
  c.flag = (id) => (book.flags[id] ??= {});
  /** Adds an action; returns its id while it is pending, null when it is already done. */
  c.emit = (a) => {
    const s = c.status(a.id);
    if (s === 'done') return null;
    let action = a;
    if (s === 'failed') {
      const fid = `failed:${a.id}`;
      if (c.done(fid)) return null; // settled by the host
      const log = book.done[a.id].log;
      action = judge(
        fid,
        'failed',
        `\`${a.command ?? a.id}\` exited ${book.done[a.id].exit}. Read its error${log ? ` (tick.mjs run wrote it to ${log})` : ''}, put it right, and record retry (it is issued again) or settled (it is not needed any more).`,
        ['retry', 'settled'],
        a.reference ?? [doc('SKILL.md', 'section 1 (the loop)')],
        { tickets: a.tickets, line: a.line, meta: { of: a.id } },
      );
    } else if (a.kind === 'spawn' && a.spawn?.background && book.issued[a.id] && !book.issued[a.id].held && (book.issued[a.id].batch ?? 1) === 1 && (a.after ?? []).every((x) => !x || c.done(x))) {
      // Handed out before in batch 1, runnable then, never recorded: the host was interrupted between spawn and
      // record. A spawn listed at a later batch was not handed out: the host sends batch 1 only (#128). An entry from
      // before batches were kept counts as handed out. One `held` is of a list `run` made and never returned (#146).
      const k = book.spawnChecks?.[a.id] ?? 0;
      action = judge(
        `spawn-check:${a.id}:${k}`,
        'spawn-check',
        `${a.id} (\`${a.spawn.description}\`) was handed out before and never recorded. Before spawning anything, check whether an agent with that description is running or has finished (its task, its completion notice). spawned: record its id with --agent; none: there is no such agent, and the spawn is issued again.`,
        ['spawned', 'none'],
        a.reference ?? [doc('SKILL.md', 'section 1 (the loop)')],
        { tickets: a.tickets, line: a.line, meta: { of: a.id }, needs: { agent: 'the agent id, with spawned' } },
      );
    }
    if (s === 'open' && a.kind === 'exec' && book.ran?.[a.id]) {
      // `run` ran it and its record failed (#146): it is listed to be recorded, not run again
      const { exit, signal, log } = book.ran[a.id];
      const r = { exit, ...(signal ? { signal } : {}), log };
      action = { ...a, ran: r, note: `It already ran (exit ${r.exit}${r.signal ? `, killed by ${r.signal}` : ''}; output in ${r.log}) and its record failed: do not run it again. Settle what refused the record, then run its record line (tick.mjs run does that itself).` };
    }
    if (!c.actions.some((x) => x.id === action.id)) {
      action.after = (action.after ?? []).filter((x) => x && c.actions.some((y) => y.id === x));
      c.actions.push(action);
    }
    return action.id;
  };
  return c;
}

const limitFor = (c, stage) =>
  c.limits[{ implementing: 'timeout-implement', fixing: 'timeout-fix', expanding: 'timeout-expand', integrating: 'timeout-merge', 'in-review': 'timeout-review' }[stage]];

// ---- steps ----------------------------------------------------------------------------------------------------------

/** Every agent id the state names joins the registry, so a later report from it can be told apart. */
function syncAgents(c) {
  for (const [id, t] of Object.entries(c.state.tickets)) {
    const a = t.assignment;
    if (!a || !a.agentId) continue;
    const known = (c.book.agents[a.agentId] ??= { tickets: [], role: null, type: a.type, status: 'current', at: a.assigned });
    if (!known.tickets.includes(id)) known.tickets.push(id);
  }
  for (const [line, L] of Object.entries(c.state.lines)) {
    const a = L.assignment;
    if (a?.agentId) c.book.agents[a.agentId] ??= { tickets: [], line, role: 'ci-fix', type: a.type, status: 'current', at: a.assigned };
  }
}

/**
 * An exec `run` ran whose record failed (#146): listed first, as it was issued, to be recorded with the exit it had
 * (c.emit marks it `ran`), never run again; also when nothing else would list it again (its side effect, say, settled
 * what issued it).
 */
function stepRan(c) {
  for (const [id, r] of Object.entries(c.book.ran ?? {})) {
    const x = c.book.issued[id];
    if (!x || x.kind !== 'exec' || c.status(id) !== 'open') continue;
    c.emit(exec(id, x.step, r.argv ?? [], { stdout: r.stdout ?? null, cwd: r.cwd ?? null, okExit: x.okExit ?? [0], tickets: x.tickets ?? [], line: x.line ?? null }));
  }
}

/** The state's tip of each line follows git's. */
function stepTips(c) {
  for (const [line, L] of Object.entries(c.state.lines)) {
    const tip = c.git.ref(c.target(line));
    if (!tip || tip === L.tip) continue;
    c.reconcile.push({ line, state: `tip ${L.tip ?? 'none'}`, git: `tip ${tip}`, follow: 'git' });
    c.emit(exec(`tip:${line}@${tip}`, 'tip', stateArgv(c, 'line', line, '--tip', tip), { line }));
  }
}

/**
 * #138: where the report of an implementation or fix round a review follows is kept, one file per assignment: the
 * review's spawn file takes its `targeted checks:` line from there (brief.mjs review).
 */
const agentReportFile = (c, id, assigned) => c.tick('report', `${keyOf(id)}-${String(assigned).replace(/[-:]/g, '')}.md`);
const keepReport = (file, outcome) =>
  `first write the report it returned, verbatim, to ${file} (the review's spawn file takes its targeted checks line from there; record ${outcome} is refused without it), then `;
/** An agent report a review can be given: its file holds a `targeted checks:` line (agents/implementer.md section 5). */
function agentReportOk(deps, file) {
  try {
    return !!file && deps.exists(file) && reportField(deps.read(file), 'targeted checks') !== null;
  } catch {
    return false;
  }
}

const COLLECT = {
  implementing: {
    outcomes: ['green', 'red', 'blocked'],
    what: (ids, report) =>
      `Take the implementation agent's report for ${ids.join(', ')} (its summary and evidence paths, not the diff) and check close-out step 1: are the targeted checks it reports green? green: ${keepReport(report, 'green')}on to review; red: it goes back to the same agent; blocked: awaiting ruling, with --value <reason>.`,
    reference: [doc('SKILL.md', 'section 2, Close-out checks and review'), doc('agents/implementer.md', 'section 5, the report it returns')],
  },
  expanding: {
    outcomes: ['reported'],
    what: (ids) => `Take the expansion agent's report for ${ids.join(', ')}. Record reported; --value lists, comma-separated, the tickets it reported as awaiting ruling (they leave the run), the others go back to candidate.`,
    reference: [doc('SKILL.md', 'section 1 (the loop)'), doc('agents/expander.md', 'section 4, the report it returns')],
  },
  fixing: {
    outcomes: ['fixed', 'blocked'],
    what: (ids, report) =>
      `Take the fix report for ${ids.join(', ')} and check its targeted checks and acceptance comparison are green. fixed: ${report ? keepReport(report, 'fixed') : ''}on to the recheck; blocked: awaiting ruling, with --value <reason>.`,
    reference: [doc('SKILL.md', 'section 2, Batched fix')],
  },
  'in-review': {
    // #143: the review host went to the background; its report comes with its completion notice. Its turn can also end
    // with no report (it was waiting on agents of its own that had reported already): incomplete, and tick sends it a
    // message at once rather than waiting for the fallback wake-up (the batch-2 run lost 55 minutes so)
    outcomes: ['pass', 'fix', 'stuck', 'incomplete'],
    what: (ids) =>
      `Take the review host agent's review report for ${ids.join(', ')} (its at most six lines, not the diff) and record its verdict: pass, fix (with --findings <the finding ids>) or stuck, with the counts of its \`counts:\` line, --observations <n> --pre-existing <n> (both, 0 when there are none) and, when the line has them, --candidates <n> --confirmed <n> --invalid <n> --blocking <n>. When its turn ended with no review report (it says it is waiting on its finders, architect or verifiers, or it stopped midway), record incomplete alone: it stays in flight and tick has you send it a message to go on.`,
    reference: [doc('REVIEWER.md', 'section 2, the review report'), doc('SKILL.md', 'section 2, Close-out checks and review')],
  },
  integrating: {
    outcomes: ['resolved', 'unresolved'],
    what: (ids) => `Take the merge agent's report for ${ids.join(', ')}: record each trade-off in the self-answer log. resolved: the merge is committed; unresolved: it could not be resolved safely and the ticket is sent back.`,
    reference: [doc('SKILL.md', 'section 2, Merge conflicts')],
  },
};

function stepReports(c) {
  const { book, state } = c;
  const keep = [];
  for (const agent of book.inbox) {
    const held = Object.entries(state.lines).find(([, L]) => L.assignment?.agentId === agent && L.assignment.deadline !== null);
    if (held) {
      // the ci-fix agent of a red light that maps to no ticket (#144)
      const [line, L] = held;
      c.reports.push({ agent, accepted: true, tickets: [], line, why: 'current' });
      keep.push(agent);
      c.emit(
        judge(
          `collect:${agent}@${L.assignment.assigned}`,
          'collect',
          `Take the ci-fix agent's report for ${line} (its summary and evidence paths, not the diff) into the run's self-answer log. fixed: it committed a fix on ${line} (tick pushes it and reads CI next); blocked: it committed nothing, with --value <what blocks it>. Either way the round is counted.`,
          ['fixed', 'blocked'],
          [doc('RED-LIGHT.md', 'step 4 (no ticket matched)')],
          { line, meta: { agent, stage: 'ci-fix' } },
        ),
      );
      continue;
    }
    const current = Object.entries(state.tickets).filter(([, t]) => t.assignment?.agentId === agent && t.assignment.deadline !== null);
    if (current.length) {
      const ids = current.map(([id]) => id);
      const t0 = current[0][1];
      const spec = COLLECT[t0.stage];
      c.reports.push({ agent, accepted: true, tickets: ids, why: 'current' });
      keep.push(agent);
      // a review host nudged after an incomplete report reports again: a new collect, not the spent one
      const nudged = c.flag(ids[0]).nudge?.agent === agent ? c.flag(ids[0]).nudge.n : 0;
      const id = `collect:${agent}@${t0.assignment.assigned}${nudged ? `:n${nudged}` : ''}`;
      if (!spec) {
        c.emit(
          judge(id, 'collect', `Take ${agent}'s report for ${ids.join(', ')} (stage ${t0.stage}) into the status record.`, ['logged'], [doc('SKILL.md', 'section 1 (the loop)')], {
            tickets: ids,
            line: t0.line,
            meta: { agent, stage: t0.stage },
          }),
        );
        continue;
      }
      if (t0.stage === 'in-review') {
        // #143: a review host that went to the background reports here; its verdict is recorded as a review, with
        // the review tier its spawn was chosen by (#139)
        const tier = c.flag(ids[0]).reviewTier;
        const tierReasons = c.flag(ids[0]).reviewTierReasons;
        const a = judge(id, 'collect', spec.what(ids), spec.outcomes, spec.reference, {
          tickets: ids,
          line: t0.line,
          meta: { agent, stage: t0.stage, mode: reviewMode(t0), kind: 'full', ...(tier ? { tier } : {}), ...(tier && tierReasons ? { tierReasons } : {}) },
        });
        a.record = `node ${q(SELF)} record ${q(c.path)} ${q(id)} --outcome pass|fix|stuck [--findings <id>,<id>] --observations <n> --pre-existing <n> [--candidates <n> --confirmed <n> --invalid <n> --blocking <n>] | --outcome incomplete`;
        c.emit(a);
        continue;
      }
      const needs = t0.stage === 'fixing' && !c.profile.recheck ? { fixed: 'the finding ids it fixed', unfixed: 'the ones still open' } : null;
      // #138: the report of a round a review follows, kept for that review's spawn file (one file per assignment)
      const reviewed = t0.stage === 'implementing' || (t0.stage === 'fixing' && c.profile.recheck);
      const agentReport = reviewed ? agentReportFile(c, ids[0], t0.assignment.assigned) : null;
      const meta = { agent, stage: t0.stage, ...(agentReport ? { agentReport } : {}) };
      c.emit(judge(id, 'collect', spec.what(ids, agentReport), spec.outcomes, spec.reference, { tickets: ids, line: t0.line, meta, needs }));
      continue;
    }
    const known = book.agents[agent];
    const duplicate = Object.keys(book.done).some((k) => k.startsWith(`collect:${agent}@`) || k === `ignore:${agent}`);
    if (duplicate && (!known || known.status !== 'stopped')) {
      c.reports.push({ agent, accepted: false, tickets: known?.tickets ?? [], why: 'duplicate' });
      continue; // already taken (or already logged): nothing more
    }
    const why = known?.status === 'stopped' ? 'stopped' : known ? 'superseded' : 'unknown';
    const tickets = known?.tickets ?? [];
    c.reports.push({ agent, accepted: false, tickets, why });
    if (c.done(`ignore:${agent}`)) continue;
    keep.push(agent);
    c.emit(
      judge(
        `ignore:${agent}`,
        'ignore',
        tickets.length
          ? `Do not take this report: ${agent} is no longer the agent of ${tickets.join(', ')} (${why}). Add one line to each one's status record: \`${agent} reported ${c.now}: ignored (${why})\`.`
          : `Do not take this report: ${agent} is no agent of this run. Note it in the run's self-answer log.`,
        ['logged'],
        [doc('SKILL.md', 'section 1 (the loop)')],
        { tickets },
      ),
    );
  }
  book.inbox = keep;
}

/** A line in red-light handling: its CI read every wake-up, and the red-light procedure per red SHA. */
function stepRed(c) {
  const { book, state } = c;
  for (const [line, L] of Object.entries(state.lines)) {
    const lastLocal = L.local.at(-1);
    if (L.ci?.verdict === 'red' && !book.red[line]) book.red[line] = { sha: L.ci.sha, at: c.now };
    if (lastLocal?.result === 'red' && !book.red[line]) book.red[line] = { sha: lastLocal.sha, at: c.now };
    const red = book.red[line];
    if (!red) continue;
    const target = c.target(line);
    const tip = c.git.ref(target);
    // A line on local verification: the earliest-red scan records older SHAs too, so only its tip's record counts.
    const local = c.profile.ci !== 'skip' && tip && target === line && onLocal(c, L);
    const tipLocal = local ? L.local.find((x) => x.sha === tip) : undefined;
    const greenCi = L.ci?.verdict === 'green' && L.ci.sha !== red.sha;
    const greenLocal = local ? tipLocal?.result === 'green' && tip !== red.sha : lastLocal?.result === 'green' && lastLocal.sha !== red.sha;
    if (greenCi || greenLocal || book.failed[line]) {
      delete book.red[line];
      continue;
    }
    const fix = red.ciFix ?? null;
    const held = L.assignment && L.assignment.deadline !== null ? L.assignment : null;
    // A ci-fix agent works in the integration worktree: no judge, no push and no CI read until it reports or is stopped.
    if (held) {
      if (!held.agentId && fix) ciFixDispatch(c, line, target, red);
      continue;
    }
    if (fix?.status === 'pending') {
      ciFixDispatch(c, line, target, red);
      continue;
    }
    if (local) {
      if (!tipLocal) localVerify(c, line, tip, localReason(c), c.git.wtOf(target), true); // a fix moved the tip: the finish's verification of it comes first
      else {
        const scan = earliestRedScan(c, line, tip);
        if (scan.done) c.emit(redLightJudge(c, line, L, red, tip, scan));
      }
      continue;
    }
    const latestRed = L.ci?.verdict === 'red' ? L.ci.sha : lastLocal?.result === 'red' ? lastLocal.sha : red.sha;
    c.emit(redLightJudge(c, line, L, red, latestRed));
    if (c.profile.ci === 'skip' || !tip || target !== line) continue;
    ciRead(c, line, target, tip, `w${book.wakeup}`, false);
  }
}

/**
 * The red-light judge of one round at `sha`; on a line on local verification it names the scan's earliest red SHA.
 * A ci-fix round that ended with no new commit (blocked, or stopped and reset) is judged again at the same SHA (#144).
 */
function redLightJudge(c, line, L, red, sha, scan = null) {
  const tip = c.git.ref(c.target(line));
  const fix = red.ciFix ?? null;
  const again = fix?.status === 'ended' && tip && tip === L.assignment?.fingerprint?.head ? `:r${fix.round}` : '';
  const used = fix?.round ?? 0;
  const failure = c.tick('ci-fix', `${slugOf(line)}-${red.sha.slice(0, 12)}-${used + 1}.failure.md`);
  const found = scan
    ? ` Each integration SHA was verified locally from the oldest: the earliest red SHA ${scan.sha}${scan.sha === sha ? ' (no integration SHA is red: the red came in after the last of them)' : ''}; ci.mjs earliest-red on the per-SHA records finds the same.`
    : '';
  return judge(
    `red-light:${line}@${sha}${again}`,
    'red-light',
    `${line} is red at ${sha}${again ? ` (fix round ${used} ended with no new commit)` : ''}.${found} Read RED-LIGHT.md in full and do its red-light handling for this round (earliest red SHA, mapping to a ticket, the fix or the revert). Record handled while a fix round is under way, reverted after a revert, failed when the line failed verification (no ticket matched after two rounds). ${
      used < 2
        ? `When it maps to no ticket, write the failing lines to ${failure} and record unmatched: tick spawns the ci-fix agent for round ${used + 1} of 2.`
        : 'The two fix rounds of a red light that maps to no ticket are used: when it still maps to no ticket, record failed.'
    }`,
    ['handled', 'reverted', 'failed', ...(used < 2 ? ['unmatched'] : [])],
    [doc('RED-LIGHT.md', 'all of it')],
    { line, after: scan?.after ?? [], meta: { round: used + 1, sha, failure, ...(scan ? { earliestRed: scan.sha } : {}) } },
  );
}

/**
 * The earliest red SHA of a red line on local verification (#141). Its integration SHAs — the ticket merges the state
 * records on it, in first-parent order — are verified one at a time from the oldest, each in a detached worktree of
 * its own (`<worktrees>/<line-slug>-at-<sha12>`, removed once the SHA has its record), until one is red: that one is
 * the earliest red SHA. A SHA with a record is not verified again. None red: the red came in after the last of them
 * (a host commit, the simplify pass or the base sync), and the earliest red SHA is the tip.
 * Returns { done: false } while a verification is under way, else { done: true, sha, after }: `after` holds the
 * worktree removals still in this list, which the red-light judge waits for.
 */
function earliestRedScan(c, line, tip) {
  const L = c.state.lines[line];
  const recorded = new Set(Object.values(c.state.tickets).flatMap((t) => (c.target(t.line) === line ? t.merges.map((m) => m.sha) : [])));
  const removing = [];
  for (const { sha } of c.git.merges(tip).reverse()) {
    if (!recorded.has(sha)) continue;
    const wt = join(c.cfg.worktrees, `${slugOf(line)}-at-${sha.slice(0, 12)}`);
    const add = `earliest-red-add:${line}@${sha}`;
    const rec = L.local.find((x) => x.sha === sha);
    if (!rec) {
      if (!c.emit(exec(add, 'earliest-red', ['git', '-C', c.cfg.root, 'worktree', 'add', '-q', '--detach', wt, sha], { line }))) localVerify(c, line, sha, localReason(c), wt);
      return { done: false };
    }
    if (c.done(add)) {
      const rm = c.emit(exec(`earliest-red-remove:${line}@${sha}`, 'earliest-red', ['git', '-C', c.cfg.root, 'worktree', 'remove', '--force', wt], { line }));
      if (rm) removing.push(rm);
    }
    if (rec.result === 'red') return { done: true, sha, after: removing };
  }
  return { done: true, sha: tip, after: removing };
}

/** Push when the remote lags, read CI at `tip` and record it. Returns true while that is still to be done. */
function ciRead(c, line, target, tip, tag, dispatch) {
  if (c.git.remote(target) !== tip) {
    c.emit(OPERATIONS.push(c, { target, tag: `@${tip}`, after: [] }));
    return true;
  }
  const out = c.tick('ci', `${slugOf(line)}-${tag}.json`);
  const readId = `ci-read:${line}:${tag}`;
  const recordId = `ci-record:${line}:${tag}`;
  if (c.done(recordId)) return false;
  const argv = ['node', js('ci.mjs'), 'verdict', ...(c.cfg.repo ? ['--repo', c.cfg.repo] : []), target, tip];
  const r = c.emit(exec(readId, 'ci-read', argv, { stdout: out, cwd: c.cfg.repo ? null : c.cfg.root, line }));
  c.emit(exec(recordId, 'ci-record', stateArgv(c, 'ci', line, '--from', out, ...(dispatch ? ['--dispatch'] : [])), { line, after: [r] }));
  return true;
}

/**
 * The ci-fix of a red light that maps to no ticket (#144): the assignment record on the line (deadline.mjs record in
 * the integration worktree, then state.mjs assign --line), then a general-purpose agent with the brief tick writes.
 * Ids carry the episode's first red SHA and the round, so a later red episode on the same line dispatches anew.
 */
function ciFixDispatch(c, line, target, red) {
  const fix = red.ciFix;
  const wt = resolve(c.git.wtOf(target) ?? c.cfg.root);
  const key = `${line}@${red.sha.slice(0, 12)}:${fix.round}`;
  const tag = `${slugOf(line)}-${red.sha.slice(0, 12)}-${fix.round}`;
  const rec = c.tick('rec', `ci-fix-${tag}.json`);
  const r1 = c.emit(exec(`rec:ci-fix:${key}`, 'assignment', ['node', js('deadline.mjs'), 'record', '--worktree', wt, '--limit', String(c.limits['timeout-fix'])], { stdout: rec, line }));
  const r2 = c.emit(exec(`assign:ci-fix:${key}`, 'assignment', stateArgv(c, 'assign', '--line', line, '--record', rec, '--type', 'general-purpose', '--worktree', wt), { line, after: [r1] }));
  const brief = c.tick('ci-fix', `${tag}.md`);
  const commands = join(wt, 'docs', 'agents', 'commands.md');
  c.write(
    brief,
    [
      `# ci-fix ${line}`,
      '',
      `You fix a red light on the integration branch ${target} that maps to no ticket. You cannot ask anyone; this is all of your brief.`,
      '',
      `- Integration worktree: ${wt} (branch ${target}). Work and commit only there, on that branch.`,
      `- Red at ${fix.sha}. The failing lines: ${fix.failure}.`,
      `- Fix round ${fix.round} of at most 2.${fix.round > 1 ? ' The previous round ended without turning the line green (blocked, stopped at its time limit, or CI still red); start from the worktree as it is now.' : ''}`,
      `- Project command contract: ${c.deps.exists(commands) ? `${commands}: run its Targeted checks for what failed and read the output as its Failures only says` : 'none: find the checks that cover the failure from the manifest and the CI settings'}. Take pass or fail from the command's own exit status, before any filter; read only the failing lines and the summary.`,
      '- Find the cause in the failing lines and fix it. Do not weaken or skip a test or a check to get green.',
      '- Commit the fix on that branch. The subject carries no ticket id (no `#N`, no ticket file name); the body says what failed and what the fix changed; no `Closes` or `Fixes`.',
      '- Do not push, open a PR, or touch another branch or worktree: tick pushes the fix and reads CI once you report.',
      '- Do nothing that needs the user\'s confirmation (a push, a release or a deploy, a message to anyone outside, a write to settings that change how Claude Code behaves, deleting anything outside the worktree): list it under human work.',
      '- When you cannot fix it, commit nothing and say what blocks it.',
      '',
      'Report in at most 10 lines:',
      '',
      '```',
      `line: ${line}`,
      'commit: <sha> | none',
      'targeted checks: <command> → <result>, …',
      'cause: <one sentence>',
      'blocked: <what blocks it> | none',
      'human work: <what only a person can do> | none',
      '```',
      '',
    ].join('\n'),
  );
  c.emit({
    id: `ci-fix:${key}`,
    kind: 'spawn',
    step: 'ci-fix',
    tickets: [],
    line,
    after: [r2],
    spawn: { subagent_type: 'general-purpose', description: roleDescription('ci-fix', [line]), prompt: `Read ${resolve(brief)} in full and follow it.`, background: true },
    reference: [doc('RED-LIGHT.md', 'step 4 (no ticket matched)')],
    meta: { round: fix.round },
    record: `node ${q(SELF)} record ${q(c.path)} ${q(`ci-fix:${key}`)} --agent <agent id>`,
  });
}

/** A fallback wake-up no later than `minutes` from now (ScheduleWakeup's 60 s floor kept); null stays null. */
export function capFallback(fallback, minutes) {
  if (!fallback || !Number.isInteger(minutes) || minutes <= 0) return fallback;
  const cap = minutes * 60;
  if (fallback.seconds <= cap) return fallback;
  return { ...fallback, seconds: cap, scheduleWakeup: Math.max(60, Math.min(fallback.scheduleWakeup ?? cap, cap)), capped: true };
}

/** deadline.mjs scan over the named agents in flight; extensions are exec, stops are TIMEOUTS.md judges. */
function stepTimeouts(c) {
  const { state, book } = c;
  const agents = new Map();
  for (const [id, t] of Object.entries(state.tickets)) {
    const a = t.assignment;
    if (!a || a.deadline === null || !a.agentId) continue;
    const seen = agents.get(a.agentId);
    if (seen) {
      seen.tickets.push(id);
      continue;
    }
    agents.set(a.agentId, { id: a.agentId, tickets: [id], stage: t.stage, a });
  }
  for (const [line, L] of Object.entries(state.lines)) {
    const a = L.assignment;
    if (!a || a.deadline === null || !a.agentId || agents.has(a.agentId)) continue;
    agents.set(a.agentId, { id: a.agentId, tickets: [], line, stage: 'ci-fix', a });
  }
  const plan = [];
  let pending = false;
  for (const x of agents.values()) {
    const { a } = x;
    const entry = { id: x.id, assigned: a.assigned, limit: a.limit, deadline: a.deadline, extended: a.extended, fingerprint: a.fingerprint };
    if (a.fingerprint.expansions) {
      entry.expansions = { ...a.fingerprint.expansions };
      if (a.deadline < c.now) {
        // Overdue: its progress is the tickets' expansion counts now, read with acceptance.mjs.
        const dir = c.tick('expansions', `${slugOf(x.id)}-${a.deadline.replace(/[-:]/g, '')}`);
        let complete = true;
        for (const id of Object.keys(a.fingerprint.expansions)) {
          const out = join(dir, `${keyOf(id)}.json`);
          const read = c.done(`expansions:${x.id}:${a.deadline}:${id}`) ? readJsonFile(c.deps, out) : null;
          if (read && Array.isArray(read.expansions)) entry.expansions[id] = read.expansions.length;
          else {
            complete = false;
            c.emit(exec(`expansions:${x.id}:${a.deadline}:${id}`, 'expansions', acceptanceArgv(c, id, c.ticketOf(id)), { stdout: out, cwd: acceptanceCwd(c), tickets: [c.leadOf(id) ?? id] }));
          }
        }
        if (!complete) {
          pending = true;
          continue;
        }
      }
    } else {
      entry.worktree = a.worktree;
    }
    plan.push({ entry, x });
  }
  if (!plan.length) return;
  const planPath = c.tick('scan', `w${book.wakeup}.plan.json`);
  c.write(planPath, `${JSON.stringify({ now: c.now, agents: plan.map((p) => p.entry) }, null, 2)}\n`);
  const r = deadlineMain(['scan', planPath, '--now', c.now], { read: c.deps.read, git: c.deps.git, clock: () => c.nowMs });
  if (r.code !== 0) throw new Error(`deadline.mjs scan failed: ${r.err.trim()}`);
  const scan = JSON.parse(r.out);
  // The fallback wake-up waits until the earliest deadline, capped by `budget: wake-check` (minutes): an agent whose
  // turn ended with no completion notice the host acts on is looked at within that, not at its stage time limit
  // (timeout-review can be hours).
  if (!pending) c.fallback = capFallback(scan.fallback, c.limits['wake-check']);
  for (const result of scan.agents) {
    const { x } = plan.find((p) => p.entry.id === result.id);
    if (x.stage === 'ci-fix') {
      ciFixTimeout(c, x, result);
      continue;
    }
    const t = state.tickets[x.tickets[0]];
    if (result.action === 'extend') {
      c.emit(exec(`extend:${x.id}@${x.a.assigned}`, 'extend', stateArgv(c, 'extend', ...x.tickets, '--deadline', result.deadline), { tickets: x.tickets, line: t.line }));
    } else if (result.action === 'stop' || result.error) {
      const used = t.timeoutReassignments[x.stage] ?? 0;
      const hint = result.error
        ? 'the fingerprint could not be computed: no reassignment, settle it as the error branch says'
        : x.stage === 'integrating'
          ? 'restore the integration worktree, then send back'
          : used >= 1
            ? x.stage === 'expanding'
              ? 'already reassigned once: awaiting ruling'
              : 'already reassigned once: stuck'
            : 'not yet reassigned in this stage: reassign';
      c.emit(
        judge(
          `timeout:${x.id}@${x.a.assigned}`,
          'timeout',
          `${x.id} (${x.stage}, ${x.tickets.join(', ')}) is overdue: ${result.error ? `error ${result.error}` : 'stop'}. TaskStop it (TIMEOUTS.md step 1) and settle it by step 2 (${hint}); write the timeout handling into the status record (step 3). Record the branch taken; collected when it had already finished (its report is then taken).`,
          x.stage === 'in-review' ? ['reassign', 'stuck', 'awaiting-ruling', 'collected'] : ['reassign', 'stuck', 'awaiting-ruling', 'send-back', 'collected'],
          [doc('TIMEOUTS.md', 'steps 1 to 3')],
          { tickets: x.tickets, line: t.line, meta: { agent: x.id, stage: x.stage, hint } },
        ),
      );
    }
  }
}

/** A line's ci-fix agent in the deadline scan: extended once on progress, else stopped; a stop is a fix round. */
function ciFixTimeout(c, x, result) {
  const { a, line } = x;
  if (result.action === 'extend') {
    c.emit(exec(`extend:${x.id}@${a.assigned}`, 'extend', stateArgv(c, 'extend', '--line', line, '--deadline', result.deadline), { line }));
    return;
  }
  if (result.action !== 'stop' && !result.error) return;
  const round = c.book.red[line]?.ciFix?.round ?? 1;
  const reset = `\`git -C ${q(a.worktree)} reset --hard ${a.fingerprint.head}\``;
  const hint = result.error
    ? `the fingerprint could not be computed (${result.error}): ${reset}, then record failed (the line failed verification)`
    : `${reset} (the assignment's HEAD), then record stopped: it counts as fix round ${round} of 2`;
  c.emit(
    judge(
      `timeout:${x.id}@${a.assigned}`,
      'timeout',
      `${x.id} (ci-fix of ${line}, a red light that maps to no ticket) is overdue: ${result.error ? `error ${result.error}` : 'stop'}. TaskStop it and settle it by TIMEOUTS.md (red-light fix): ${hint}. Write the timeout handling into the run's self-answer log. collected when it had already finished (its report is then taken and the round still counts).`,
      ['stopped', 'failed', 'collected'],
      [doc('TIMEOUTS.md', 'steps 1 to 3 (red-light fix)')],
      { line, meta: { agent: x.id, stage: 'ci-fix', hint } },
    ),
  );
}

function acceptanceArgv(c, id, t, extra = []) {
  if (c.cfg.tracker === 'github') return ['node', js('acceptance.mjs'), 'github', '--repo', c.cfg.repo, numOf(id), ...extra];
  return ['node', js('acceptance.mjs'), 'local', '--ref', t?.branch && c.git.ref(t.branch) ? t.branch : c.target(t?.line ?? c.cfg.base), c.ticketPath(id), ...extra];
}
const acceptanceCwd = (c) => (c.cfg.tracker === 'github' ? null : c.cfg.root);

// ---- one ticket's agent -----------------------------------------------------------------------------------------------

/** The latest implementer (or fix agent) the registry knows for a ticket, unless it was stopped. */
function implementerOf(c, id) {
  const entries = Object.entries(c.book.agents).filter(([, a]) => a.tickets.includes(id) && (a.role === 'implement' || a.role === 'fix'));
  entries.sort((x, y) => (x[1].at < y[1].at ? -1 : 1));
  const last = entries.at(-1);
  // an agent at work on another ticket now (it took a downstream ticket of a chain) is not this ticket's to message
  return last && last.status !== 'stopped' && !agentBusy(c, last[0], id) ? last[0] : null;
}

/** Whether `agent` holds an assignment in flight on a ticket other than `except`, or on a line. */
const agentBusy = (c, agent, except = null) =>
  Object.entries(c.state.tickets).some(([k, t]) => k !== except && t.assignment?.agentId === agent && t.assignment.deadline !== null) ||
  Object.values(c.state.lines).some((L) => L.assignment?.agentId === agent && L.assignment.deadline !== null);

/** The most tickets one implementation agent takes along a chain, its first included: its context grows with each. */
const CHAIN_CAP = 3;

/**
 * The idle implementation agent of a ticket's one upstream, to take this ticket next with its context of the same
 * code: the upstream passed its review (queued or later, so it will not need its agent for a fix round), and the agent
 * has taken fewer than CHAIN_CAP tickets. null when there is none (a fresh agent is spawned).
 */
function chainAgent(c, upstream) {
  const u = upstream ? c.state.tickets[upstream] : null;
  if (!u || !['queued', 'integrating', 'awaiting-ci', 'awaiting-merge', 'delivered'].includes(u.stage)) return null;
  const agent = implementerOf(c, upstream);
  const a = agent ? c.book.agents[agent] : null;
  if (!a || agentBusy(c, agent) || a.tickets.length >= CHAIN_CAP) return null;
  return agent;
}

/**
 * The file holding a ticket's full text (its ticket face), and the exec that fetches it (null when there is none to
 * wait for): the ticket file in Local Markdown; on GitHub `tick/body/<n>.md`, which tick writes from the JSON
 * `gh issue view --json title,body,comments` left in `tick/body/<n>.json` (ticketFace). It is fetched once, or once
 * more under the id suffix `again`: an expansion fetches under its own, so the implementation agent's fetch comes after
 * the expansion and carries its block; a review reads the ticket as it is then.
 */
function bodyFile(c, id, t, after, again = null) {
  if (c.cfg.tracker === 'local') return { file: join(c.git.wtOf(c.target(t.line)) ?? c.cfg.root, c.ticketPath(id)), id: null };
  const file = c.tick('body', `${keyOf(id)}.md`);
  const raw = c.tick('body', `${keyOf(id)}.json`);
  const eid = again ? `body:${id}:${again}` : `body:${id}`;
  if (c.done(eid)) {
    if (c.deps.exists(raw)) c.write(file, ticketFace(c.deps.read(raw)));
    return { file, id: null };
  }
  return { file, id: c.emit(exec(eid, 'body', ['gh', 'issue', 'view', numOf(id), '--repo', c.cfg.repo, '--json', 'title,body,comments'], { stdout: raw, tickets: [id], after })) };
}

/**
 * A GitHub ticket's face, from `gh issue view --json title,body,comments`: `# <title>`, the body, the comments under
 * `## Comments` (each `### <author> (<created>)`), then the expansion blocks under `## sorry-matt expansion` — the
 * comments whose first non-blank line is the marker (acceptance.mjs's rule), the way a Local Markdown ticket file
 * holds them. A section with nothing in it is left out. Output that is not that JSON is kept as it is.
 */
function ticketFace(text) {
  let issue;
  try {
    issue = JSON.parse(text);
  } catch {
    return text;
  }
  if (!isObject(issue)) return text;
  const str = (v) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim() : '');
  const comments = Array.isArray(issue.comments) ? issue.comments.filter(isObject) : [];
  const isBlock = (x) => str(x.body).split('\n').find((l) => l.trim())?.trim() === MARKER;
  const parts = [`# ${str(issue.title) || '(no title)'}`, str(issue.body) || '(no body)'];
  const said = comments.filter((x) => !isBlock(x));
  if (said.length) {
    parts.push('## Comments');
    for (const x of said) parts.push(`### ${str(x.author?.login) || 'unknown'}${str(x.createdAt) ? ` (${str(x.createdAt)})` : ''}`, str(x.body) || '(empty)');
  }
  const blocks = comments.filter(isBlock);
  if (blocks.length) parts.push('## sorry-matt expansion', ...blocks.map((x) => str(x.body)));
  return `${parts.join('\n\n')}\n`;
}

/**
 * Where a ticket's acceptance is (brief.mjs's `acceptance`): its snapshot's criteria, or the ticket text under
 * expand: skip when the snapshot has none. Criteria a previous run's expansion block or the ticket itself wrote are
 * someone else's acceptance and stay so under skip.
 */
function acceptanceSource(c, id) {
  if (c.profile.expand !== 'skip') return 'criteria';
  // null when missing or unreadable; a bundle has criteria only when each of its tickets has some (#205)
  const has = (m) => {
    const snap = readJsonFile(c.deps, c.snapshot(m));
    return Array.isArray(snap?.items) && snap.items.length > 0;
  };
  return c.group(id).every(has) ? 'criteria' : 'ticket-text';
}

/**
 * #205: the ticket face the agents read. A ticket's own (bodyFile), or for a bundle one file with the face of each
 * of its tickets, written once each of them is fetched; `waiting` while one is still being fetched (nothing that reads
 * the face is handed out then).
 */
function faceFile(c, id, t, after, again = null) {
  if (!c.members(id).length) return bodyFile(c, id, t, after, again);
  const parts = c.group(id).map((m) => ({ m, ...bodyFile(c, m, t, after, again) }));
  const pending = parts.find((x) => x.id)?.id ?? null;
  const file = c.tick('body', `${keyOf(id)}.bundle${again ? `-${slugOf(again)}` : ''}.md`);
  if (pending) return { file, id: pending, waiting: true };
  const ids = c.group(id);
  const head = [
    `# Bundle ${ids.join(', ')}`,
    '',
    `These ${ids.length} tickets are one bundle (#205): one implementation on one ticket branch, one review of the whole diff, one merge. Each keeps its identity: its text is below under its own heading, each acceptance criterion names its ticket, and delivering the bundle delivers every one of them. ${id}, the lead, carries the status record; each other ticket's status record points to it.`,
  ];
  const body = parts.map((x) => `---\n\n## Bundle ticket ${x.m}\n\n${c.deps.exists(x.file) ? c.deps.read(x.file).replace(/\s+$/, '') : '(its text could not be read)'}`);
  c.write(file, `${[...head, '', ...body].join('\n')}\n`);
  return { file, id: null };
}

/** #205: a bundle's snapshot: the items of each ticket's own snapshot, in bundle order, each naming its ticket. */
function bundleSnapshot(c, id) {
  const snaps = c.group(id).map((m) => ({ m, snap: readJsonFile(c.deps, c.snapshot(m)) }));
  if (snaps.some((x) => !x.snap)) return null;
  const items = snaps.flatMap(({ m, snap }) => (snap.items ?? []).map((it) => ({ ticket: m, ...it })));
  const out = {
    format: 'sorry-matt/acceptance@1',
    tracker: snaps[0].snap.tracker,
    source: snaps[0].snap.source,
    id,
    bundle: c.group(id),
    title: snaps.map(({ m, snap }) => `${m} ${snap.title ?? ''}`.trim()).join(' / '),
    items,
    expansions: snaps.flatMap(({ m, snap }) => (snap.expansions ?? []).map((e) => ({ ticket: m, ...e }))),
    needsExpansion: snaps.some(({ snap }) => snap.needsExpansion),
    sha256: createHash('sha256').update(JSON.stringify(items)).digest('hex'),
  };
  c.write(c.acceptanceFile(id), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

/**
 * The comparison of the acceptance with the snapshot for a review (acceptance.mjs --against): one exec per ticket;
 * for a bundle (#205) the one file the agents read is written once each ticket's is done, its `check` the union of
 * theirs (each item naming its ticket) and `tickets` each one's own output. `waiting` while one is still running.
 */
function againstFile(c, id, t, tag) {
  const one = (m) => {
    const file = c.tick('against', `${keyOf(m)}-${tag}.json`);
    const sha = m === id ? (t.snapshotSha256 ?? '<sha256>') : (readJsonFile(c.deps, c.snapshot(m))?.sha256 ?? '<sha256>');
    const eid = c.emit(
      exec(`against:${m}:${tag}`, 'acceptance-check', acceptanceArgv(c, m, t, ['--against', c.snapshot(m), '--sha', sha]), {
        stdout: file,
        cwd: acceptanceCwd(c),
        okExit: [0, 3],
        tickets: [id],
        line: t.line,
      }),
    );
    return { m, file, id: eid };
  };
  if (!c.members(id).length) {
    const x = one(id);
    return { file: x.file, id: x.id };
  }
  const parts = c.group(id).map(one);
  const file = c.tick('against', `${keyOf(id)}-${tag}.bundle.json`);
  const pending = parts.find((x) => x.id)?.id ?? null;
  if (pending) return { file, id: pending, waiting: true };
  const outs = parts.map((x) => ({ m: x.m, out: readJsonFile(c.deps, x.file) }));
  const named = (m, xs) => (xs ?? []).map((it) => ({ ticket: m, ...it }));
  const check = {
    against: c.acceptanceFile(id),
    snapshotIntact: outs.every((x) => x.out?.check?.snapshotIntact !== false),
    changed: outs.some((x) => !x.out || x.out.check?.changed !== false),
    removed: outs.flatMap((x) => named(x.m, x.out?.check?.removed)),
    added: outs.flatMap((x) => named(x.m, x.out?.check?.added)),
  };
  c.write(file, `${JSON.stringify({ format: 'sorry-matt/acceptance@1', id, bundle: c.group(id), check, tickets: Object.fromEntries(outs.map((x) => [x.m, x.out])) }, null, 2)}\n`);
  return { file, id: null };
}

/**
 * Hand a ticket to an agent: the assignment record (deadline.mjs record, then state.mjs assign), then the spawn, the
 * SendMessage to the agent that has the context, or the merge agent. `create` is set for a fresh dispatch from
 * candidate: the worktree and branch actions it waits for, and the stage move to implementing.
 */
function dispatchAgent(c, id, t, { role, stage, mode, worktree, reassign = false, prevAgent = null, why = null, create = null, note = null, files = null, mergeOf = null, upstream = null }) {
  const n = (c.book.dispatches[id] ?? 0) + 1;
  const tag = `${keyOf(id)}-${n}`;
  const rec = c.tick('rec', `${tag}.json`);
  const before = create?.after ?? [];
  const r1 = c.emit(exec(`rec:${id}:${n}`, 'assignment', ['node', js('deadline.mjs'), 'record', '--worktree', worktree, '--limit', String(limitFor(c, stage))], { stdout: rec, tickets: [id], line: t.line, after: before }));
  const type = mode === 'send' ? (c.book.agents[prevAgent]?.type ?? 'general-purpose') : AGENT_TYPES.implement;
  const r2 = c.emit(
    exec(`assign:${id}:${n}`, 'assignment', stateArgv(c, 'assign', id, '--record', rec, '--type', type, '--worktree', worktree, ...(reassign ? ['--reassign'] : [])), {
      tickets: [id],
      line: t.line,
      after: [r1],
    }),
  );
  let r3 = null;
  if (create) r3 = c.emit(exec(`stage:${id}:implementing:h${hist(t)}`, 'stage', stateArgv(c, 'stage', 'implementing', id), { tickets: [id], line: t.line, after: [r2, ...(create.stageAfter ?? [])] }));
  const pending = { mode, role, n, worktree, prevAgent, why, ...(upstream ? { upstream } : {}), branch: create?.branch ?? t.branch, ...(note ? { note } : {}), ...(files ? { files } : {}), ...(mergeOf ? { mergeOf } : {}) };
  c.flag(id).pending = pending;
  agentTail(c, id, t, pending, [r2, r3, ...before]);
}

const WHY = {
  red: 'its targeted checks were red: fix them to green (close-out step 1)',
  fix: "the review's findings, verbatim (summary, evidence, fix) from the status record: close them all in this one round (close-out step 3)",
  'send-back': 'the send-back record and the rebuilt worktree: redo the ticket from the latest integration branch (SEND-BACK.md)',
  chain: 'a new ticket, downstream of the one it implemented: its own spawn file, worktree and branch',
};
/** review: minimal leaves its findings in the reviewer's report file (the ticket's flag `report`), not in a review block. */
const reportAt = (flag) => (flag.report ? `${flag.report} (the reviewer's report)` : null);
/**
 * Why an agent gets the work: WHY's text for `why`, the reviewer's report for a minimal review's fix round, or
 * (#197) the saved failing output for a pr-red fix round — the PR head's CI is red, there are no review findings.
 */
const whyText = (flag, why) =>
  why === 'fix' && flag.prRed
    ? `the PR head's CI is red at ${flag.prRed.sha}; the failing runs' output is in ${flag.prRed.failure.join(', ') || 'the CI read'}: find the cause, fix it to green (do not weaken a test or a check), and the fix commit is pushed back to the same pull request (no review findings this round)`
    : why === 'fix' && reportAt(flag)
      ? `the review's findings, verbatim, in ${reportAt(flag)}: close them all in this one round (close-out step 3)`
      : (WHY[why] ?? why);

/** What fills the assignment's agent id: a spawn, a SendMessage or the merge agent's spawn. */
function agentTail(c, id, t, p, after) {
  const spawnRecord = (n) => `node ${q(SELF)} record ${q(c.path)} ${q(`spawn:${id}:${n}`)} --agent <agent id> [--type general-purpose]`;
  if (p.mode === 'send' && p.why === 'chain') {
    // a new ticket for the agent of its upstream: the same spawn file a fresh agent gets, by SendMessage
    const brief = implementBrief(c, id, t, p, after);
    if (!brief) return;
    c.emit(
      judge(
        `send:${id}:${p.n}`,
        'send',
        `SendMessage ${p.prevAgent} (it implemented ${p.upstream}, upstream of ${id}, and keeps its context of that code): "Your ticket ${p.upstream} is done. A new ticket follows it: ${id}. Read ${resolve(brief.out)} in full and follow it as a new assignment — its own worktree ${p.worktree} and branch ${p.branch}; leave ${p.upstream}'s worktree as it is." sent: it has the work; gone: it no longer exists (a new agent is spawned instead).`,
        ['sent', 'gone'],
        [doc('SKILL.md', 'section 1 (the loop)')],
        { tickets: [id], line: t.line, after: [brief.id, ...after] },
      ),
    );
    return;
  }
  if (p.mode === 'send') {
    c.emit(
      judge(
        `send:${id}:${p.n}`,
        'send',
        `SendMessage ${p.prevAgent} (it keeps its context) for ${id}: ${whyText(c.flag(id), p.why)}. sent: it has the work again; gone: it no longer exists (a new agent is spawned instead).`,
        ['sent', 'gone'],
        [doc('SKILL.md', p.why === 'red' ? 'section 2, Close-out checks and review' : p.why === 'fix' ? 'section 2, Batched fix' : 'section 1 (the loop)'), ...(p.why === 'send-back' ? [doc('SEND-BACK.md', 'step 4')] : [])],
        { tickets: [id], line: t.line, after },
      ),
    );
    return;
  }
  if (p.mode === 'merge') {
    const files = p.files?.length ? ` (${p.files.join(', ')})` : '';
    // #196, integrate: ticket-pr: the conflict is the base sync, origin/<base> merged into the ticket branch
    const sides = p.mergeOf ? `Merging ${p.mergeOf} into ${t.branch}` : `Merging ${t.branch} into ${c.target(t.line)}`;
    const command = p.mergeOf ? `git merge --no-edit ${p.mergeOf}` : `git merge --no-ff --no-edit ${t.branch}`;
    c.emit(
      judge(
        `merge-agent:${id}:${p.n}`,
        'merge-agent',
        `${sides} conflicts${files}; integrate.mjs aborted the merge, so ${p.worktree} is clean. Spawn a merge agent in the background with description \`${roleDescription('merge', [id])}\` and the merge-conflict brief (both sides' ticket text and commit messages, the intent rule): in ${p.worktree} it runs \`${command}\` again, resolves each conflict, and ends with \`git commit --no-edit\`; when it cannot resolve them safely it runs \`git merge --abort\` and reports unresolved. Record spawned with --agent.`,
        ['spawned'],
        [doc('SKILL.md', 'section 2, Merge conflicts')],
        { tickets: [id], line: t.line, after, needs: { agent: 'the merge agent id' } },
      ),
    );
    return;
  }
  // spawn: the brief from brief.mjs, then the Agent call
  const brief = implementBrief(c, id, t, p, after);
  if (!brief) return;
  const { id: b, out } = brief;
  const a = {
    id: `spawn:${id}:${p.n}`,
    kind: 'spawn',
    step: 'spawn',
    tickets: [id],
    line: t.line,
    after: [b, ...after],
    spawn: { subagent_type: AGENT_TYPES.implement, description: roleDescription(p.role, c.group(id)), prompt: `Read ${resolve(out)} in full and follow it.`, background: true, fallback: fallbackSpawn(out) },
    reference: [doc('SKILL.md', 'section 1 (the loop: spawn; general-purpose when the type is not available)')],
    record: spawnRecord(p.n),
  };
  c.emit(a);
}

/** The implementation spawn file from brief.mjs: { id: its exec's id (null when done), out }, or null while waiting. */
function implementBrief(c, id, t, p, after) {
  const body = faceFile(c, id, t, []);
  if (body.waiting) return null; // a bundle's face is written once each of its tickets is fetched (#205)
  const values = c.tick('brief', `${keyOf(id)}-${p.n}.values.json`);
  const out = c.tick('brief', `${keyOf(id)}-${p.n}.md`);
  let bodyPath = body.file;
  if (p.note) {
    if (body.id) return null; // the ticket text comes first; the note is added to it next time
    bodyPath = c.tick('body', `${keyOf(id)}-${p.n}.md`);
    c.write(bodyPath, `${c.deps.read(body.file).replace(/\s+$/, '')}\n\n${p.note}\n`);
  }
  c.write(
    values,
    `${JSON.stringify(
      {
        out,
        role: p.role,
        snapshot: c.acceptanceFile(id),
        worktree: p.worktree,
        branch: p.branch,
        integration: c.target(t.line),
        bodyFile: bodyPath,
        sendBackFile: c.deps.exists(c.sendBack(id)) ? c.sendBack(id) : null,
        acceptance: acceptanceSource(c, id), // expand: skip with no criteria — the ticket text is the acceptance
      },
      null,
      2,
    )}\n`,
  );
  const b = c.emit(exec(`brief:${id}:${p.n}`, 'brief', ['node', js('brief.mjs'), 'implement', values], { stdout: c.tick('brief', `${keyOf(id)}-${p.n}.json`), tickets: [id], line: t.line, after: [body.id, ...after] }));
  return { id: b, out };
}

/** The general-purpose spawn for a session without the agent type: brief.mjs's fallback of the spawn file `out`. */
const fallbackSpawn = (out) => ({ subagent_type: 'general-purpose', prompt: `Read ${fallbackPath(resolve(out))} in full and follow it.` });

/** An assignment with no agent id yet: the spawn or SendMessage that fills it. */
function pendingAgent(c, id, t) {
  const p = c.flag(id).pending;
  if (p?.mode === 'expand') return expandTail(c, p.round);
  if (p) return agentTail(c, id, t, p, []);
  c.emit(
    judge(
      `unnamed:${id}:h${hist(t)}`,
      'unnamed',
      `${id} has an assignment record with no agent id and no dispatch tick knows of. If an agent was spawned for it, record spawned with --agent <its id>; else record none (the assignment is released and the ticket dispatched again).`,
      ['spawned', 'none'],
      [doc('SKILL.md', 'section 1 (the loop)')],
      { tickets: [id], line: t.line },
    ),
  );
}

// ---- stages ---------------------------------------------------------------------------------------------------------

const stageTo = (c, id, t, to, { reason = null, after = [] } = {}) =>
  c.emit(exec(`stage:${id}:${to}:h${hist(t)}`, 'stage', stateArgv(c, 'stage', to, id, ...(reason ? ['--reason', reason] : [])), { tickets: [id], line: t.line, after }));

/** Findings still open with no fix round left: a raw issue (onUnfixed: file-issue) or stuck. */
function unfixed(c, id, t, what) {
  if (c.profile.onUnfixed === 'file-issue' && t.unfixedIssue) return stageTo(c, id, t, 'queued');
  // review: minimal: the open findings are in the reviewer's report; a prove-it review's are in the status record's review block
  const report = c.flag(id).report;
  if (c.profile.onUnfixed === 'file-issue') {
    return c.emit(
      judge(
        `file-issue:${id}:h${hist(t)}`,
        'file-issue',
        `${id}: ${what}. File one raw issue listing the open findings${report ? ` (they are in ${report}, the reviewer's report)` : ''} (location, one sentence, evidence path) linked to the status record, polished by ASKING section 6. Record filed with --value <issue id>; the ticket is then integrated.`,
        ['filed'],
        [doc('SKILL.md', 'section 2, Filing along the way'), doc('ASKING.md', 'section 6')],
        { tickets: [id], line: t.line, needs: { value: 'the issue id' } },
      ),
    );
  }
  const source = report ? `${report}, the reviewer's report` : 'the latest review block of its status record';
  return c.emit(
    judge(
      `stuck:${id}:h${hist(t)}`,
      'mark-stuck',
      `${id}: ${what}. Mark it stuck as SEND-BACK.md says (the stuck record with the open findings, worktree and branch removed); the open findings are in ${source}. Record stuck with --value <reason>.`,
      ['stuck'],
      [doc('SEND-BACK.md', 'Mark stuck')],
      { tickets: [id], line: t.line },
    ),
  );
}

/** The review a ticket in in-review is due: a recheck when it came back from a fix round, else the initial one. */
// #199: a review entered from integrating (the base sync changed the ticket's own change) is a recheck too
const reviewMode = (t) => (['fixing', 'integrating'].includes(t.history[lastEntry(t, 'in-review')]?.from) ? 'recheck' : 'initial');

/**
 * The fixed point of a ticket's review (#191, #195): the line's integration branch (the base branch under
 * integrate: direct). Under integrate: ticket-pr it is decided per ticket, not per line: `origin/<base>` for a ticket
 * that is not stacked, the upstream ticket's recorded branch for a stacked one (origin/<base> when none is recorded
 * yet — ticket-init refuses that order, so it does not come up in a run tick drove).
 */
const fixedPointOf = (c, t) =>
  c.profile.integrate === 'ticket-pr'
    ? // #199: once the upstream is merged the ticket is the stack's bottom, and its fixed point is the base again
      ((t.stackParent ?? null) !== null && !upstreamMerged(c, t) && c.state.tickets[t.stackParent]?.branch) || `origin/${c.cfg.base}`
    : c.target(t.line);
/** #199: whether a stacked ticket's upstream is merged (delivered with its merge recorded). */
const upstreamMerged = (c, t) => {
  const u = c.state.tickets[t.stackParent ?? ''];
  return !!u && u.stage === 'delivered' && u.merges.length > 0;
};

function stepInReview(c, id, t) {
  const k = t.history.filter((h) => h.to === 'in-review').length;
  const mode = reviewMode(t);
  const flag = c.flag(id);
  let cr = currentReview(t);
  const retrying = cr?.verdict === 'stuck' && flag.retryReviews === t.reviews.length;
  if (retrying) cr = null;
  // #143: the review host is in flight (it went to the background): its report, or the deadline scan, comes first
  if (!cr && t.assignment?.deadline && t.assignment.agentId) {
    const nudge = flag.nudge;
    if (nudge && nudge.agent === t.assignment.agentId && !nudge.sent) {
      // its turn ended with no report (incomplete): a message now, not the fallback wake-up
      c.emit(
        judge(
          `nudge:${id}:${nudge.n}`,
          'nudge',
          `SendMessage ${nudge.agent} (the review host of ${id}, still in flight): "Your turn ended without the review report. Every agent you spawned has either reported or left its notes in your notes directory: read the notes files you are missing, finish the review, and return the review report. Do not end your turn to wait for an agent that has already reported." Record sent; gone when it no longer exists (the deadline scan then hands the review out again).`,
          ['sent', 'gone'],
          [doc('REVIEWER.md', 'section 1'), doc('TIMEOUTS.md', 'the review host')],
          { tickets: [id], line: t.line, meta: { agent: nudge.agent } },
        ),
      );
    }
    return;
  }
  if (cr) {
    if (cr.verdict === 'pass') {
      // #199: a stacked ticket's own patch-id at this passed review, against its fixed point now (the upstream
      // branch): after its stack is synced (rebased) it is compared, and the same id keeps this review
      const p = stackPatch(c, id, t, `r${t.reviews.length}`);
      return stageTo(c, id, t, 'queued', { after: [p?.pending ?? null] });
    }
    if (cr.verdict === 'fix') {
      if (t.fixRounds < c.profile.fixRounds) return stageTo(c, id, t, 'fixing');
      return unfixed(c, id, t, `the ${cr.mode} review still says fix and the ${c.profile.fixRounds} fix rounds are used`);
    }
    return c.emit(
      judge(
        `review-stuck:${id}:${t.reviews.length}`,
        'review-stuck',
        `The review host returned stuck for ${id} with a release condition. Clear it and review again (record retry: the same mode, the previous review block in the status record); when it cannot be cleared, mark it stuck (SEND-BACK.md) and record stuck with --value <reason>. A review stopped by the budget hook (reason budget) awaits a ruling: record awaiting-ruling with --value <the hook's message>.`,
        ['retry', 'stuck', 'awaiting-ruling'],
        [doc('REVIEWER.md', 'section 1 and the report'), doc('SEND-BACK.md', 'Mark stuck')],
        { tickets: [id], line: t.line },
      ),
    );
  }
  // a review handed out again after its host timed out (#143) is a new review: its own ids and spawn file
  const tag = `${k}${retrying ? `.${t.reviews.length}` : ''}${flag.redispatch?.reassign ? '-t' : ''}`;
  const cmp = againstFile(c, id, t, tag);
  const against = cmp.file;
  const ag = cmp.id;
  if (cmp.waiting) return; // a bundle's comparison is written once each of its tickets' is done (#205)
  // #139: under review: full the review tier picks the review; it is judged first, once per initial review
  const tier = c.profile.review === 'full' ? reviewTier(c, id, t) : null;
  if (tier === undefined) return void faceFile(c, id, t, [], `review:${tag}`); // the ticket face is fetched meanwhile
  if (c.profile.review === 'minimal' || tier.tier === 'light') {
    const brief = c.tick('review', `${keyOf(id)}-${tag}.md`);
    const report = c.tick('review', `${keyOf(id)}-${tag}.report.md`); // the fix round's findings come from here
    const body = faceFile(c, id, t, [], `review:${tag}`); // the ticket as it is at this review
    if (body.waiting) return;
    const acceptance =
      acceptanceSource(c, id) === 'ticket-text'
        ? '- Acceptance: the ticket text is the acceptance (expand: skip, and the snapshot has no criteria).'
        : `- Acceptance: the \`items\` of the acceptance snapshot ${resolve(c.acceptanceFile(id))}.`;
    c.write(
      brief,
      [
        `# Review ${id}`,
        '',
        `You review one ticket's change and report blocking findings only. You cannot ask anyone; this is all of your brief.`,
        '',
        `- Ticket text: ${resolve(body.file)} (${c.cfg.tracker === 'local' ? 'the ticket file' : 'the full ticket text'}).`,
        acceptance,
        `- Ticket branch: ${t.branch}; compare it with ${fixedPointOf(c, t)} (\`git diff ${fixedPointOf(c, t)}...${t.branch}\`).`,
        `- Acceptance snapshot: ${c.acceptanceFile(id)}; the comparison with the ticket now: ${against}.`,
        ...(c.members(id).length ? [`- This is a bundle of ${c.group(id).join(', ')} (#205): review the whole diff once against every ticket's criteria; each criterion names its ticket.`] : []),
        `- A blocking finding is a criterion the change does not meet, or a defect it introduces that breaks behaviour. Style, taste and pre-existing problems are not findings.`,
        '',
        'Report in at most 15 lines: `verdict: pass | fix`, then one line per finding: `<id>: <file:line> <what is wrong> <evidence>`.',
        `Write your full report to ${report}, and also return it as your reply. The fix round reads its findings from that file.`,
        '',
      ].join('\n'),
    );
    return c.emit({
      id: `review:${id}:${tag}`,
      kind: 'spawn',
      step: 'review',
      tickets: [id],
      line: t.line,
      after: [ag, body.id],
      spawn: { subagent_type: 'general-purpose', description: roleDescription('review', c.group(id)), prompt: `Read ${resolve(brief)} in full and follow it.`, background: false },
      reference: [doc('SKILL.md', 'section 2, Close-out checks and review')],
      outcomes: ['pass', 'fix'],
      meta: { mode, kind: 'minimal', report, ...(tier ? { tier: tier.tier } : {}), ...(tier?.reasons ? { tierReasons: tier.reasons } : {}) },
      record: `node ${q(SELF)} record ${q(c.path)} ${q(`review:${id}:${tag}`)} --agent <agent id> --outcome pass|fix [--findings <id>,<id>]`,
    });
  }
  return proveItReview(c, id, t, { mode, tag, against, ag, previous: mode === 'recheck' || retrying, tier });
}

/**
 * #139: the review tier of the ticket's current review, from prove-it's `tier.mjs judge` on the fixed point and the
 * ticket branch, run in the repo: undefined while it is being judged; else { tier, file }, `file` null when its output
 * could not be read (the tier is then taken as full, and prove-it judges it itself). It is judged at each initial
 * review (an implementation round's); a recheck, and a retry after stuck, keep the tier of the initial review they
 * follow, so a ticket's review does not change kind between its rounds.
 */
function reviewTier(c, id, t) {
  const entries = t.history.filter((h) => h.to === 'in-review');
  // #199: a recheck after the base sync (from integrating) keeps the tier of the initial review, as a fix's does
  const k = entries.findLastIndex((h) => h.from !== 'fixing' && h.from !== 'integrating') + 1 || entries.length;
  const file = c.tick('tier', `${keyOf(id)}-${k}.json`);
  const argv = ['node', TIER_SCRIPT, 'judge', '--base', fixedPointOf(c, t), '--head', t.branch];
  if (c.emit(exec(`tier:${id}:${k}`, 'tier', argv, { stdout: file, cwd: c.cfg.root, tickets: [id], line: t.line })) !== null) return undefined;
  const out = readJsonFile(c.deps, file);
  // #156: the judge's reasons go on the review's record with its tier
  // #173: each reason whole, spaces and commas included; state.mjs takes one --tier-reason per reason
  const reasons = Array.isArray(out?.reasons) && out.reasons.length && out.reasons.every(isText) ? out.reasons : null;
  return TIERS.includes(out?.tier) ? { tier: out.tier, file, reasons } : { tier: 'full', file: null, reasons: null };
}

/**
 * The status record's place, as prove-it section 1 names it: the host's own note of it (state.mjs set
 * --status-record), else on GitHub the ticket's comment that starts with the status marker, in Local Markdown the
 * ticket file in the ticket worktree (the implementation agent keeps it there, on the ticket branch).
 */
function statusRecordOf(c, id, t) {
  if (t.statusRecord) return t.statusRecord;
  if (c.cfg.tracker === 'github') return `the comment on ${c.cfg.repo}#${numOf(id)} whose first line is \`<!-- sorry-matt:status -->\``;
  const wt = c.git.wtOf(t.branch);
  return wt ? resolve(wt, c.ticketPath(id)) : `the ticket file ${c.ticketPath(id)} on ${t.branch}`;
}

/** The line's CI coverage for prove-it (brief.mjs review's `ci`): no-origin, uncovered (settled as CI not covering it), or covered. */
const ciCoverage = (c, t) => (!c.git.hasOrigin ? 'no-origin' : c.state.lines[t.line]?.ciNotCovering ? 'uncovered' : 'covered');

/**
 * The prove-it review (#138): brief.mjs review writes the review host's spawn file from the values tick writes here —
 * every one filled, none left to the host — and the review host is spawned with it in the foreground, so the diff
 * and its output stay out of the host's context. The values file is `tick/review/<key>-<tag>.values.json`; a value
 * a later ticket adds is a key there and in brief.mjs review. Without a usable agent report (a state from before the
 * report was kept, or a timeout's collected report) a judge has it written first.
 */
function proveItReview(c, id, t, { mode, tag, against, ag, previous, tier }) {
  const flag = c.flag(id);
  if (!agentReportOk(c.deps, flag.agentReport)) {
    const file = flag.agentReport ?? c.tick('report', `${keyOf(id)}-review-${tag}.md`);
    return c.emit(
      judge(
        `agent-report:${id}:${tag}`,
        'agent-report',
        `${id} is to be reviewed, but its implementation (or fix) agent's report is not on file. Write the latest report that agent returned for ${id}, verbatim, to ${file} (the review's spawn file takes its targeted checks line from there), and record written.`,
        ['written'],
        [doc('SKILL.md', 'section 2, Close-out checks and review'), doc('agents/implementer.md', 'section 5, the report it returns')],
        { tickets: [id], line: t.line, after: [ag], meta: { agentReport: file } },
      ),
    );
  }
  const body = faceFile(c, id, t, [], `review:${tag}`); // the ticket as it is at this review
  if (body.waiting) return;
  const values = c.tick('review', `${keyOf(id)}-${tag}.values.json`);
  const out = c.tick('review', `${keyOf(id)}-${tag}.md`);
  c.write(
    values,
    `${JSON.stringify(
      {
        out,
        mode,
        root: c.cfg.root,
        tracker: c.cfg.tracker,
        ...(c.cfg.tracker === 'github' ? { repo: c.cfg.repo } : {}),
        ticket: id,
        bodyFile: body.file,
        statusRecord: statusRecordOf(c, id, t),
        snapshot: c.acceptanceFile(id),
        against,
        fixedPoint: fixedPointOf(c, t),
        branch: t.branch,
        checksReport: flag.agentReport,
        ci: ciCoverage(c, t),
        previous,
        reviewer: 'primary',
        scratchpad: join(c.cfg.worktrees, 'review', keyOf(id)),
        tier: tier?.file ?? null,
        bundle: c.members(id).length ? c.group(id) : null,
        siblings: siblingScope(c, id, tag),
      },
      null,
      2,
    )}\n`,
  );
  const b = c.emit(exec(`brief:${id}:review-${tag}`, 'brief', ['node', js('brief.mjs'), 'review', values], { stdout: c.tick('review', `${keyOf(id)}-${tag}.json`), tickets: [id], line: t.line, after: [ag, body.id] }));
  // #143: the assignment record, as for any agent: deadline.mjs record in the ticket worktree with timeout-review,
  // then state.mjs assign (--reassign when the previous review host timed out); the spawn's record names the agent
  const wt = resolve(t.assignment?.worktree ?? c.git.wtOf(t.branch) ?? c.cfg.root);
  const rec = c.tick('rec', `${keyOf(id)}-review-${tag}.json`);
  const r1 = c.emit(exec(`rec:review:${id}:${tag}`, 'assignment', ['node', js('deadline.mjs'), 'record', '--worktree', wt, '--limit', String(limitFor(c, 'in-review'))], { stdout: rec, tickets: [id], line: t.line }));
  const r2 = c.emit(
    exec(`assign:review:${id}:${tag}`, 'assignment', stateArgv(c, 'assign', id, '--record', rec, '--type', 'general-purpose', '--worktree', wt, ...(flag.redispatch?.reassign ? ['--reassign'] : [])), {
      tickets: [id],
      line: t.line,
      after: [r1],
    }),
  );
  return c.emit({
    id: `review:${id}:${tag}`,
    kind: 'spawn',
    step: 'review',
    tickets: [id],
    line: t.line,
    after: [b, ag, body.id, r2],
    spawn: { subagent_type: 'general-purpose', description: roleDescription('review', c.group(id)), prompt: `Read ${resolve(out)} in full and follow it.`, background: false },
    reference: [doc('REVIEWER.md', 'all of it (the spawn file is its rules and the values)'), doc('SKILL.md', 'section 2, Close-out checks and review')],
    outcomes: ['pass', 'fix', 'stuck'],
    meta: { mode, kind: 'full', ...(tier?.file ? { tier: tier.tier } : {}), ...(tier?.reasons ? { tierReasons: tier.reasons } : {}) },
    // #143: with its report when it returned it; --agent alone when the Agent tool put it in the background
    record: `node ${q(SELF)} record ${q(c.path)} ${q(`review:${id}:${tag}`)} --agent <agent id> --outcome pass|fix|stuck [--findings <id>,<id>] --observations <n> --pre-existing <n> [--candidates <n> --confirmed <n> --invalid <n> --blocking <n>] [--covered <n>]   (in the background: --agent <agent id> alone)`,
  });
}

/**
 * #205: the sibling scope of a review: the run's other open tickets (not at an end state, not this bundle), each with
 * its stage, title, predicted files and where its full text is, so a candidate one of them covers is not reported as
 * this ticket's. null when there is none.
 */
function siblingScope(c, id, tag) {
  const own = new Set(c.group(id));
  const rows = [];
  for (const [lead, t] of Object.entries(c.state.tickets)) {
    if (TERMINAL.includes(t.stage)) continue;
    for (const m of c.group(lead)) {
      if (own.has(m)) continue;
      const files = c.deps.exists(c.predicted(m)) ? c.deps.read(c.predicted(m)).split(/\r?\n/).map((x) => x.trim()).filter((x) => x && !x.startsWith('#')) : [];
      const text = c.cfg.tracker === 'github' ? `\`gh issue view ${numOf(m)} --repo ${c.cfg.repo}\`` : `${c.ticketPath(m)} on ${c.target(t.line)}`;
      const title = c.book.titles?.[m];
      rows.push(`- ${m}${title ? ` — ${title}` : ''} (${t.stage}${m !== lead ? `, in bundle ${lead}` : ''}); predicted files: ${files.join(', ') || 'none written'}; full text: ${text}`);
    }
  }
  if (!rows.length) return null;
  const file = c.tick('review', `${keyOf(id)}-${tag}.siblings.md`);
  c.write(
    file,
    [
      `# Sibling scope of ${[...own].join(', ')}`,
      '',
      'The other open tickets of this run. A candidate that one of them is to do (its text says so) is `covered` by it, not a finding or an observation of this review — unless it is a blocking one (acceptance, regression, red, safety): this ticket lands on its own.',
      '',
      ...rows,
    ].join('\n') + '\n',
  );
  return file;
}

/**
 * #142, #205: a review whose report counts observations or pre-existing gets a judge to file them in one raw ticket
 * per line (SKILL.md, Filing along the way). It does not hold the ticket up: the review's conclusion goes on beside
 * it. One judge at a time per line, in review order: a later one is handed out once the earlier is recorded, and
 * names the raw ticket on file for the line, which its new items join, an item already there merged, not repeated.
 */
function stepObservations(c) {
  const busy = new Set(); // lines with a judge in this list
  for (const [id, t] of Object.entries(c.state.tickets)) {
    if (busy.has(t.line)) continue;
    const at = t.reviews.findIndex((r, i) => (r.observations ?? 0) + (r.preExisting ?? 0) > 0 && !c.done(`observations:${id}:${i + 1}`));
    if (at < 0) continue;
    busy.add(t.line);
    const r = t.reviews[at];
    const o = r.observations ?? 0;
    const counts = `${o} observation${o === 1 ? '' : 's'} and ${r.preExisting ?? 0} pre-existing`;
    const where = `the \`observations\` and \`pre-existing\` sections of its ${r.mode} review block (review ${at + 1}) in ${statusRecordOf(c, id, t)}`;
    const issue = c.flag(`line:${t.line}`).observationsIssue ?? c.flag(id).observationsIssue;
    const how =
      c.cfg.tracker === 'github'
        ? '`gh issue create` without `ready-for-agent`, the body polished by ASKING section 6'
        : `the next unused ticket file in ${c.cfg.ticketsDir} with Status needs-triage, committed to ${t.line} (pushed before this wake-up ends when there is an origin)`;
    const what = issue
      ? `${id}'s ${r.mode} review reports ${counts}. Read only ${where}; add its items to ${issue}, the raw ticket of line ${t.line} (location, one sentence, evidence path each, and the ticket it came from). An item at the same location as one already there, or about the same problem, is not added again: name ${id} among that item's sources. The same raw ticket, not another. Record filed with --value ${issue}.`
      : `${id}'s ${r.mode} review reports ${counts}. Read only ${where}, and file one raw ticket for line ${t.line} listing each item (location, one sentence, evidence path, the ticket it came from), linked to the status record: ${how}. Later reviews of the line's tickets add theirs to it. It stays outside the frozen ticket set. Record filed with --value <issue id>.`;
    c.emit(
      judge(`observations:${id}:${at + 1}`, 'observations', what, ['filed'], [doc('SKILL.md', 'section 2, Filing along the way'), doc('ASKING.md', 'section 6')], {
        tickets: [id],
        line: t.line,
        needs: { value: 'issue id' },
      }),
    );
  }
}

function stepFixing(c, id, t) {
  const report = currentReport(t);
  if (report) {
    if (!report.unfixed.length) return stageTo(c, id, t, 'queued');
    return unfixed(c, id, t, `findings ${report.unfixed.join(', ')} are still open after the fix round`);
  }
  const a = t.assignment;
  if (a && a.deadline !== null) {
    if (!a.agentId) pendingAgent(c, id, t);
    return;
  }
  const flag = c.flag(id);
  const prev = implementerOf(c, id);
  const respawn = flag.redispatch?.mode === 'spawn' || !prev;
  dispatchAgent(c, id, t, {
    role: 'fix',
    stage: 'fixing',
    mode: respawn ? 'spawn' : 'send',
    worktree: a?.worktree,
    reassign: !!flag.redispatch?.reassign,
    prevAgent: prev,
    why: 'fix',
    note: respawn ? reassignNote(c, id, t, flag.redispatch) : null,
  });
}

function reassignNote(c, id, t, r) {
  const link = t.statusRecord ? ` (${t.statusRecord})` : '';
  const prRed = t.stage === 'fixing' ? c.flag(id).prRed : null; // #197: a pr-red fix round has no review findings
  const at = t.stage === 'fixing' ? reportAt(c.flag(id)) : null;
  if (!r?.reassign) return `The fix round of ${id}: ${prRed ? whyText(c.flag(id), 'fix') : `the findings are in ${at ?? `the latest review block of its status record${link}`}; close them all`}.`;
  const head = `The previous agent on ${id} timed out and was stopped. Its commits and uncommitted changes are in the worktree: decide whether to keep them.`;
  // The record it updates is always the status record; under review: minimal the findings are in the report file.
  const findings = prRed
    ? ` This fix round is for the PR head's red CI: ${whyText(c.flag(id), 'fix')}.`
    : at ? ` The findings of this fix round are in ${at}, not in the status record.` : t.stage === 'fixing' ? ' The findings of this fix round are in the latest review block there.' : '';
  return `${head} Update the existing status record in place${link}.${findings}`;
}

function stepImplementing(c, id, t) {
  const a = t.assignment;
  if (a && a.deadline !== null) {
    if (!a.agentId) pendingAgent(c, id, t);
    return;
  }
  const r = c.flag(id).redispatch;
  if (!r) return pendingAgent(c, id, t);
  const prev = implementerOf(c, id);
  const mode = r.mode === 'send' && prev ? 'send' : 'spawn';
  dispatchAgent(c, id, t, {
    role: 'implement',
    stage: 'implementing',
    mode,
    worktree: a?.worktree,
    reassign: !!r.reassign,
    prevAgent: prev,
    why: r.why ?? 'red',
    note: mode === 'spawn' ? (r.reassign ? reassignNote(c, id, t, r) : `Taking over from an agent that is gone: ${whyText(c.flag(id), r.why ?? 'red')}.`) : null,
  });
}

function stepExpanding(c, id, t) {
  const a = t.assignment;
  if (a && a.deadline !== null && !a.agentId) pendingAgent(c, id, t);
}

/** Expansion agents stopped for a timeout and to be reassigned: one new agent for all of them. */
function stepExpandReassign(c) {
  const group = Object.entries(c.state.tickets)
    .filter(([id, t]) => t.stage === 'expanding' && t.assignment?.deadline === null && c.book.flags[id]?.redispatch?.reassign)
    // #205: a lead's fingerprint holds its members' counts too; each is expanded again
    .flatMap(([id, t]) => {
      const counts = t.assignment.fingerprint?.expansions ?? {};
      return c.group(id).filter((m) => m === id || m in counts).map((m) => ({ id: m, count: counts[m] ?? 0 }));
    });
  if (!group.length) return;
  const n = Math.max(...group.map((x) => c.book.dispatches[c.leadOf(x.id)] ?? 0)) + 1;
  expandDispatch(c, `${Math.max(1, c.state.usage.rounds)}x${n}`, group, { reassign: true });
}

// ---- ticket-level pull requests (#195) ------------------------------------------------------------------------------

/** The commit the latest implementation or fix report carries (its `commit:` line; agents/implementer.md section 5), or null: no report kept, or it says none. */
function reportedCommit(c, id) {
  const file = c.flag(id).agentReport;
  if (!file) return null;
  try {
    const v = reportField(c.deps.read(file), 'commit');
    return v && !/^none\b/i.test(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * #195: under integrate: ticket-pr every ticket is its own pull request from its first reported commit on. A ticket
 * whose latest agent report carries a commit and has no PR recorded gets one `pr-open` exec (integrate.mjs pushes the
 * ticket branch and opens the draft PR; the number goes into the state); a report carrying no commit opens nothing
 * and the report's own rules go on as ever. Once the PR is recorded, a branch tip the remote does not have yet — a
 * batched fix's commit, a redo after a send-back — gets a `pr-push` exec to the same pull request; the number never
 * changes and no second PR is opened. Neither exec is marked `host` (a ticket branch is never a protected branch),
 * and the review's actions do not wait for them: the review and the PR's CI run in parallel. While an agent holds the
 * ticket (an implementation or fix round, a review host in flight) nothing is pushed: its report comes first.
 */
function stepTicketPr(c) {
  if (c.profile.integrate !== 'ticket-pr') return;
  for (const [id, t] of Object.entries(c.state.tickets)) {
    if (TERMINAL.includes(t.stage) || !t.branch) continue;
    if (t.assignment?.deadline && t.assignment.agentId) continue; // an agent is at work: its report comes first
    const tip = c.git.ref(t.branch);
    if (!tip || !reportedCommit(c, id)) continue;
    if ((t.pr ?? null) === null) {
      const title = c.book.titles?.[id] ?? String(id);
      c.emit(
        exec(`pr-open:${id}`, 'pr-open', ['node', js('integrate.mjs'), 'pr-open', c.path, id, '--title', title, '--base', c.cfg.base, '--repo', c.cfg.root], {
          stdout: c.tick('pr', `${keyOf(id)}-open.json`),
          tickets: [id],
          line: t.line,
        }),
      );
    } else if (c.git.remote(t.branch) !== tip) {
      c.emit(
        exec(`pr-push:${id}@${tip.slice(0, 12)}`, 'pr-push', ['node', js('integrate.mjs'), 'pr-push', c.path, id, '--repo', c.cfg.root], {
          stdout: c.tick('pr', `${keyOf(id)}-push-${tip.slice(0, 12)}.json`),
          tickets: [id],
          line: t.line,
        }),
      );
    }
  }
}

// ---- the ticket-pr merge path (#196) --------------------------------------------------------------------------------

/**
 * #196: under integrate: ticket-pr a reviewed ticket that is not stacked walks its own merge, one ticket at a time
 * per line: pr-merge's push phase (sync the base into the ticket branch, push; queued → integrating) → awaiting-ci
 * (ci.mjs verdict on the PR head, read once per wake-up; the wait is the existing fallback wake-up, no polling loop)
 * → green: pr-merge --ready (`gh pr ready` + merge-gate.mjs) → awaiting-merge, the merge command handed to the host
 * as a prompting call (send status `host`) → the host reports the merge sent, and pr-merge --merged (checked once
 * per wake-up) records the merge SHA and delivers. Without merge authorization the host records left-for-human: the
 * PR stays ready for a person, and the ticket is delivered with a left-for-human record (state.mjs set
 * --left-for-human). A red PR head goes to a fix round (the fix commit is pushed back to the same PR by
 * stepTicketPr); cancelled is rerun once and no-run counted per ticket, as the line-level CI rules have it. A
 * stacked ticket parks at queued: its stack's merge order is not driven here.
 */
function stepPrMerge(c) {
  prCloseIssues(c);
  const paused = prBaseRed(c); // #197: a red base pauses new push phases until the revert PR lands
  const byLine = new Map();
  for (const [id, t] of Object.entries(c.state.tickets)) {
    if (!byLine.has(t.line)) byLine.set(t.line, []);
    byLine.get(t.line).push([id, t]);
  }
  for (const tickets of byLine.values()) {
    let busy = false;
    for (const [id, t] of tickets) {
      if (t.stage === 'integrating') prIntegrating(c, id, t);
      else if (t.stage === 'awaiting-ci') prAwaitCi(c, id, t);
      else if (t.stage === 'awaiting-merge') prAwaitMerge(c, id, t);
      else continue;
      busy = true;
    }
    if (busy || paused) continue;
    // #199: a stacked ticket walks the merge path once the ticket below it has merged (it is then the stack's bottom:
    // stacks merge from the bottom up, each with gh stack merge), and its push phase — gh stack sync, which rebases
    // the stack — only while no agent is at work anywhere in its stack (gh stack stops at a dirty or busy worktree)
    const stackIdle = (id) => stackOf(c, id).every((k) => !(c.state.tickets[k].assignment?.deadline && c.state.tickets[k].assignment.agentId));
    const queued = tickets
      .filter(([id, t]) => t.stage === 'queued' && ((t.stackParent ?? null) === null || (upstreamMerged(c, t) && stackIdle(id))) && (t.pr ?? null) !== null && t.branch)
      .sort((x, y) => ((x[1].history[lastEntry(x[1], 'queued')]?.at ?? '') < (y[1].history[lastEntry(y[1], 'queued')]?.at ?? '') ? -1 : 1));
    if (queued.length) prPushPhase(c, queued[0][0], queued[0][1]); // the push phase moves queued → integrating itself
  }
}

/**
 * #197: the base branch's CI after a merge, under integrate: ticket-pr. Once any ticket has a merge recorded, the
 * base verdict is read once per wake-up (ci.mjs base). A red opens an episode (book.baseRed): the earliest-red scan
 * runs against the base itself (ruling 1: the plan's `line` is the base branch, its lower bound the parent of the
 * oldest recorded merge), the red is mapped to the causing ticket by merge order and merge SHA (the recorded merges
 * in the stretch from the first green up to the earliest red, the oldest first), and integrate.mjs revert opens the
 * revert PR — never a base push — with the tickets depending on the reverted one (by stackParent and waitingOn,
 * transitively) as --dependent: they get the upstream-reverted handling. The revert PR's own CI is read once per
 * wake-up; once green the merge goes to the host as a prompting call (ruling 2: a mechanical revert, no review),
 * sent under merge authorization or left for a person. The base is then read again each wake-up (and at once when
 * its tip moves within the wake-up: the read is keyed by the tip); green ends the episode, and a base red at another
 * SHA (the next causing ticket's red once the revert landed, or red anew) opens a new episode instance, so the scan
 * reruns and the next ticket is mapped and reverted — tickets whose merges are already reverted on the base are
 * never mapped again, and a ticket is reverted once. A red that the walk cannot pin above this run's merges (no
 * green concluded inside the walk, and the base verdict at the lower bound is red: the red was there before the
 * oldest merge) maps to no ticket, like a stretch with no recorded merge: a `base-red-unmatched` judge, one per
 * episode instance, and after `settled` the base keeps being read each wake-up until it is green. Returns true
 * while an episode is open: new push phases wait, and the finish does too (unless the revert is left for a person).
 */
function prBaseRed(c) {
  if (c.profile.ci === 'skip') return false;
  const merged = Object.entries(c.state.tickets).filter(([, t]) => t.merges.length);
  if (!merged.length) return false;
  // The base read is keyed by the wake-up and the base tip as this repository sees it: a merge seen within the
  // wake-up (a revert PR merged and fetched) is a new read, and a read never outlives the tip it was taken at.
  const baseTip = c.git.remote(c.cfg.base);
  const key = `${baseTip ? baseTip.slice(0, 12) : 'none'}-w${c.book.wakeup}`;
  const out = c.tick('ci', `base-${key}.json`);
  const read = c.emit(
    exec(`base-ci:${key}`, 'base-ci', ['node', js('ci.mjs'), 'base', ...(c.cfg.repo ? ['--repo', c.cfg.repo] : []), c.cfg.base], {
      stdout: out,
      cwd: c.cfg.repo ? null : c.cfg.root,
    }),
  );
  if (read !== null) return !!c.book.baseRed;
  const v = readJsonFile(c.deps, out);
  c.book.baseSeen = { tip: baseTip, verdict: v?.verdict ?? null }; // the finish waits for a concluded read at the current tip
  if (v?.verdict === 'green') {
    delete c.book.baseRed; // the revert landed (or the red cleared): the episode is over
    return false;
  }
  const redNow = v?.verdict === 'red' && v.sha ? v.sha : null;
  if (!redNow) return !!c.book.baseRed; // running, no run or unread: an open episode stays open
  let red = c.book.baseRed ?? null;
  // Settled, or the revert sent (or left for a person), at this same red: wait for the base to move. A red at
  // another SHA — still red after a revert landed, or red anew — opens a new episode instance (F1, F2, review 1):
  // the scan reruns, and tickets whose merges are already reverted on the base are never mapped again.
  if (red && red.sha === redNow && (red.sent || red.settled)) return true;
  if (!red || red.sha !== redNow) red = c.book.baseRed = { sha: redNow, at: c.now, n: (c.book.baseRedN = (c.book.baseRedN ?? 0) + 1) };
  const sha12 = red.sha.slice(0, 12);
  // the walk and the mapping read the base's history: fetch it first, once per episode instance
  if (c.git.hasOrigin && c.emit(exec(`base-fetch:${sha12}:e${red.n}`, 'sync-base', ['git', '-C', c.cfg.root, 'fetch', 'origin', c.cfg.base]))) return true;
  // a ticket whose merges are all reverted on the base already (an earlier episode's revert PR merged) is never mapped
  // again; the revert commit may sit on a merged revert PR's side of the history, so the whole history is searched
  const revertedOnBase = (t) =>
    t.merges.every((m) => {
      try {
        return c.deps.git(c.cfg.root, ['log', '--format=%H', '--fixed-strings', `--grep=This reverts commit ${m.sha}`, `${m.sha}..origin/${c.cfg.base}`]).trim() !== '';
      } catch {
        return false;
      }
    });
  // An earlier episode's revert that has not landed on the base yet is finished first, before any new mapping: a
  // red at a new SHA (another merge landing meanwhile) must not strand a revert PR that was opened and not merged.
  const pending = merged.find(([id, t]) => c.done(`revert:${keyOf(id)}`) && !revertedOnBase(t));
  const cause = pending ?? baseRedCause(c, red, merged, revertedOnBase);
  if (!Array.isArray(cause)) return cause;
  return baseRedRevert(c, red, cause);
}

/**
 * #197: the base-red episode's mapping (ruling 1) — the earliest-red scan against the base, the pre-existing-red
 * guard, and the causing ticket by merge order and merge SHA. Returns [id, ticket], or prBaseRed's return value.
 */
function baseRedCause(c, red, merged, revertedOnBase) {
  const sha12 = red.sha.slice(0, 12);
  // ruling 1: the earliest-red scan against the base; the walk reaches back past the oldest recorded merge
  const shas = merged.flatMap(([, t]) => t.merges.map((m) => m.sha));
  let oldest = shas[0];
  for (const s of shas.slice(1)) if (c.git.ancestor(s, oldest)) oldest = s;
  const plan = c.tick('ci', `base-${sha12}.plan.json`);
  c.write(
    plan,
    `${JSON.stringify(
      {
        worktree: c.cfg.root,
        line: c.cfg.base,
        base: `${oldest}^`,
        ci: true,
        ...(c.cfg.repo ? { repo: c.cfg.repo } : {}),
        tickets: merged.map(([id, t]) => ({ id, merges: t.merges.map((m) => m.sha), ...(t.branch ? { branch: t.branch } : {}) })),
      },
      null,
      2,
    )}\n`,
  );
  const scanOut = c.tick('ci', `base-${sha12}.json`);
  if (c.emit(exec(`base-scan:${sha12}`, 'base-scan', ['node', js('ci.mjs'), 'earliest-red', plan], { stdout: scanOut, cwd: c.cfg.root })) !== null) return true;
  const scan = readJsonFile(c.deps, scanOut);
  if (!scan) return true; // the scan's output could not be read; its exec's failure judge leads
  if (scan.earliestRed === null) {
    // nothing concluded red in the walk although the base read red: the episode stays open (pushes stay paused)
    // and the base is read afresh next wake-up, where a new tip or a green read moves it on
    red.settled = true;
    return true;
  }
  // F3 (review 1): the pre-existing-red guard. The plan's `base` is a raw SHA, so ci.mjs's own baseCi guard cannot
  // query runs by it; when no green concluded inside the walk (lowerBound kind merge-base), the red may pre-date
  // this run's merges — the base verdict at the lower bound, a branch-valid query, decides. Red there: the red was
  // on the base below the oldest merge and belongs to no ticket of this run. Any other verdict (green, no-run,
  // running, query-failed) changes nothing, as ci.mjs's guard has it.
  if (scan.lowerBound?.kind === 'merge-base') {
    const lowOut = c.tick('ci', `base-low-${sha12}.json`);
    const lowRead = c.emit(
      exec(`base-low:${sha12}`, 'ci-read', ['node', js('ci.mjs'), 'verdict', ...(c.cfg.repo ? ['--repo', c.cfg.repo] : []), c.cfg.base, scan.lowerBound.sha], {
        stdout: lowOut,
        cwd: c.cfg.repo ? null : c.cfg.root,
      }),
    );
    if (lowRead !== null) return true;
    if (readJsonFile(c.deps, lowOut)?.verdict === 'red') {
      return baseRedUnmatched(c, red, `the base was already red at ${scan.lowerBound.sha}, below this run's oldest merge (the scan is in ${scanOut})`);
    }
  }
  // the causing tickets, by merge order and merge SHA: the recorded merges in the stretch, the oldest merge first
  let stretch = null;
  try {
    stretch = c.deps
      .git(c.cfg.root, ['rev-list', '--first-parent', `${scan.lowerBound.sha}..${scan.earliestRed}`])
      .split(/\r?\n/)
      .filter(Boolean)
      .reverse();
  } catch {}
  if (stretch === null) return true; // git could not walk the stretch: tried again at the next list or wake-up
  const at = (t) => Math.min(...t.merges.map((m) => stretch.indexOf(m.sha)).filter((i) => i >= 0));
  const causing = merged.filter(([, t]) => t.merges.some((m) => stretch.includes(m.sha)) && !revertedOnBase(t)).sort((a, b) => at(a[1]) - at(b[1]));
  if (!causing.length) {
    return baseRedUnmatched(c, red, `no recorded merge of this run that is not already reverted lies in ${scan.lowerBound.sha}..${scan.earliestRed} (the scan is in ${scanOut})`);
  }
  return causing[0];
}

/**
 * #197: the revert of the causing ticket — integrate.mjs revert opens the revert PR (once per ticket) with its
 * dependents, its own CI is read, and green brings the merge as a prompting call (ruling 2).
 */
function baseRedRevert(c, red, [tid, t]) {
  const sha12 = red.sha.slice(0, 12);
  // the tickets depending on the reverted one, by stackParent and waitingOn, transitively
  const seen = new Set([tid]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [id2, t2] of Object.entries(c.state.tickets)) {
      if (seen.has(id2)) continue;
      if (((t2.stackParent ?? null) !== null && seen.has(t2.stackParent)) || (t2.waitingOn ?? []).some((x) => seen.has(x))) {
        seen.add(id2);
        grew = true;
      }
    }
  }
  const dependents = [...seen].filter((x) => x !== tid);
  const out2 = c.tick('pr', `${keyOf(tid)}-revert.json`);
  const revertId = c.emit(
    exec(
      `revert:${keyOf(tid)}`, // once per ticket: a later episode that still maps it (its revert not landed) goes on
      'revert',
      [
        'node',
        js('integrate.mjs'),
        'revert',
        c.path,
        tid,
        '--worktree',
        join(c.cfg.worktrees, `${keyOf(tid)}-revert`),
        '--reason',
        `base CI red at ${red.sha}`,
        '--base',
        c.cfg.base,
        '--repo',
        c.cfg.root,
        ...dependents.flatMap((d) => ['--dependent', d]),
      ],
      { stdout: out2, tickets: [tid], line: t.line },
    ),
  );
  if (revertId !== null) return true;
  const rv = readJsonFile(c.deps, out2);
  const rbranch = rv?.revertBranch ?? null;
  const pr = rv?.pr ?? null;
  if (!rbranch || pr === null) return true; // the output could not be read; the revert exec's failure judge leads
  // ruling 2: the revert PR is merged only after its own CI is green — read once per wake-up, then the prompting call
  const tip = c.git.ref(rbranch);
  const head = c.git.remote(rbranch);
  if (!tip || !head || head !== tip) return true;
  const head12 = head.slice(0, 12);
  const ciOut = c.tick('ci', `revert-${keyOf(tid)}-w${c.book.wakeup}.json`);
  const ciRead2 = c.emit(
    exec(`revert-ci:${tid}@${head12}:w${c.book.wakeup}`, 'ci-read', ['node', js('ci.mjs'), 'verdict', ...(c.cfg.repo ? ['--repo', c.cfg.repo] : []), rbranch, head], {
      stdout: ciOut,
      cwd: c.cfg.repo ? null : c.cfg.root,
      tickets: [tid],
      line: t.line,
    }),
  );
  if (ciRead2 !== null) return true;
  const v2 = readJsonFile(c.deps, ciOut);
  if (v2?.verdict !== 'green') return true; // red, running or unread: read again next wake-up (the fallback waits)
  if (c.done(`revert-send:${tid}:${pr}`)) {
    red.sent = true; // sent (or left for a person) already: back to reading the base until it is green (F1, review 1)
    return true;
  }
  c.emit(
    judge(
      `revert-send:${tid}:${pr}`,
      'revert-send',
      `The revert pull request ${pr} (${rbranch}, reverting ${tid}) is green on CI. It is a mechanical revert: no review (ruling 2). With merge authorization — a standing grant in the ledger's authorization field, or the user's instruction this run — run \`gh pr merge ${pr}\` with your own tool under the user's permission settings (never --admin, never auto-merge) and record sent. Without authorization record left-for-human: the merge goes on the human-work list. Either way tick reads the base again, and the episode ends when it is green.`,
      ['sent', 'left-for-human'],
      [doc('RED-LIGHT.md', 'the ticket-pr handling (a red base)'), doc('FINISH.md', 'the merge where authority allows')],
      { tickets: [tid], line: t.line, meta: { pr, branch: rbranch, command: `gh pr merge ${pr}` } },
    ),
  );
  return true;
}

/**
 * #197: a base red that maps to no ticket, one judge per episode instance (F2, review 1: a per-SHA id could never
 * come back after `settled` at a red that stays). `settled` keeps the episode in a settled state: the base is read
 * each wake-up until it is green, and a red at a new SHA re-opens the episode (a new instance, a new judge).
 */
function baseRedUnmatched(c, red, why) {
  c.emit(
    judge(
      `base-red-unmatched:${red.sha.slice(0, 12)}:e${red.n ?? 1}`,
      'base-red-unmatched',
      `The base branch ${c.cfg.base} is red at ${red.sha}, and ${why}. The red did not come in with a merge this run can revert: settle it outside this run (a fix on the base, or a person on the human-work list) and record settled; tick then keeps reading the base each wake-up until it is green.`,
      ['settled'],
      [doc('RED-LIGHT.md', 'the ticket-pr handling (a red base)')],
      { meta: { sha: red.sha } },
    ),
  );
  return true;
}

/**
 * #196: after a ticket's merge the issue may still be open (`Closes` did not fire, or was edited away): its state is
 * read once, and an open one is closed with a comment pointing at the PR — idempotent, never relying on `Closes`.
 * A bundle closes every member's issue; a left-for-human ticket has no merge yet, so the person closing is theirs.
 */
function prCloseIssues(c) {
  if (c.cfg.tracker !== 'github') return;
  for (const [id, t] of Object.entries(c.state.tickets)) {
    if (t.stage !== 'delivered' || !t.merges.length) continue;
    for (const m of c.group(id)) {
      const out = c.tick('pr', `issue-${keyOf(m)}.json`);
      if (c.emit(exec(`issue-state:${m}`, 'issue-state', ['gh', 'issue', 'view', numOf(m), '--json', 'state', ...(c.cfg.repo ? ['--repo', c.cfg.repo] : [])], { stdout: out, tickets: [id], line: t.line })) !== null) continue;
      if (readJsonFile(c.deps, out)?.state !== 'OPEN') continue; // closed already (Closes fired): nothing to do
      c.emit(
        exec(`issue-close:${m}`, 'issue-close', ['gh', 'issue', 'close', numOf(m), '--comment', `Delivered by pull request #${t.pr} (merge ${t.merges.at(-1).sha}).`, ...(c.cfg.repo ? ['--repo', c.cfg.repo] : [])], {
          tickets: [id],
          line: t.line,
        }),
      );
    }
  }
}

/** A ticket integrating under ticket-pr: its base sync's conflict goes to a merge agent, else the push phase runs. */
function prIntegrating(c, id, t) {
  const flag = c.flag(id);
  if (flag.sendBack) {
    c.emit(
      judge(
        `send-back:${id}:h${hist(t)}`,
        'send-back',
        `Send ${id} back for a redo as SEND-BACK.md says (integrate.mjs send-back with --base ${c.cfg.base}, then the send-back record, also written to ${c.sendBack(id)}, and the widened prediction; the pull request #${t.pr} stays open, and the redo is pushed to it). Record sent-back; when it was sent back once already, mark it stuck instead (SEND-BACK.md) and record stuck with --value <reason>.`,
        ['sent-back', 'stuck'],
        [doc('SEND-BACK.md', 'Send back for a redo')],
        { tickets: [id], line: t.line },
      ),
    );
    return;
  }
  const a = t.assignment;
  if (a && a.deadline !== null) {
    if (!a.agentId) pendingAgent(c, id, t);
    return; // the merge agent resolves the base sync's conflict in the ticket worktree
  }
  prPushPhase(c, id, t);
}

/** pr-merge's push phase; exit 0 → awaiting-ci, exit 4 (base-sync conflict, aborted) → a merge agent, then a rerun. */
function prPushPhase(c, id, t) {
  const flag = c.flag(id);
  let n = flag.prSync ?? 1;
  // A ticket back at queued with its attempt already spent (a pr-red fix round re-queued it; the push phase itself
  // leaves queued at once) starts a new attempt: the spent exec id must not swallow the new round (review F1).
  // #222: spent means it pushed (exit 0). A conflict (4) or a divergence (5) leaves the ticket at queued too, and
  // that attempt is not spent: its merge agent or its ruling comes first, or each pass would sync again for ever.
  if (t.stage === 'queued' && c.book.done[`pr-sync:${id}:${n}`]?.exit === 0) flag.prSync = n += 1;
  const pid = `pr-sync:${id}:${n}`;
  const out = c.tick('pr', `${keyOf(id)}-sync-${n}.json`);
  if (c.emit(exec(pid, 'pr-merge', ['node', js('integrate.mjs'), 'pr-merge', c.path, id, '--base', c.cfg.base, '--repo', c.cfg.root], { stdout: out, okExit: [0, 4, 5], tickets: [id], line: t.line })) !== null) return;
  const done = c.book.done[pid];
  if (done.exit === 0) {
    // #199: a resolved conflict of the base sync changed the ticket's own change: a recheck (the initial review's
    // tier) before the PR head's CI, as for a fix
    if (n > (flag.prSyncFrom ?? 1) && c.book.done[`pr-sync:${id}:${n - 1}`]?.exit === 4 && t.reviews.length) return void stageTo(c, id, t, 'in-review');
    // #199: a stacked ticket's sync rebased it (new SHAs): its own patch-id against its fixed point now is compared
    // with the one taken when its review passed — the same keeps the review, any other (or none on record) rechecks
    if ((t.stackParent ?? null) !== null && t.reviews.length) {
      const now = stackPatch(c, id, t, `s${n}`);
      if (now.pending) return;
      const before = readJsonFile(c.deps, c.tick('pr', `${keyOf(id)}-patch-r${t.reviews.length}.json`));
      const after = readJsonFile(c.deps, now.file);
      if (!before?.patchId || before.patchId !== after?.patchId) return void stageTo(c, id, t, 'in-review');
    }
    return void stageTo(c, id, t, 'awaiting-ci');
  }
  if (done.exit === 4) {
    // the conflict of merging origin/<base> into the ticket branch; the rerun after the resolution is a new attempt
    const handed = Object.values(c.book.agents).some((x) => x.role === 'merge' && x.tickets.includes(id) && x.at >= done.at);
    if (!handed) {
      const o = readJsonFile(c.deps, out);
      dispatchAgent(c, id, t, { role: 'merge', stage: 'integrating', mode: 'merge', worktree: c.git.wtOf(t.branch) ?? c.cfg.root, files: Array.isArray(o?.files) ? o.files : null, mergeOf: `origin/${c.cfg.base}` });
      // #222: a conflict leaves the state as it was (integrate.mjs pr-merge), so a queued ticket is moved to
      // integrating here, at once: back at queued its spent attempt would start a new sync, never the merge agent's
      // wait. The attempt stays this one until the merge agent is handed the conflict.
      if (t.stage === 'queued') stageTo(c, id, t, 'integrating', { reason: 'base sync conflict' });
      return;
    }
    flag.prSync = n + 1; // handed and reported: the rerun after the resolution, now
    return void prPushPhase(c, id, t);
  }
  // exit 5: gh stack sync aborted on stack divergence — a ruling, not a retry
  c.emit(
    judge(
      `pr-diverged:${id}:${n}`,
      'pr-diverged',
      `${id}'s stack diverged while pr-merge synced it (${out} holds the lines). Rule on the divergence (whose branch moved, what the stack should look like), put it right, and record retry; or record stuck / awaiting-ruling with --value <reason>.`,
      ['retry', 'stuck', 'awaiting-ruling'],
      [{ path: js('integrate.mjs'), part: 'header, pr-merge (diverged)' }],
      { tickets: [id], line: t.line, meta: { of: pid } },
    ),
  );
}

/**
 * #199: the patch-id exec of a stacked ticket's own change against its fixed point now (integrate.mjs patch-id),
 * under `tag`: { pending: its id while it runs, else null; file }, or null for a ticket that is not stacked.
 */
function stackPatch(c, id, t, tag) {
  if (c.profile.integrate !== 'ticket-pr' || (t.stackParent ?? null) === null || !t.branch) return null;
  const file = c.tick('pr', `${keyOf(id)}-patch-${tag}.json`);
  const pending = c.emit(
    exec(`patch:${id}:${tag}`, 'patch-id', ['node', js('integrate.mjs'), 'patch-id', c.path, id, '--from', fixedPointOf(c, t), '--repo', c.cfg.root], {
      stdout: file,
      tickets: [id],
      line: t.line,
    }),
  );
  return { pending, file };
}

/** #199: the tickets of `id`'s stack, below and above it (by stackParent), `id` left out. */
function stackOf(c, id) {
  const out = new Set();
  for (let p = c.state.tickets[id]?.stackParent ?? null; p !== null && !out.has(p); p = c.state.tickets[p]?.stackParent ?? null) out.add(p);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [k, t] of Object.entries(c.state.tickets)) {
      if (k === id || out.has(k) || (t.stackParent ?? null) === null) continue;
      if (t.stackParent === id || out.has(t.stackParent)) {
        out.add(k);
        grew = true;
      }
    }
  }
  return [...out];
}

/** A ticket awaiting CI on its PR head: one ci.mjs read per wake-up; green goes on to the ready phase. */
function prAwaitCi(c, id, t) {
  const flag = c.flag(id);
  const tip = c.git.ref(t.branch);
  const head = c.git.remote(t.branch);
  if (!tip || !head || head !== tip) return; // stepTicketPr pushes the tip first; CI is read at the pushed head
  const head12 = head.slice(0, 12);
  if (flag.prCiWaived === head) return void prReadyPhase(c, id, t, head12);
  const out = c.tick('ci', `pr-${keyOf(id)}-w${c.book.wakeup}.json`);
  const readId = `pr-ci:${id}@${head12}:w${c.book.wakeup}`;
  if (c.emit(exec(readId, 'ci-read', ['node', js('ci.mjs'), 'verdict', ...(c.cfg.repo ? ['--repo', c.cfg.repo] : []), t.branch, head], { stdout: out, cwd: c.cfg.repo ? null : c.cfg.root, tickets: [id], line: t.line })) !== null) return;
  const v = readJsonFile(c.deps, out);
  const verdict = v?.verdict ?? null;
  if (verdict) flag.prCi = { sha: head, verdict }; // #200: the PR head's last CI result, for the reconciliation table
  if (verdict !== 'no-run' && flag.prNoRun) {
    delete flag.prNoRun;
    delete flag.prNoRunAt;
  }
  if (verdict === 'green') return void prReadyPhase(c, id, t, head12);
  if (verdict === 'red') {
    const fixable = t.fixRounds < c.profile.fixRounds;
    // #197: this red is the ticket's own — no earliest-red scan. The failing runs' output is saved first, from the
    // verdict's `failed` ids, and the fix round points its original agent at it.
    const logs = [];
    const after = [];
    for (const run of v?.failed ?? []) {
      const log = c.tick('ci-fix', `pr-${keyOf(id)}-${head12}-${run}.log`);
      const did = c.emit(
        exec(`pr-red-log:${id}@${head12}:${run}`, 'ci-log', ['gh', 'run', 'view', String(run), '--log-failed', ...(c.cfg.repo ? ['--repo', c.cfg.repo] : [])], {
          stdout: log,
          cwd: c.cfg.repo ? null : c.cfg.root,
          tickets: [id],
          line: t.line,
        }),
      );
      if (did) after.push(did);
      logs.push(log);
    }
    c.emit(
      judge(
        `pr-red:${id}@${head12}`,
        'pr-red',
        `${id}'s pull request head ${head} (${t.branch}) is red on CI${logs.length ? `; the failing runs' output is saved to ${logs.join(', ')}` : ''}. This red belongs to this ticket alone: no earliest-red scan.${fixable ? ' Record fix: the ticket goes to a fix round for its original agent, pointed at that failing output (not at review findings), and the fix commit is pushed back to the same PR.' : ` The ${c.profile.fixRounds} fix rounds are used.`} Or record stuck / awaiting-ruling with --value <reason>.`,
        [...(fixable ? ['fix'] : []), 'stuck', 'awaiting-ruling'],
        [doc('RED-LIGHT.md', 'the ticket-pr handling (a red PR head)')],
        { tickets: [id], line: t.line, after, meta: { sha: head, failure: logs } },
      ),
    );
    return;
  }
  if (verdict === 'cancelled') {
    // the line-level rule, applied to the PR head run: rerun each cancelled run once, read again next wake-up
    for (const run of v?.rerun ?? []) c.emit(exec(`pr-rerun:${id}:${run}`, 'ci-rerun', ['gh', 'run', 'rerun', String(run), ...(c.cfg.repo ? ['--repo', c.cfg.repo] : [])], { tickets: [id], line: t.line }));
    return;
  }
  if (verdict === 'no-run' && v?.reason === 'empty') {
    // the line-level no-run counting, per ticket: at two empty reads the branch's run list settles it
    if (flag.prNoRunAt !== readId) {
      flag.prNoRun = (flag.prNoRun ?? 0) + 1;
      flag.prNoRunAt = readId;
    }
    if ((flag.prNoRun ?? 0) < 2) return;
    const runsOut = c.tick('ci', `pr-${keyOf(id)}-branch-w${c.book.wakeup}.json`);
    if (c.emit(exec(`pr-ci-branch:${id}:w${c.book.wakeup}`, 'ci-branch', ['gh', 'run', 'list', '--branch', t.branch, '--limit', '1', '--json', 'databaseId', ...(c.cfg.repo ? ['--repo', c.cfg.repo] : [])], { stdout: runsOut, cwd: c.cfg.repo ? null : c.cfg.root, tickets: [id], line: t.line })) !== null) return;
    const listed = readJsonFile(c.deps, runsOut);
    if (Array.isArray(listed) && listed.length === 0) {
      c.emit(
        judge(
          `pr-no-ci:${id}@${head12}`,
          'pr-no-ci',
          `No CI run covers ${id}'s pull request head ${head} after two reads, and ${t.branch} has no runs at all. Record ready to go on to the ready phase (merge-gate.mjs still guards the merge); or record stuck / awaiting-ruling with --value <reason>.`,
          ['ready', 'stuck', 'awaiting-ruling'],
          [{ path: js('ci.mjs'), part: 'header (no-run)' }],
          { tickets: [id], line: t.line, meta: { sha: head } },
        ),
      );
    }
    return;
  }
  // running or query-failed: read again next wake-up; the wait is the fallback wake-up
}

/** pr-merge --ready (`gh pr ready` + merge-gate.mjs), then awaiting-merge and the merge handed to the host. */
function prReadyPhase(c, id, t, head12) {
  const out = c.tick('pr', `${keyOf(id)}-ready-${head12}.json`);
  if (c.emit(exec(`pr-ready:${id}@${head12}`, 'pr-ready', ['node', js('integrate.mjs'), 'pr-merge', c.path, id, '--ready', '--base', c.cfg.base, '--repo', c.cfg.root], { stdout: out, tickets: [id], line: t.line })) !== null) return;
  c.flag(id).prReady = out;
  const s = stageTo(c, id, t, 'awaiting-merge');
  prSendJudge(c, id, t, readJsonFile(c.deps, out), s ? [s] : []);
}

/**
 * The prompting call of the merge (#196): the command goes to the host, which sends it only under merge
 * authorization (a standing grant in the ledger's authorization field, or the user's instruction this run) with its
 * own tool, under the user's permission settings; without authorization the ticket is recorded left-for-human.
 * True while the judge is still open.
 */
function prSendJudge(c, id, t, ready, after) {
  const sid = `pr-send:${id}:${t.pr}`;
  if (c.done(sid)) return false;
  const gate = ready?.gate ?? null;
  const send = ready?.send ?? null;
  const human = send?.status !== 'host';
  const command = send?.command ?? `gh pr merge ${t.pr}`;
  const what = human
    ? `${id}'s pull request ${t.pr} is ready, and merge-gate.mjs says a person merges it (${gate ? `${gate.decision}: ${gate.reason}` : 'its output could not be read'}). Put the merge on the human-work list and record left-for-human: the ticket is delivered with a left-for-human record. Or record stuck / awaiting-ruling with --value <reason>.`
    : `${id}'s pull request ${t.pr} is ready (merge-gate.mjs: ${gate.decision}, ${gate.reason}). With merge authorization — a standing grant in the ledger's authorization field, or the user's instruction this run — run \`${command}\` with your own tool under the user's permission settings (never --admin, never auto-merge) and record sent: tick then watches for the merge, GitHub's merge queue included. Without authorization record left-for-human: the PR stays ready for a person to merge and the ticket is delivered with a left-for-human record. Or record stuck / awaiting-ruling with --value <reason>.`;
  c.emit(
    judge(sid, 'pr-send', what, [...(human ? [] : ['sent']), 'left-for-human', 'stuck', 'awaiting-ruling'], [doc('FINISH.md', 'the merge where authority allows'), { path: js('merge-gate.mjs'), part: 'header (decisions)' }], {
      tickets: [id],
      line: t.line,
      after,
      meta: { pr: t.pr, command },
    }),
  );
  return true;
}

/** A ticket awaiting its merge: once the command was sent, pr-merge --merged is checked once per wake-up. */
function prAwaitMerge(c, id, t) {
  const flag = c.flag(id);
  const ready = flag.prReady ? readJsonFile(c.deps, flag.prReady) : null;
  if (prSendJudge(c, id, t, ready, [])) return;
  if (c.book.done[`pr-send:${id}:${t.pr}`]?.outcome !== 'sent') return; // left-for-human and the rulings moved it in record
  // exit 3: the PR is not merged yet (the queue is running); checked again next wake-up — the fallback wake-up waits
  c.emit(
    exec(`pr-merged:${id}:w${c.book.wakeup}`, 'pr-merged', ['node', js('integrate.mjs'), 'pr-merge', c.path, id, '--merged', '--repo', c.cfg.root], {
      stdout: c.tick('pr', `${keyOf(id)}-merged-w${c.book.wakeup}.json`),
      okExit: [0, 3],
      tickets: [id],
      line: t.line,
    }),
  );
}

// ---- integration ----------------------------------------------------------------------------------------------------

function stepIntegration(c) {
  // #195: under integrate: ticket-pr nothing merges into an integration branch — the line has none (#193). The
  // merge path is the ticket's own pull request's: integrate.mjs pr-merge, driven by stepPrMerge (#196).
  if (c.profile.integrate === 'ticket-pr') return stepPrMerge(c);
  const { state, book } = c;
  const byTarget = new Map();
  for (const [id, t] of Object.entries(state.tickets)) {
    const target = c.target(t.line);
    if (!byTarget.has(target)) byTarget.set(target, []);
    byTarget.get(target).push([id, t]);
  }
  for (const [target, tickets] of byTarget) {
    const wt = c.git.wtOf(target);
    const tip = c.git.ref(target);
    let busy = false;
    for (const [id, t] of tickets) {
      if (t.stage === 'delivered' && t.merges.length && tip) {
        const sha = t.merges.at(-1).sha;
        if (!c.git.ancestor(sha, tip)) {
          c.reconcile.push({ ticket: id, state: `delivered, merged at ${sha}`, git: `${sha} is not in ${target}`, follow: 'ruling' });
          c.emit(
            judge(`ask:merge-missing:${id}@${sha}`, 'merge-missing', `The state records ${id} delivered with merge ${sha}, but ${target} does not contain it (the branch was rewritten or reset). Ask the user what happened before going on; record settled when it is put right.`, ['settled'], [doc('ASKING.md', 'section 4 (ruling points)')], {
              kind: 'ask',
              tickets: [id],
              line: t.line,
            }),
          );
        }
      }
      if (t.stage !== 'queued' && t.stage !== 'integrating') continue;
      const m = mergedSha(c, id, t, target);
      if (m && t.assignment?.deadline && t.assignment.agentId) {
        busy = true; // the merge agent committed; its report (and any follow-up commit) comes first
        continue;
      }
      if (m) {
        closeOut(c, id, t, target, m);
        busy = true;
        continue;
      }
      if (t.stage === 'integrating') {
        busy = true;
        integrating(c, id, t, target, wt);
      }
    }
    if (busy || !tip) continue;
    // integrate.mjs pushes a line itself; a push to the base branch (integrate: direct) is the host's (`host`).
    // One push per integration, before the next merge.
    if (c.profile.integrate === 'direct' && c.git.hasOrigin && c.git.remote(target) !== tip && tickets.some(([, t]) => t.merges.length)) {
      c.emit(OPERATIONS.push(c, { target, tag: `@${tip}`, after: [] }));
      continue;
    }
    const lines = new Set(tickets.map(([, t]) => t.line));
    if ([...lines].some((l) => book.red[l] && !book.failed[l])) continue; // the queue pauses on a red line
    const queued = tickets
      .filter(([, t]) => t.stage === 'queued')
      .sort((x, y) => ((x[1].history[lastEntry(x[1], 'queued')]?.at ?? '') < (y[1].history[lastEntry(y[1], 'queued')]?.at ?? '') ? -1 : 1));
    if (!queued.length) continue;
    const [id, t] = queued[0];
    if (!wt) {
      c.emit(judge(`no-worktree:${target}`, 'no-worktree', `No worktree has ${target} checked out, so ${id} cannot be merged. Create it with integrate.mjs line-init and record done.`, ['done'], [{ path: js('integrate.mjs'), part: 'header, line-init' }], { line: t.line }));
      continue;
    }
    const s = stageTo(c, id, t, 'integrating');
    if (!t.branch) continue;
    const m = OPERATIONS.merge(c, { id, t, wt, tag: `h${hist(t) + 1}` });
    m.after = [s];
    c.emit(m);
  }
}

/** The ticket is merged in git: integrate.mjs merge once more finds that merge and does what is left of it. */
function closeOut(c, id, t, target, m) {
  const recorded = t.merges.some((x) => x.sha === m.sha || m.sha.startsWith(x.sha));
  if (t.stage === 'queued' || !recorded) {
    c.reconcile.push({ ticket: id, state: `${t.stage}${recorded ? '' : ', no merge SHA recorded'}`, git: `merged into ${target} at ${m.sha}`, follow: 'git' });
  }
  c.emit(OPERATIONS.merge(c, { id, t, wt: c.git.wtOf(target) ?? c.cfg.root, tag: `@${m.sha.slice(0, 12)}` }));
}

function integrating(c, id, t, target, wt) {
  const flag = c.flag(id);
  const mh = c.git.mergeHead(wt);
  if (flag.sendBack) {
    const abort = mh ? c.emit(exec(`abort:${id}:h${hist(t)}`, 'abort', ['git', '-C', wt, 'merge', '--abort'], { tickets: [id], line: t.line })) : null;
    c.emit(
      judge(
        `send-back:${id}:h${hist(t)}`,
        'send-back',
        `Send ${id} back for a redo as SEND-BACK.md says (integrate.mjs send-back, then the send-back record, also written to ${c.sendBack(id)}, and the widened prediction). Record sent-back; when it was sent back once already, mark it stuck instead (SEND-BACK.md) and record stuck with --value <reason>.`,
        ['sent-back', 'stuck'],
        [doc('SEND-BACK.md', 'Send back for a redo')],
        { tickets: [id], line: t.line, after: [abort] },
      ),
    );
    return;
  }
  const a = t.assignment;
  if (a && a.deadline !== null) {
    if (!a.agentId) pendingAgent(c, id, t);
    return; // the merge agent is at work
  }
  if (mh) {
    // a merge left in progress with no agent on it (an interrupted merge agent): hand it to a merge agent again
    dispatchAgent(c, id, t, { role: 'merge', stage: 'integrating', mode: 'merge', worktree: wt });
    return;
  }
  const tag = `h${hist(t)}`;
  const mid = `merge:${id}:${tag}`;
  if (c.done(mid)) {
    const done = c.book.done[mid];
    const handed = Object.values(c.book.agents).some((x) => x.role === 'merge' && x.tickets.includes(id) && x.at >= done.at);
    if (done.exit === 4 && !handed) {
      // integrate.mjs aborted a conflict (exit 4): the merge agent redoes the merge and resolves it
      const out = readJsonFile(c.deps, c.tick('merge', `${keyOf(id)}-${slugOf(tag)}.json`));
      dispatchAgent(c, id, t, { role: 'merge', stage: 'integrating', mode: 'merge', worktree: wt, files: Array.isArray(out?.files) ? out.files : null });
      return;
    }
    c.emit(
      judge(`merge-check:${id}:${tag}`, 'merge-check', `The merge of ${t.branch} into ${target} is not on ${target}${handed ? ' although the merge agent reported' : ''}. Find out why; record retry to merge again, or stuck / awaiting-ruling with --value <reason>.`, ['retry', 'stuck', 'awaiting-ruling'], [doc('SKILL.md', 'section 2, Merge conflicts')], {
        tickets: [id],
        line: t.line,
      }),
    );
    return;
  }
  if (!t.branch) {
    c.emit(judge(`merge-manual:${id}:${tag}`, 'merge-manual', `${id} has no ticket branch in the state; find it, run integrate.mjs merge with --branch, and record done.`, ['done'], [{ path: js('integrate.mjs'), part: 'header, merge' }], { tickets: [id], line: t.line }));
    return;
  }
  c.emit(OPERATIONS.merge(c, { id, t, wt: wt ?? c.cfg.root, tag }));
}

// ---- dispatch point -------------------------------------------------------------------------------------------------

function dueReasons(c) {
  const { book, state } = c;
  const last = book.lastDispatch;
  if (!last) return ['first wake-up'];
  if (last.wakeup === book.wakeup) return [];
  const reasons = new Set();
  for (const [id, t] of Object.entries(state.tickets)) {
    for (const h of t.history.slice(last.history[id] ?? 0)) {
      if (h.to === 'delivered') reasons.add('a ticket was integrated');
      else if (h.to === 'stuck' || h.to === 'awaiting-ruling') reasons.add('a ticket left the pipeline');
      else if (h.from === 'integrating' && h.to === 'candidate') reasons.add('a ticket was sent back');
      else if (h.from === 'expanding') reasons.add('an expansion agent reported');
    }
    if (t.merges.length > (last.merges[id] ?? 0)) reasons.add('a ticket was merged');
    // #198: the one upstream a waiting ticket waits on got its branch (it was dispatched): it can be stacked now
    if (t.stage === 'waiting-upstream' && (t.waitingOn ?? []).length === 1 && c.profile.integrate === 'ticket-pr' && stackFree(c, t.waitingOn[0], id) && ghStackReady(c)) {
      reasons.add('an upstream can take a stacked ticket');
    }
  }
  for (const line of last.red) if (!book.red[line]) reasons.add('a red line turned green');
  for (const line of Object.keys(book.failed)) if (!last.failed.includes(line)) reasons.add('a line failed verification');
  const tickets = Object.values(state.tickets);
  const dispatchable = (t) => t.stage === 'candidate' && !book.red[t.line] && !book.failed[t.line];
  if (!tickets.some((t) => BUSY.includes(t.stage)) && tickets.some(dispatchable)) reasons.add('nothing in flight while candidates remain');
  return [...reasons];
}

function stepDispatch(c) {
  const { book, state } = c;
  let d = book.dispatch;
  if (!d) {
    if (state.stop || c.actions.length) return;
    const reasons = dueReasons(c);
    if (!reasons.length) return;
    d = book.dispatch = {
      round: state.usage.rounds + 1,
      wakeup: book.wakeup,
      opened: c.now,
      reasons,
      marks: Object.fromEntries(Object.entries(state.tickets).map(([id, t]) => [id, hist(t)])),
      touched: [],
    };
  }
  c.dispatch = { round: d.round, reasons: d.reasons, closed: false };
  const before = c.actions.length;
  dispatchSteps(c, d);
  if (c.actions.length === before) {
    const touched = new Set(d.touched);
    book.lastDispatch = {
      round: d.round,
      wakeup: book.wakeup,
      at: c.now,
      history: Object.fromEntries(Object.entries(state.tickets).map(([id, t]) => [id, touched.has(id) ? hist(t) : (d.marks[id] ?? 0)])),
      merges: Object.fromEntries(Object.entries(state.tickets).map(([id, t]) => [id, t.merges.length])),
      red: Object.keys(book.red),
      failed: Object.keys(book.failed),
    };
    book.dispatch = null;
    c.dispatch.closed = true;
  }
}

function dispatchSteps(c, d) {
  const { state, book, profile } = c;
  const r = d.round;
  // 1. usage, then progress and the limits
  if (state.usage.rounds < r && !state.stop) {
    const u = c.emit(exec(`usage:r${r}`, 'usage', stateArgv(c, 'usage', ...(state.usage.started === null ? ['--started', c.now] : [])), {}));
    const plan = c.tick('progress', `r${r}.plan.json`);
    const out = c.tick('progress', `r${r}.json`);
    c.write(plan, `${JSON.stringify(progressPlan(c), null, 2)}\n`);
    const p = c.emit(exec(`progress:r${r}`, 'progress', ['node', js('deadline.mjs'), 'progress', plan], { stdout: out, after: [u] }));
    c.emit(exec(`progress-record:r${r}`, 'progress', stateArgv(c, 'progress', '--from', out), { after: [p] }));
    return;
  }
  if (state.stop) return; // stepStop marks the rest
  // 2. CI per line
  let waiting = false;
  for (const [line, L] of Object.entries(state.lines)) {
    if (profile.ci === 'skip') break;
    const target = c.target(line);
    if (target !== line) continue; // state.mjs records CI per line; under direct only the base's own line has it
    if (L.assignment?.deadline) continue; // its ci-fix agent is at work in the integration worktree (#144)
    const tip = c.git.ref(target);
    if (!tip) continue;
    if (onLocal(c, L)) continue; // a line without CI is verified once, at the finish (#141)
    if (c.git.remote(target) === null) continue; // never pushed: not read
    if (ciRead(c, line, target, tip, `r${r}`, true)) {
      waiting = true;
      continue;
    }
    // after the read
    const verdictFile = c.tick('ci', `${slugOf(line)}-r${r}.json`);
    if (L.ci?.verdict === 'cancelled') {
      const v = readJsonFile(c.deps, verdictFile);
      for (const run of v?.rerun ?? []) c.emit(exec(`rerun:${line}:${run}`, 'ci-rerun', ['gh', 'run', 'rerun', String(run), ...(c.cfg.repo ? ['--repo', c.cfg.repo] : [])], { line }));
    }
    if (L.ci?.verdict === 'query-failed' && localVerify(c, line, tip, 'no-verdict', c.git.wtOf(target))) waiting = true;
    if (L.ci?.verdict === 'no-run' && L.ci.reason === 'empty' && L.noRun.count >= 2 && !L.ciNotCovering) {
      const runs = c.tick('ci', `${slugOf(line)}-r${r}-branch.json`);
      const id = `ci-branch:${line}:r${r}`;
      if (!c.done(id)) {
        c.emit(exec(id, 'ci-branch', ['gh', 'run', 'list', '--branch', target, '--limit', '1', '--json', 'databaseId', ...(c.cfg.repo ? ['--repo', c.cfg.repo] : [])], { stdout: runs, cwd: c.cfg.repo ? null : c.cfg.root, line }));
        waiting = true;
      } else {
        const listed = readJsonFile(c.deps, runs);
        if (Array.isArray(listed) && !c.done(`ci-branch-record:${line}:r${r}`)) {
          c.emit(exec(`ci-branch-record:${line}:r${r}`, 'ci-record', stateArgv(c, 'ci', line, '--from', verdictFile, '--dispatch', '--branch-runs', String(listed.length)), { line }));
          waiting = true;
        }
      }
    }
  }
  if (waiting) return;
  // 3. frontier
  const fr = frontier(c, r);
  if (!fr) return;
  // a frontier id as the run names it: a ticket, or a member of a bundle (#205)
  const known = (fid) => [fid, basename(String(fid))].find((x) => c.leadOf(x) !== null) ?? null;
  const info = new Map(fr.tickets.map((x) => [known(x.id), x]).filter(([k]) => k));
  book.titles = { ...(book.titles ?? {}), ...Object.fromEntries([...info].filter(([, x]) => x.title).map(([k, x]) => [k, x.title])) };
  // 4. stalled tickets and the lines that failed verification leave the pipeline
  for (const [id, t] of Object.entries(state.tickets)) {
    if (t.stage !== 'candidate') continue;
    // a bundle stalls when any of its tickets does (#205)
    const sid = c.group(id).find((m) => info.get(m)?.stalled) ?? id;
    const f = info.get(sid);
    let reason = null;
    if (f?.stalled) reason = `stalled (${f.stalled})${sid !== id ? ` at ${sid}, of this bundle` : ''}: ${f.blockedBy.filter((b) => b.state !== 'done').map((b) => `${b.id} ${b.state}`).join(', ') || 'see frontier'}`;
    else if (book.failed[t.line]) reason = `line failed verification (${t.line})`;
    if (reason) {
      d.touched.push(id);
      stageTo(c, id, t, 'awaiting-ruling', { reason });
    }
  }
  // 4b. #198: under integrate: ticket-pr, the tickets whose upstreams in this run are not merged: stacked, or waiting
  const { stacked, held } = profile.integrate === 'ticket-pr' ? prUpstreams(c, info, known, d) : { stacked: [], held: new Set() };
  // 5. candidates, the most unblocking first
  const dependents = (id) => {
    const g = c.group(id);
    return fr.tickets.filter((x) => !g.includes(known(x.id)) && (x.blockedBy ?? []).some((b) => b.inSet && g.includes(known(b.id)))).length;
  };
  // #205: a bundle is ready when every blocker of each of its tickets is done or in the bundle; its place is its
  // first ready ticket's in the frontier's order
  const groupReady = (id) =>
    c.group(id).every((m) => {
      const f = info.get(m);
      return f && f.state === 'open' && (f.blockedBy ?? []).every((b) => b.state === 'done' || c.group(id).includes(known(b.id)));
    });
  const order = [
    ...new Set([
      ...fr.frontier.map(known).filter(Boolean).map((x) => c.leadOf(x)),
      ...Object.keys(state.tickets).filter((id) => c.members(id).length && groupReady(id)),
    ]),
  ]
    .filter((id) => !c.members(id).length || groupReady(id))
    .concat(stacked.filter((id) => state.tickets[id].stackParent)); // #198: a stacked ticket is ready on its upstream
  const candidates = order
    .filter((id) => state.tickets[id].stage === 'candidate' && !held.has(id) && !info.get(id)?.stalled && !book.failed[state.tickets[id].line] && !book.red[state.tickets[id].line])
    .map((id, i) => ({ id, i, n: dependents(id) }))
    .sort((x, y) => y.n - x.n || x.i - y.i)
    .map((x) => x.id);
  const ready = [];
  const expand = [];
  let pending = false;
  for (const id of candidates) {
    const t = state.tickets[id];
    // #205: each ticket of a bundle has its own snapshot, expansion and predicted files; the lead waits for them all
    let held = false;
    let lead = null;
    for (const m of c.group(id)) {
      const snap = c.snapshot(m);
      let acc = c.deps.exists(snap) ? readJsonFile(c.deps, snap) : null;
      if (!acc) {
        const out = c.tick('acceptance', `r${r}-${keyOf(m)}.json`);
        acc = c.done(`acceptance:${m}:r${r}`) ? readJsonFile(c.deps, out) : null;
        if (!acc) {
          c.emit(exec(`acceptance:${m}:r${r}`, 'acceptance', acceptanceArgv(c, m, t), { stdout: out, cwd: acceptanceCwd(c), tickets: [id], line: t.line }));
          pending = held = true;
          continue;
        }
        if (acc.needsExpansion && profile.expand === 'agent') {
          expand.push({ id: m, count: Array.isArray(acc.expansions) ? acc.expansions.length : 0 });
          held = true;
          continue;
        }
        c.write(snap, `${JSON.stringify(acc, null, 2)}\n`); // the snapshot, saved once
      }
      if (m === id) lead = acc;
      if (!c.deps.exists(c.predicted(m))) {
        c.emit(
          judge(`predict:${m}`, 'predict', `Write ${m}'s predicted files to ${c.predicted(m)}: one repo-relative path per line, \`/\` only when nothing narrower can be inferred, index files left out. Record written.`, ['written'], [doc('SKILL.md', 'section 2, Predicted files')], {
            tickets: [id],
            line: t.line,
          }),
        );
        pending = held = true;
      }
    }
    if (held) continue;
    if (c.members(id).length && !c.deps.exists(c.acceptanceFile(id))) bundleSnapshot(c, id);
    if (t.snapshotSha256 === null) {
      c.emit(exec(`snapshot:${id}`, 'snapshot', stateArgv(c, 'set', id, '--snapshot', lead.sha256), { tickets: [id], line: t.line }));
      pending = true;
    }
    ready.push({ id, title: info.get(id)?.title ?? null });
  }
  if (expand.length) expandDispatch(c, r, expand);
  if (pending || !ready.length) return;
  // 6. overlap, then a ticket branch and an implementation agent for each `start`
  const ov = overlapRun(c, `overlap:r${r}`, `${r}`, ready);
  if (!ov) return;
  // #198: a ticket stacked within this dispatch point, after its overlap ran (its upstream got its branch meanwhile),
  // gets an overlap run of its own, so it starts now rather than after its upstream merges
  const covered = new Set([...(ov.start ?? []), ...(ov.wait ?? []).map((w) => w.id)]);
  const late = ready.filter((x) => !covered.has(x.id) && state.tickets[x.id].stackParent);
  const ov2 = late.length ? overlapRun(c, `overlap:r${r}:${late.map((x) => keyOf(x.id)).join('+')}`, `${r}-${late.map((x) => keyOf(x.id)).join('+')}`, late) : null;
  if (late.length && !ov2) return;
  // #198: a stacked ticket builds on its upstream's branch, so its overlap with the tickets below it in the stack is
  // no conflict: it starts when those are all it overlaps
  const chainOf = (id) => {
    const out = [];
    for (let p = state.tickets[id]?.stackParent ?? null; p !== null && !out.includes(p); p = state.tickets[p]?.stackParent ?? null) out.push(p);
    return out;
  };
  const starts = new Set();
  for (const o of [ov, ov2].filter(Boolean)) {
    for (const id of o.start ?? []) starts.add(id);
    for (const w of o.wait ?? []) {
      const chain = chainOf(w.id);
      if (chain.length && (w.overlaps ?? []).every((x) => chain.includes(x.with))) starts.add(w.id);
    }
  }
  // the ticket's one upstream in this run (its blockers' leads, done or not), whose agent may take it next
  const upstreamOf = (id) => {
    const ups = new Set();
    for (const m of c.group(id)) for (const b of info.get(m)?.blockedBy ?? []) if (b.inSet && c.leadOf(known(b.id)) && c.leadOf(known(b.id)) !== id) ups.add(c.leadOf(known(b.id)));
    return ups.size === 1 ? [...ups][0] : null;
  };
  for (const { id, title } of ready.filter((x) => starts.has(x.id))) {
    const t = state.tickets[id];
    if (!t || t.stage !== 'candidate') continue;
    createDispatch(c, id, t, title, upstreamOf(id));
  }
}

/** overlap.mjs for `cands` against the tickets holding files now: its output, or null while it runs. */
function overlapRun(c, oid, tag, cands) {
  const { state } = c;
  const planPath = join(c.W, 'overlap', `${tag}.plan.json`);
  const outPath = join(c.W, 'overlap', `${tag}.json`);
  if (c.done(oid)) return readJsonFile(c.deps, outPath);
  const running = Object.entries(state.tickets)
    .filter(([, t]) => OCCUPIES.includes(t.stage))
    .map(([id, t]) => {
      let files = predictedOf(c, id);
      if (!c.deps.exists(files)) {
        files = c.tick('overlap', `${keyOf(id)}.whole.txt`);
        c.write(files, '/\n'); // no prediction on record: it holds the whole repository
      }
      const wt = t.assignment?.worktree && c.deps.exists(t.assignment.worktree) ? t.assignment.worktree : null;
      // #196: under ticket-pr the base a running worktree is diffed against is the ticket's own fixed point
      return { id, files, ...(wt ? { worktree: wt, base: fixedPointOf(c, t) } : {}) };
    });
  c.write(planPath, `${JSON.stringify({ running, candidates: cands.map(({ id }) => ({ id, files: predictedOf(c, id) })) }, null, 2)}\n`);
  c.emit(exec(oid, 'overlap', ['node', js('overlap.mjs'), planPath], { stdout: outPath }));
  return null;
}

/** #198: whether gh stack passed the freeze's check (#189: freeze.json's preflight `gh-stack` with `stack` true). */
function ghStackReady(c) {
  const f = join(c.W, 'freeze.json');
  if (!c.deps.exists(f)) return false;
  return readJsonFile(c.deps, f)?.preflight?.checks?.some((x) => x?.name === 'gh-stack' && x.stack === true) ?? false;
}

const prMerged = (t) => t.stage === 'delivered' && t.merges.length > 0;

/**
 * #198: whether ticket `u` can take `id` on top of it in a stack: its ticket branch is there, it is not at an end state
 * (or it is delivered with its PR left for a person, not merged), and no other live ticket is stacked on it yet —
 * gh stack is linear, so the first ticket dispatched on it takes it (the open question's recommendation).
 */
function stackFree(c, u, id) {
  const U = c.state.tickets[u];
  if (!U || !U.branch || !c.git.ref(U.branch)) return false;
  if (TERMINAL.includes(U.stage) && !(U.stage === 'delivered' && !U.merges.length)) return false;
  return !Object.entries(c.state.tickets).some(([k, t]) => k !== id && t.stackParent === u && !['stuck', 'awaiting-ruling'].includes(t.stage) && !prMerged(t));
}

/**
 * #198: under integrate: ticket-pr, the candidates whose blockers in this run are not all merged (#187 ruling 2). Only
 * a merged ticket counts as done upstream (a delivered ticket left for a person is not merged). A ticket with exactly
 * one unmerged upstream — a bundle's tickets count as one, its lead (#205) — is stacked on it when gh stack passed the
 * freeze's check and the upstream can take it (stackFree): its stackParent is recorded, and it dispatches with the
 * frontier's ready ones; integrate.mjs ticket-init cuts it from the upstream branch and adds it to the stack. Any
 * other — two or more unmerged upstreams, gh stack missing, an upstream with no branch yet or already taken — goes to
 * waiting-upstream with waitingOn naming them; once none is left unmerged it goes back to candidate and starts from
 * the new base (a later dispatch point may stack it instead, once its one upstream can take it). When every upstream
 * it waits on is at an end state that is not a merge (stuck, awaiting a ruling, or left for a person), nothing in this
 * run will merge them: awaiting-ruling. gh stack missing while a ticket could have been stacked brings one judge (not
 * one per ticket) to put its install on the human-work list. Returns { stacked: the ids stacked this list, held: the
 * ids that wait (they are not dispatched, whatever the frontier says) }.
 */
function prUpstreams(c, info, known, d) {
  const { state } = c;
  const canStack = ghStackReady(c);
  const stacked = [];
  const held = new Set();
  const claimed = new Map(); // upstream → the ticket stacked on it in this list
  let wanted = false;
  for (const [id, t] of Object.entries(state.tickets)) {
    if (t.stage !== 'candidate' && t.stage !== 'waiting-upstream') continue;
    const g = c.group(id);
    if (g.some((m) => info.get(m)?.stalled)) continue; // step 4 rules on it
    const ups = new Set();
    for (const m of g) {
      for (const b of info.get(m)?.blockedBy ?? []) {
        if (!b.inSet) continue;
        const lead = c.leadOf(known(b.id));
        if (lead === null || lead === id || prMerged(state.tickets[lead])) continue;
        ups.add(lead);
      }
    }
    const waiting = [...ups].sort();
    const parent = t.stackParent ?? null;
    const was = [...(t.waitingOn ?? [])].sort();
    const setTo = (stack, wait) => {
      if (parent === stack && was.join(',') === wait.join(',')) return null;
      return c.emit(
        exec(`upstream:${id}:h${hist(t)}:${stack ?? 'none'}:${wait.join(',') || 'none'}`, 'upstream', stateArgv(c, 'set', id, '--stack-parent', stack ?? 'none', '--waiting-on', wait.join(',') || 'none'), {
          tickets: [id],
          line: t.line,
        }),
      );
    };
    if (!waiting.length) {
      // nothing unmerged upstream (any more): the frontier's own rules; a wait or a stack recorded before is cleared
      const s = setTo(null, []);
      if (t.stage === 'waiting-upstream') {
        d.touched.push(id);
        stageTo(c, id, t, 'candidate', { after: [s] });
      }
      continue;
    }
    const u = waiting.length === 1 ? waiting[0] : null;
    const free = u !== null && stackFree(c, u, id) && (!claimed.has(u) || claimed.get(u) === id);
    if (free && canStack) {
      claimed.set(u, id);
      const s = setTo(u, []);
      if (t.stage === 'waiting-upstream') {
        d.touched.push(id);
        stageTo(c, id, t, 'candidate', { after: [s] });
      }
      stacked.push(id);
      continue;
    }
    if (free) wanted = true;
    held.add(id);
    const s = setTo(null, waiting);
    if (waiting.every((w) => TERMINAL.includes(state.tickets[w].stage))) {
      d.touched.push(id);
      stageTo(c, id, t, 'awaiting-ruling', { reason: `waits on ${waiting.join(', ')}, which this run will not merge (${waiting.map((w) => `${w} ${state.tickets[w].stage}`).join(', ')})`, after: [s] });
      continue;
    }
    if (t.stage === 'candidate') {
      d.touched.push(id);
      stageTo(c, id, t, 'waiting-upstream', { after: [s] });
    }
  }
  if (wanted) {
    c.emit(
      judge(
        'gh-stack-missing',
        'gh-stack-missing',
        `gh stack did not pass the freeze's check (freeze.json preflight gh-stack), so a ticket with one unmerged upstream waits for it to merge (waiting-upstream) instead of stacking on it. Put \`gh extension install github/gh-stack\` on the human-work list (once, not per ticket; never install it yourself) and record listed.`,
        ['listed'],
        [doc('SKILL.md', 'section 0 (freeze)')],
      ),
    );
  }
  return { stacked, held };
}

/** #205: a ticket's predicted files, or for a bundle one list of all its tickets' (written once each has one). */
function predictedOf(c, id) {
  if (!c.members(id).length) return c.predicted(id);
  const files = c.group(id).map((m) => c.predicted(m));
  if (!files.every((f) => c.deps.exists(f))) return c.predicted(id); // a missing one: the caller's fallback holds
  const out = c.tick('overlap', `${keyOf(id)}.bundle.txt`);
  c.write(out, `${files.map((f) => c.deps.read(f).replace(/\s+$/, '')).join('\n')}\n`);
  return out;
}

function progressPlan(c) {
  const { state } = c;
  const u = state.usage;
  let spawns = u.spawns;
  const counters = c.path.replace(/\.state\.json$/i, '.counters.json');
  if (counters !== c.path && c.deps.exists(counters)) {
    const data = readJsonFile(c.deps, counters);
    if (data && Number.isInteger(data.spawns)) spawns = data.spawns;
  }
  const hours = u.started === null ? 0 : Math.max(0, (c.nowMs - Date.parse(u.started)) / 1000 - u.waitingSeconds) / 3600;
  return {
    previous: u.snapshot,
    tips: Object.fromEntries(Object.entries(state.lines).map(([line, L]) => [line, c.git.ref(c.target(line)) ?? L.tip]).filter(([, sha]) => sha)),
    terminal: Object.entries(state.tickets).filter(([, t]) => TERMINAL.includes(t.stage)).map(([id]) => id),
    noProgress: u.noProgress,
    usage: { rounds: u.rounds, spawns, hours },
    limits: { rounds: c.limits.rounds, spawns: c.limits.spawns, hours: c.limits.hours, 'no-progress': c.limits['no-progress'] },
  };
}

/** frontier.mjs for the whole set (GitHub), or per line with --ref (Local Markdown); null while it is being read. */
function frontier(c, r) {
  const { state } = c;
  // #205: a bundle's members are tickets of the set too, and share their lead's end state
  const ids = Object.keys(state.tickets).flatMap((id) => c.group(id));
  if (c.cfg.tracker === 'github') {
    const out = c.tick('frontier', `r${r}.json`);
    const read = c.done(`frontier:r${r}`) ? readJsonFile(c.deps, out) : null;
    if (read) return read;
    // #198: under ticket-pr only a merged ticket is done upstream (one left for a person to merge is not, yet)
    const done = ids.filter((id) => c.ticketOf(id).stage === 'delivered' && (c.profile.integrate !== 'ticket-pr' || c.ticketOf(id).merges.length)).map(numOf);
    const stuck = ids.filter((id) => c.ticketOf(id).stage === 'stuck').map(numOf);
    const argv = ['node', js('frontier.mjs'), 'github', '--repo', c.cfg.repo, ...(done.length ? ['--done', done.join(',')] : []), ...(stuck.length ? ['--stuck', stuck.join(',')] : []), ...ids];
    c.emit(exec(`frontier:r${r}`, 'frontier', argv, { stdout: out }));
    return null;
  }
  const parts = [];
  let missing = false;
  for (const [line, L] of Object.entries(state.lines)) {
    const target = c.target(line);
    for (const lineId of L.lines.length ? L.lines : [null]) {
      const tag = `r${r}-${slugOf(line)}${lineId ? `-${slugOf(lineId)}` : ''}`;
      const out = c.tick('frontier', `${tag}.json`);
      const read = c.done(`frontier:${tag}`) ? readJsonFile(c.deps, out) : null;
      if (read) {
        parts.push(read);
        continue;
      }
      missing = true;
      c.emit(exec(`frontier:${tag}`, 'frontier', ['node', js('frontier.mjs'), 'local', '--ref', target, ...(lineId ? ['--line', lineId] : []), ...ids.map((id) => c.ticketPath(id))], { stdout: out, cwd: c.cfg.root, line }));
    }
  }
  if (missing) return null;
  const tickets = new Map();
  for (const p of parts) for (const x of p.tickets) if (!tickets.has(x.id)) tickets.set(x.id, x);
  return { tickets: [...tickets.values()], frontier: [...new Set(parts.flatMap((p) => p.frontier))] };
}

function createDispatch(c, id, t, title, upstream = null) {
  const name = c.cfg.tracker === 'github' ? `${numOf(id).padStart(2, '0')}-${slugOf(String(title ?? 'ticket').toLowerCase()).slice(0, 40).replace(/-+$/, '') || 'ticket'}` : slugOf(basename(id).replace(/\.md$/i, ''));
  const branch = t.branch ?? `${c.state.run}/${name}`;
  const present = c.git.wtOf(branch);
  const worktree = present ?? join(c.cfg.worktrees, basename(branch));
  const w = present && t.branch === branch ? null : c.emit(OPERATIONS.createTicketBranch(c, { id, branch, worktree, tag: `h${hist(t)}` }));
  const prev = t.sendBacks ? implementerOf(c, id) : null;
  // a ticket of a chain goes to the idle agent of its one upstream, which already holds that code in its context: a
  // fresh agent would read it all again (the batch-2 run's implementers were 72% of its agents' tokens)
  const chain = prev ? null : chainAgent(c, upstream);
  dispatchAgent(c, id, t, {
    role: 'implement',
    stage: 'implementing',
    mode: prev || chain ? 'send' : 'spawn',
    worktree,
    prevAgent: prev ?? chain,
    why: prev ? 'send-back' : chain ? 'chain' : 'send-back',
    ...(chain ? { upstream } : {}),
    create: { after: [w], stageAfter: [w], branch },
  });
}

function expandDispatch(c, r, group, { reassign = false } = {}) {
  const { state } = c;
  const ids = group.map((x) => x.id);
  // #205: a bundle's member is expanded with the others but recorded on its lead
  const leads = [...new Set(ids.map((id) => c.leadOf(id)))];
  const bodies = ids.map((id) => bodyFile(c, id, c.ticketOf(id), [], `expand:r${r}`));
  const lines = [...new Set(ids.map((id) => c.target(c.ticketOf(id).line)))];
  const values = c.tick('brief', `expand-r${r}.values.json`);
  const out = c.tick('brief', `expand-r${r}.md`);
  c.write(
    values,
    `${JSON.stringify(
      {
        out,
        run: state.run,
        round: Number.parseInt(String(r), 10) || 1,
        tracker: c.cfg.tracker,
        ...(c.cfg.tracker === 'github' ? { repo: c.cfg.repo } : {}),
        lines: lines.map((branch) => ({ branch, worktree: resolve(c.git.wtOf(branch) ?? c.cfg.root) })),
        spec: c.cfg.spec ?? null,
        tickets: ids.map((id, i) => ({ id, line: c.target(c.ticketOf(id).line), bodyFile: bodies[i].file })),
      },
      null,
      2,
    )}\n`,
  );
  const rec = c.tick('rec', `expand-r${r}.json`);
  const r1 = c.emit(exec(`rec:expand:r${r}`, 'assignment', ['node', js('deadline.mjs'), 'record', ...group.flatMap((x) => ['--expansions', `${x.id}=${x.count}`]), '--limit', String(c.limits['timeout-expand'])], { stdout: rec, tickets: leads }));
  const r2 = c.emit(exec(`assign:expand:r${r}`, 'assignment', stateArgv(c, 'assign', ...leads, '--record', rec, '--type', AGENT_TYPES.expand, ...(reassign ? ['--reassign'] : [])), { tickets: leads, after: [r1] }));
  const r3 = reassign ? null : c.emit(exec(`stage:expanding:r${r}`, 'stage', stateArgv(c, 'stage', 'expanding', ...leads), { tickets: leads, after: [r2] }));
  c.book.expansions[r] = ids;
  for (const id of leads) c.flag(id).pending = { mode: 'expand', round: r };
  expandTail(c, r, [r2, r3, ...bodies.map((b) => b.id)]);
}

function expandTail(c, r, after = []) {
  const ids = c.book.expansions[r];
  const leads = [...new Set(ids.map((id) => c.leadOf(id) ?? id))];
  const values = c.tick('brief', `expand-r${r}.values.json`);
  const out = c.tick('brief', `expand-r${r}.md`);
  const b = c.emit(exec(`brief:expand:r${r}`, 'brief', ['node', js('brief.mjs'), 'expand', values], { stdout: c.tick('brief', `expand-r${r}.json`), tickets: leads, after }));
  c.emit({
    id: `spawn:expand:r${r}`,
    kind: 'spawn',
    step: 'spawn',
    tickets: leads,
    line: null,
    after: [b, ...after],
    spawn: { subagent_type: AGENT_TYPES.expand, description: roleDescription('expand', ids), prompt: `Read ${resolve(out)} in full and follow it.`, background: true, fallback: fallbackSpawn(out) },
    reference: [doc('SKILL.md', 'section 1 (the loop: spawn; general-purpose when the type is not available)')],
    record: `node ${q(SELF)} record ${q(c.path)} ${q(`spawn:expand:r${r}`)} --agent <agent id> [--type general-purpose]`,
  });
}

/** After a stop: everything not dispatched, and every expansion, is awaiting ruling. */
function stepStop(c) {
  const stop = c.state.stop;
  if (!stop) return;
  const u = stop.usage ?? {};
  const reason = `run stopped at ${stop.stoppedBy.join(', ')} (rounds ${u.rounds}, spawns ${u.spawns}, hours ${u.hours === null || u.hours === undefined ? 'unknown' : Number(u.hours).toFixed(1)})`;
  for (const [id, t] of Object.entries(c.state.tickets)) if (t.stage === 'candidate' || t.stage === 'expanding' || t.stage === 'waiting-upstream') stageTo(c, id, t, 'awaiting-ruling', { reason });
}

// ---- the finish -----------------------------------------------------------------------------------------------------

function stepFinish(c) {
  const { state, book, profile } = c;
  const tickets = Object.values(state.tickets);
  if (!tickets.every((t) => TERMINAL.includes(t.stage)) || book.dispatch || book.finished) return;
  // #197: the base-red episode (the revert PR) ends first — a revert left for a person goes on the human-work list
  // instead — and the base must have been read at its current tip after the last merge, with a concluded verdict
  if (profile.integrate === 'ticket-pr' && book.baseRed && !book.baseRed.left) return;
  if (profile.integrate === 'ticket-pr' && profile.ci !== 'skip' && tickets.some((t) => t.merges.length)) {
    if (book.baseSeen?.tip !== c.git.remote(c.cfg.base) || book.baseSeen?.verdict === 'running') return;
  }
  // #196: under integrate: ticket-pr there is no line delivery — every delivered ticket merged its own PR with CI
  // green on the PR head, or is recorded left-for-human; the lines have no branch, base sync or full verification.
  if (profile.integrate !== 'ticket-pr') {
    // One finish per target: under direct every line's target is the base, finished once (on its own line when the
    // state has one, which is where its CI is recorded).
    const byTarget = new Map();
    for (const line of Object.keys(state.lines)) {
      const target = c.target(line);
      if (!byTarget.has(target) || line === target) byTarget.set(target, line);
    }
    let all = true;
    for (const [target, line] of byTarget) if (!finishLine(c, line, target)) all = false;
    if (!all) return;
  }
  // The gates of the stop and the finish (gates.mjs); the finish's assertions assume aggregate PRs (or ticket-level
  // PRs, #200: delivered by its own definition, no line checks) and a CI read.
  const gates = [];
  if (state.stop) gates.push(c.emit(OPERATIONS.gate(c, { gate: 'stopped' })));
  if (['aggregate-pr', 'ticket-pr'].includes(profile.integrate) && profile.ci === 'read') gates.push(c.emit(OPERATIONS.gate(c, { gate: 'finish' })));
  if (gates.some(Boolean)) return;
  // #200: the PRs left for a person get their body polished (ASKING section 6); the ones merged here are not
  const rows = profile.integrate === 'ticket-pr' ? prRows(c) : null;
  const polish = [];
  for (const row of rows ?? []) {
    if (row.lead !== null || row.merge !== 'left-for-human' || row.pr === null) continue;
    polish.push(
      c.emit(
        judge(
          `pr-polish:${row.ticket}`,
          'pr-polish',
          `Pull request ${row.pr} (${row.ticket}) is left for a person to merge. Polish its body as ASKING section 6 says — call the Skill tool with \`no-bullshit\` on it — keeping its \`Closes\` lines, and write it back with \`gh pr edit ${row.pr} --body-file <file>\`. Record polished.`,
          ['polished'],
          [doc('ASKING.md', 'section 6'), doc('FINISH.md', 'integrate: ticket-pr')],
          { tickets: [row.ticket], meta: { pr: row.pr } },
        ),
      ),
    );
  }
  // #205: each line's observation ticket, checked once against the line's final tip
  for (const l of Object.keys(state.lines)) {
    const issue = book.flags[`line:${l}`]?.observationsIssue;
    if (!issue) continue;
    const sha = c.git.ref(c.target(l)) ?? state.lines[l].tip;
    c.emit(
      judge(
        `observations-final:${l}`,
        'observations-final',
        `${issue} holds the observations and pre-existing of line ${l}. Check each of its items against ${c.target(l)} at ${sha ?? 'its tip'}, and mark it in ${issue}: still present, or resolved by <ticket> (<sha>) when a later ticket of the line already changed it. Read the code at each item's location; add nothing new. Record checked.`,
        ['checked'],
        [doc('FINISH.md', 'the observation ticket of a line'), doc('SKILL.md', 'section 2, Filing along the way')],
        { line: l, after: c.actions.filter((a) => a.step === 'observations').map((a) => a.id) },
      ),
    );
  }
  const skipped = simplifySkipped(c);
  const after = [...c.actions.filter((a) => a.step === 'observations' || a.step === 'observations-final').map((a) => a.id), ...polish]; // #142: the raw tickets are filed first
  if (rows) {
    // #200: integrate: ticket-pr — every ticket was its own delivery; no simplify pass, base sync, full verification,
    // review-guide.mjs or aggregate PR
    const human = humanMerges(c, rows);
    c.emit(
      judge(
        'wrap-up',
        'wrap-up',
        `Every ticket is at an end state; under integrate: ticket-pr each one was its own delivery (FINISH.md, integrate: ticket-pr): no simplify pass, no base sync, no full verification, no review-guide.mjs, no aggregate PR. Do what is left: the cleanup (clean-it-up), the final output with the reconciliation table — one row per ticket (a bundle's members each), with the PR link, its stack, the merge state and the PR head's CI result, as meta.tickets has them — run metrics and spawn breakdown, and the ledger's ended marker when standalone.${
          human.length ? ` Put each PR left for a person on the human-work list with merge-gate.mjs's reason, a stack's in its merge order (the bottom first): ${human.map((x) => x.text).join('; ')}.` : ''
        } Record done.`,
        ['done'],
        [doc('FINISH.md', 'integrate: ticket-pr')],
        { after, meta: { tickets: rows, humanWork: human } },
      ),
    );
    return;
  }
  c.emit(
    judge(
      'wrap-up',
      'wrap-up',
      `Every line is through the finish. Read FINISH.md and do what is left after the lines' delivery: the cleanup (clean-it-up), the merge where authority allows${profile.integrate === 'direct' ? ' (integrate: direct — the tickets are on the base branch already; there is no aggregate PR)' : ' (merge queue included)'}, closing tickets, the final output with the reconciliation table, run metrics and spawn breakdown, and the ledger's ended marker when standalone.${
        skipped.length ? ` Lines that skipped the simplify pass: write each reason into the self-answer log and list the lines in the closing summary — ${skipped.map((x) => `${x.line}: ${x.reason}`).join('; ')}.` : ''
      } Record done.`,
      ['done'],
      [doc('FINISH.md', 'after the delivery of each line')],
      {
        after,
        ...(skipped.length ? { meta: { simplifySkipped: skipped } } : {}),
      },
    ),
  );
}

/**
 * #200: the reconciliation rows under integrate: ticket-pr, one per ticket — a bundle's members each, with the lead's
 * PR (`lead` names it; null on the lead's own row): the PR number and link, the stack it is in (its tickets bottom
 * first, null outside a stack), the merge state (merged, in-queue, left-for-human, waiting-upstream, not-merged), the
 * merge SHA, the PR head's last CI result, and for a PR left for a person merge-gate.mjs's decision and reason.
 */
function prRows(c) {
  const rows = [];
  const depth = (k) => {
    let n = 0;
    for (let p = c.state.tickets[k]?.stackParent ?? null; p !== null && n < 100; p = c.state.tickets[p]?.stackParent ?? null) n += 1;
    return n;
  };
  for (const [id, t] of Object.entries(c.state.tickets)) {
    const others = stackOf(c, id);
    const stack = others.length ? [...others, id].sort((a, b) => depth(a) - depth(b)) : null;
    const merge =
      t.stage === 'delivered'
        ? t.merges.length
          ? 'merged'
          : 'left-for-human'
        : t.stage === 'awaiting-merge'
          ? 'in-queue'
          : t.stage === 'waiting-upstream' || /^waits on /.test(String(t.reason ?? ''))
            ? 'waiting-upstream'
            : 'not-merged';
    const pr = t.pr ?? null;
    const ci = c.book.flags[id]?.prCi ?? null;
    const ready = c.book.flags[id]?.prReady ? readJsonFile(c.deps, c.book.flags[id].prReady) : null;
    const gate = merge === 'left-for-human' && ready?.gate ? { decision: ready.gate.decision, reason: ready.gate.reason } : null;
    for (const m of c.group(id)) {
      rows.push({
        ticket: m,
        lead: m === id ? null : id,
        stage: t.stage,
        pr,
        url: pr !== null && c.cfg.repo ? `https://github.com/${c.cfg.repo}/pull/${pr}` : null,
        stack,
        merge,
        mergeSha: t.merges.at(-1)?.sha ?? null,
        ci: ci ? { verdict: ci.verdict, sha: ci.sha } : null,
        gate,
        reason: t.reason ?? t.leftForHuman ?? null,
      });
    }
  }
  return rows;
}

/** #200: the human-work list's merges — the PRs left for a person, a stack's bottom first, with merge-gate's reason. */
function humanMerges(c, rows) {
  const left = rows.filter((r) => r.lead === null && r.merge === 'left-for-human' && r.pr !== null);
  const pos = (r) => (r.stack ? r.stack.indexOf(r.ticket) : 0);
  left.sort((a, b) => String(a.stack?.[0] ?? a.ticket).localeCompare(String(b.stack?.[0] ?? b.ticket)) || pos(a) - pos(b));
  return left.map((r) => ({
    ticket: r.ticket,
    pr: r.pr,
    url: r.url,
    stack: r.stack,
    gate: r.gate,
    text: `merge PR ${r.pr}${r.url ? ` (${r.url})` : ''} for ${r.ticket}${r.gate ? ` — merge-gate.mjs: ${r.gate.decision}, ${r.gate.reason}` : ''}${r.stack ? ` — stack ${r.stack.join(' ← ')}, merge position ${r.stack.indexOf(r.ticket) + 1} of ${r.stack.length}, with \`gh stack merge ${r.pr} --yes --squash\`` : ''}`,
  }));
}

/** One line's simplify pass, base sync, full verification and delivery; true once all are done. */
function finishLine(c, line, target) {
  const { state, book, profile, git } = c;
  const L = state.lines[line];
  const wt = git.wtOf(target) ?? c.cfg.root;
  const merged = Object.values(state.tickets).some((t) => c.target(t.line) === target && t.merges.length);
  if (!merged) return true; // nothing was integrated: nothing to deliver
  if (L.assignment?.deadline) return false; // its ci-fix agent is at work in the integration worktree (#144)
  if (profile.simplify && simplifySpawn(c, line, target, wt)) return false;
  if (profile.integrate !== 'direct' && !L.base) {
    const baseRef = git.hasOrigin ? `origin/${c.cfg.base}` : c.cfg.base;
    if (git.hasOrigin && c.emit(exec(`fetch:${line}`, 'sync-base', ['git', '-C', wt, 'fetch', 'origin', c.cfg.base], { line }))) return false;
    const baseSha = git.commit(baseRef);
    const tip = git.ref(target);
    const flag = book.flags[`line:${line}`] ?? {};
    if (flag.unsynced) {
      const abort = git.mergeHead(wt) ? c.emit(exec(`sync-abort:${line}`, 'sync-base', ['git', '-C', wt, 'merge', '--abort'], { line })) : null;
      c.emit(exec(`unsynced:${line}`, 'sync-base', stateArgv(c, 'line', line, '--base', flag.unsynced, '--synced', 'no'), { line, after: [abort] }));
      return false;
    }
    if (baseSha && tip && git.ancestor(baseSha, tip)) {
      c.emit(exec(`synced:${line}@${baseSha}`, 'sync-base', stateArgv(c, 'line', line, '--base', baseSha, '--synced', 'yes'), { line }));
      return false;
    }
    if (git.mergeHead(wt)) {
      c.emit(
        judge(`sync-agent:${line}`, 'sync-base', `Merging ${baseRef} into ${line} conflicts. Spawn the merge agent of close-out step 4 for it (description \`${roleDescription('merge', [line])}\`): one side the line, the other the base, the goal the line's intent on the latest base. resolved: it committed the merge; unresolved: it could not (record --value ${baseSha}).`, ['resolved', 'unresolved'], [doc('FINISH.md', 'step 2 (sync the base)')], {
          line,
          meta: { baseSha },
        }),
      );
      return false;
    }
    if (c.done(`sync:${line}`)) {
      c.emit(judge(`sync-check:${line}`, 'sync-base', `Merging ${baseRef} into ${line} ended with neither a merge nor a conflict; settle it and record retry or settled.`, ['retry', 'settled'], [doc('FINISH.md', 'step 2')], { line }));
      return false;
    }
    c.emit(exec(`sync:${line}`, 'sync-base', ['git', '-C', wt, 'merge', '--no-edit', baseRef], { okExit: [0, 1], line }));
    return false;
  }
  if (!finalVerify(c, line, target, wt)) return false;
  if (profile.integrate === 'direct') return true;
  return !c.emit(
    judge(`deliver-line:${line}`, 'deliver-line', `Deliver ${line} as FINISH.md says: ${c.cfg.tracker === 'github' ? 'review-guide.mjs, then the aggregate PR with the per-ticket guide' : 'keep the integration branch, record its name and tip, remove the integration worktree'}. Record done.`, ['done'], [doc('FINISH.md', 'delivering each line')], { line }),
  );
}

/**
 * The simplify agent of one line (#153), a foreground spawn with a brief tick writes: it judges from the line's whole
 * change whether to simplify, and reports applied, none or skipped with a one-line reason. Null once recorded.
 */
function simplifySpawn(c, line, target, wt) {
  const { state, cfg, profile, git } = c;
  const id = `simplify:${line}`;
  if (c.done(id)) return null;
  // The line's whole change: from the base under aggregate-pr; under direct, from before the run's first merge.
  const first = Object.values(state.tickets)
    .filter((t) => c.target(t.line) === target)
    .flatMap((t) => t.merges)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))[0];
  const fork = profile.integrate === 'direct' ? `${first.sha}^1` : git.hasOrigin ? `origin/${cfg.base}` : cfg.base;
  const brief = c.tick('simplify', `${slugOf(line)}.md`);
  c.write(
    brief,
    [
      `# Simplify ${line}`,
      '',
      `You are the simplify agent of one integration line at the run's finish. You cannot ask anyone; this is all of your brief.`,
      '',
      `- Worktree: ${wt} (branch ${target}). Work and commit only there; do not push.`,
      `- The line's whole change: \`git diff ${fork}...${target}\`, run in the worktree (\`--stat\` first).`,
      '',
      'First judge from that change whether it needs a simplify pass:',
      '- Skip it when the change is only documentation, only deletions, only configuration or data files, or adds no new logic.',
      '- Do it when the change adds or rewrites logic that may hold a duplicate implementation, a reusable function it does not use, or a branch or a layer of indirection that can go.',
      '- When unsure, simplify. There is no line-count threshold: judge by what changed, not by how much.',
      '',
      `To simplify, call the Skill tool with \`simplify\` in the worktree, on the line's change above. Commit the fixes you apply as one commit with the subject \`refactor: simplify ${line}\` and no ticket id; its body lists each fix applied, and each fix you rejected with one line on why. With no fix to apply, commit nothing.`,
      '',
      'Reply with these two lines and nothing else:',
      '',
      '```text',
      'outcome: applied | none | skipped',
      'reason: <one line>',
      '```',
      '',
      'applied: you committed fixes. none: you simplified and found no fix to apply. skipped: you judged that no simplify pass is needed and did not call simplify.',
      '',
    ].join('\n'),
  );
  return c.emit({
    id,
    kind: 'spawn',
    step: 'simplify',
    tickets: [],
    line,
    after: [],
    spawn: { subagent_type: 'general-purpose', description: roleDescription('simplify', [line]), prompt: `Read ${resolve(brief)} in full and follow it.`, background: false },
    reference: [doc('FINISH.md', 'step 1 (simplify pass)')],
    outcomes: ['applied', 'none', 'skipped'],
    record: `node ${q(SELF)} record ${q(c.path)} ${q(id)} --agent <agent id> --outcome applied|none|skipped --value <one-line reason>`,
  });
}

/** The lines whose simplify agent skipped the pass, with its reason, in the state's line order. */
function simplifySkipped(c) {
  return Object.keys(c.state.lines)
    .map((line) => ({ line, d: c.book.done[`simplify:${line}`] }))
    .filter(({ d }) => d?.outcome === 'skipped')
    .map(({ line, d }) => ({ line, reason: d.value }));
}

/** The full verification at the line's latest SHA; true once it has a conclusion (or the line failed). */
function finalVerify(c, line, target, wt) {
  const { state, book, profile, git } = c;
  const L = state.lines[line];
  if (book.failed[line] || profile.ci === 'skip' || target !== line) return true; // direct: CI is recorded on the base's own line only
  const tip = git.ref(target);
  if (!tip) return true;
  if (!git.hasOrigin || L.ciNotCovering) {
    const rec = L.local.find((x) => x.sha === tip);
    if (!rec) localVerify(c, line, tip, git.hasOrigin ? 'ci-not-covering' : 'no-origin', wt, true);
    return rec ? rec.result === 'green' : false;
  }
  if (L.ci?.sha === tip && L.ci.verdict === 'green') return true;
  if (L.ci?.sha === tip && L.ci.verdict === 'red') return false; // red-light handling is on
  if (L.ci?.sha === tip && L.ci.verdict === 'query-failed') {
    const rec = L.local.find((x) => x.sha === tip);
    if (!rec) localVerify(c, line, tip, 'no-verdict', wt, true);
    return rec ? rec.result === 'green' : false;
  }
  const tag = `final-w${book.wakeup}-${tip.slice(0, 12)}`;
  if (L.ci?.sha === tip && L.ci.verdict === 'running' && c.done(`ci-record:${line}:${tag}`)) {
    const v = readJsonFile(c.deps, c.tick('ci', `${slugOf(line)}-${tag}.json`));
    const runs = (v?.runs ?? []).filter((x) => x.status !== 'completed');
    const watched = runs.map((x) => c.emit(exec(`watch:${line}:${x.id}`, 'ci-watch', ['gh', 'run', 'watch', String(x.id), '--exit-status', ...(c.cfg.repo ? ['--repo', c.cfg.repo] : [])], { okExit: [0, 1], line })));
    if (watched.some(Boolean)) return false;
    ciRead(c, line, target, tip, `${tag}-again`, false);
    return false;
  }
  ciRead(c, line, target, tip, tag, false);
  return false;
}

// ---- next -------------------------------------------------------------------------------------------------------------

// Where a git or gh command of the pipeline is described (node commands point to their script's header).
const EXEC_REFERENCE = {
  body: { path: js('brief.mjs'), part: 'header (bodyFile)' },
  abort: doc('SEND-BACK.md', 'Send back for a redo'),
  push: { path: SELF, part: 'header (the registry: push)' },
  'ci-rerun': { path: js('ci.mjs'), part: 'header (cancelled: rerun)' },
  'ci-branch': { path: js('state.mjs'), part: 'header (ci: --branch-runs)' },
  'ci-watch': doc('FINISH.md', 'step 3 (full verification)'),
  'sync-base': doc('FINISH.md', 'step 2 (sync the base)'),
  'earliest-red': { path: SELF, part: 'header (a red line on local verification: the earliest-red scan)' },
};

function batches(actions) {
  const at = new Map();
  for (const a of actions) {
    a.batch = 1 + Math.max(0, ...a.after.map((x) => at.get(x) ?? 0));
    at.set(a.id, a.batch);
  }
}

function recordLine(c, a) {
  if (a.record) return a.record;
  const head = `node ${q(SELF)} record ${q(c.path)} ${q(a.id)}`;
  if (a.kind === 'exec') return `${head} --exit ${a.ran ? a.ran.exit : '<exit code>'}`;
  const extra = [];
  if (a.needs?.agent) extra.push('--agent <agent id>');
  if (a.needs?.value) extra.push(`--value <${a.needs.value}>`);
  if (a.needs?.fixed) extra.push('--fixed <id>,<id> --unfixed <id>,<id>');
  return `${head} --outcome ${a.outcomes.join('|')}${extra.length ? ` ${extra.join(' ')}` : ''}`;
}

export function next(path, reported, now, deps, { hold = false } = {}) {
  const state = load(path);
  const c = context(path, state, now, deps);
  c.hold = hold; // run's own lists: their batch-1 spawns are handed out only when run returns the list (#146)
  const { book } = c;
  for (const id of reported) if (!book.inbox.includes(id)) book.inbox.push(id);
  syncAgents(c);
  if (book.finished) {
    return finish(c, 'done');
  }
  stepRan(c);
  stepTips(c);
  stepReports(c);
  stepRed(c);
  stepTimeouts(c);
  stepStop(c);
  for (const [id, t] of Object.entries(state.tickets)) {
    if (t.stage === 'in-review') stepInReview(c, id, t);
    else if (t.stage === 'fixing') stepFixing(c, id, t);
    else if (t.stage === 'implementing') stepImplementing(c, id, t);
    else if (t.stage === 'expanding') stepExpanding(c, id, t);
  }
  stepObservations(c);
  stepExpandReassign(c);
  stepTicketPr(c);
  stepIntegration(c);
  stepDispatch(c);
  stepFinish(c);
  if (c.actions.length) return finish(c, 'tick');
  if (book.finished) return finish(c, 'done');
  const f = c.fallback;
  c.emit(
    judge(
      `wakeup-end:${book.wakeup}`,
      'wakeup-end',
      `Nothing else this wake-up. Write the ledger's narrative fields up to date (next action, self-answer log, human-work list). ${
        f
          ? `Then schedule the fallback wake-up: ScheduleWakeup ${f.scheduleWakeup} seconds; without it, stop the previous background sleep and start \`sleep ${Math.ceil(f.seconds)}\` in the background, recording its task id with --value.`
          : 'No agent is in flight: let /loop pace itself (record --value none to clear a background sleep).'
      } Record done.`,
      ['done'],
      [doc('SKILL.md', 'section 1 (the loop: fallback wake-up)'), doc('ASKING.md', 'section 7 (the ledger)')],
    ),
  );
  return finish(c, 'end');
}

function finish(c, then) {
  const { book } = c;
  batches(c.actions);
  for (const a of c.actions) {
    a.reference ??= a.argv?.[0] === 'node' ? [{ path: a.argv[1], part: 'header' }] : [EXEC_REFERENCE[a.step] ?? doc('SKILL.md', 'section 1 (the loop)')];
    a.record = recordLine(c, a);
    book.issued[a.id] = {
      kind: a.kind,
      step: a.step,
      batch: a.batch,
      tickets: a.tickets,
      line: a.line,
      ...(a.okExit ? { okExit: a.okExit } : {}),
      ...(a.outcomes ? { outcomes: a.outcomes } : {}),
      ...(a.meta ? { meta: a.meta } : {}),
      // a minimal reviewer's spawn: when its round was first issued, so record can tell this round's report from an
      // older one. Each round (the initial review, each recheck, each retry) is an action id of its own; the same id
      // handed out again before it is recorded keeps its time, so a report written before one more `next` counts.
      ...(a.meta?.report ? { at: book.issued[a.id]?.at ?? c.now } : {}),
      ...(c.hold && a.kind === 'spawn' && a.batch === 1 ? { held: true } : {}),
    };
  }
  // Every exec's stdout lands in a directory that exists, later batches' included: the command is a plain redirect.
  for (const dir of new Set(c.actions.filter((a) => a.kind === 'exec' && a.stdout).map((a) => dirname(a.stdout)))) c.deps.mkdir(dir);
  update(c.path, c.now, (s) => {
    s.tick = book;
    return {};
  });
  return {
    format: FORMAT,
    command: 'next',
    run: c.state.run,
    wakeup: book.wakeup,
    now: c.now,
    profile: c.profile,
    reports: c.reports,
    reconcile: c.reconcile,
    dispatch: c.dispatch,
    wrote: [...new Set(c.wrote)],
    actions: c.actions,
    fallback: c.fallback,
    then,
  };
}

// ---- record -----------------------------------------------------------------------------------------------------------

/**
 * review: minimal: the reviewer's report file, when there is one, is this round's (written no earlier than this
 * round's review spawn was first issued, `issuedAt`) and its `verdict:` line says the outcome recorded; fix needs the
 * file, since the fix round reads its findings from it. Refused (3) otherwise. A pass with no file at all goes on.
 */
function checkReport(file, outcome, issuedAt, deps) {
  let held = '';
  try {
    if (deps.exists(file)) held = deps.read(file);
  } catch {}
  const redo = `write the report the reviewer returned this round there, verbatim, and record ${outcome} again`;
  if (!held.trim()) {
    if (outcome === 'fix') throw new Refused(`${file} holds no report: the reviewer writes its full report there; when it did not, ${redo}`);
    return;
  }
  const verdict = /^[\s>*`-]*verdict[\s*`]*:[\s*`]*(pass|fix)\b/im.exec(held)?.[1]?.toLowerCase() ?? null;
  if (!verdict) throw new Refused(`${file} has no \`verdict: pass|fix\` line: ${redo}`);
  if (verdict !== outcome) throw new Refused(`${file} says verdict: ${verdict}, not ${outcome}: record the verdict the report holds, or ${redo}`);
  const mtime = issuedAt ? deps.stat(file).mtimeMs : null; // an entry from before tick kept the time has none
  if (mtime !== null && mtime < Date.parse(issuedAt))
    throw new Refused(`${file} was written ${formatTime(mtime)}, before this round's review spawn was first issued (${issuedAt}): it is an older round's report; ${redo}`);
}

export function record(path, id, flags, now, deps) {
  const state = load(path);
  if (!isObject(state.tick) || state.tick.format !== FORMAT) throw new UsageError(`${path} has no tick configuration: run tick.mjs setup first`);
  const book = structuredClone(state.tick);
  const issued = book.issued[id];
  if (!issued) throw new Refused(`${id} is not an action tick issued for this run`);
  const outcome = flags.outcome ?? null;
  const entry = { at: now };
  if (issued.kind === 'exec') {
    if (flags.exit === undefined || !/^-?\d+$/.test(flags.exit)) throw new UsageError(`${id} is an exec action: record it with --exit <exit code>`);
    entry.exit = Number(flags.exit);
  } else {
    const allowed = issued.outcomes ?? [];
    // #143: a prove-it review host the Agent tool put in the background is recorded by its agent alone
    const inBackground = issued.step === 'review' && issued.kind === 'spawn' && issued.meta?.kind === 'full' && outcome === null;
    if (issued.kind === 'spawn' && (!allowed.length || inBackground)) {
      if (!flags.agent) throw new UsageError(`${id} is a spawn: record it with --agent <agent id>`);
    } else if (!allowed.includes(outcome)) throw new UsageError(`${id}: --outcome must be one of ${allowed.join(', ')}`);
    if (outcome !== null) entry.outcome = outcome;
  }
  if (flags.value !== undefined) entry.value = flags.value;
  if (flags.agent !== undefined) entry.agent = flags.agent;
  if (flags.log !== undefined) entry.log = flags.log; // tick.mjs run only: where the exec's error output went
  const seen = book.done[id];
  if (seen) {
    const same = seen.exit === entry.exit && seen.outcome === entry.outcome && seen.agent === entry.agent;
    if (!same) throw new Refused(`${id} was already recorded (${JSON.stringify(seen)}); a different result is not taken`);
    return { format: FORMAT, command: 'record', id, applied: [], wakeup: book.wakeup, already: true };
  }
  const applied = [];
  const S = (...args) => {
    const r = deps.stateMain([args[0], path, ...args.slice(1), '--now', now]);
    if (r.code === 3) throw new Refused(r.err.trim());
    if (r.code !== 0) throw new Error(r.err.trim());
    applied.push(`state.mjs ${args.join(' ')}`);
    return JSON.parse(r.out);
  };
  const live = () => load(path);
  const ticket = (tid) => live().tickets[tid];
  const flag = (tid) => (book.flags[tid] ??= {});
  const stageIf = (tid, to, reason) => {
    const t = ticket(tid);
    if (t && t.stage !== to) S('stage', to, tid, ...(reason ? ['--reason', reason] : []));
  };
  const release = (tids, stopped = false) => {
    const held = tids.filter((tid) => ticket(tid)?.assignment?.deadline);
    if (held.length) S('release', ...held, ...(stopped ? ['--stopped'] : []));
  };
  const named = (tids, agent) => {
    const open = tids.filter((tid) => ticket(tid)?.assignment?.deadline && ticket(tid).assignment.agentId !== agent);
    if (open.length) S('agent', ...open, '--id', agent);
  };
  const meta = issued.meta ?? {};
  const tickets = issued.tickets ?? [];
  const reissue = (x) => {
    delete book.done[x];
    if (book.ran) delete book.ran[x];
  };
  // A spawn's agent fills the assignment of its tickets (a spawn falling back to another type re-records it).
  const spawned = (tids) => {
    const pending = flag(tids[0]).pending;
    if (flags.type && pending) {
      const recs = join(dirname(path), state.run, 'tick', 'rec');
      if (pending.mode === 'expand') S('assign', ...tids, '--record', join(recs, `expand-r${pending.round}.json`), '--type', flags.type);
      else S('assign', ...tids, '--record', join(recs, `${keyOf(tids[0])}-${pending.n}.json`), '--type', flags.type, '--worktree', pending.worktree);
    }
    named(tids, flags.agent);
    register(flags.agent, pending?.mode === 'expand' ? 'expand' : (pending?.role ?? 'implement'), flags.type ?? (pending?.mode === 'expand' ? AGENT_TYPES.expand : AGENT_TYPES.implement), tids);
  };
  const register = (agent, role, type, tids = tickets) => {
    book.agents[agent] = { tickets: [...new Set([...(book.agents[agent]?.tickets ?? []), ...tids])], role, type, status: 'current', at: now };
    for (const tid of tids) {
      book.dispatches[tid] = (book.dispatches[tid] ?? 0) + 1;
      delete flag(tid).pending;
      delete flag(tid).redispatch;
    }
  };

  // A line's ci-fix agent (#144): its agent id on the line's assignment, the round dispatched.
  const ciFixSpawned = (line, agent) => {
    const a = live().lines[line]?.assignment;
    if (a?.deadline && a.agentId !== agent) S('agent', '--line', line, '--id', agent);
    book.agents[agent] = { tickets: [], line, role: 'ci-fix', type: flags.type ?? 'general-purpose', status: 'current', at: now };
    const fix = book.red[line]?.ciFix;
    if (fix) fix.status = 'dispatched';
  };
  // An agent's report taken (or the agent stopped): its status on the books, and it leaves the inbox.
  const takeAgent = (agent, status = 'collected') => {
    if (book.agents[agent]) book.agents[agent].status = status;
    book.inbox = book.inbox.filter((x) => x !== agent);
  };
  const ciFixEnded = (line, agent, status, stopped = false) => {
    if (live().lines[line]?.assignment?.deadline) S('release', '--line', line, ...(stopped ? ['--stopped'] : []));
    takeAgent(agent, status);
    const fix = book.red[line]?.ciFix;
    if (fix) fix.status = 'ended';
  };
  // #142: a prove-it review's verdict comes with its report's two counts, by whichever path it comes (#143: the spawn,
  // or the collect of a review host that went to the background); a minimal reviewer reports blocking findings only.
  const reviewCounts = (full, withVerdict) => {
    const given = [flags.observations, flags['pre-existing']].filter((x) => x !== undefined).length;
    if (!full && given) throw new UsageError(`${id}: a minimal review reports blocking findings only; record it without --observations and --pre-existing`);
    if (full && !withVerdict && given)
      throw new UsageError(`${id}: a review host in the background has no report yet: record --agent alone; its collect takes --observations and --pre-existing`);
    if (full && withVerdict && given < 2)
      throw new UsageError(`${id}: record the review with the counts of its report's \`counts:\` line: --observations <n> --pre-existing <n>`);
    // #156: the four finding counts of the same line, all four or none, under the same rules
    const more = FINDING_COUNTS.filter((k) => flags[k] !== undefined);
    if (more.length && !full) throw new UsageError(`${id}: a minimal review reports blocking findings only; record it without --${FINDING_COUNTS.join(', --')}`);
    if (more.length && !withVerdict)
      throw new UsageError(`${id}: a review host in the background has no report yet: record --agent alone; its collect takes the counts`);
    if (more.length && more.length < FINDING_COUNTS.length) throw new UsageError(`${id}: --candidates, --confirmed, --invalid and --blocking go together`);
    // #205: the count of candidates another open ticket covers, under the same rules
    if (flags.covered !== undefined && (!full || !withVerdict)) throw new UsageError(`${id}: --covered goes with a prove-it review's report`);
    for (const k of ['observations', 'pre-existing', ...FINDING_COUNTS, 'covered'])
      if (flags[k] !== undefined && !/^\d+$/.test(flags[k])) throw new UsageError(`--${k}: expected a whole number, 0 or more, got ${JSON.stringify(flags[k])}`);
    return [
      ...(given ? ['--observations', flags.observations, '--pre-existing', flags['pre-existing']] : []),
      ...more.flatMap((k) => [`--${k}`, flags[k]]),
      ...(flags.covered !== undefined ? ['--covered', flags.covered] : []),
    ];
  };
  // A review recorded once on ticket `t`, with its report's counts (#142) and the review tier it was chosen by and that
  // tier's reasons (#139, #156).
  const recordReview = (tid, t, meta, verdict, counts) => {
    if (t.stage === 'in-review' && !(currentReview(t) && flag(tid).retryReviews !== t.reviews.length)) {
      S('review', tid, '--mode', meta.mode, '--verdict', verdict, '--kind', meta.kind, ...(meta.tier ? ['--tier', meta.tier] : []), ...(meta.tier && meta.tierReasons ? meta.tierReasons.flatMap((r) => ['--tier-reason', r]) : []), ...(verdict === 'fix' && flags.findings ? ['--findings', flags.findings] : []), ...counts);
    }
  };
  // A prove-it review host's verdict (#143): its assignment released, it is collected, the review recorded once.
  const reviewEnded = (tid, agent, meta, verdict, counts) => {
    release([tid]);
    takeAgent(agent);
    recordReview(tid, ticket(tid), { ...meta, kind: 'full' }, verdict, counts);
  };

  switch (issued.step) {
    case 'collect': {
      if (meta.stage === 'ci-fix') {
        ciFixEnded(issued.line, meta.agent, 'collected');
        break;
      }
      if (meta.stage === 'in-review') {
        if (outcome === 'incomplete') {
          // its turn ended with no report: it stays in flight; stepInReview has the host send it a message at once
          reviewCounts(true, false);
          const prev = flag(tickets[0]).nudge;
          flag(tickets[0]).nudge = { agent: meta.agent, n: (prev?.agent === meta.agent ? prev.n : 0) + 1, sent: false, at: now };
          book.inbox = book.inbox.filter((x) => x !== meta.agent);
          break;
        }
        // #143: the report of a review host that went to the background, with its counts as for the spawn (#142)
        reviewEnded(tickets[0], meta.agent, meta, outcome, reviewCounts(true, true));
        break;
      }
      // #138: a round a review follows hands its report over first (checked before anything is written)
      if (meta.agentReport && ((meta.stage === 'implementing' && outcome === 'green') || (meta.stage === 'fixing' && outcome === 'fixed'))) {
        if (!agentReportOk(deps, meta.agentReport))
          throw new Refused(`${meta.agentReport} holds no agent report with a \`targeted checks:\` line: write the report ${meta.agent} returned there, verbatim, and record ${outcome} again`);
        for (const tid of tickets) flag(tid).agentReport = meta.agentReport;
      }
      release(tickets);
      takeAgent(meta.agent);
      const [tid] = tickets;
      if (meta.stage === 'implementing') {
        if (outcome === 'green') stageIf(tid, 'in-review');
        else if (outcome === 'red') flag(tid).redispatch = { mode: 'send', why: 'red' };
        else stageIf(tid, 'awaiting-ruling', flags.value ?? 'blocked: see the status record');
      } else if (meta.stage === 'expanding') {
        const ruling = flags.value ? list(flags.value, '--value') : [];
        for (const x of tickets) stageIf(x, ruling.includes(x) ? 'awaiting-ruling' : 'candidate', ruling.includes(x) ? 'the expansion agent reported it as awaiting ruling' : undefined);
      } else if (meta.stage === 'fixing') {
        delete flag(tid).prRed; // #197: a pr-red fix round ends with its report; a later fix round is the review's
        if (outcome === 'blocked') stageIf(tid, 'awaiting-ruling', flags.value ?? 'blocked: see the status record');
        else if (live().profile?.recheck === false) {
          if (flags.fixed === undefined && flags.unfixed === undefined) throw new UsageError(`${id}: under recheck: false the fix report needs --fixed and/or --unfixed`);
          if (!currentReport(ticket(tid))) S('report', tid, ...(flags.fixed ? ['--fixed', flags.fixed] : []), ...(flags.unfixed ? ['--unfixed', flags.unfixed] : []));
        } else stageIf(tid, 'in-review');
      } else if (meta.stage === 'integrating' && outcome === 'unresolved') flag(tid).sendBack = true;
      break;
    }
    case 'ignore':
      book.inbox = book.inbox.filter((x) => `ignore:${x}` !== id);
      break;
    case 'nudge': {
      const n = flag(tickets[0]).nudge;
      if (n) n.sent = true;
      if (outcome === 'gone') takeAgent(meta.agent, 'stopped');
      break;
    }
    case 'spawn':
      if (!flags.agent) throw new UsageError(`${id} is a spawn: record it with --agent <agent id>`);
      spawned(tickets);
      break;
    case 'ci-fix':
      if (!flags.agent) throw new UsageError(`${id} is a spawn: record it with --agent <agent id>`);
      ciFixSpawned(issued.line, flags.agent);
      break;
    case 'spawn-check': {
      const of = meta.of;
      if (outcome === 'spawned') {
        if (!flags.agent) throw new UsageError(`${id}: record spawned with --agent <its id>`);
        if (book.issued[of]?.step === 'ci-fix') ciFixSpawned(book.issued[of].line, flags.agent);
        else spawned(book.issued[of]?.tickets ?? tickets);
        book.done[of] = { at: now, agent: flags.agent };
      } else {
        book.spawnChecks = { ...(book.spawnChecks ?? {}), [of]: (book.spawnChecks?.[of] ?? 0) + 1 };
        delete book.issued[of]; // issued again as a spawn by the next list
      }
      break;
    }
    case 'send': {
      const [tid] = tickets;
      const pending = flag(tid).pending;
      if (outcome === 'sent') {
        named(tickets, pending.prevAgent);
        register(pending.prevAgent, pending.role, book.agents[pending.prevAgent]?.type ?? 'general-purpose');
      } else {
        flag(tid).redispatch = { ...(flag(tid).redispatch ?? {}), mode: 'spawn' };
        flag(tid).pending = { ...pending, mode: 'spawn', note: `Taking over from an agent that is gone: ${whyText(flag(tid), pending.why)}.` };
      }
      break;
    }
    case 'merge-agent': {
      if (!flags.agent) throw new UsageError(`${id}: record spawned with --agent <the merge agent id>`);
      named(tickets, flags.agent);
      register(flags.agent, 'merge', flags.type ?? 'general-purpose');
      break;
    }
    case 'unnamed':
      if (outcome === 'spawned') {
        if (!flags.agent) throw new UsageError(`${id}: record spawned with --agent <its id>`);
        named(tickets, flags.agent);
        register(flags.agent, 'implement', flags.type ?? ticket(tickets[0])?.assignment?.type ?? AGENT_TYPES.implement);
      } else {
        release(tickets);
        flag(tickets[0]).redispatch = { mode: 'spawn' };
      }
      break;
    case 'review': {
      const [tid] = tickets;
      const t = ticket(tid);
      // #142: a prove-it review is recorded with its report's two counts (#143: not while its host is in the background)
      const counts = reviewCounts(meta.kind !== 'minimal', outcome !== null);
      if (meta.report) {
        checkReport(meta.report, outcome, issued.at, deps); // review: minimal
        flag(tid).report = meta.report;
      } else delete flag(tid).report;
      if (issued.kind === 'spawn') {
        if (!flags.agent) throw new UsageError(`${id}: record the reviewer with --agent <agent id>`);
        book.agents[flags.agent] = { tickets, role: 'review', type: 'general-purpose', status: 'collected', at: now };
      }
      if (meta.kind === 'full') {
        // #143: the review host holds the assignment tick recorded before the spawn; with no outcome it is in flight
        named(tickets, flags.agent);
        book.agents[flags.agent].status = 'current';
        delete flag(tid).redispatch;
        // #139: a host that went to the background is recorded by its collect, with this spawn's tier
        if (meta.tier) flag(tid).reviewTier = meta.tier;
        else delete flag(tid).reviewTier;
        if (meta.tierReasons) flag(tid).reviewTierReasons = meta.tierReasons;
        else delete flag(tid).reviewTierReasons;
        if (outcome !== null) reviewEnded(tid, flags.agent, meta, outcome, counts);
        break;
      }
      recordReview(tid, t, meta, outcome, counts);
      break;
    }
    case 'agent-report':
      if (!agentReportOk(deps, meta.agentReport))
        throw new Refused(`${meta.agentReport} holds no agent report with a \`targeted checks:\` line: write the latest report of ${tickets[0]}'s implementation or fix agent there, verbatim, and record written again`);
      flag(tickets[0]).agentReport = meta.agentReport;
      break;
    case 'simplify':
      // the simplify agent's report (#153): applied, none or skipped, and a one-line reason (the wrap-up lists skipped)
      if (!flags.agent) throw new UsageError(`${id}: record the simplify agent with --agent <agent id>`);
      if (typeof flags.value !== 'string' || !flags.value.trim() || /[\r\n]/.test(flags.value)) throw new UsageError(`${id}: record the agent's reason with --value <one line>`);
      book.agents[flags.agent] = { tickets: [], role: 'simplify', type: 'general-purpose', status: 'collected', at: now };
      break;
    case 'review-stuck':
      if (outcome === 'retry') flag(tickets[0]).retryReviews = ticket(tickets[0]).reviews.length;
      else if (outcome === 'awaiting-ruling') stageIf(tickets[0], 'awaiting-ruling', flags.value ?? 'the review was stopped by the budget');
      else stageIf(tickets[0], 'stuck', flags.value ?? 'prove-it stuck could not be cleared');
      break;
    case 'mark-stuck':
      stageIf(tickets[0], 'stuck', flags.value ?? 'findings still open after the fix rounds');
      break;
    case 'observations': {
      // #142, #205: one raw ticket per line; a later review's items go into it
      if (!flags.value) throw new UsageError(`${id}: record filed with --value <issue id>`);
      const ln = issued.line ?? ticket(tickets[0])?.line;
      const f = flag(`line:${ln}`);
      const onFile = f.observationsIssue ?? flag(tickets[0]).observationsIssue;
      if (onFile && onFile !== flags.value)
        throw new Refused(`${id}: the observations and pre-existing of line ${ln} go to ${onFile}, the raw ticket filed for it; add the new items there and record filed with --value ${onFile}`);
      f.observationsIssue = flags.value;
      break;
    }
    case 'observations-final':
      break;
    case 'file-issue':
      if (!flags.value) throw new UsageError(`${id}: record filed with --value <issue id>`);
      if (ticket(tickets[0]).unfixedIssue !== flags.value) S('set', tickets[0], '--unfixed-issue', flags.value);
      break;
    case 'send-back': {
      const f = flag(tickets[0]);
      delete f.sendBack;
      // #222 (ticket-pr): the redo's base syncs are attempts of their own — its first is not the rerun after the old
      // attempt's conflict, so it is not taken for a resolution that needs a recheck
      if (f.prSync !== undefined || book.done[`pr-sync:${tickets[0]}:1`]) f.prSync = f.prSyncFrom = (f.prSync ?? 1) + 1;
      // the old attempt's report is not the redo's: nothing is pushed to the pull request before the redo reports
      delete f.agentReport;
      stageIf(tickets[0], outcome === 'stuck' ? 'stuck' : 'candidate', flags.value ?? (outcome === 'stuck' ? 'the integration conflict could not be resolved after a send back' : 'sent back for a redo'));
      break;
    }
    // #196: the ticket-pr merge path's judges
    case 'pr-red':
      // #197: the fix round is pointed at the saved failing output, not at review findings
      if (outcome === 'fix') flag(tickets[0]).prRed = { sha: meta.sha, failure: meta.failure ?? [] };
      stageIf(tickets[0], outcome === 'fix' ? 'fixing' : outcome, flags.value ?? `the PR head's CI is red at ${meta.sha}`);
      break;
    case 'pr-no-ci':
      if (outcome === 'ready') flag(tickets[0]).prCiWaived = meta.sha;
      else stageIf(tickets[0], outcome, flags.value ?? 'no CI run covers the PR head');
      break;
    case 'pr-send': {
      const [tid] = tickets;
      if (outcome === 'left-for-human') {
        if ((ticket(tid)?.leftForHuman ?? null) === null) S('set', tid, '--left-for-human', flags.value ?? `pull request ${meta.pr} is ready; the merge is left for a person`);
        stageIf(tid, 'delivered');
      } else if (outcome !== 'sent') stageIf(tid, outcome, flags.value ?? 'the merge could not be sent');
      break;
    }
    case 'pr-diverged':
      if (outcome === 'retry') reissue(meta.of);
      else stageIf(tickets[0], outcome, flags.value ?? 'the stack diverged while pr-merge synced it');
      break;
    // #197: the base-red episode under integrate: ticket-pr
    case 'revert-send':
      if (book.baseRed) {
        book.baseRed.sent = true; // sent, or left for a person: the base is read until it is green
        if (outcome === 'left-for-human') book.baseRed.left = true; // the finish need not wait for a person's merge
      }
      break;
    case 'base-red-unmatched':
      if (book.baseRed) book.baseRed.settled = true; // the base keeps being read each wake-up until it is green (F2)
      break;
    case 'timeout': {
      if (meta.stage === 'ci-fix') {
        ciFixEnded(issued.line, meta.agent, outcome === 'collected' ? 'collected' : 'stopped', true);
        if (outcome === 'failed') book.failed[issued.line] = now;
        break;
      }
      if (meta.stage === 'in-review' && outcome === 'collected') {
        // #143: the review host had finished: its report is taken by the collect the next list gives (a verdict)
        if (!book.inbox.includes(meta.agent)) book.inbox.push(meta.agent);
        break;
      }
      release(tickets, true);
      if (book.agents[meta.agent]) book.agents[meta.agent].status = 'stopped';
      const [tid] = tickets;
      if (outcome === 'reassign') for (const x of tickets) flag(x).redispatch = { mode: 'spawn', reassign: true };
      else if (outcome === 'stuck') for (const x of tickets) stageIf(x, 'stuck', flags.value ?? 'timed out twice');
      else if (outcome === 'awaiting-ruling') for (const x of tickets) stageIf(x, 'awaiting-ruling', flags.value ?? 'timed out');
      else if (outcome === 'send-back') stageIf(tid, 'candidate', flags.value ?? 'the merge agent timed out: sent back');
      else if (outcome === 'collected') {
        if (book.agents[meta.agent]) book.agents[meta.agent].status = 'collected';
        if (meta.stage === 'implementing' || meta.stage === 'fixing') delete flag(tid).agentReport; // #138: an earlier round's report is not this one's; the review has it written
        if (meta.stage === 'fixing') delete flag(tid).prRed; // #197
        if (meta.stage === 'implementing') stageIf(tid, 'in-review');
        else if (meta.stage === 'expanding') for (const x of tickets) stageIf(x, 'candidate');
        else if (meta.stage === 'fixing') stageIf(tid, 'in-review');
      }
      break;
    }
    case 'red-light':
      if (outcome === 'failed') book.failed[issued.line] = now;
      else if (outcome === 'unmatched') {
        // RED-LIGHT step 4: no ticket matched; tick dispatches the ci-fix agent with the failing lines the host wrote
        const red = book.red[issued.line];
        if (!red) throw new Refused(`${id}: ${issued.line} is not red any more`);
        let failure = '';
        try {
          failure = deps.read(meta.failure);
        } catch {
          failure = '';
        }
        if (!failure.trim()) throw new Refused(`${id}: write the failing lines to ${meta.failure} first (the failure output the ci-fix agent reads), then record unmatched`);
        red.ciFix = { round: meta.round, status: 'pending', sha: meta.sha, failure: meta.failure };
      }
      break;
    case 'verify-local':
      // verify.mjs wrote the per-SHA record itself; a conclusion at the finish is one full verification
      if (entry.exit === 0 && id.includes(':final-')) S('usage', '--add', 'fullVerifications=1');
      break;
    case 'merge-check':
    case 'sync-base':
      if (outcome === 'retry') reissue(id.startsWith('merge-check:') ? id.replace('merge-check:', 'merge:') : `sync:${issued.line}`);
      else if (outcome === 'stuck' || outcome === 'awaiting-ruling') stageIf(tickets[0], outcome, flags.value ?? 'the merge failed');
      else if (outcome === 'unresolved') book.flags[`line:${issued.line}`] = { unsynced: flags.value ?? meta.baseSha };
      break;
    case 'failed':
      if (outcome === 'retry') reissue(meta.of);
      break;
    case 'wakeup-end':
      book.wakeup += 1;
      if (flags.value !== undefined) S('usage', '--sleep-task', flags.value);
      break;
    case 'wrap-up':
      book.finished = now;
      break;
    case 'ci-record': {
      const L = live().lines[issued.line];
      if (id.includes(':final-') && L.ci && ['green', 'red'].includes(L.ci.verdict)) S('usage', '--add', 'fullVerifications=1');
      break;
    }
    default:
      break;
  }
  if (outcome !== 'retry') book.done[id] = entry; // a retry issues the same thing again
  if (book.ran) delete book.ran[id]; // recorded: what run kept of it is spent (#146)
  update(path, now, (s) => {
    s.tick = book;
    return {};
  });
  return { format: FORMAT, command: 'record', id, applied, wakeup: book.wakeup };
}

// ---- run --------------------------------------------------------------------------------------------------------------

/** Where `run` writes one exec's error output: `<run>/tick/run/<action id as a file name>.log`. */
const runLog = (path, run, id) => join(runDir(path, run), 'tick', 'run', `${keyOf(id)}.log`);
const RUN_LISTS = 500;
/** What the host does when `run` exits 3 (#147, #146): the `do` of its output. */
const RUN_REFUSED =
  'blocked ran (its exit is blocked.exit and its side effects happened) and its record was refused: tick or a state.mjs guard said no. tick kept that it ran: it is not run again. Do not edit the state by hand. Settle what `error` says as for a refused record (a refusal is a verdict; do not write it another way), then run `run` again: it records blocked with its exit without running it (when `error` says it is already recorded, nothing is left to record). A refusal you cannot settle is a ruling point: ask.';

/** Keeps that `run` ran an exec, before its record (#146): an exec whose record fails is recorded later, not run again. */
function markRan(path, a, result, now) {
  update(path, now, (s) => {
    (s.tick.ran ??= {})[a.id] = { ...result, at: now, argv: a.argv, stdout: a.stdout ?? null, cwd: a.cwd ?? null };
    return {};
  });
}

/**
 * `next` again and again: each list's batch-1 execs (those marked `host` aside) run through deps.execute
 * in list order, each kept as run and recorded with its exit code as `record --exit` does; `next` runs again only
 * while batch 1 held nothing else and `then` is "tick". An exec an earlier run ran and could not record is recorded,
 * not run. The output is the last list less the execs run, plus `ran`; its batch-1 spawns count as handed out only
 * once it is returned. `now` is read again for each `next` and record: the clock moves while the execs run.
 */
export function run(path, reported, now, deps) {
  const ran = [];
  const lists = []; // each list's own reports, reconcile, dispatch and wrote, with the ids run from it (#147)
  let blocked = null;
  try {
    let out = null;
    for (let i = 0; ; i += 1) {
      if (i > RUN_LISTS) throw new Error(`run: ${RUN_LISTS} lists in a row held nothing but execs; stopping`);
      out = next(path, i === 0 ? reported : [], now(), deps, { hold: true });
      const list = { now: out.now, reports: out.reports, reconcile: out.reconcile, dispatch: out.dispatch, wrote: out.wrote, ran: [] };
      lists.push(list);
      const first = out.actions.filter((a) => a.batch === 1);
      const todo = [];
      for (const a of first.filter((x) => x.kind === 'exec')) if (a.ran || !a.host) todo.push(a);
      for (const a of todo) {
        let result = a.ran; // ran before, its record failed: record it, do not run it again
        blocked = { id: a.id, step: a.step, at: result ? 'record' : 'execute', exit: result?.exit ?? null, log: result?.log ?? runLog(path, out.run, a.id), record: a.record };
        if (!result) {
          deps.mkdir(dirname(blocked.log));
          const { code, signal } = deps.execute(a, blocked.log);
          result = { exit: code, ...(signal ? { signal } : {}), log: blocked.log };
          Object.assign(blocked, { at: 'record', exit: code });
          markRan(path, a, result, now());
        }
        record(path, a.id, { exit: String(result.exit), log: result.log }, now(), deps);
        ran.push({ id: a.id, exit: result.exit, ...(result.signal ? { signal: result.signal } : {}), log: result.log });
        list.ran.push(a.id);
        blocked = null;
      }
      if (out.then !== 'tick' || !first.length || todo.length !== first.length) {
        const done = new Set(todo.map((a) => a.id));
        // returned to the host now: its batch-1 spawns are handed out (a spawn-check if they go unrecorded)
        const held = first.filter((a) => a.kind === 'spawn').map((a) => a.id);
        if (held.length)
          update(path, now(), (s) => {
            for (const id of held) if (s.tick.issued[id]) delete s.tick.issued[id].held;
            return {};
          });
        return { ...out, command: 'run', actions: out.actions.filter((a) => !done.has(a.id)), ran, lists };
      }
    }
  } catch (e) {
    e.run = { ran, blocked, lists }; // what main prints beside the error: what ran, and where run stopped
    throw e;
  }
}

/**
 * Whether the bash on PATH can run tick's commands: it starts, and on win32 it is Git Bash, MSYS or Cygwin (`uname -s`),
 * not WSL's, which flattens Windows paths. { ok, uname: what `uname -s` printed | null, why: null | the reason it is not }.
 * The one judgement of it: bashExecutor uses it, and so do the tests that run commands in bash.
 */
export function bashUsable({ spawn = spawnSync, platform = process.platform } = {}) {
  const p = spawn('bash', ['-c', 'uname -s'], { encoding: 'utf8' });
  if (p.error || p.status !== 0) return { ok: false, uname: null, why: `bash could not be started (${p.error?.message ?? `uname -s exited ${p.status}`}): run the execs by hand` };
  const uname = String(p.stdout ?? '').trim();
  if (platform === 'win32' && !/MINGW|MSYS|CYGWIN/i.test(uname))
    return { ok: false, uname, why: `the bash on PATH is not Git Bash, MSYS or Cygwin (uname -s: ${uname || 'nothing'}), likely WSL's, which flattens Windows paths: put Git Bash first on PATH` };
  return { ok: true, uname, why: null };
}

/**
 * The default exec seam of `run`: `bash -c <command>` with stderr (and stdout, which a `stdout` exec redirects in its
 * command) written to `log`. A bash that is not usable (bashUsable) throws (exit 1) before anything runs.
 */
export function bashExecutor({ spawn = spawnSync, platform = process.platform } = {}) {
  let checked = false;
  return (a, log) => {
    if (!checked) {
      const usable = bashUsable({ spawn, platform });
      if (!usable.ok) throw new Error(usable.why);
      checked = true;
    }
    const fd = openSync(log, 'w');
    try {
      const p = spawn('bash', ['-c', a.command], { stdio: ['ignore', fd, fd] });
      if (p.error) throw new Error(`bash could not run ${a.id} (${p.error.message})`);
      if (p.status === null && p.signal) {
        // killed, not ended (#146): 128 + the signal number, as a shell reports it, which no okExit holds
        writeSync(fd, `
tick.mjs run: killed by ${p.signal}, not a normal end
`);
        return { code: 128 + (osConstants.signals[p.signal] ?? 0), signal: p.signal };
      }
      return { code: p.status ?? 1 };
    } finally {
      closeSync(fd);
    }
  };
}

// ---- setup ----------------------------------------------------------------------------------------------------------

export function setup(path, flags, now) {
  if (!['github', 'local'].includes(flags.tracker)) throw new UsageError('setup needs --tracker github|local');
  if (!flags.root || !flags.base) throw new UsageError('setup needs --root <repo working tree> and --base <base branch>');
  if (flags.tracker === 'github' && !/^[^/\s]+\/[^/\s]+$/.test(flags.repo ?? '')) throw new UsageError('--repo <owner>/<repo> is required with --tracker github');
  if (flags.tracker === 'local' && !flags['tickets-dir']) throw new UsageError('--tickets-dir <repo-relative dir> is required with --tracker local');
  const root = resolve(flags.root);
  return update(path, now, (s) => {
    const config = {
      tracker: flags.tracker,
      repo: flags.repo ?? null,
      root,
      base: flags.base,
      ledger: flags.ledger ? resolve(flags.ledger) : null,
      ticketsDir: flags['tickets-dir'] ?? null,
      worktrees: resolve(flags.worktrees ?? join(dirname(root), `${basename(root)}.worktrees`, s.run)),
      spec: flags.spec ?? null,
    };
    s.tick = isObject(s.tick) && s.tick.format === FORMAT ? { ...s.tick, config } : newBook(config);
    return { config };
  });
}

function newBook(config) {
  return {
    format: FORMAT,
    config,
    wakeup: 1,
    inbox: [],
    agents: {},
    issued: {},
    done: {},
    flags: {},
    red: {},
    failed: {},
    expansions: {},
    dispatches: {},
    dispatch: null,
    lastDispatch: null,
    finished: null,
  };
}

// ---- entry ------------------------------------------------------------------------------------------------------------

function parseArgs(argv, spec) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      rest.push(a);
      continue;
    }
    const name = a.slice(2);
    if (!(name in spec)) throw new UsageError(`unknown flag ${a}`);
    // the next token is the value unless it is missing or is a flag itself (`--reported --now …`); `-1` is a value
    if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new UsageError(`${a} needs a value`);
    const value = argv[(i += 1)];
    if (spec[name] === 'many') (flags[name] ??= []).push(value);
    else if (name in flags) throw new UsageError(`${a} is given twice`);
    else flags[name] = value;
  }
  return { flags, rest };
}

export function defaultDeps() {
  return {
    read: (p) => readFileSync(p, 'utf8'),
    exists: (p) => existsSync(p),
    stat: (p) => ({ mtimeMs: statSync(p).mtimeMs }), // record: when a minimal reviewer's report was written
    mkdir: (p) => mkdirSync(p, { recursive: true }),
    write: (p, text) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, text);
    },
    git: (cwd, args, env = {}) =>
      execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } }),
    stateMain,
    clock: () => Date.now(),
    execute: bashExecutor(), // run: (action, log file) => { code, signal? }
  };
}

/** record with several results joined by `+` (see main): each group after the first takes the state file of the first. */
function recordMany(argv, deps) {
  const groups = [[]];
  for (const a of argv.slice(1)) {
    if (a === '+') groups.push([]);
    else groups.at(-1).push(a);
  }
  const [first, ...more] = groups;
  const state = first[0];
  // one `--now` anywhere (a host appends it at the end) is every group's clock
  const withNow = groups.find((g) => g.includes('--now'));
  const now = withNow ? withNow[withNow.indexOf('--now') + 1] : null;
  const records = [];
  for (const [i, g] of [first, ...more.map((x) => [state, ...x])].entries()) {
    const r = main(['record', ...g, ...(now && !g.includes('--now') ? ['--now', now] : [])], deps);
    if (r.code !== 0) {
      const out = { format: FORMAT, command: 'record', records, failed: { index: i, id: g[1] ?? null } };
      return { code: r.code, out: `${JSON.stringify(out, null, 2)}\n`, err: r.err };
    }
    records.push(JSON.parse(r.out));
  }
  return { code: 0, out: `${JSON.stringify({ format: FORMAT, command: 'record', records }, null, 2)}\n`, err: '' };
}

const SPECS = {
  setup: { tracker: 'one', root: 'one', base: 'one', repo: 'one', ledger: 'one', 'tickets-dir': 'one', worktrees: 'one', spec: 'one', now: 'one' },
  next: { reported: 'many', now: 'one' },
  run: { reported: 'many', now: 'one' },
  record: { exit: 'one', outcome: 'one', agent: 'one', type: 'one', value: 'one', findings: 'one', fixed: 'one', unfixed: 'one', observations: 'one', 'pre-existing': 'one', candidates: 'one', confirmed: 'one', invalid: 'one', blocking: 'one', covered: 'one', now: 'one' },
};

// Returns { code, out, err } instead of touching the process, so tests can drive it.
export function main(argv, deps = defaultDeps()) {
  // `record <state> <id> [flags] + <id> [flags]…`: several results in one call, in order, each as its own record — the
  // host records a batch with one command (every host call reads its whole context again). The first that fails stops
  // the rest; the output lists what was recorded before it.
  if (argv[0] === 'record' && argv.includes('+')) return recordMany(argv, deps);
  try {
    const command = argv[0];
    if (!(command in SPECS)) throw new UsageError('expected setup, next, run or record');
    const { flags, rest } = parseArgs(argv.slice(1), SPECS[command]);
    if (!rest.length) throw new UsageError(`${command} needs the state file first`);
    const path = resolve(rest[0]);
    if (flags.now !== undefined && (!TIME.test(flags.now) || Number.isNaN(Date.parse(flags.now)))) throw new UsageError(`--now: expected a UTC time like 2026-01-31T23:59:59Z`);
    const clock = () => flags.now ?? formatTime(Math.floor(deps.clock() / 1000) * 1000);
    const now = clock();
    let out;
    if (command === 'setup') {
      if (rest.length !== 1) throw new UsageError('setup takes the state file and flags');
      out = { format: FORMAT, command, ...setup(path, flags, now) };
    } else if (command === 'next') {
      if (rest.length !== 1) throw new UsageError('next takes the state file and flags');
      out = next(path, flags.reported ?? [], now, deps);
    } else if (command === 'run') {
      if (rest.length !== 1) throw new UsageError('run takes the state file and flags');
      out = run(path, flags.reported ?? [], clock, deps); // each list and record at its own time
    } else {
      if (rest.length !== 2) throw new UsageError('record takes the state file and one action id');
      out = record(path, rest[1], flags, now, deps);
    }
    return { code: 0, out: `${JSON.stringify(out, null, 2)}\n`, err: '' };
  } catch (e) {
    const refused = e instanceof Refused || e?.constructor?.name === 'Refusal';
    const r = refused ? { code: 3, out: '', err: `tick: refused: ${e.message}\n` } : failure('tick', e);
    if (!e?.run) return r;
    // run stopped part way (#147): what it ran and recorded, the exec it stopped at, and, for a refusal, what to do
    const out = { format: FORMAT, command: 'run', exit: r.code, error: r.err.replace(/^tick: (refused: )?/, '').replace(/\nusage: see the header of tick\.mjs\n$/, '').trim(), ...e.run };
    if (r.code === 3 && e.run.blocked?.at === 'record') out.do = RUN_REFUSED;
    return { ...r, out: `${JSON.stringify(out, null, 2)}\n` };
  }
}

runIfEntry(import.meta.url, main);
