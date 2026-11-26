#!/usr/bin/env node
// ci: what GitHub Actions says about an integration branch or a ticket branch. `verdict` turns the runs of one SHA
// into one result;
// `base` does the same for the latest SHA of the base branch; `earliest-red` finds where a red line turned red
// and which tickets were merged in that stretch.
// Read-only: it queries `gh` and `git` and never reruns, pushes or writes anything.
// No dependencies: runs on a bare Node 20+ with git and the `gh` CLI.
//
// Usage
//   node ci.mjs verdict [--repo <owner>/<repo>] <branch> <sha>
//   node ci.mjs base [--repo <owner>/<repo>] <base branch>
//   node ci.mjs earliest-red <plan.json>
//
// verdict
//   Input: a branch and the SHA to read: an integration branch and its tip, or a ticket branch and the head SHA of
//   its ticket PR. `gh` runs in the current directory; pass --repo when that is not inside the repository. The
//   query is
//     gh run list --branch <branch> --commit <sha> --limit 100 --json databaseId,workflowName,event,status,conclusion
//   It lists the runs of every event on that SHA: a ticket PR's head SHA has a `push` run and a `pull_request` run,
//   and `--branch` matches both (the head branch is the branch of a `pull_request` run; checked live on this repo
//   with `gh run list --branch <PR head branch> --json event,headSha`), so no `--event` query is added. Each run
//   carries its `event`, and the runs of all events are judged together by the rules below: a green `push` run
//   beside a red `pull_request` run is red. Stacked ticket PRs need no workflow trigger of their own: per the
//   gh-stack FAQ ("How do GitHub Actions work with Stacked PRs?"), every PR in a stack triggers `pull_request`
//   workflows, branch protection and required checks as if it targeted the stack's base (main).
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
//     "branch":  "<branch>",
//     "sha":     "<sha>",
//     "verdict": "query-failed" | "no-run" | "red" | "running" | "cancelled" | "green",
//     "reason":  "empty" | "no-success" | null,   // set only for no-run
//     "error":   "<gh's error message>" | null,   // set only for query-failed
//     "runs":    [{ "id": 123, "workflow": "check", "event": "push" | "pull_request" | ... | null,
//                   "status": "completed", "conclusion": "success" }],
//     "rerun":   [123],                            // for cancelled: the ids of the cancelled runs, for
//                                                  // `gh run rerun <id>`, which the caller runs; else []
//     "failed":  [123]                             // the ids of the red runs, for `gh run view <id> --log-failed`
//                                                  // (#197: a red PR head's failing output is saved from these)
//   }
//
// base
//   Input: the base branch, as a branch name or `origin/<branch>`, `refs/remotes/origin/<branch>` or
//   `refs/heads/<branch>` (the prefix is dropped). Its latest SHA is GitHub's, not a local ref's:
//     gh api repos/<owner>/<repo>/commits/<branch> --jq .sha
//   (`repos/{owner}/{repo}/...` without --repo, which gh fills in from the current directory). That SHA's runs are
//   then read and judged exactly as `verdict` does. A lookup that fails or does not print a SHA is query-failed
//   with `sha` null, and no runs are read.
//
//   Output: `verdict`'s fields with `command` "base", `branch` the base branch and `sha` its latest SHA or null,
//   plus `failed`: the ids of the red runs, for `gh run view <id> --log-failed`. freeze.mjs reads it for its
//   `base-ci` preflight check.
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
//     gh run list --branch <line> --limit 200 --json headSha,databaseId,workflowName,event,status,conclusion
//   grouped by `headSha` and judged by the rules of `verdict`; only red and green are conclusions (running,
//   cancelled and no-run, all-skipped SHAs included, are not). A SHA with no CI conclusion takes its local
//   verification record, when it has one. When `gh` fails, only the local records are used and `ci` in the
//   output says so.
//   Truncation: `gh` returns runs newest first and stops at 200. When it returns 200, older runs may be missing:
//   `truncated` is true and `boundary` is the SHA of the last (oldest) run returned. That SHA, every SHA with a
//   run listed after that SHA's first run, and every walked SHA older than one of those are `partial`: on them
//   only red is a CI conclusion (a missing run can turn any other verdict red, but cannot undo a red), so a
//   partial green, running or cancelled SHA is passed over, or takes its local record. A walked SHA with no run
//   listed has no CI verdict, as before. With `truncated`, the earliest red may lie past the boundary; the
//   stretch then still reaches back to the lower bound, so `tickets` covers it.
//   `earliestRed`: starting at the newest SHA that has a conclusion, when that one is red, the oldest red SHA
//   reached before a green one; SHAs without a conclusion in between are passed over. null when the newest
//   conclusion is green or no SHA has one.
//   `lowerBound`: that green SHA (`kind` "green"), or the merge base when there is no earlier green conclusion
//   (`kind` "merge-base"), on lines with CI as well.
//   `baseCi`: with `ci` true, a red and no green on the line, the base's runs of the merge base, from
//     gh run list --branch <base branch> --commit <merge-base> --limit 100 --json headSha,databaseId,workflowName,event,status,conclusion
//   where <base branch> is `base` without a leading `origin/`, `refs/remotes/origin/` or `refs/heads/`, judged by
//   the rules of `verdict`. When that verdict is red, the base was already red where the line left it: the red
//   came in with the base, `tickets` is empty and `unmatched` true. Any other verdict (green, running, cancelled,
//   no-run, query-failed) changes nothing. null when the base is not read.
//   `tickets`: unless `baseCi` is red, the tickets owning the two-parent first-parent merges of
//   `<lowerBound.sha>..<earliestRed>`, oldest first, each once, matched by the rules in the header of
//   review-guide.mjs (merges.mjs implements them for both scripts): a ticket with recorded `merges` is matched
//   only by SHA; one without, by its subject — `Merge branch '<branch>'` or `Merge branch '<branch>-ci'`, or
//   `Merge <id>`. Host commits in the stretch are not merges and own nothing.
//
//   Output (stdout, JSON, format "sorry-matt/ci@1"; fields are only ever added, never renamed)
//   {
//     "format":      "sorry-matt/ci@1",
//     "command":     "earliest-red",
//     "line":        { "ref": "origin/<integration branch>", "sha": "<tip>" },
//     "ci":          "read" | "query-failed" | "not-read",    // not-read: the plan's `ci` is false
//     "error":       "<gh's error message>" | null,           // set only for query-failed
//     "truncated":   false,                                    // true: gh returned 200 runs, older ones may be
//                                                              // missing (see Truncation above)
//     "boundary":    "<sha>" | null,                           // set only with truncated: the oldest run's SHA
//     "baseCi":      { "branch": "main", "sha": "<merge base>",
//                      "verdict": "query-failed" | "no-run" | "red" | "running" | "cancelled" | "green",
//                      "error": "<gh's error message>" | null, "runs": [...], "failed": [123] } | null,
//                                                              // the base at the merge base (see `baseCi` above);
//                                                              // `runs` and `failed` as in `verdicts`
//     "earliestRed": "<sha>" | null,
//     "lowerBound":  { "sha": "<sha>", "kind": "green" | "merge-base" } | null,   // null with earliestRed
//     "tickets":     ["#12", "#14"],                           // ids, oldest merge first
//     "unmatched":   false,                                    // true: there is a red, and no merge in the
//                                                              // stretch belongs to a ticket, or `baseCi` is red
//     "merges":      [{ "sha": "<merge>", "subject": "...", "tickets": ["#12"],
//                       "matchedBy": "sha" | "branch" | "id" | null }],   // the stretch's merges, oldest first
//     "verdicts":    [{ "sha": "<sha>", "verdict": "red", "source": "ci" | "local", "partial": false,
//                       "runs": [{ "id": 123, "workflow": "check", "event": "push", "status": "completed",
//                                  "conclusion": "failure" }],
//                       "failed": [123] }]
//                                                              // newest first: walked SHAs with CI runs or a
//                                                              // local record; verdict as in `verdict`, from the
//                                                              // runs listed; `runs` as in `verdict` (empty
//                                                              // without CI runs, kept under a local record);
//                                                              // `failed`: the ids of its red runs, for
//                                                              // `gh run view <id> --log-failed`
//   }
//
// Exit codes: 0 output written, a failed `gh` query included (it is a result: `query-failed`); 1 git failed;
// 2 bad arguments or plan.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { UsageError, parseJson, failure, run, runIfEntry } from './cli.mjs';
import { ticketOwners } from './merges.mjs';

