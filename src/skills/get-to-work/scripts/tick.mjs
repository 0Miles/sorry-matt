#!/usr/bin/env node
// tick: the action list of one wake-up of get-to-work's pipeline. It reads the run state (state.mjs), git and the
// files of the run directory, and says what the host does now: which agent reports to take and which to ignore,
// which agents to extend or stop, which ticket to integrate, whether a dispatch point runs and what it dispatches,
// what the finish does, and how long the fallback wake-up waits. Every action points to the reference it needs.
// The host runs the actions and writes each result back with `tick.mjs record`; `tick.mjs run` does that for the
// exec actions but pushes. tick spawns nothing and stops no agent. `next` and `record` run no network call and change
// no branch; `run` executes exec actions, which may reach the network (ci.mjs, gh) and merge branches (integrate.mjs).
// No dependencies: runs on a bare Node 20+ with git on PATH (and, for `run`, bash).
//
// Usage
//   node tick.mjs setup  <state> --tracker github|local --root <repo working tree> --base <base branch>
//                        [--repo <owner>/<repo>] [--ledger <ledger.md>] [--tickets-dir <repo-relative dir>]
//                        [--worktrees <dir>] [--spec <identifier or path>]
//   node tick.mjs next   <state> [--reported <agent id>]... [--now <UTC>]
//   node tick.mjs run    <state> [--reported <agent id>]... [--now <UTC>]
//   node tick.mjs record <state> <action id> [--exit <code>] [--outcome <word>] [--agent <id>] [--type <agent type>]
//                        [--value <text>] [--findings <id>,<id>] [--fixed <id>,<id>] [--unfixed <id>,<id>]
//                        [--now <UTC>]
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
//   review: minimal  one reviewer `spawn` (foreground, description `review <ticket>`, the role word of brief.mjs)
//                    instead of the review host's `judge`, with a brief tick writes: the ticket text's file (fetched
//                    again first on GitHub; the spawn waits for it), the acceptance source (the snapshot's `items`, or
//                    the ticket text as expand: skip has it below), blocking findings only, `verdict: pass | fix`, the
//                    full report written to `tick/review/<ticket key>-<tag>.report.md` beside the brief and also
//                    returned. `record review:…` is refused (3) when that file is missing or empty with
//                    `--outcome fix`, or, when it is there, its `verdict:` line is missing or not the outcome, or it
//                    was written before the review spawn was last issued (`issued.<id>.at`; an interrupted round's
//                    file): the host writes the report returned this round there verbatim. The fix round (send, the
//                    note of a new agent), file-issue and mark-stuck name that file as the findings' source, not the
//                    status record's review block
//   recheck: false   after a fix round, the fix report leads straight to queued (or to the issue for unfixed ones)
//   onUnfixed: file-issue  findings still open → a `judge` to file a raw issue; queued only once its id is recorded
//   expand: skip     no expansion; a ticket whose snapshot has no criteria goes on with its own text (brief.mjs is
//                    given `acceptance: ticket-text`, so the spawn file says the ticket text is the acceptance); one
//                    with criteria (the ticket's own, or a previous run's expansion block) keeps them: `criteria`
//   ci: skip         no CI read and no local verification, in the pipeline or at the finish
//   simplify: false  no simplify pass at the finish
//   integrate: direct  merges go into the base branch; the finish neither syncs the base nor opens aggregate PRs
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
// Output of next (stdout, JSON, format "sorry-matt/tick@1"; fields are only ever added, never renamed)
//   { "format": "sorry-matt/tick@1", "command": "next", "run": "<run>", "wakeup": <n>, "now": "<UTC>",
//     "profile": { ...the effective profile },
//     "reports":   [{ "agent": "<id>", "accepted": true | false, "tickets": [<ticket>],
//                     "why": "current" | "duplicate" | "superseded" | "stopped" | "unknown" }],
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
//   out, and is issued again as the same spawn. A foreground spawn (the minimal reviewer) ends with the host's turn,
//   so it is issued again as it is.
//
// record
//   Writes back one action's result. exec: `--exit <code>` (an exit not in `okExit` makes the next list carry a
//   `judge` to settle the failure). spawn: `--agent <id>` (the reviewer spawn also `--outcome` and `--findings`).
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
//   that list is made). It stops after a list whose batch 1 holds a spawn, a judge, an ask or a push, or whose `then`
//   is "end" or "done": the host's actions. It records no wakeup-end. A push (an exec with step `push`) is never run: the host runs it with
//   its own Bash tool, so the guard hook sees the `git push`. An exit not in `okExit` is recorded as it is; the next
//   list carries its `failed` judge, which stops run; nothing is retried.
//   Each exec's stderr (and its stdout when its `stdout` is null) goes to `<run>/tick/run/<action id as a file
//   name>.log`, which the `failed` judge names.
//   Output: the last `next` output with "command": "run", its `actions` less the execs run (batches are not
//   renumbered), plus "ran": [{ "id", "exit", "log" }] in the order run.
//   bash must start, and on win32 be Git Bash, MSYS or Cygwin (`uname -s`): WSL's bash flattens Windows paths. When
//   it is not, run exits 1 with nothing on stdout; what it recorded before stays.
//
// The bookkeeping lives in the state file under `tick` (state.mjs keeps keys it does not know), written only by
// this script: { "format", "config", "wakeup", "inbox": [agent ids reported, not yet taken],
//   "agents": { "<id>": { "tickets", "role", "type", "status": "current" | "collected" | "stopped", "at" } },
//   "issued": { "<action id>": {…} }, "done": { "<action id>": { "at", "exit"?, "outcome"?, "value"?, "log"? } },
//   "flags": { "<ticket>": {…} }, "red": { "<line>": { "sha", "at" } }, "failed": { "<line>": "<UTC>" },
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
// names them); tick's own plans and outputs go under its `tick/`.
//
// Exit codes: 0 output written; 1 the state, the ledger or git could not be read, a state write failed, or (run) bash
// could not be used; 2 bad arguments; 3 refused (record of an action not issued, an outcome not allowed, a state.mjs
// refusal).
// On 1, 2 or 3 nothing is written to stdout.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, parseJson, failure, runIfEntry } from './cli.mjs';
import { load, update, main as stateMain, TERMINAL, PROFILE_DEFAULTS } from './state.mjs';
import { main as deadlineMain } from './deadline.mjs';
import { parseWorktrees } from './freeze.mjs';
import { ticketOwners } from './merges.mjs';
import { description as roleDescription, fallbackPath, AGENT_TYPES } from './brief.mjs';

