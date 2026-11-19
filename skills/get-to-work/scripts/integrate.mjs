#!/usr/bin/env node
// integrate: the git sequences of get-to-work's lines and close-out, each step idempotent and written into the run
// state through state.mjs (its header is the schema; this script never edits the state file itself). No
// dependencies: runs on a bare Node 20+.
//
// Usage (every command takes the state file first; `--now <UTC>` is passed on to state.mjs's writes)
//   node integrate.mjs line-init   <state> --branch <branch> [--worktree <path>] [--from <ref>] [--repo <dir>]
//   node integrate.mjs ticket-init <state> <ticket> --branch <ticket branch> --worktree <path> [--repo <dir>]
//   node integrate.mjs merge       <state> <ticket> --worktree <integration worktree> [--branch <ticket branch>]
//                                  [--local <ticket file> [--checks <text>]] [--push]
//
// `--repo` is any worktree of the repository (default: the current directory). Paths are compared through their
// real paths, so a Windows short name and its long name are one worktree.
//
// line-init    Creates a line's integration branch and its worktree, by the run's profile `integrate`
//              (state.mjs; default aggregate-pr):
//                aggregate-pr  `--branch` is the line's own `<run>/<line-slug>` branch, created at `--from`
//                              (default HEAD of `--repo`) with a worktree at `--worktree`. The base branch itself
//                              (main, master, origin's default branch) is refused. A branch that already exists is
//                              reused as it is (`--from` is then ignored); a worktree already holding it must be
//                              the one at `--worktree`.
//                direct        `--branch` is the base branch: tickets merge straight into it, and nothing is
//                              created from a ref (`--from` is refused). The branch must exist. The worktree that
//                              already has it checked out is the line's worktree (a different `--worktree` is
//                              refused); when none has, one is added at `--worktree`.
//              Records the line in the state with its tip (`state.mjs line <branch> --tip <sha>`) when the state
//              does not already have that tip.
//              Output: { "format", "command": "line-init", "integrate", "branch", "worktree", "tip",
//                        "created": { "branch": true | false, "worktree": true | false } }
// ticket-init  Creates the ticket branch from the current tip of its line's integration branch (the ticket's
//              `line` in the state), with a worktree at `--worktree`, and records the branch on the ticket
//              (`state.mjs set --branch`). An existing branch is reused as it is; a worktree already holding it must
//              be the one at `--worktree`. Refused for a ticket at an end state.
//              Output: { "format", "command": "ticket-init", "ticket", "line", "branch", "worktree", "head",
//                        "from": "<line tip it was cut from>" | null, "created": { "branch", "worktree" } }
// merge        Integrates one ticket (stage queued, integrating, or delivered for a rerun) in the integration
//              worktree, which must have the ticket's line checked out. The steps, in order; each one checks
//              whether it is already done and only does what is missing, so a rerun after an interruption at any
//              point finishes the rest and never merges twice:
//                1. merge   Already merged when (the rule of #101's git reconciliation): the ticket has a merge SHA
//                           in the state (it must be on the line, else refused: state and git disagree); else
//                           the ticket branch, when it exists, is an ancestor of the line and a merge of it is on
//                           the line's first-parent history (its second parent is the branch tip, or merges.mjs
//                           matches it: `Merge branch '<branch>'`, `Merge <ticket>`); when the branch is gone, the
//                           second way alone. Otherwise `git merge --no-ff --no-edit <branch>` (git's default
//                           message). The worktree must be clean (tracked files) with no merge in progress.
//                           A conflict: `git merge --abort`, exit 4 with { "result": "conflict", "files" }; the
//                           state, the worktree and HEAD are as before. Whether to hand it to a merge agent is the
//                           host's call; after the agent commits the resolution (`git commit --no-edit`), a rerun
//                           finds that merge and goes on from step 2.
//                2. record  queued → integrating (`state.mjs stage`), then the merge SHA (`state.mjs merge`) unless
//                           it is recorded. `found` in the output says where the merge came from: "merged" (this
//                           run), "state" (recorded) or "git" (on the line but not in the state: git wins and it
//                           is recorded now).
//                3. deliver Local Markdown only (`--local <ticket file>`, relative to the integration worktree):
//                           in the file as committed at HEAD, every `- [ ]` of the ticket's own text (outside
//                           fenced code and the `Comments` / `sorry-matt …` sections, as ticket.mjs reads it) and of
//                           its `sorry-matt expansion` sections is ticked, the `Status:` value becomes
//                           `ready-for-human` (a `Status: ready-for-human` line is added under the title when there
//                           is none), and a `## sorry-matt completion` section is appended listing the merge, the
//                           integration branch, the implementation commits (`<merge>^1..<merge>^2`) and the checks
//                           passed (`--checks`, else the ticket's `verification` in the state; one of them is
//                           required). Committed alone as `<ticket>: sorry-matt completion`. Already done when the
//                           file at HEAD has a non-empty completion record after its last `sorry-matt blocker`
//                           (frontier.mjs's done rule); a working-tree copy that differs from both HEAD and the
//                           delivery is refused (uncommitted edits). GitHub delivers nothing here (the ticket stays
//                           open for the aggregate PR).
//                4. stage   integrating → delivered; then the line's tip in the state becomes the worktree's HEAD.
//                5. push    Only with `--push`: `git push -u origin <line>`. Skipped without an `origin` remote
//                           ("no-origin"). A push to a protected branch (main, master, origin's default branch: the
//                           guard hook's rule, so only under integrate: direct) is never run here: the output
//                           gives the command for the host to run, so the guard hook decides it ("host").
//                6. clean   Removes the ticket's worktree (`git worktree remove`, never forced) and the local ticket
//                           branch (`git branch -d`). A worktree with changes is refused; the earlier steps stay
//                           done, and a rerun after it is cleaned finishes.
//              Output: { "format", "command": "merge", "ticket", "line", "branch", "result": "merged",
//                        "merge": "<sha>", "found": "merged" | "state" | "git", "stage": "delivered",
//                        "delivery": "committed" | "already" | "none", "tip": "<sha>",
//                        "push": { "status": "pushed" | "not-requested" | "no-origin" | "host", "command"? },
//                        "cleanup": { "worktree": "removed" | "absent", "branch": "deleted" | "absent" } }
//
// Output is JSON on stdout, format "sorry-matt/integrate@1" (fields are only ever added, never renamed).
// Exit codes: 0 done; 1 git or the state could not be read or written (the message says which step); 2 bad
// arguments; 3 refused: well-formed, but the state or the repository does not allow it (the message says what
// is missing; steps finished before it stay finished); 4 merge conflict (JSON on stdout, nothing changed). On 1,
// 2 and 3 nothing is written to stdout.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { UsageError, run, canonical, failure, runIfEntry } from './cli.mjs';
import { main as stateMain, load, PROFILE_DEFAULTS, TERMINAL } from './state.mjs';
import { ticketOwners } from './merges.mjs';
import { scan, ownRows, lastRecordIndex, sectionAt } from './ticket.mjs';

