#!/usr/bin/env node
// ci: what GitHub Actions says about an integration branch. `verdict` turns the runs of one SHA into one result;
// `earliest-red` finds where a red line turned red and which tickets were merged in that stretch.
// Read-only: it queries `gh` and `git` and never reruns, pushes or writes anything.
// No dependencies: runs on a bare Node 20+ with git and the `gh` CLI.
//
// Usage
//   node ci.mjs verdict [--repo <owner>/<repo>] <integration branch> <sha>
//   node ci.mjs earliest-red <plan.json>
//
// verdict
//   Input: the integration branch and the SHA to read. `gh` runs in the current directory; pass --repo when that
//   is not inside the repository. The query is
//     gh run list --branch <branch> --commit <sha> --limit 100 --json databaseId,workflowName,status,conclusion
//   All runs of the SHA together give one verdict, by the first rule that matches:
//     1. query-failed  `gh` exited non-zero, could not be started, or printed something that is not a run list.
//     2. no-run        the list is empty (`reason` "empty").
//     3. red           a run's conclusion is failure, timed_out, startup_failure, action_required or stale.
//     4. running       a run's status is not completed.
//     5. cancelled     a run's conclusion is cancelled.
//     6. green         at least one run's conclusion is success (the others being skipped, neutral or anything
//                      not named above);
//        no-run        otherwise: every run completed and none succeeded, e.g. all skipped or neutral
//                      (`reason` "no-success").
//
//   Output (stdout, JSON, format "sorry-matt/ci@1"; fields are only ever added, never renamed)
//   {
//     "format":  "sorry-matt/ci@1",
//     "command": "verdict",
//     "branch":  "<integration branch>",
//     "sha":     "<sha>",
//     "verdict": "query-failed" | "no-run" | "red" | "running" | "cancelled" | "green",
//     "reason":  "empty" | "no-success" | null,   // set only for no-run
//     "error":   "<gh's error message>" | null,   // set only for query-failed
//     "runs":    [{ "id": 123, "workflow": "check", "status": "completed", "conclusion": "success" }],
//     "rerun":   [123]                             // for cancelled: the ids of the cancelled runs, for
//                                                  // `gh run rerun <id>`, which the caller runs; else []
//   }
//
// earliest-red
//   plan.json, written by the host for one line:
//   {
//     "worktree": "<integration worktree>",   // absolute, or relative to the plan file; git and gh run here
//     "line":     "<integration branch>",
//     "base":     "<base ref>",               // what the line's PR merges into, e.g. origin/main
//     "ci":       true,                       // false for a line on local verification: `gh` is never called
//     "repo":     "<owner>/<repo>",           // optional, passed to gh as --repo
//     "local":    ["local: <integration branch> <full SHA> <green|red> <reason>"],
//                                             // optional: the per-SHA local verification records of ledger
//                                             // field 4, copied as they are; records of other branches are
//                                             // ignored, and the first record of a SHA wins
//     "tickets":  [{ "id": "#12", "merges": ["<sha>"], "branch": "<run>/12-slug" }]   // all but id optional
//   }
//   `tickets` has the same fields as in review-guide.mjs's plan; fields that script reads and this one does not
//   are ignored.
//
//   The walk is `git log --first-parent <merge-base>..<tip>`, newest first, where <tip> is `origin/<line>` when
//   `ci` is true and the local `<line>` otherwise, and <merge-base> is `git merge-base <tip> <base>`.
//   Each SHA's verdict: with `ci` true, the runs of
//     gh run list --branch <line> --limit 200 --json headSha,databaseId,workflowName,status,conclusion
//   grouped by `headSha` and judged by the rules of `verdict`; only red and green are conclusions (running,
//   cancelled and no-run, all-skipped SHAs included, are not). A SHA with no CI conclusion takes its local
//   verification record, when it has one. When `gh` fails, only the local records are used and `ci` in the
//   output says so.
//   `earliestRed`: starting at the newest SHA that has a conclusion, when that one is red, the oldest red SHA
//   reached before a green one; SHAs without a conclusion in between are passed over. null when the newest
//   conclusion is green or no SHA has one.
//   `lowerBound`: that green SHA (`kind` "green"), or the merge base when there is no earlier green conclusion
//   (`kind` "merge-base"), on lines with CI as well.
//   `tickets`: the tickets owning the two-parent first-parent merges of `<lowerBound.sha>..<earliestRed>`, oldest
//   first, each once, matched by the rules in the header of review-guide.mjs (merges.mjs implements them for
//   both scripts): a ticket with recorded `merges` is matched only by SHA; one without, by its subject —
//   `Merge branch '<branch>'` or `Merge branch '<branch>-ci'`, or `Merge <id>`. Host commits in the stretch are
//   not merges and own nothing.
//
//   Output (stdout, JSON, format "sorry-matt/ci@1"; fields are only ever added, never renamed)
//   {
//     "format":      "sorry-matt/ci@1",
//     "command":     "earliest-red",
//     "line":        { "ref": "origin/<integration branch>", "sha": "<tip>" },
//     "ci":          "read" | "query-failed" | "not-read",    // not-read: the plan's `ci` is false
//     "error":       "<gh's error message>" | null,           // set only for query-failed
//     "earliestRed": "<sha>" | null,
//     "lowerBound":  { "sha": "<sha>", "kind": "green" | "merge-base" } | null,   // null with earliestRed
//     "tickets":     ["#12", "#14"],                           // ids, oldest merge first
//     "unmatched":   false,                                    // true: there is a red, and no merge in the
//                                                              // stretch belongs to a ticket
//     "merges":      [{ "sha": "<merge>", "subject": "...", "tickets": ["#12"],
//                       "matchedBy": "sha" | "branch" | "id" | null }],   // the stretch's merges, oldest first
//     "verdicts":    [{ "sha": "<sha>", "verdict": "red", "source": "ci" | "local" }]
//                                                              // newest first: walked SHAs with CI runs or a
//                                                              // local record; verdict as in `verdict`
//   }
//
// Exit codes: 0 output written, a failed `gh` query included (it is a result: `query-failed`); 1 git failed;
// 2 bad arguments or plan.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { UsageError, failure, run, runIfEntry } from './cli.mjs';
import { ticketOwners } from './merges.mjs';

