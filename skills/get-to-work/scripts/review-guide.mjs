#!/usr/bin/env node
// review-guide: the per-ticket guide of one line's aggregate PR. It finds which commits on the integration branch
// belong to which ticket, orders the tickets for reading, and measures the PR against the review threshold.
// No dependencies: runs on a bare Node 20+ with git 2.38+.
//
// Usage
//   node review-guide.mjs <plan.json>
//
// plan.json, written by the host for one line:
//   {
//     "worktree":  "<integration worktree>",          // absolute, or relative to the plan file; git runs here
//     "base":      "<base ref>",                       // what the PR merges into, e.g. origin/main
//     "line":      "<integration branch>",
//     "web":       "https://github.com/<owner>/<repo>", // the repository's web URL; links are built on it
//     "threshold": 400,                                // optional, default 400 changed lines
//     "tickets":   [{ "id": "#12", "branch": "<run>/12-slug", "title": "...",       // title optional
//                     "blockedBy": ["#11"], "statusRecord": "<URL>" }]           // both optional
//   }
//   `tickets` are the tickets merged into the line, delivered or not. `blockedBy` edges to ids not listed are
//   ignored.
//
// The walk is `git log --first-parent <base>..<line>`, oldest first. A two-parent merge whose subject is git's
// default `Merge branch '<b>'` (optionally `... into <x>`) belongs to the ticket whose `branch` is <b>, or <b>
// without a `-ci` suffix (the red-light fix branch). Its ticket commits are `<merge>^1..<merge>^2`. Every other
// first-parent commit is line-level: `base-merge` when its second parent is already in <base> (syncing the
// base), `merge` for any other merge, `commit` otherwise (simplify pass, host records, red-light fixes, reverts).
//
// A merge is `resolved` when its tree differs from git's own merge of its parents (`git merge-tree
// --write-tree`): it carries a conflict resolution, or any other edit made in the merge, and
// `git show --remerge-diff <sha>` shows exactly that part. null when git cannot tell (octopus, old git).
//
// Size is `git diff --shortstat <base>...<line>`: insertions plus deletions of the PR diff (from the merge base,
// like GitHub's PR diff); binary files count no lines. `over` is true when that total exceeds the threshold.
//
// Reading order: a ticket comes after its listed blockers; among tickets free to go, the one merged first goes
// first; tickets with no merge go last in plan order. A cycle is broken at the earliest merged ticket and noted
// in `warnings`.
//
// Output (stdout, JSON, format "sorry-matt/review-guide@1"; fields are only ever added, never renamed)
//   {
//     "format":  "sorry-matt/review-guide@1",
//     "base":    { "ref": "origin/main", "sha": "<sha>" },
//     "line":    { "ref": "<integration branch>", "sha": "<sha>" },
//     "size":    { "files": 12, "insertions": 380, "deletions": 95, "total": 475, "threshold": 400, "over": true },
//     "tickets": [{ "order": 1, "id": "#11", "title": "..." | null, "statusRecord": "<URL>" | null,
//                   "blockedBy": ["#10"],               // listed blockers only
//                   "merges": [{ "sha": "<merge>", "url": "<web>/commit/<merge>", "branch": "<run>/11-slug",
//                                "range": "<p1>..<p2>", "compare": "<web>/compare/<p1>...<p2>",
//                                "stat": { "files": 3, "insertions": 40, "deletions": 2 },
//                                "commits": [{ "sha": "<sha>", "subject": "...", "url": "<web>/commit/<sha>" }],
//                                "resolved": false, "remergeDiff": null }] }],   // or "git show --remerge-diff <merge>"
//     "lineCommits": [{ "kind": "commit" | "merge" | "base-merge", "sha": "<sha>", "subject": "...",
//                       "url": "<web>/commit/<sha>", "resolved": null, "remergeDiff": null }],
//     "missing":  ["#14"],                              // listed tickets with no merge on the line
//     "warnings": []
//   }
//   Merges and commits are oldest first. `resolved` is null for plain commits.
//
// Exit codes: 0 output written; 3 output written but a listed ticket has no merge (`missing`); 1 git failed;
// 2 bad arguments or plan.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORMAT = 'sorry-matt/review-guide@1';
export const DEFAULT_THRESHOLD = 400;

class UsageError extends Error {}

const MERGE_SUBJECT = /^Merge (?:remote-tracking )?branch '([^']+)'/;