export const FORMAT = 'sorry-matt/integrate@1';
const CONFLICT = 4;

/** Well-formed, but the state or the repository does not allow it: exit 3. */
class Refusal extends Error {}

// ---- git ---------------------------------------------------------------------------------------------------------

const git = (cwd, ...args) => run('git', args, cwd).replace(/\s+$/, '');
const tryGit = (cwd, ...args) => {
  try {
    return git(cwd, ...args);
  } catch {
    return null;
  }
};
const commitOf = (cwd, ref) => tryGit(cwd, 'rev-parse', '--verify', '-q', `${ref}^{commit}`);
const branchTip = (cwd, branch) => commitOf(cwd, `refs/heads/${branch}`);
const isAncestor = (cwd, a, b) => tryGit(cwd, 'merge-base', '--is-ancestor', a, b) !== null;
const mergeInProgress = (cwd) => tryGit(cwd, 'rev-parse', '--verify', '-q', 'MERGE_HEAD') !== null;
const currentBranch = (cwd) => tryGit(cwd, 'symbolic-ref', '--short', '-q', 'HEAD');

const samePath = (a, b) => {
  const x = canonical(a);
  const y = canonical(b);
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
};

/** The repository's worktrees: [{ path, branch (short name) | null }]. Prunes stale entries first. */
function worktrees(cwd) {
  git(cwd, 'worktree', 'prune');
  const out = [];
  for (const block of git(cwd, 'worktree', 'list', '--porcelain').split(/\r?\n\r?\n/)) {
    const path = /^worktree (.+)$/m.exec(block)?.[1];
    if (!path) continue;
    const ref = /^branch (.+)$/m.exec(block)?.[1] ?? null;
    out.push({ path, branch: ref ? ref.replace(/^refs\/heads\//, '') : null });
  }
  return out;
}

// The guard hook's protected branches (hooks/classify.mjs): main, master, and origin's default branch when the
// clone knows it. A push to one of them is left to the host so the guard sees it.
function isProtected(cwd, branch) {
  if (branch === 'main' || branch === 'master') return true;
  const head = tryGit(cwd, 'symbolic-ref', '--short', '-q', 'refs/remotes/origin/HEAD');
  return !!head && head.slice(head.indexOf('/') + 1) === branch;
}

/**
 * Make sure `branch` has a worktree at `path`: reuse the one holding it there, refuse one elsewhere, add one
 * otherwise. `create` is the start point when the branch does not exist yet. Returns what was created.
 */
function ensureWorktree(repo, branch, path, create) {
  const exists = branchTip(repo, branch) !== null;
  const all = worktrees(repo);
  const holder = all.find((w) => w.branch === branch);
  if (holder) {
    if (!samePath(holder.path, path)) throw new Refusal(`${branch} is already checked out at ${holder.path}, not at ${path}`);
    return { branch: false, worktree: false, path: holder.path };
  }
  const occupant = all.find((w) => samePath(w.path, path));
  if (occupant) throw new Refusal(`${path} is already the worktree of ${occupant.branch ?? 'a detached HEAD'}`);
  if (exists) {
    git(repo, 'worktree', 'add', path, branch);
    return { branch: false, worktree: true, path };
  }
  if (!create) throw new Refusal(`${branch} does not exist`);
  git(repo, 'worktree', 'add', '-b', branch, path, create);
  return { branch: true, worktree: true, path };
}

// ---- state -------------------------------------------------------------------------------------------------------

/** Run a state.mjs command; a refusal there is one here, any other failure is exit 1. */
function state(ctx, command, ...args) {
  const argv = [command, ctx.state, ...args, ...(ctx.now ? ['--now', ctx.now] : [])];
  const r = stateMain(argv);
  if (r.code === 0) return JSON.parse(r.out);
  const message = r.err.trim().replace(/^state: (refused: )?/, '');
  if (r.code === 3) throw new Refusal(`state.mjs ${command}: ${message}`);
  throw new Error(`state.mjs ${command}: ${message}`);
}

const ticketOf = (s, id) => {
  const t = s.tickets[id];
  if (!t) throw new Refusal(`${id} is not a ticket of this run (add it with state.mjs add)`);
  return t;
};

// ---- commands ----------------------------------------------------------------------------------------------------

function lineInit(ctx, rest, flags) {
  if (rest.length) throw new UsageError('line-init takes no positional arguments after the state file');
  if (!flags.branch) throw new UsageError('line-init needs --branch');
  const repo = ctx.repo;
  const s = load(ctx.state);
  const mode = { ...PROFILE_DEFAULTS, ...(s.profile ?? {}) }.integrate;
  const branch = flags.branch;
  let made;
  if (mode === 'direct') {
    if (flags.from !== undefined) throw new UsageError('--from: under integrate: direct the line is the base branch itself; nothing is created from a ref');
    if (branchTip(repo, branch) === null) throw new Refusal(`integrate: direct merges into the base branch ${branch}, which does not exist`);
    const holder = worktrees(repo).find((w) => w.branch === branch);
    if (holder) {
      if (flags.worktree !== undefined && !samePath(holder.path, flags.worktree)) {
        throw new Refusal(`integrate: direct: ${branch} is checked out at ${holder.path}; that is the line's worktree`);
      }
      made = { branch: false, worktree: false, path: holder.path };
    } else {
      if (flags.worktree === undefined) throw new UsageError(`line-init needs --worktree: ${branch} is not checked out anywhere`);
      made = ensureWorktree(repo, branch, ctx.path(flags.worktree), null);
    }
  } else {
    if (flags.worktree === undefined) throw new UsageError('line-init needs --worktree');
    if (isProtected(repo, branch)) {
      throw new Refusal(`integrate: aggregate-pr needs the line's own integration branch; ${branch} is the base branch`);
    }
    const from = flags.from ?? 'HEAD';
    if (branchTip(repo, branch) === null && commitOf(repo, from) === null) throw new Refusal(`--from ${from} is not a commit`);
    made = ensureWorktree(repo, branch, ctx.path(flags.worktree), from);
  }
  const tip = branchTip(repo, branch);
  if (s.lines[branch]?.tip !== tip) state(ctx, 'line', branch, '--tip', tip);
  return {
    out: { command: 'line-init', integrate: mode, branch, worktree: made.path, tip, created: { branch: made.branch, worktree: made.worktree } },
  };
}

function ticketInit(ctx, rest, flags) {
  if (rest.length !== 1) throw new UsageError('ticket-init takes exactly one ticket');
  if (!flags.branch) throw new UsageError('ticket-init needs --branch');
  if (!flags.worktree) throw new UsageError('ticket-init needs --worktree');
  const [id] = rest;
  const repo = ctx.repo;
  const s = load(ctx.state);
  const t = ticketOf(s, id);
  if (TERMINAL.includes(t.stage)) throw new Refusal(`${id} is ${t.stage}, an end state`);
  const lineTip = branchTip(repo, t.line);
  if (lineTip === null) throw new Refusal(`${id}'s integration branch ${t.line} does not exist (line-init first)`);
  const made = ensureWorktree(repo, flags.branch, ctx.path(flags.worktree), lineTip);
  if (t.branch !== flags.branch) state(ctx, 'set', id, '--branch', flags.branch);
  return {
    out: {
      command: 'ticket-init',
      ticket: id,
      line: t.line,
      branch: flags.branch,
      worktree: made.path,
      head: branchTip(repo, flags.branch),
      from: made.branch ? lineTip : null,
      created: { branch: made.branch, worktree: made.worktree },
    },
  };
}

/** The ticket's merge on the line: { sha, found } or null when it is not merged yet (see step 1). */
function findMerge(wt, line, id, t, branch) {
  if (t.merges.length) {
    const sha = commitOf(wt, t.merges[0].sha);
    if (sha === null) throw new Refusal(`${id}: the recorded merge ${t.merges[0].sha} is not a commit in this repository`);
    if (!isAncestor(wt, sha, `refs/heads/${line}`)) throw new Refusal(`${id}: the recorded merge ${sha} is not on ${line}; the state and git disagree`);
    return { sha, found: 'state' };
  }
  const tip = branchTip(wt, branch);
  if (tip !== null && !isAncestor(wt, tip, `refs/heads/${line}`)) return null;
  const log = git(wt, 'log', '--first-parent', '--merges', '--reverse', '--format=%H%x09%P%x09%s', `refs/heads/${line}`);
  const commits = log
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      const [sha, parents, ...s] = l.split('\t');
      return { sha, parents: parents.split(' ').filter(Boolean), subject: s.join('\t') };
    });
  const exact = tip === null ? undefined : commits.find((c) => c.parents[1] === tip);
  if (exact) return { sha: exact.sha, found: 'git' };
  const { owners } = ticketOwners([{ id, branch, merges: [] }], (ref) => git(wt, 'rev-parse', '--verify', `${ref}^{commit}`));
  const named = commits.find((c) => owners(c).owners.length);
  if (named) return { sha: named.sha, found: 'git' };
  if (tip !== null) throw new Refusal(`${id}: ${branch} is already contained in ${line}, but no merge of it is there (does it have commits of its own?)`);
  throw new Refusal(`${id}: ${branch} does not exist and no merge of ${id} is on ${line}`);
}

// ---- Local Markdown delivery ---------------------------------------------------------------------------------------

const UNCHECKED = /^(\s*[-*+]\s+)\[ \]/;
const STATUS = /^[ \t]*(?:\*\*)?Status(?::\*\*|\*\*:|:)[ \t]*(.*)$/i;
const COMPLETION = (t) => /^sorry-matt completion$/i.test(t);
const BLOCKER = (t) => /^sorry-matt blocker$/i.test(t);

/** frontier.mjs's done rule, minus the boxes: a non-empty completion record after the last blocker. */
export function delivered(text) {
  const rows = scan(text);
  const at = lastRecordIndex(rows, COMPLETION);
  return at >= 0 && lastRecordIndex(rows, BLOCKER) < at && sectionAt(rows, at).some((r) => r.line.trim());
}

/** The ticket file with its boxes ticked, Status ready-for-human and a completion section appended. */
export function deliver(text, { merge, line, commits, checks }) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const rows = scan(text);
  const own = ownRows(rows);
  const out = rows.map((r) => r.line);
  const tick = (i) => {
    out[i] = out[i].replace(UNCHECKED, '$1[x]');
  };
  own.forEach((r, i) => r.line && tick(i));
  rows.forEach((r, i) => {
    if (!r.level || !/^sorry-matt expansion$/i.test(r.title)) return;
    sectionAt(rows, i).forEach((row, k) => !row.fenced && tick(i + 1 + k));
  });
  const status = own.findIndex((r) => r.line && !r.level && STATUS.test(r.line));
  if (status >= 0) {
    const value = STATUS.exec(out[status])[1];
    out[status] = `${out[status].slice(0, out[status].length - value.length)}ready-for-human`;
  } else {
    const title = rows.findIndex((r) => r.level === 1);
    if (title >= 0) out.splice(title + 1, 0, '', 'Status: ready-for-human');
    else out.unshift('Status: ready-for-human', '');
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  out.push(
    '',
    '## sorry-matt completion',
    '',
    `- Merge: ${merge}`,
    `- Integration branch: ${line}`,
    '- Implementation commits:',
    ...(commits.length ? commits.map((c) => `  - ${c}`) : ['  - (none)']),
    `- Checks passed: ${checks}`,
    '',
  );
  return out.join(eol);
}

function deliverLocal(wt, file, info, id) {
  const abs = resolve(wt, file);
  const rel = relative(canonical(wt), canonical(abs)).split(sep).join('/');
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Refusal(`--local ${file} is outside the integration worktree ${wt}`);
  let head;
  try {
    head = run('git', ['show', `HEAD:${rel}`], wt);
  } catch {
    throw new Refusal(`--local ${rel} is not committed on ${info.line}`);
  }
  if (delivered(head)) return 'already';
  // Compared with line endings normalized: a checkout may turn the committed LF into CRLF.
  const lf = (x) => x.replace(/\r\n/g, '\n');
  const now = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  let body;
  if (now === null || lf(now) === lf(head)) body = deliver(now ?? head, info);
  else if (lf(now) === lf(deliver(head, info))) body = now;
  else throw new Refusal(`${rel} has uncommitted changes in ${wt}; commit or discard them, then rerun`);
  writeFileSync(abs, body);
  git(wt, 'add', '--', rel);
  git(wt, 'commit', '-q', '-m', `${id}: sorry-matt completion`, '--', rel);
  return 'committed';
}

// ---- merge -------------------------------------------------------------------------------------------------------

function merge(ctx, rest, flags) {
  if (rest.length !== 1) throw new UsageError('merge takes exactly one ticket');
  if (!flags.worktree) throw new UsageError('merge needs --worktree (the integration worktree)');
  if (flags.checks !== undefined && flags.local === undefined) throw new UsageError('--checks goes with --local');
  const [id] = rest;
  const wt = ctx.path(flags.worktree);
  let s = load(ctx.state);
  let t = ticketOf(s, id);
  if (!['queued', 'integrating', 'delivered'].includes(t.stage)) {
    throw new Refusal(`${id} is ${t.stage}; merge takes a ticket that is queued, integrating, or delivered (a rerun)`);
  }
  const branch = flags.branch ?? t.branch;
  if (!branch) throw new Refusal(`${id} has no ticket branch recorded: pass --branch, or create it with ticket-init`);
  const line = t.line;
  const on = currentBranch(wt);
  if (on !== line) throw new Refusal(`${wt} has ${on ?? 'no branch'} checked out, not ${id}'s integration branch ${line}`);
  const checks = flags.checks ?? t.verification;
  if (flags.local !== undefined && !checks) throw new Refusal(`${id}: the delivery record needs the checks passed: pass --checks, or set --verification in the state`);
  if (mergeInProgress(wt)) throw new Refusal(`a merge is in progress in ${wt}: finish it (git commit --no-edit) or abort it (git merge --abort), then rerun`);

  // 1. merge
  let found = findMerge(wt, line, id, t, branch);
  if (!found) {
    if (git(wt, 'status', '--porcelain', '--untracked-files=no')) throw new Refusal(`${wt} has uncommitted changes; the merge needs a clean worktree`);
    try {
      git(wt, 'merge', '--no-ff', '--no-edit', branch);
    } catch (error) {
      if (!mergeInProgress(wt)) throw error;
      const files = git(wt, 'diff', '--name-only', '--diff-filter=U').split(/\r?\n/).filter(Boolean);
      git(wt, 'merge', '--abort');
      return { code: CONFLICT, out: { command: 'merge', ticket: id, line, branch, result: 'conflict', files } };
    }
    found = { sha: git(wt, 'rev-parse', 'HEAD'), found: 'merged' };
  }

  // 2. record
  if (t.stage === 'queued') state(ctx, 'stage', 'integrating', id);
  if (!t.merges.some((m) => commitOf(wt, m.sha) === found.sha)) state(ctx, 'merge', id, found.sha);

  // 3. deliver
  let delivery = 'none';
  if (flags.local !== undefined) {
    const commits = git(wt, 'log', '--reverse', '--format=%h %s', `${found.sha}^1..${found.sha}^2`).split(/\r?\n/).filter(Boolean);
    delivery = deliverLocal(wt, flags.local, { merge: found.sha, line, commits, checks }, id);
  }

  // 4. stage and tip
  s = load(ctx.state);
  t = s.tickets[id];
  if (t.stage === 'integrating') state(ctx, 'stage', 'delivered', id);
  const tip = git(wt, 'rev-parse', 'HEAD');
  if (s.lines[line]?.tip !== tip) state(ctx, 'line', line, '--tip', tip);

  // 5. push
  let push;
  if (!flags.push) push = { status: 'not-requested' };
  else if (tryGit(wt, 'remote', 'get-url', 'origin') === null) push = { status: 'no-origin' };
  else if (isProtected(wt, line)) push = { status: 'host', command: `git -C "${wt}" push -u origin ${line}` };
  else {
    git(wt, 'push', '-q', '-u', 'origin', line);
    push = { status: 'pushed' };
  }

  // 6. clean
  const cleanup = { worktree: 'absent', branch: 'absent' };
  const holder = worktrees(wt).find((w) => w.branch === branch);
  if (holder) {
    try {
      git(wt, 'worktree', 'remove', holder.path);
    } catch (error) {
      throw new Refusal(`${id} is merged and recorded, but its worktree ${holder.path} could not be removed (${String(error.stderr ?? error.message).trim()}); clean it, then rerun`);
    }
    cleanup.worktree = 'removed';
  }
  if (branchTip(wt, branch) !== null) {
    try {
      git(wt, 'branch', '-q', '-d', branch);
    } catch (error) {
      throw new Refusal(`${id} is merged and recorded, but ${branch} could not be deleted (${String(error.stderr ?? error.message).trim()})`);
    }
    cleanup.branch = 'deleted';
  }

  return {
    out: {
      command: 'merge',
      ticket: id,
      line,
      branch,
      result: 'merged',
      merge: found.sha,
      found: found.found,
      stage: load(ctx.state).tickets[id].stage,
      delivery,
      tip,
      push,
      cleanup,
    },
  };
}

// ---- entry -------------------------------------------------------------------------------------------------------

const COMMANDS = {
  'line-init': [lineInit, { branch: 'one', worktree: 'one', from: 'one', repo: 'one', now: 'one' }],
  'ticket-init': [ticketInit, { branch: 'one', worktree: 'one', repo: 'one', now: 'one' }],
  merge: [merge, { worktree: 'one', branch: 'one', local: 'one', checks: 'one', push: 'bool', now: 'one' }],
};

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
    if (name in flags) throw new UsageError(`${a} is given twice`);
    if (spec[name] === 'bool') {
      flags[name] = true;
      continue;
    }
    if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`);
    flags[name] = argv[(i += 1)];
  }
  return { flags, rest };
}

export function defaultDeps() {
  return { cwd: process.cwd() };
}

// Returns { code, out, err } instead of touching the process, so tests can drive it.
export function main(argv, deps = defaultDeps()) {
  try {
    const entry = COMMANDS[argv[0]];
    if (!entry) throw new UsageError(`expected one of ${Object.keys(COMMANDS).join(', ')}`);
    const [cmd, spec] = entry;
    const { flags, rest } = parseArgs(argv.slice(1), spec);
    if (!rest.length) throw new UsageError(`${argv[0]} needs the state file first`);
    const path = (p) => resolve(deps.cwd, p);
    const ctx = { state: path(rest[0]), now: flags.now, repo: path(flags.repo ?? '.'), path };
    const { code = 0, out } = cmd(ctx, rest.slice(1), flags);
    return { code, out: `${JSON.stringify({ format: FORMAT, ...out }, null, 2)}\n`, err: '' };
  } catch (e) {
    if (e instanceof Refusal) return { code: 3, out: '', err: `integrate: refused: ${e.message}\n` };
    return failure('integrate', e);
  }
}

runIfEntry(import.meta.url, main);