export const FORMAT = 'sorry-matt/ci@1';

const RED = new Set(['failure', 'timed_out', 'startup_failure', 'action_required', 'stale']);
const RUN_FIELDS = 'databaseId,workflowName,status,conclusion';

const toRun = (r) => ({ id: r.databaseId, workflow: r.workflowName ?? null, status: r.status ?? null, conclusion: r.conclusion || null });

/** One verdict for the runs of one SHA (`{ id, workflow, status, conclusion }` each): rules 2 to 6 of the header. */
export function classify(runs) {
  const result = (verdict, extra = {}) => ({ verdict, reason: null, rerun: [], ...extra });
  if (!runs.length) return result('no-run', { reason: 'empty' });
  if (runs.some((r) => RED.has(r.conclusion))) return result('red');
  if (runs.some((r) => r.status !== 'completed')) return result('running');
  const cancelled = runs.filter((r) => r.conclusion === 'cancelled');
  if (cancelled.length) return result('cancelled', { rerun: cancelled.map((r) => r.id) });
  if (runs.some((r) => r.conclusion === 'success')) return result('green');
  return result('no-run', { reason: 'no-success' });
}

// `gh run list` through the seam: { runs } with the raw rows, or { error } when the query failed.
function queryRuns(gh, args, cwd) {
  try {
    const rows = JSON.parse(gh(['run', 'list', ...args], cwd));
    if (!Array.isArray(rows)) throw new Error('gh run list did not print a JSON array');
    return { rows };
  } catch (e) {
    return { error: (e.stderr && String(e.stderr).trim()) || e.message };
  }
}