export function readPlan(path, read) {
  let plan;
  try {
    plan = JSON.parse(read(path));
  } catch (e) {
    throw new UsageError(`${path}: ${e.message}`);
  }
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new UsageError(`${path}: not a JSON object`);
  for (const key of ['worktree', 'base', 'line', 'web']) {
    if (typeof plan[key] !== 'string' || !plan[key]) throw new UsageError(`${path}: ${key} is a non-empty string`);
  }
  const threshold = plan.threshold ?? DEFAULT_THRESHOLD;
  if (!Number.isInteger(threshold) || threshold < 0) throw new UsageError(`${path}: threshold is a non-negative integer`);
  if (!Array.isArray(plan.tickets)) throw new UsageError(`${path}: tickets is an array`);
  const ids = new Set();
  const branches = new Set();
  const tickets = plan.tickets.map((t, i) => {
    const where = `${path}: tickets[${i}]`;
    if (!t || typeof t.id !== 'string' || !t.id) throw new UsageError(`${where} has no id`);
    if (typeof t.branch !== 'string' || !t.branch) throw new UsageError(`${where} (${t.id}) has no branch`);
    if (ids.has(t.id)) throw new UsageError(`${path}: ${t.id} listed twice`);
    if (branches.has(t.branch)) throw new UsageError(`${path}: branch ${t.branch} listed twice`);
    ids.add(t.id);
    branches.add(t.branch);
    const blockedBy = t.blockedBy ?? [];
    if (!Array.isArray(blockedBy) || blockedBy.some((b) => typeof b !== 'string')) {
      throw new UsageError(`${where} (${t.id}): blockedBy is an array of ids`);
    }
    return { id: t.id, branch: t.branch, title: t.title ?? null, statusRecord: t.statusRecord ?? null, blockedBy };
  });
  return {
    worktree: resolve(dirname(path), plan.worktree),
    base: plan.base,
    line: plan.line,
    web: plan.web.replace(/\/+$/, ''),
    threshold,
    tickets,
  };
}

export function parseShortstat(text) {
  const n = (re) => Number((re.exec(text) || [0, 0])[1]);
  return { files: n(/(\d+) files? changed/), insertions: n(/(\d+) insertions?\(\+\)/), deletions: n(/(\d+) deletions?\(-\)/) };
}

// Kahn's algorithm; among ready tickets the smallest key goes first.
export function readingOrder(tickets, key) {
  const ids = new Set(tickets.map((t) => t.id));
  const pending = new Map(tickets.map((t) => [t.id, new Set(t.blockedBy.filter((b) => ids.has(b) && b !== t.id))]));
  const byKey = (a, b) => key(a) - key(b);
  const order = [];
  const warnings = [];
  let rest = [...tickets];
  while (rest.length) {
    let ready = rest.filter((t) => pending.get(t.id).size === 0).sort(byKey);
    if (!ready.length) {
      ready = [...rest].sort(byKey);
      warnings.push(`blocker cycle among ${rest.map((t) => t.id).join(', ')}: broken at ${ready[0].id}`);
    }
    const next = ready[0];
    order.push(next);
    rest = rest.filter((t) => t !== next);
    for (const deps of pending.values()) deps.delete(next.id);
  }
  return { order, warnings };
}