export const FORMAT = 'sorry-matt/ci@1';

const RED = new Set(['failure', 'timed_out', 'startup_failure', 'action_required', 'stale']);
// Each run's event too: a ticket PR's head SHA has push and pull_request runs.
const RUN_FIELDS = 'databaseId,workflowName,event,status,conclusion';
// earliest-red reads at most this many runs of the line; a list this long may have been cut.
export const RUN_LIMIT = 200;

const toRun = (r) => ({ id: r.databaseId, workflow: r.workflowName ?? null, event: r.event || null, status: r.status ?? null, conclusion: r.conclusion || null });

/** One verdict for the runs of one SHA (`{ id, workflow, event, status, conclusion }` each): rules 2 to 6 of the header. */
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
  if (q.error !== undefined) return { ...head, verdict: 'query-failed', reason: null, error: q.error, runs: [], rerun: [], failed: [] };
  const runs = q.rows.map(toRun);
  const c = classify(runs);
  return { ...head, verdict: c.verdict, reason: c.reason, error: null, runs, rerun: c.rerun, failed: runs.filter((r) => RED.has(r.conclusion)).map((r) => r.id) };
}

const LOCAL_RECORD = /^local:\s+(\S+)\s+([0-9a-f]{40,64})\s+(green|red)(?:\s|$)/;