export function verdict({ branch, sha, repo, cwd }, gh) {
  const args = ['--branch', branch, '--commit', sha, '--limit', '100', '--json', RUN_FIELDS, ...(repo ? ['--repo', repo] : [])];
  const q = queryRuns(gh, args, cwd);
  const head = { format: FORMAT, command: 'verdict', branch, sha };
  if (q.error !== undefined) return { ...head, verdict: 'query-failed', reason: null, error: q.error, runs: [], rerun: [] };
  const runs = q.rows.map(toRun);
  const c = classify(runs);
  return { ...head, verdict: c.verdict, reason: c.reason, error: null, runs, rerun: c.rerun };
}

const LOCAL_RECORD = /^local:\s+(\S+)\s+([0-9a-f]{40,64})\s+(green|red)(?:\s|$)/;

export function readPlan(path, read) {
  let plan;
  try {
    plan = JSON.parse(read(path));
  } catch (e) {
    throw new UsageError(`${path}: ${e.message}`);
  }
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new UsageError(`${path}: not a JSON object`);
  for (const key of ['worktree', 'line', 'base']) {
    if (typeof plan[key] !== 'string' || !plan[key]) throw new UsageError(`${path}: ${key} is a non-empty string`);
  }
  if (typeof plan.ci !== 'boolean') throw new UsageError(`${path}: ci is true or false`);
  const repo = plan.repo ?? null;
  if (repo !== null && (typeof repo !== 'string' || !repo)) throw new UsageError(`${path}: repo is a non-empty string`);
  const records = plan.local ?? [];
  if (!Array.isArray(records)) throw new UsageError(`${path}: local is an array of ledger lines`);
  const local = new Map();
  records.forEach((line, i) => {
    const m = typeof line === 'string' && LOCAL_RECORD.exec(line.trim());
    if (!m) throw new UsageError(`${path}: local[${i}] is not "local: <branch> <full SHA> <green|red> <reason>"`);
    if (m[1] === plan.line && !local.has(m[2])) local.set(m[2], m[3]);
  });
  if (!Array.isArray(plan.tickets)) throw new UsageError(`${path}: tickets is an array`);
  const ids = new Set();
  const tickets = plan.tickets.map((t, i) => {
    const where = `${path}: tickets[${i}]`;
    if (!t || typeof t.id !== 'string' || !t.id) throw new UsageError(`${where} has no id`);
    if (ids.has(t.id)) throw new UsageError(`${path}: ${t.id} listed twice`);
    ids.add(t.id);
    const branch = t.branch ?? null;
    if (branch !== null && (typeof branch !== 'string' || !branch)) throw new UsageError(`${where} (${t.id}): branch is a non-empty string`);
    const merges = t.merges ?? [];
    if (!Array.isArray(merges) || !merges.every((x) => typeof x === 'string' && x)) {
      throw new UsageError(`${where} (${t.id}): merges is an array of SHAs`);
    }
    return { id: t.id, branch, merges };
  });
  return { worktree: resolve(dirname(path), plan.worktree), line: plan.line, base: plan.base, ci: plan.ci, repo, local, tickets };
}