export function buildGuide(plan, git) {
  const run = (args) => git(plan.worktree, args);
  const sha = (ref) => run(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();
  const baseSha = sha(plan.base);
  const lineSha = sha(plan.line);
  const url = (s) => `${plan.web}/commit/${s}`;

  // For commands whose exit status is the answer, not a failure.
  const probe = (args) => {
    try {
      return { status: 0, out: run(args) };
    } catch (e) {
      if (typeof e.status !== 'number') throw e;
      return { status: e.status, out: String(e.stdout ?? '') };
    }
  };
  const resolution = (merge, parents) => {
    let resolved = null;
    if (parents.length === 2) {
      const auto = probe(['merge-tree', '--write-tree', '--no-messages', parents[0], parents[1]]);
      if (auto.status <= 1) {
        resolved = auto.status === 1 || auto.out.split('\n')[0].trim() !== run(['rev-parse', `${merge}^{tree}`]).trim();
      }
    }
    return { resolved, remergeDiff: resolved ? `git show --remerge-diff ${merge}` : null };
  };
  const lines = (args) => run(args).split('\n').filter(Boolean).map((l) => l.split('\t'));

  const firstParent = lines(['log', '--first-parent', '--reverse', '--format=%H%x09%P%x09%s', `${baseSha}..${lineSha}`]).map(
    ([h, p, ...s]) => ({ sha: h, parents: p.split(' ').filter(Boolean), subject: s.join('\t') }),
  );

  const byBranch = new Map(plan.tickets.map((t) => [t.branch, t]));
  const merges = new Map(plan.tickets.map((t) => [t.id, []]));
  const firstMerge = new Map();
  const lineCommits = [];

  firstParent.forEach((c, index) => {
    const branch = c.parents.length === 2 ? (MERGE_SUBJECT.exec(c.subject) || [])[1] : undefined;
    const ticket = branch && (byBranch.get(branch) || byBranch.get(branch.replace(/-ci$/, '')));
    if (ticket) {
      const [p1, p2] = c.parents;
      merges.get(ticket.id).push({
        sha: c.sha,
        url: url(c.sha),
        branch,
        range: `${p1}..${p2}`,
        compare: `${plan.web}/compare/${p1}...${p2}`,
        stat: parseShortstat(run(['diff', '--shortstat', `${p1}...${p2}`])),
        commits: lines(['log', '--reverse', '--format=%H%x09%s', `${p1}..${p2}`]).map(([h, ...s]) => ({
          sha: h,
          subject: s.join('\t'),
          url: url(h),
        })),
        ...resolution(c.sha, c.parents),
      });
      if (!firstMerge.has(ticket.id)) firstMerge.set(ticket.id, index);
      return;
    }
    const entry = { sha: c.sha, subject: c.subject, url: url(c.sha) };
    if (c.parents.length < 2) {
      lineCommits.push({ kind: 'commit', ...entry, resolved: null, remergeDiff: null });
      return;
    }
    const fromBase = probe(['merge-base', '--is-ancestor', c.parents[1], baseSha]);
    if (fromBase.status > 1) throw new Error(`git merge-base --is-ancestor failed for ${c.sha}`);
    lineCommits.push({ kind: fromBase.status === 0 ? 'base-merge' : 'merge', ...entry, ...resolution(c.sha, c.parents) });
  });

  const planIndex = new Map(plan.tickets.map((t, i) => [t.id, i]));
  const key = (t) => firstMerge.get(t.id) ?? firstParent.length + planIndex.get(t.id);
  const { order, warnings } = readingOrder(plan.tickets, key);
  const listed = new Set(plan.tickets.map((t) => t.id));

  const size = parseShortstat(run(['diff', '--shortstat', `${baseSha}...${lineSha}`]));
  const total = size.insertions + size.deletions;
  return {
    format: FORMAT,
    base: { ref: plan.base, sha: baseSha },
    line: { ref: plan.line, sha: lineSha },
    size: { ...size, total, threshold: plan.threshold, over: total > plan.threshold },
    tickets: order.map((t, i) => ({
      order: i + 1,
      id: t.id,
      title: t.title,
      statusRecord: t.statusRecord,
      blockedBy: t.blockedBy.filter((b) => listed.has(b) && b !== t.id),
      merges: merges.get(t.id),
    })),
    lineCommits,
    missing: plan.tickets.filter((t) => !merges.get(t.id).length).map((t) => t.id),
    warnings,
  };
}

export function defaultDeps() {
  return {
    read: (p) => readFileSync(p, 'utf8'),
    git: (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
  };
}

// Returns { code, out, err } instead of touching the process, so tests can drive it.
export function main(argv, deps = defaultDeps()) {
  try {
    if (argv.length !== 1 || argv[0].startsWith('-')) throw new UsageError('expected exactly one plan file');
    const guide = buildGuide(readPlan(resolve(argv[0]), deps.read), deps.git);
    const err = guide.missing.length ? `review-guide: no merge on the line for ${guide.missing.join(', ')}\n` : '';
    return { code: guide.missing.length ? 3 : 0, out: `${JSON.stringify(guide, null, 2)}\n`, err };
  } catch (e) {
    const usage = e instanceof UsageError;
    const detail = (e.stderr && String(e.stderr).trim()) || e.message;
    return { code: usage ? 2 : 1, out: '', err: `review-guide: ${detail}\n${usage ? 'usage: see the header of review-guide.mjs\n' : ''}` };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { code, out, err } = main(process.argv.slice(2));
  process.stdout.write(out);
  process.stderr.write(err);
  process.exitCode = code;
}