export function readPlan(path, read) {
  let plan;
  try {
    plan = parseJson(read(path));
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
  let truncated = false;
  let boundary = null;
  const runsBySha = new Map();
  const partial = new Set();
  if (plan.ci) {
    const args = ['--branch', plan.line, '--limit', String(RUN_LIMIT), '--json', `headSha,${RUN_FIELDS}`, ...(plan.repo ? ['--repo', plan.repo] : [])];
    const q = queryRuns(gh, args, plan.worktree);
    if (q.error !== undefined) {
      ci = 'query-failed';
      error = q.error;
    } else {
      ci = 'read';
      for (const r of q.rows) runsBySha.set(r.headSha, [...(runsBySha.get(r.headSha) ?? []), toRun(r)]);
      // A full list may have lost its oldest runs. The SHA of the last (oldest) row, every SHA with a row from
      // that SHA's first row on, and every walked SHA older than one of those may be missing runs.
      truncated = q.rows.length >= RUN_LIMIT;
      if (truncated) {
        boundary = q.rows[q.rows.length - 1].headSha;
        const cut = q.rows.findIndex((r) => r.headSha === boundary);
        for (const r of q.rows.slice(cut)) partial.add(r.headSha);
        const first = walk.findIndex((c) => partial.has(c.sha));
        if (first >= 0) for (const c of walk.slice(first)) partial.add(c.sha);
      }
    }
  }

  // One entry per walked SHA that anything is known about. A CI conclusion (red or green) stands; without one,
  // the local record is the conclusion. On a SHA that may be missing runs only red is a conclusion: a missing run
  // can turn green, running or cancelled red, but cannot undo a red.
  const concluded = (v) => v === 'red' || v === 'green';
  const verdictOf = new Map();
  for (const c of walk) {
    const runs = runsBySha.get(c.sha) ?? [];
    const fromCi = runs.length ? classify(runs).verdict : null;
    const cut = partial.has(c.sha);
    const ciConcluded = cut ? fromCi === 'red' : concluded(fromCi);
    const failed = runs.filter((r) => RED.has(r.conclusion)).map((r) => r.id);
    const known = { partial: cut, runs, failed };
    if (plan.local.has(c.sha) && !ciConcluded) verdictOf.set(c.sha, { verdict: plan.local.get(c.sha), source: 'local', ...known, concluded: true });
    else if (fromCi) verdictOf.set(c.sha, { verdict: fromCi, source: 'ci', ...known, concluded: ciConcluded });
  }

  let red = -1;
  let green = -1;
  for (let i = 0; i < walk.length; i += 1) {
    const e = verdictOf.get(walk[i].sha);
    if (!e?.concluded) continue;
    const v = e.verdict;
    if (v === 'green') {
      green = i;
      break;
    }
    red = i;
  }

  // No green on the line: the stretch reaches back to the merge base. When the base was already red there, the
  // red came in with the base and belongs to no ticket on the line.
  let baseCi = null;
  if (plan.ci && red >= 0 && green < 0) {
    const branch = baseBranch(plan.base);
    const args = ['--branch', branch, '--commit', mergeBase, '--limit', '100', '--json', `headSha,${RUN_FIELDS}`, ...(plan.repo ? ['--repo', plan.repo] : [])];
    const q = queryRuns(gh, args, plan.worktree);
    if (q.error !== undefined) {
      baseCi = { branch, sha: mergeBase, verdict: 'query-failed', error: q.error, runs: [], failed: [] };
    } else {
      const runs = q.rows.filter((r) => r.headSha === mergeBase).map(toRun);
      const failed = runs.filter((r) => RED.has(r.conclusion)).map((r) => r.id);
      baseCi = { branch, sha: mergeBase, verdict: classify(runs).verdict, error: null, runs, failed };
    }
  }

  const out = {
    format: FORMAT,
    command: 'earliest-red',
    line: { ref, sha: tip },
    ci,
    error,
    truncated,
    boundary,
    baseCi,
    earliestRed: null,
    lowerBound: null,
    tickets: [],
    unmatched: false,
    merges: [],
    verdicts: walk.filter((c) => verdictOf.has(c.sha)).map((c) => {
      const { concluded: _, ...e } = verdictOf.get(c.sha);
      return { sha: c.sha, ...e };
    }),
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
  const tickets = baseCi?.verdict === 'red' ? [] : [...new Set(merges.flatMap((m) => m.tickets))];
  return {
    ...out,
    earliestRed: walk[red].sha,
    lowerBound: green < 0 ? { sha: mergeBase, kind: 'merge-base' } : { sha: walk[green].sha, kind: 'green' },
    tickets,
    unmatched: tickets.length === 0,
    merges,
  };
}

// The branch GitHub knows the base by: `origin/main`, `refs/remotes/origin/main` and `refs/heads/main` are `main`.
const baseBranch = (base) => base.replace(/^refs\/remotes\/origin\/|^origin\/|^refs\/heads\//, '');

/** The base branch's latest SHA on GitHub and the verdict of its runs: the `base` command of the header. */
export function baseVerdict({ base, repo, cwd }, gh) {
  const branch = baseBranch(base);
  const head = { format: FORMAT, command: 'base', branch };
  let sha;
  try {
    sha = String(gh(['api', `repos/${repo ?? '{owner}/{repo}'}/commits/${branch}`, '--jq', '.sha'], cwd)).trim();
    if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new Error(`gh api did not print a SHA: ${sha.slice(0, 80)}`);
  } catch (e) {
    const error = (e.stderr && String(e.stderr).trim()) || e.message;
    return { ...head, sha: null, verdict: 'query-failed', reason: null, error, runs: [], rerun: [], failed: [] };
  }
  const v = verdict({ branch, sha, repo, cwd }, gh);
  return { ...head, sha, verdict: v.verdict, reason: v.reason, error: v.error, runs: v.runs, rerun: v.rerun, failed: v.failed };
}

// --repo and the positional arguments of verdict (2) and base (1).
function repoArgs(argv, count, usage) {
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
  if (rest.length !== count) throw new UsageError(usage);
  return { rest, repo };
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
      const { rest: [branch, sha], repo } = repoArgs(rest, 2, 'verdict takes <branch> <sha>');
      result = verdict({ branch, sha, repo, cwd: deps.cwd }, deps.gh);
    } else if (command === 'base') {
      const { rest: [base], repo } = repoArgs(rest, 1, 'base takes <base branch>');
      result = baseVerdict({ base, repo, cwd: deps.cwd }, deps.gh);
    } else if (command === 'earliest-red') {
      if (rest.length !== 1 || rest[0].startsWith('-')) throw new UsageError('earliest-red takes exactly one plan file');
      result = earliestRed(readPlan(resolve(rest[0]), deps.read), deps);
    } else {
      throw new UsageError('expected verdict, base or earliest-red');
    }
    return { code: 0, out: `${JSON.stringify(result, null, 2)}\n`, err: '' };
  } catch (e) {
    return failure('ci', e);
  }
}

runIfEntry(import.meta.url, main);