export const FORMAT = 'sorry-matt/tick@1';
const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const SKILL = dirname(SCRIPTS);
const SELF = join(SCRIPTS, 'tick.mjs');
const js = (name) => join(SCRIPTS, name);
// `agents/<name>.md` is a plugin agent definition, two levels up from this skill (src: src/agents; dist: agents).
const doc = (file, part) => ({
  path: file === 'ASKING.md' ? resolve(SKILL, '..', 'have-it-all-done', 'ASKING.md') : file.startsWith('agents/') ? resolve(SKILL, '..', '..', file) : join(SKILL, file),
  part,
});

const BUSY = ['expanding', 'implementing', 'in-review', 'fixing', 'queued', 'integrating'];
const IN_FLIGHT = ['implementing', 'in-review', 'fixing', 'queued', 'integrating'];
export const LIMIT_DEFAULTS = Object.freeze({
  spawns: 200,
  rounds: 40,
  hours: 12,
  'no-progress': 3,
  'timeout-implement': 30,
  'timeout-fix': 20,
  'timeout-expand': 15,
  'timeout-merge': 15,
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

function gitView(root, deps) {
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
  const top = tryGit(root, ['rev-parse', '--show-toplevel']);
  if (top === null) throw new Error(`${root} is not a git working tree`);
  const worktrees = parseWorktrees(tryGit(root, ['worktree', 'list', '--porcelain']) ?? '').filter((w) => !w.bare && !w.prunable);
  const hasOrigin = tryGit(root, ['remote', 'get-url', 'origin']) !== null;
  const ref = (b) => (b ? tryGit(root, ['rev-parse', '-q', '--verify', `refs/heads/${b}^{commit}`]) : null);
  const view = {
    root,
    hasOrigin,
    wtOf: (branch) => worktrees.find((w) => w.branch === branch)?.path ?? null,
    ref,
    remote: (b) => (hasOrigin ? tryGit(root, ['rev-parse', '-q', '--verify', `refs/remotes/origin/${b}^{commit}`]) : null),
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

function exec(id, step, argv, { stdout = null, cwd = null, okExit = [0], tickets = [], line = null, after = [], note = null } = {}) {
  return { id, kind: 'exec', step, tickets, line, after, argv, stdout, cwd, okExit, command: commandLine(argv, stdout, cwd), ...(note ? { note } : {}) };
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
  // integrate.mjs ticket-init: the ticket branch from the line's tip, its worktree, the branch recorded
  createTicketBranch: (c, { id, branch, worktree, tag }) =>
    exec(`branch:${id}:${basename(worktree)}:${tag}`, 'ticket-branch', ['node', js('integrate.mjs'), 'ticket-init', c.path, id, '--branch', branch, '--worktree', worktree, '--repo', c.cfg.root], { tickets: [id] }),
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
  push: (c, { target, tag, after }) => exec(`push:${target}:${tag}`, 'push', ['git', '-C', c.git.wtOf(target) ?? c.cfg.root, 'push', '-u', 'origin', target], { line: target, after }),
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
  const profile = { ...PROFILE_DEFAULTS, ...(state.profile ?? {}) };
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
    } else if (a.kind === 'spawn' && a.spawn?.background && book.issued[a.id] && (book.issued[a.id].batch ?? 1) === 1 && (a.after ?? []).every((x) => !x || c.done(x))) {
      // Handed out before in batch 1, runnable then, never recorded: the host was interrupted between spawn and
      // record. A spawn listed at a later batch was not handed out: the host sends batch 1 only (#128). An entry from
      // before batches were kept counts as handed out.
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
    if (!c.actions.some((x) => x.id === action.id)) {
      action.after = (action.after ?? []).filter((x) => x && c.actions.some((y) => y.id === x));
      c.actions.push(action);
    }
    return action.id;
  };
  return c;
}

const limitFor = (c, stage) => c.limits[{ implementing: 'timeout-implement', fixing: 'timeout-fix', expanding: 'timeout-expand', integrating: 'timeout-merge' }[stage]];

// ---- steps ----------------------------------------------------------------------------------------------------------

/** Every agent id the state names joins the registry, so a later report from it can be told apart. */
function syncAgents(c) {
  for (const [id, t] of Object.entries(c.state.tickets)) {
    const a = t.assignment;
    if (!a || !a.agentId) continue;
    const known = (c.book.agents[a.agentId] ??= { tickets: [], role: null, type: a.type, status: 'current', at: a.assigned });
    if (!known.tickets.includes(id)) known.tickets.push(id);
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

const COLLECT = {
  implementing: {
    outcomes: ['green', 'red', 'blocked'],
    what: (ids) => `Take the implementation agent's report for ${ids.join(', ')} (its summary and evidence paths, not the diff) and check close-out step 1: are the targeted checks it reports green? green: on to review; red: it goes back to the same agent; blocked: awaiting ruling, with --value <reason>.`,
    reference: [doc('SKILL.md', 'section 2, Close-out checks and review'), doc('agents/implementer.md', 'section 5, the report it returns')],
  },
  expanding: {
    outcomes: ['reported'],
    what: (ids) => `Take the expansion agent's report for ${ids.join(', ')}. Record reported; --value lists, comma-separated, the tickets it reported as awaiting ruling (they leave the run), the others go back to candidate.`,
    reference: [doc('SKILL.md', 'section 1 (the loop)'), doc('agents/expander.md', 'section 4, the report it returns')],
  },
  fixing: {
    outcomes: ['fixed', 'blocked'],
    what: (ids) => `Take the fix report for ${ids.join(', ')} and check its targeted checks and acceptance comparison are green. fixed: on to the recheck; blocked: awaiting ruling, with --value <reason>.`,
    reference: [doc('SKILL.md', 'section 2, Batched fix')],
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
    const current = Object.entries(state.tickets).filter(([, t]) => t.assignment?.agentId === agent && t.assignment.deadline !== null);
    if (current.length) {
      const ids = current.map(([id]) => id);
      const t0 = current[0][1];
      const spec = COLLECT[t0.stage];
      c.reports.push({ agent, accepted: true, tickets: ids, why: 'current' });
      keep.push(agent);
      const id = `collect:${agent}@${t0.assignment.assigned}`;
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
      const needs = t0.stage === 'fixing' && !c.profile.recheck ? { fixed: 'the finding ids it fixed', unfixed: 'the ones still open' } : null;
      c.emit(judge(id, 'collect', spec.what(ids), spec.outcomes, spec.reference, { tickets: ids, line: t0.line, meta: { agent, stage: t0.stage }, needs }));
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
    if (local) {
      if (!tipLocal) localVerify(c, line, tip, localReason(c), c.git.wtOf(target)); // a fix moved the tip: verify it first
      else {
        const scan = earliestRedScan(c, line, tip);
        if (scan.done) c.emit(redLightJudge(c, line, tip, scan));
      }
      continue;
    }
    const latestRed = L.ci?.verdict === 'red' ? L.ci.sha : lastLocal?.result === 'red' ? lastLocal.sha : red.sha;
    c.emit(redLightJudge(c, line, latestRed));
    if (c.profile.ci === 'skip' || !tip || target !== line) continue;
    ciRead(c, line, target, tip, `w${book.wakeup}`, false);
  }
}

/** The red-light judge of one round at `sha`; on a line on local verification it names the scan's earliest red SHA. */
function redLightJudge(c, line, sha, scan = null) {
  const found = scan
    ? ` Each integration SHA was verified locally from the oldest: the earliest red SHA ${scan.sha}${scan.sha === sha ? ' (no integration SHA is red: the red came in after the last of them)' : ''}; ci.mjs earliest-red on the per-SHA records finds the same.`
    : '';
  return judge(
    `red-light:${line}@${sha}`,
    'red-light',
    `${line} is red at ${sha}.${found} Read RED-LIGHT.md in full and do its red-light handling for this round (earliest red SHA, mapping to a ticket, the fix or the revert). Record handled while a fix round is under way, reverted after a revert, failed when the line failed verification (no ticket matched after two rounds).`,
    ['handled', 'reverted', 'failed'],
    [doc('RED-LIGHT.md', 'all of it')],
    { line, after: scan?.after ?? [], ...(scan ? { meta: { earliestRed: scan.sha } } : {}) },
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
            c.emit(exec(`expansions:${x.id}:${a.deadline}:${id}`, 'expansions', acceptanceArgv(c, id, state.tickets[id]), { stdout: out, cwd: acceptanceCwd(c), tickets: [id] }));
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
  if (!pending) c.fallback = scan.fallback;
  for (const result of scan.agents) {
    const { x } = plan.find((p) => p.entry.id === result.id);
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
          `${x.id} (${x.stage}, ${x.tickets.join(', ')}) is overdue: ${result.error ? `error ${result.error}` : 'stop'}. TaskStop it and settle it by TIMEOUTS.md step 3 (${hint}); write the timeout handling into the status record (step 4). Record the branch taken; collected when it had already finished (its report is then taken).`,
          ['reassign', 'stuck', 'awaiting-ruling', 'send-back', 'collected'],
          [doc('TIMEOUTS.md', 'steps 3 and 4')],
          { tickets: x.tickets, line: t.line, meta: { agent: x.id, stage: x.stage, hint } },
        ),
      );
    }
  }
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
  return last && last.status !== 'stopped' ? last[0] : null;
}

/**
 * The file holding a ticket's full text, and the exec that fetches it (null when there is none to wait for): the
 * ticket file in Local Markdown; on GitHub `tick/body/<n>.md`, fetched once, or once more under the id suffix `again`
 * (a review reads the ticket as it is then).
 */
function bodyFile(c, id, t, after, again = null) {
  if (c.cfg.tracker === 'local') return { file: join(c.git.wtOf(c.target(t.line)) ?? c.cfg.root, c.ticketPath(id)), id: null };
  const file = c.tick('body', `${keyOf(id)}.md`);
  const eid = again ? `body:${id}:${again}` : `body:${id}`;
  if (c.done(eid) && c.deps.exists(file)) return { file, id: null };
  return { file, id: c.emit(exec(eid, 'body', ['gh', 'issue', 'view', numOf(id), '--repo', c.cfg.repo, '--comments'], { stdout: file, tickets: [id], after })) };
}

/**
 * Where a ticket's acceptance is (brief.mjs's `acceptance`): its snapshot's criteria, or the ticket text under
 * expand: skip when the snapshot has none. Criteria a previous run's expansion block or the ticket itself wrote are
 * someone else's acceptance and stay so under skip.
 */
function acceptanceSource(c, id) {
  if (c.profile.expand !== 'skip') return 'criteria';
  const snap = readJsonFile(c.deps, c.snapshot(id)); // null when missing or unreadable
  return Array.isArray(snap?.items) && snap.items.length ? 'criteria' : 'ticket-text';
}

/**
 * Hand a ticket to an agent: the assignment record (deadline.mjs record, then state.mjs assign), then the spawn, the
 * SendMessage to the agent that has the context, or the merge agent. `create` is set for a fresh dispatch from
 * candidate: the worktree and branch actions it waits for, and the stage move to implementing.
 */
function dispatchAgent(c, id, t, { role, stage, mode, worktree, reassign = false, prevAgent = null, why = null, create = null, note = null, files = null }) {
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
  const pending = { mode, role, n, worktree, prevAgent, why, branch: create?.branch ?? t.branch, ...(note ? { note } : {}), ...(files ? { files } : {}) };
  c.flag(id).pending = pending;
  agentTail(c, id, t, pending, [r2, r3, ...before]);
}

const WHY = {
  red: 'its targeted checks were red: fix them to green (close-out step 1)',
  fix: "the review's findings, verbatim (summary, evidence, fix) from the status record: close them all in this one round (close-out step 3)",
  'send-back': 'the send-back record and the rebuilt worktree: redo the ticket from the latest integration branch (SEND-BACK.md)',
};
/** review: minimal leaves its findings in the reviewer's report file (the ticket's flag `report`), not in a review block. */
const reportAt = (flag) => (flag.report ? `${flag.report} (the reviewer's report)` : null);
/** Why an agent gets the work: WHY's text for `why`, or the reviewer's report for a minimal review's fix round. */
const whyText = (flag, why) =>
  why === 'fix' && reportAt(flag)
    ? `the review's findings, verbatim, in ${reportAt(flag)}: close them all in this one round (close-out step 3)`
    : (WHY[why] ?? why);

/** What fills the assignment's agent id: a spawn, a SendMessage or the merge agent's spawn. */
function agentTail(c, id, t, p, after) {
  const spawnRecord = (n) => `node ${q(SELF)} record ${q(c.path)} ${q(`spawn:${id}:${n}`)} --agent <agent id> [--type general-purpose]`;
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
    c.emit(
      judge(
        `merge-agent:${id}:${p.n}`,
        'merge-agent',
        `Merging ${t.branch} into ${c.target(t.line)} conflicts${files}; integrate.mjs aborted the merge, so ${p.worktree} is clean. Spawn a merge agent in the background with description \`${roleDescription('merge', [id])}\` and the merge-conflict brief (both sides' ticket text and commit messages, the intent rule): in ${p.worktree} it runs \`git merge --no-ff --no-edit ${t.branch}\` again, resolves each conflict, and ends with \`git commit --no-edit\`; when it cannot resolve them safely it runs \`git merge --abort\` and reports unresolved. Record spawned with --agent.`,
        ['spawned'],
        [doc('SKILL.md', 'section 2, Merge conflicts')],
        { tickets: [id], line: t.line, after, needs: { agent: 'the merge agent id' } },
      ),
    );
    return;
  }
  // spawn: the brief from brief.mjs, then the Agent call
  const body = bodyFile(c, id, t, []);
  const values = c.tick('brief', `${keyOf(id)}-${p.n}.values.json`);
  const out = c.tick('brief', `${keyOf(id)}-${p.n}.md`);
  let bodyPath = body.file;
  if (p.note) {
    if (body.id) return; // the ticket text comes first; the note is added to it next time
    bodyPath = c.tick('body', `${keyOf(id)}-${p.n}.md`);
    c.write(bodyPath, `${c.deps.read(body.file).replace(/\s+$/, '')}\n\n${p.note}\n`);
  }
  c.write(
    values,
    `${JSON.stringify(
      {
        out,
        role: p.role,
        snapshot: c.snapshot(id),
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
  const a = {
    id: `spawn:${id}:${p.n}`,
    kind: 'spawn',
    step: 'spawn',
    tickets: [id],
    line: t.line,
    after: [b, ...after],
    spawn: { subagent_type: AGENT_TYPES.implement, description: roleDescription(p.role, [id]), prompt: `Read ${resolve(out)} in full and follow it.`, background: true, fallback: fallbackSpawn(out) },
    reference: [doc('SKILL.md', 'section 1 (the loop: spawn; general-purpose when the type is not available)')],
    record: spawnRecord(p.n),
  };
  c.emit(a);
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
  // review: minimal: the open findings are in the reviewer's report; a full review's are in the status record's review block
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

function stepInReview(c, id, t) {
  const k = t.history.filter((h) => h.to === 'in-review').length;
  const mode = t.history[lastEntry(t, 'in-review')]?.from === 'fixing' ? 'recheck' : 'initial';
  const flag = c.flag(id);
  let cr = currentReview(t);
  const retrying = cr?.verdict === 'stuck' && flag.retryReviews === t.reviews.length;
  if (retrying) cr = null;
  if (cr) {
    if (cr.verdict === 'pass') return stageTo(c, id, t, 'queued');
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
  const tag = `${k}${retrying ? `.${t.reviews.length}` : ''}`;
  const against = c.tick('against', `${keyOf(id)}-${tag}.json`);
  const ag = c.emit(
    exec(`against:${id}:${tag}`, 'acceptance-check', acceptanceArgv(c, id, t, ['--against', c.snapshot(id), '--sha', t.snapshotSha256 ?? '<sha256>']), {
      stdout: against,
      cwd: acceptanceCwd(c),
      okExit: [0, 3],
      tickets: [id],
      line: t.line,
    }),
  );
  if (c.profile.review === 'minimal') {
    const brief = c.tick('review', `${keyOf(id)}-${tag}.md`);
    const report = c.tick('review', `${keyOf(id)}-${tag}.report.md`); // the fix round's findings come from here
    const body = bodyFile(c, id, t, [], `review:${tag}`); // the ticket as it is at this review
    const acceptance =
      acceptanceSource(c, id) === 'ticket-text'
        ? '- Acceptance: the ticket text is the acceptance (expand: skip, and the snapshot has no criteria).'
        : `- Acceptance: the \`items\` of the acceptance snapshot ${resolve(c.snapshot(id))}.`;
    c.write(
      brief,
      [
        `# Review ${id}`,
        '',
        `You review one ticket's change and report blocking findings only. You cannot ask anyone; this is all of your brief.`,
        '',
        `- Ticket text: ${resolve(body.file)} (${c.cfg.tracker === 'local' ? 'the ticket file' : 'the full ticket text'}).`,
        acceptance,
        `- Ticket branch: ${t.branch}; compare it with ${c.target(t.line)} (\`git diff ${c.target(t.line)}...${t.branch}\`).`,
        `- Acceptance snapshot: ${c.snapshot(id)}; the comparison with the ticket now: ${against}.`,
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
      spawn: { subagent_type: 'general-purpose', description: roleDescription('review', [id]), prompt: `Read ${brief} in full and follow it.`, background: false },
      reference: [doc('SKILL.md', 'section 2, Close-out checks and review')],
      outcomes: ['pass', 'fix'],
      meta: { mode, kind: 'minimal', report },
      record: `node ${q(SELF)} record ${q(c.path)} ${q(`review:${id}:${tag}`)} --agent <agent id> --outcome pass|fix [--findings <id>,<id>]`,
    });
  }
  return c.emit(
    judge(
      `review:${id}:${tag}`,
      'review',
      `Review ${id}, mode ${mode}: fill REVIEWER.md (the ticket's id and text with its expansion block, the snapshot ${c.snapshot(id)}, the comparison ${against}, the fixed point ${c.target(t.line)}, the ticket branch ${t.branch}, the targeted-check result, the line's CI coverage${mode === 'recheck' ? ', the previous review block: in the status record' : ''}) and spawn the review host agent in the foreground with description \`${roleDescription('review', [id])}\`. Take only its review report. Record its verdict, with fix also --findings <the finding ids>.`,
      ['pass', 'fix', 'stuck'],
      [doc('REVIEWER.md', 'the brief below the rule'), doc('SKILL.md', 'section 2, Close-out checks and review')],
      { tickets: [id], line: t.line, after: [ag], meta: { mode, kind: 'full' } },
    ),
  );
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
  const at = t.stage === 'fixing' ? reportAt(c.flag(id)) : null;
  if (!r?.reassign) return `The fix round of ${id}: the findings are in ${at ?? `the latest review block of its status record${link}`}; close them all.`;
  const head = `The previous agent on ${id} timed out and was stopped. Its commits and uncommitted changes are in the worktree: decide whether to keep them.`;
  // The record it updates is always the status record; under review: minimal the findings are in the report file.
  const findings = at ? ` The findings of this fix round are in ${at}, not in the status record.` : t.stage === 'fixing' ? ' The findings of this fix round are in the latest review block there.' : '';
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
    .map(([id, t]) => ({ id, count: t.assignment.fingerprint?.expansions?.[id] ?? 0 }));
  if (!group.length) return;
  const n = Math.max(...group.map((x) => c.book.dispatches[x.id] ?? 0)) + 1;
  expandDispatch(c, `${Math.max(1, c.state.usage.rounds)}x${n}`, group, { reassign: true });
}

// ---- integration ----------------------------------------------------------------------------------------------------

function stepIntegration(c) {
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
    // integrate.mjs pushes a line itself; a push to the base branch (integrate: direct) is the host's, so the
    // guard hook sees it. One push per integration, before the next merge.
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
  const known = (fid) => (fid in state.tickets ? fid : basename(String(fid)) in state.tickets ? basename(String(fid)) : null);
  const info = new Map(fr.tickets.map((x) => [known(x.id), x]).filter(([k]) => k));
  // 4. stalled tickets and the lines that failed verification leave the pipeline
  for (const [id, t] of Object.entries(state.tickets)) {
    if (t.stage !== 'candidate') continue;
    const f = info.get(id);
    let reason = null;
    if (f?.stalled) reason = `stalled (${f.stalled}): ${f.blockedBy.filter((b) => b.state !== 'done').map((b) => `${b.id} ${b.state}`).join(', ') || 'see frontier'}`;
    else if (book.failed[t.line]) reason = `line failed verification (${t.line})`;
    if (reason) {
      d.touched.push(id);
      stageTo(c, id, t, 'awaiting-ruling', { reason });
    }
  }
  // 5. candidates, the most unblocking first
  const dependents = (id) => fr.tickets.filter((x) => (x.blockedBy ?? []).some((b) => b.inSet && known(b.id) === id)).length;
  const order = fr.frontier.map(known).filter(Boolean);
  const candidates = order
    .filter((id) => state.tickets[id].stage === 'candidate' && !info.get(id)?.stalled && !book.failed[state.tickets[id].line] && !book.red[state.tickets[id].line])
    .map((id, i) => ({ id, i, n: dependents(id) }))
    .sort((x, y) => y.n - x.n || x.i - y.i)
    .map((x) => x.id);
  const ready = [];
  const expand = [];
  let pending = false;
  for (const id of candidates) {
    const t = state.tickets[id];
    const snap = c.snapshot(id);
    let acc = c.deps.exists(snap) ? readJsonFile(c.deps, snap) : null;
    if (!acc) {
      const out = c.tick('acceptance', `r${r}-${keyOf(id)}.json`);
      acc = c.done(`acceptance:${id}:r${r}`) ? readJsonFile(c.deps, out) : null;
      if (!acc) {
        c.emit(exec(`acceptance:${id}:r${r}`, 'acceptance', acceptanceArgv(c, id, t), { stdout: out, cwd: acceptanceCwd(c), tickets: [id], line: t.line }));
        pending = true;
        continue;
      }
      if (acc.needsExpansion && profile.expand === 'agent') {
        expand.push({ id, count: Array.isArray(acc.expansions) ? acc.expansions.length : 0 });
        continue;
      }
      c.write(snap, `${JSON.stringify(acc, null, 2)}\n`); // the snapshot, saved once
    }
    if (t.snapshotSha256 === null) {
      c.emit(exec(`snapshot:${id}`, 'snapshot', stateArgv(c, 'set', id, '--snapshot', acc.sha256), { tickets: [id], line: t.line }));
      pending = true;
    }
    if (!c.deps.exists(c.predicted(id))) {
      c.emit(
        judge(`predict:${id}`, 'predict', `Write ${id}'s predicted files to ${c.predicted(id)}: one repo-relative path per line, \`/\` only when nothing narrower can be inferred, index files left out. Record written.`, ['written'], [doc('SKILL.md', 'section 2, Predicted files')], {
          tickets: [id],
          line: t.line,
        }),
      );
      pending = true;
    }
    ready.push({ id, title: info.get(id)?.title ?? null });
  }
  if (expand.length) expandDispatch(c, r, expand);
  if (pending || !ready.length) return;
  // 6. overlap, then a ticket branch and an implementation agent for each `start`
  const planPath = join(c.W, 'overlap', `${r}.plan.json`);
  const outPath = join(c.W, 'overlap', `${r}.json`);
  const ov = c.done(`overlap:r${r}`) ? readJsonFile(c.deps, outPath) : null;
  if (!ov) {
    const running = Object.entries(state.tickets)
      .filter(([, t]) => IN_FLIGHT.includes(t.stage))
      .map(([id, t]) => {
        let files = c.predicted(id);
        if (!c.deps.exists(files)) {
          files = c.tick('overlap', `${keyOf(id)}.whole.txt`);
          c.write(files, '/\n'); // no prediction on record: it holds the whole repository
        }
        const wt = t.assignment?.worktree && c.deps.exists(t.assignment.worktree) ? t.assignment.worktree : null;
        return { id, files, ...(wt ? { worktree: wt, base: c.target(t.line) } : {}) };
      });
    c.write(planPath, `${JSON.stringify({ running, candidates: ready.map(({ id }) => ({ id, files: c.predicted(id) })) }, null, 2)}\n`);
    c.emit(exec(`overlap:r${r}`, 'overlap', ['node', js('overlap.mjs'), planPath], { stdout: outPath }));
    return;
  }
  for (const id of ov.start ?? []) {
    const t = state.tickets[id];
    if (!t || t.stage !== 'candidate') continue;
    createDispatch(c, id, t, ready.find((x) => x.id === id)?.title);
  }
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
  const ids = Object.keys(state.tickets);
  if (c.cfg.tracker === 'github') {
    const out = c.tick('frontier', `r${r}.json`);
    const read = c.done(`frontier:r${r}`) ? readJsonFile(c.deps, out) : null;
    if (read) return read;
    const done = ids.filter((id) => state.tickets[id].stage === 'delivered').map(numOf);
    const stuck = ids.filter((id) => state.tickets[id].stage === 'stuck').map(numOf);
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

function createDispatch(c, id, t, title) {
  const name = c.cfg.tracker === 'github' ? `${numOf(id).padStart(2, '0')}-${slugOf(String(title ?? 'ticket').toLowerCase()).slice(0, 40).replace(/-+$/, '') || 'ticket'}` : slugOf(basename(id).replace(/\.md$/i, ''));
  const branch = t.branch ?? `${c.state.run}/${name}`;
  const present = c.git.wtOf(branch);
  const worktree = present ?? join(c.cfg.worktrees, basename(branch));
  const w = present && t.branch === branch ? null : c.emit(OPERATIONS.createTicketBranch(c, { id, branch, worktree, tag: `h${hist(t)}` }));
  const prev = t.sendBacks ? implementerOf(c, id) : null;
  dispatchAgent(c, id, t, {
    role: 'implement',
    stage: 'implementing',
    mode: prev ? 'send' : 'spawn',
    worktree,
    prevAgent: prev,
    why: 'send-back',
    create: { after: [w], stageAfter: [w], branch },
  });
}

function expandDispatch(c, r, group, { reassign = false } = {}) {
  const { state } = c;
  const ids = group.map((x) => x.id);
  const bodies = ids.map((id) => bodyFile(c, id, state.tickets[id], []));
  const lines = [...new Set(ids.map((id) => c.target(state.tickets[id].line)))];
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
        tickets: ids.map((id, i) => ({ id, line: c.target(state.tickets[id].line), bodyFile: bodies[i].file })),
      },
      null,
      2,
    )}\n`,
  );
  const rec = c.tick('rec', `expand-r${r}.json`);
  const r1 = c.emit(exec(`rec:expand:r${r}`, 'assignment', ['node', js('deadline.mjs'), 'record', ...group.flatMap((x) => ['--expansions', `${x.id}=${x.count}`]), '--limit', String(c.limits['timeout-expand'])], { stdout: rec, tickets: ids }));
  const r2 = c.emit(exec(`assign:expand:r${r}`, 'assignment', stateArgv(c, 'assign', ...ids, '--record', rec, '--type', AGENT_TYPES.expand, ...(reassign ? ['--reassign'] : [])), { tickets: ids, after: [r1] }));
  const r3 = reassign ? null : c.emit(exec(`stage:expanding:r${r}`, 'stage', stateArgv(c, 'stage', 'expanding', ...ids), { tickets: ids, after: [r2] }));
  c.book.expansions[r] = ids;
  for (const id of ids) c.flag(id).pending = { mode: 'expand', round: r };
  expandTail(c, r, [r2, r3, ...bodies.map((b) => b.id)]);
}

function expandTail(c, r, after = []) {
  const ids = c.book.expansions[r];
  const values = c.tick('brief', `expand-r${r}.values.json`);
  const out = c.tick('brief', `expand-r${r}.md`);
  const b = c.emit(exec(`brief:expand:r${r}`, 'brief', ['node', js('brief.mjs'), 'expand', values], { stdout: c.tick('brief', `expand-r${r}.json`), tickets: ids, after }));
  c.emit({
    id: `spawn:expand:r${r}`,
    kind: 'spawn',
    step: 'spawn',
    tickets: ids,
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
  for (const [id, t] of Object.entries(c.state.tickets)) if (t.stage === 'candidate' || t.stage === 'expanding') stageTo(c, id, t, 'awaiting-ruling', { reason });
}

// ---- the finish -----------------------------------------------------------------------------------------------------

function stepFinish(c) {
  const { state, book, profile } = c;
  const tickets = Object.values(state.tickets);
  if (!tickets.every((t) => TERMINAL.includes(t.stage)) || book.dispatch || book.finished) return;
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
  // The gates of the stop and the finish (gates.mjs); the finish's assertions assume aggregate PRs and a CI read.
  const gates = [];
  if (state.stop) gates.push(c.emit(OPERATIONS.gate(c, { gate: 'stopped' })));
  if (profile.integrate === 'aggregate-pr' && profile.ci === 'read') gates.push(c.emit(OPERATIONS.gate(c, { gate: 'finish' })));
  if (gates.some(Boolean)) return;
  c.emit(
    judge(
      'wrap-up',
      'wrap-up',
      `Every line is through the finish. Read FINISH.md and do what is left after the lines' delivery: the cleanup (clean-it-up), the merge where authority allows${profile.integrate === 'direct' ? ' (integrate: direct — the tickets are on the base branch already; there is no aggregate PR)' : ' (merge queue included)'}, closing tickets, the final output with the reconciliation table, run metrics and spawn breakdown, and the ledger's ended marker when standalone. Record done.`,
      ['done'],
      [doc('FINISH.md', 'after the delivery of each line')],
    ),
  );
}

/** One line's simplify pass, base sync, full verification and delivery; true once all are done. */
function finishLine(c, line, target) {
  const { state, book, profile, git } = c;
  const L = state.lines[line];
  const wt = git.wtOf(target) ?? c.cfg.root;
  const merged = Object.values(state.tickets).some((t) => c.target(t.line) === target && t.merges.length);
  if (!merged) return true; // nothing was integrated: nothing to deliver
  if (profile.simplify && c.emit(judge(`simplify:${line}`, 'simplify', `Simplify pass on ${line}: call the Skill tool with simplify in ${wt}; commit the applied fixes as one commit without a ticket id (none: no commit); log the rejected ones in the self-answer log. Record done.`, ['done'], [doc('FINISH.md', 'step 1 (simplify pass)')], { line })))
    return false;
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
  if (a.kind === 'exec') return `${head} --exit <exit code>`;
  const extra = [];
  if (a.needs?.agent) extra.push('--agent <agent id>');
  if (a.needs?.value) extra.push(`--value <${a.needs.value}>`);
  if (a.needs?.fixed) extra.push('--fixed <id>,<id> --unfixed <id>,<id>');
  return `${head} --outcome ${a.outcomes.join('|')}${extra.length ? ` ${extra.join(' ')}` : ''}`;
}

export function next(path, reported, now, deps) {
  const state = load(path);
  const c = context(path, state, now, deps);
  const { book } = c;
  for (const id of reported) if (!book.inbox.includes(id)) book.inbox.push(id);
  syncAgents(c);
  if (book.finished) {
    return finish(c, 'done');
  }
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
  stepExpandReassign(c);
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
      // a minimal reviewer's spawn: when it was last issued, so record can tell this round's report from an older one
      ...(a.meta?.report ? { at: c.now } : {}),
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
 * review: minimal: the reviewer's report file, when there is one, is this round's (written no earlier than the review
 * spawn was last issued, `issuedAt`) and its `verdict:` line says the outcome recorded; fix needs the file, since the
 * fix round reads its findings from it. Refused (3) otherwise. A pass with no file at all goes on.
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
    throw new Refused(`${file} was written ${formatTime(mtime)}, before this review spawn was last issued (${issuedAt}): it is an older round's report; ${redo}`);
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
    if (issued.kind === 'spawn' && !allowed.length) {
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

  switch (issued.step) {
    case 'collect': {
      release(tickets);
      if (book.agents[meta.agent]) book.agents[meta.agent].status = 'collected';
      book.inbox = book.inbox.filter((x) => x !== meta.agent);
      const [tid] = tickets;
      if (meta.stage === 'implementing') {
        if (outcome === 'green') stageIf(tid, 'in-review');
        else if (outcome === 'red') flag(tid).redispatch = { mode: 'send', why: 'red' };
        else stageIf(tid, 'awaiting-ruling', flags.value ?? 'blocked: see the status record');
      } else if (meta.stage === 'expanding') {
        const ruling = flags.value ? list(flags.value, '--value') : [];
        for (const x of tickets) stageIf(x, ruling.includes(x) ? 'awaiting-ruling' : 'candidate', ruling.includes(x) ? 'the expansion agent reported it as awaiting ruling' : undefined);
      } else if (meta.stage === 'fixing') {
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
    case 'spawn':
      if (!flags.agent) throw new UsageError(`${id} is a spawn: record it with --agent <agent id>`);
      spawned(tickets);
      break;
    case 'spawn-check': {
      const of = meta.of;
      if (outcome === 'spawned') {
        if (!flags.agent) throw new UsageError(`${id}: record spawned with --agent <its id>`);
        spawned(book.issued[of]?.tickets ?? tickets);
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
      if (meta.report) {
        checkReport(meta.report, outcome, issued.at, deps); // review: minimal
        flag(tid).report = meta.report;
      } else delete flag(tid).report;
      if (issued.kind === 'spawn') {
        if (!flags.agent) throw new UsageError(`${id}: record the reviewer with --agent <agent id>`);
        book.agents[flags.agent] = { tickets, role: 'review', type: 'general-purpose', status: 'collected', at: now };
      }
      if (t.stage === 'in-review' && !(currentReview(t) && flag(tid).retryReviews !== t.reviews.length)) {
        S('review', tid, '--mode', meta.mode, '--verdict', outcome, '--kind', meta.kind, ...(outcome === 'fix' && flags.findings ? ['--findings', flags.findings] : []));
      }
      break;
    }
    case 'review-stuck':
      if (outcome === 'retry') flag(tickets[0]).retryReviews = ticket(tickets[0]).reviews.length;
      else if (outcome === 'awaiting-ruling') stageIf(tickets[0], 'awaiting-ruling', flags.value ?? 'the review was stopped by the budget');
      else stageIf(tickets[0], 'stuck', flags.value ?? 'prove-it stuck could not be cleared');
      break;
    case 'mark-stuck':
      stageIf(tickets[0], 'stuck', flags.value ?? 'findings still open after the fix rounds');
      break;
    case 'file-issue':
      if (!flags.value) throw new UsageError(`${id}: record filed with --value <issue id>`);
      if (ticket(tickets[0]).unfixedIssue !== flags.value) S('set', tickets[0], '--unfixed-issue', flags.value);
      break;
    case 'send-back':
      delete flag(tickets[0]).sendBack;
      stageIf(tickets[0], outcome === 'stuck' ? 'stuck' : 'candidate', flags.value ?? (outcome === 'stuck' ? 'the integration conflict could not be resolved after a send back' : 'sent back for a redo'));
      break;
    case 'timeout': {
      release(tickets, true);
      if (book.agents[meta.agent]) book.agents[meta.agent].status = 'stopped';
      const [tid] = tickets;
      if (outcome === 'reassign') for (const x of tickets) flag(x).redispatch = { mode: 'spawn', reassign: true };
      else if (outcome === 'stuck') for (const x of tickets) stageIf(x, 'stuck', flags.value ?? 'timed out twice');
      else if (outcome === 'awaiting-ruling') for (const x of tickets) stageIf(x, 'awaiting-ruling', flags.value ?? 'timed out');
      else if (outcome === 'send-back') stageIf(tid, 'candidate', flags.value ?? 'the merge agent timed out: sent back');
      else if (outcome === 'collected') {
        if (book.agents[meta.agent]) book.agents[meta.agent].status = 'collected';
        if (meta.stage === 'implementing') stageIf(tid, 'in-review');
        else if (meta.stage === 'expanding') for (const x of tickets) stageIf(x, 'candidate');
        else if (meta.stage === 'fixing') stageIf(tid, 'in-review');
      }
      break;
    }
    case 'red-light':
      if (outcome === 'failed') book.failed[issued.line] = now;
      break;
    case 'verify-local':
      // verify.mjs wrote the per-SHA record itself; a conclusion at the finish is one full verification
      if (entry.exit === 0 && id.includes(':final-')) S('usage', '--add', 'fullVerifications=1');
      break;
    case 'merge-check':
    case 'sync-base':
      if (outcome === 'retry') delete book.done[id.startsWith('merge-check:') ? id.replace('merge-check:', 'merge:') : `sync:${issued.line}`];
      else if (outcome === 'stuck' || outcome === 'awaiting-ruling') stageIf(tickets[0], outcome, flags.value ?? 'the merge failed');
      else if (outcome === 'unresolved') book.flags[`line:${issued.line}`] = { unsynced: flags.value ?? meta.baseSha };
      break;
    case 'failed':
      if (outcome === 'retry') delete book.done[meta.of];
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
  update(path, now, (s) => {
    s.tick = book;
    return {};
  });
  return { format: FORMAT, command: 'record', id, applied, wakeup: book.wakeup };
}

// ---- run --------------------------------------------------------------------------------------------------------------

/** Where `run` writes one exec's error output: `<run>/tick/run/<action id as a file name>.log`. */
const runLog = (path, run, id) => join(runDir(path, run), 'tick', 'run', `${keyOf(id)}.log`);
// An exec `run` leaves to the host: a push, so the guard hook sees the `git push` in the host's own tool call.
const runnable = (a) => a.kind === 'exec' && a.step !== 'push';
const RUN_LISTS = 500;

/**
 * `next` again and again: each list's batch-1 execs (push aside) run through deps.execute in list order, each
 * recorded with its exit code as `record --exit` does; `next` runs again only while batch 1 held nothing else and
 * `then` is "tick". The output is the last list less the execs run, plus `ran`. `now` is read again for each `next`
 * and record: the clock moves while the execs run.
 */
export function run(path, reported, now, deps) {
  const ran = [];
  let out = next(path, reported, now(), deps);
  for (let i = 0; ; i += 1) {
    const first = out.actions.filter((a) => a.batch === 1);
    const todo = first.filter(runnable);
    for (const a of todo) {
      const log = runLog(path, out.run, a.id);
      deps.mkdir(dirname(log));
      const { code } = deps.execute(a, log);
      record(path, a.id, { exit: String(code), log }, now(), deps);
      ran.push({ id: a.id, exit: code, log });
    }
    if (out.then !== 'tick' || !first.length || todo.length !== first.length) {
      const done = new Set(todo.map((a) => a.id));
      return { ...out, command: 'run', actions: out.actions.filter((a) => !done.has(a.id)), ran };
    }
    if (i >= RUN_LISTS) throw new Error(`run: ${RUN_LISTS} lists in a row held nothing but execs; stopping`);
    out = next(path, [], now(), deps);
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
    if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`);
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
    execute: bashExecutor(), // run: (action, log file) => { code }
  };
}

const SPECS = {
  setup: { tracker: 'one', root: 'one', base: 'one', repo: 'one', ledger: 'one', 'tickets-dir': 'one', worktrees: 'one', spec: 'one', now: 'one' },
  next: { reported: 'many', now: 'one' },
  run: { reported: 'many', now: 'one' },
  record: { exit: 'one', outcome: 'one', agent: 'one', type: 'one', value: 'one', findings: 'one', fixed: 'one', unfixed: 'one', now: 'one' },
};

// Returns { code, out, err } instead of touching the process, so tests can drive it.
export function main(argv, deps = defaultDeps()) {
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
    if (e instanceof Refused) return { code: 3, out: '', err: `tick: refused: ${e.message}\n` };
    if (e?.constructor?.name === 'Refusal') return { code: 3, out: '', err: `tick: refused: ${e.message}\n` };
    return failure('tick', e);
  }
}

runIfEntry(import.meta.url, main);