export function earliestRed(plan, { git, gh }) {
  const runGit = (args) => git(plan.worktree, args);
  const sha = (ref) => runGit(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();
  const ref = plan.ci ? `origin/${plan.line}` : plan.line;
  const tip = sha(ref);
  const mergeBase = runGit(['merge-base', tip, sha(plan.base)]).trim();
  const walk = runGit(['log', '--first-parent', '--format=%H%x09%P%x09%s', `${mergeBase}..${tip}`])
    .split('\n')
    .filter(Boolean)
    .map((r) => {
      const [h, p, ...s] = r.split('\t');
      return { sha: h, parents: p.split(' ').filter(Boolean), subject: s.join('\t') };
    });

  let ci = 'not-read';
  let error = null;
  const runsBySha = new Map();
  if (plan.ci) {
    const args = ['--branch', plan.line, '--limit', '200', '--json', `headSha,${RUN_FIELDS}`, ...(plan.repo ? ['--repo', plan.repo] : [])];
    const q = queryRuns(gh, args, plan.worktree);
    if (q.error !== undefined) {
      ci = 'query-failed';
      error = q.error;
    } else {
      ci = 'read';
      for (const r of q.rows) runsBySha.set(r.headSha, [...(runsBySha.get(r.headSha) ?? []), toRun(r)]);
    }
  }

  // One entry per walked SHA that anything is known about. A CI conclusion (red or green) stands; without one,
  // the local record is the conclusion.
  const concluded = (v) => v === 'red' || v === 'green';
  const verdictOf = new Map();
  for (const c of walk) {
    const fromCi = runsBySha.has(c.sha) ? classify(runsBySha.get(c.sha)).verdict : null;
    if (plan.local.has(c.sha) && !concluded(fromCi)) verdictOf.set(c.sha, { verdict: plan.local.get(c.sha), source: 'local' });
    else if (fromCi) verdictOf.set(c.sha, { verdict: fromCi, source: 'ci' });
  }

  let red = -1;
  let green = -1;
  for (let i = 0; i < walk.length; i += 1) {
    const v = verdictOf.get(walk[i].sha)?.verdict;
    if (!concluded(v)) continue;
    if (v === 'green') {
      green = i;
      break;
    }
    red = i;
  }

  const out = {
    format: FORMAT,
    command: 'earliest-red',
    line: { ref, sha: tip },
    ci,
    error,
    earliestRed: null,
    lowerBound: null,
    tickets: [],
    unmatched: false,
    merges: [],
    verdicts: walk.filter((c) => verdictOf.has(c.sha)).map((c) => ({ sha: c.sha, ...verdictOf.get(c.sha) })),
  };
  if (red < 0) return out;

  // walk is newest first: the stretch is everything after the lower bound up to the earliest red, oldest first.
  const stretch = walk.slice(red, green < 0 ? walk.length : green).reverse();
  const { owners } = ticketOwners(plan.tickets, sha);
  const merges = stretch
    .filter((c) => c.parents.length > 1)
    .map((c) => {
      const match = owners(c);
      return { sha: c.sha, subject: c.subject, tickets: match.owners.map((t) => t.id), matchedBy: match.owners.length ? match.matchedBy : null };
    });
  const tickets = [...new Set(merges.flatMap((m) => m.tickets))];
  return {
    ...out,
    earliestRed: walk[red].sha,
    lowerBound: green < 0 ? { sha: mergeBase, kind: 'merge-base' } : { sha: walk[green].sha, kind: 'green' },
    tickets,
    unmatched: tickets.length === 0,
    merges,
  };
}

function verdictArgs(argv) {
  const rest = [];
  let repo = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--repo') {
      repo = argv[(i += 1)];
      if (!repo || repo.startsWith('-')) throw new UsageError('--repo takes <owner>/<repo>');
    } else if (argv[i].startsWith('-')) {
      throw new UsageError(`unknown option ${argv[i]}`);
    } else {
      rest.push(argv[i]);
    }
  }
  if (rest.length !== 2) throw new UsageError('verdict takes <integration branch> <sha>');
  return { branch: rest[0], sha: rest[1], repo };
}

export function defaultDeps() {
  return {
    read: (p) => readFileSync(p, 'utf8'),
    git: (cwd, args) => run('git', ['-C', cwd, ...args]),
    gh: (args, cwd) => run('gh', args, cwd),
    cwd: process.cwd(),
  };
}

// Returns { code, out, err } instead of touching the process, so tests can drive it.
export function main(argv, deps = defaultDeps()) {
  try {
    const [command, ...rest] = argv;
    let result;
    if (command === 'verdict') {
      result = verdict({ ...verdictArgs(rest), cwd: deps.cwd }, deps.gh);
    } else if (command === 'earliest-red') {
      if (rest.length !== 1 || rest[0].startsWith('-')) throw new UsageError('earliest-red takes exactly one plan file');
      result = earliestRed(readPlan(resolve(rest[0]), deps.read), deps);
    } else {
      throw new UsageError('expected verdict or earliest-red');
    }
    return { code: 0, out: `${JSON.stringify(result, null, 2)}\n`, err: '' };
  } catch (e) {
    return failure('ci', e);
  }
}

runIfEntry(import.meta.url, main);
