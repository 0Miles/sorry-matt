#!/usr/bin/env node
// freeze: the deterministic part of freezing a ticket set in one repository: preflight checks, the files other
// work holds, which tickets that excludes, the lines after joining those whose predicted files overlap, and the
// candidate order. No dependencies: runs on a bare Node 20+.
//
// Usage
//   node freeze.mjs <plan.json>
//
// plan.json, written by the host for one repository (a workspace with several repositories gets one plan each;
// a line never spans repositories):
//   {
//     "repo":     "<working tree>",                 // optional; default the current directory
//     "base":     "<base branch>",                  // the branch the lines merge into, e.g. "main"; needed
//     "frontier": "<frontier output file>" | { ...frontier.mjs output... },   // format sorry-matt/frontier@1
//     "files":    { "#11": "<predicted-files list>", ... },                   // one per open ticket
//     "ignore":   ["<worktree path>" | "<branch>" | "#<pr>"],                // optional holders to leave out
//     "held":     [{ "id": "<who>", "files": "<predicted-files list>", "release": "<condition>" }]  // optional
//   }
//   Relative paths are relative to the plan file. `frontier` is the output of frontier.mjs for the whole frozen
//   set, run without --line; its `tracker` and `source` decide the GitHub checks, which repository's pull
//   requests are read, and how the base's CI is read. A predicted-files list is the format overlap.mjs reads:
//   one repo-relative path per line, `/` alone for the whole repository, blank lines and `#` lines ignored; a path covers itself and everything
//   under it, and `path#symbol` (`path#outer#inner` when nested) narrows it to a function, block or markdown
//   heading of that file. Overlap is overlap.mjs's: two entries on the same path that both name a symbol
//   overlap only when one symbol chain starts with the other; an entry without a symbol is the whole file.
//   Every ticket whose state is "open" needs a list; lists of other tickets are ignored. `held` is
//   what git cannot see (another session the host knows of), with its own release condition.
//
// What it computes
//   preflight  `git-repo`: the repo is a git working tree with a commit on HEAD. `clean`: `git status
//              --porcelain` prints nothing. With tracker "github" also `gh-auth`: `gh auth status` exits 0, and
//              `repo-match`: one of the repo's remotes points at the frontier's `source` (owner/repo, any host,
//              case-insensitive). Then, whichever the tracker, `base-ci`: `ci.mjs base` on the plan's `base` —
//              the CI of the base's latest SHA on GitHub. The CI comes from the git remote, not from where the
//              tickets live: with tracker "github" it is read from the frontier's `source` (`--repo`); with
//              tracker "local", gh runs in the repo without `--repo` and finds the GitHub repository from its
//              remotes (a remote gh does not know as GitHub is query-failed), and a repo with no `origin` remote
//              has no CI to read: `base-ci` is then no warning, with `ci` null, and gh is not called. `base-ci`
//              never fails (`ok` is always true): when that verdict is red or query-failed its `warning` is true
//              and the freeze goes on (what the host does with a warning is in SKILL.md, freeze step 4); any other
//              verdict is no warning. When a check fails, `ok` is false and everything below is null.
//   held       Files other work is changing, each holder with a release condition:
//              - every other worktree of the repo (not bare, not prunable): `git diff --name-only --no-renames
//                <merge-base of HEAD and its HEAD>` inside it (committed, staged, unstaged) plus its untracked
//                files git does not ignore;
//              - every local branch not merged into HEAD and not checked out in a worktree: the files of
//                `git diff HEAD...<branch>`;
//              - with tracker "github", every open pull request of `source` whose head is not the current branch:
//                its files as `gh pr list --json files` returns them;
//              - the plan's `held` entries.
//              Git, worktree and PR holders hold whole files; only a `held` entry's list can name symbols.
//              A holder named in `ignore` (a worktree by path or by its branch, a branch, a PR as `#n`) is left
//              out; holders with no file are not listed.
//   excluded   Open tickets whose predicted entries overlap a held entry, in the sense above. They leave
//              the frozen set; the host records them as awaiting ruling with the holders and release conditions.
//   stalled    Open tickets left in the set that can no longer become ready because of an exclusion, in
//              frontier.mjs's terms: "blocked-external" (an in-set blocker was excluded) or "blocked-upstream"
//              (an in-set blocker is stalled this way). Tickets the frontier already marked stalled are not
//              repeated.
//   lines      The frontier's lines recomputed without the excluded tickets (an exclusion can split a line),
//              then joined: two lines whose open tickets' predicted paths overlap become one, transitively, until
//              no two lines overlap. A line's id is its first ticket in the frontier's sort order; `members` are
//              the recomputed line ids it is made of; `joins` are the pairs of tickets from different members
//              whose paths overlap, with those paths.
//   candidates The frontier's ready tickets that were not excluded, those that block the most open tickets of
//              the remaining set first (direct in-set blockers only); equal counts keep the frontier's order.
//   bundleCandidates  (#205) Groups of open tickets on one line, none excluded or stalled, connected by pairs whose
//              predicted entries overlap (overlap.mjs's sense, so symbol-disjoint entries are no pair and index
//              files, left out of the lists, never link). Each has its `overlaps` (the pairs and their paths), its
//              `edges` (direct open in-set blocker edges inside it, `[blocker, ticket]`) and `through`: open tickets
//              outside it on a blocker path between two of its tickets — merging such a group would be a cycle, so
//              only a part of it without such a path can be a bundle. The script rules on none of them.
//   bundles    The plan's `bundles` (the host's rulings), checked: each lists 2 to `bundleCap` tickets, all of them
//              bundleable (as above) and on one line, connected by overlapping pairs among themselves, with no
//              blocker path between two of them through an open ticket outside it, and no ticket in two bundles.
//              Any failure exits 2 naming the bundle and why. A bundle's `lead` is its first ticket in the
//              frontier's order; `tickets` are all of them, the lead first.
//
// plan.json may also have
//     "bundles":   [["#5", "#6"], ...],     // the bundles the host ruled on; default none
//     "bundleCap": 3                         // the most tickets in a bundle; default 3, at least 2
//
// Output (stdout, JSON, format "sorry-matt/freeze@1"; fields are only ever added, never renamed)
//   {
//     "format":     "sorry-matt/freeze@1",
//     "tracker":    "github" | "local",
//     "source":     "<owner>/<repo>" | "<git-ref>" | "worktree",
//     "repo":       "<top level of the working tree>" | null,
//     "preflight":  { "ok": true, "checks": [{ "name": "git-repo" | "clean" | "gh-auth" | "repo-match" | "base-ci",
//                                              "ok": true, "detail": "..." }] },
//                   // base-ci also has "warning": true | false and "ci": ci.mjs base's output without format and
//                   // command ({ branch, sha, verdict, reason, error, runs, rerun, failed }), or null when a local
//                   // tracker's repo has no origin
//     "held":       [{ "source": "worktree" | "branch" | "pr" | "host", "id": "<path | branch | #n | who>",
//                      "branch": "<branch>" | null, "files": ["src/a.md"], "release": "..." }],
//     "excluded":   [{ "id": "#12", "overlaps": [{ "with": "<holder id>", "source": "branch",
//                                                   "paths": ["src/a"], "release": "..." }] }],
//     "stalled":    [{ "id": "#13", "stalled": "blocked-external", "by": ["#12"] }],
//     "lines":      [{ "id": "#5", "members": ["#5", "#9"], "tickets": ["#5", "#6", "#9"],
//                      "files": ["src/a"], "joins": [{ "tickets": ["#6", "#9"], "paths": ["src/a"] }] }],
//     "candidates": [{ "id": "#5", "line": "#5", "unlocks": 2 }],
//     "bundleCandidates": [{ "line": "#5", "tickets": ["#5", "#6"], "overlaps": [{ "tickets": ["#5", "#6"],
//                            "paths": ["src/a"] }], "edges": [["#5", "#6"]], "through": [] }],
//     "bundleCap":  3,
//     "bundles":    [{ "lead": "#5", "tickets": ["#5", "#6"], "line": "#5" }]
//   }
//   `held` through `candidates`, `bundleCandidates` and `bundles` are null when the preflight fails. Paths are sorted, `/` is the whole
//   repository, an entry that names a symbol is written `path#symbol`; lines, their tickets and members follow the frontier's ticket order.
//
// Exit codes: 0 output written (read `preflight.ok`); 1 a list, git or gh read failed after the preflight;
// 2 bad arguments or plan.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { UsageError, canonical, failure, runIfEntry } from './cli.mjs';
import { overlaps, parseList, parseEntry, whole, display } from './overlap.mjs';
import { baseVerdict } from './ci.mjs';

export const FORMAT = 'sorry-matt/freeze@1';
export const BUNDLE_CAP = 3;
const FRONTIER_FORMAT = 'sorry-matt/frontier@1';

const uniqueSorted = (xs) => [...new Set(xs)].sort();
const z = (out) => out.split('\0').filter(Boolean);
const detail = (e) => (e.stderr && String(e.stderr).trim()) || e.message;

// ---------- plan ----------

function readJSON(path, read, what) {
  try {
    return JSON.parse(read(path));
  } catch (e) {
    if (e instanceof SyntaxError) throw new UsageError(`${path}: ${what} is not JSON (${e.message})`);
    throw e;
  }
}

function readFrontier(frontier, where) {
  if (!frontier || typeof frontier !== 'object' || Array.isArray(frontier) || frontier.format !== FRONTIER_FORMAT) {
    throw new UsageError(`${where}: frontier is not ${FRONTIER_FORMAT} output`);
  }
  const { tracker, source, tickets, frontier: ready } = frontier;
  if (!['github', 'local'].includes(tracker) || typeof source !== 'string' || !Array.isArray(tickets) || !Array.isArray(ready)) {
    throw new UsageError(`${where}: frontier needs tracker, source, tickets and frontier`);
  }
  for (const t of tickets) {
    if (!t || typeof t.id !== 'string' || typeof t.state !== 'string' || !Array.isArray(t.blockedBy)) {
      throw new UsageError(`${where}: a frontier ticket needs id, state and blockedBy`);
    }
  }
  const ids = new Set(tickets.map((t) => t.id));
  for (const id of ready) if (!ids.has(id)) throw new UsageError(`${where}: frontier lists ${id}, which is not a ticket`);
  return frontier;
}

export function readPlan(path, read, cwd = process.cwd()) {
  const plan = readJSON(path, read, 'the plan');
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new UsageError(`${path}: the plan is not an object`);
  const dir = dirname(path);
  if (plan.repo !== undefined && (typeof plan.repo !== 'string' || !plan.repo)) throw new UsageError(`${path}: repo is a non-empty string`);
  const repo = plan.repo ? resolve(dir, plan.repo) : resolve(cwd);

  let frontier = plan.frontier;
  if (typeof frontier === 'string' && frontier) {
    const file = resolve(dir, frontier);
    frontier = readJSON(file, read, 'the frontier');
  }
  frontier = readFrontier(frontier, path);

  const files = plan.files ?? {};
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw new UsageError(`${path}: files is an object`);
  const byId = new Map(frontier.tickets.map((t) => [t.id, t]));
  const predicted = new Map();
  for (const [id, list] of Object.entries(files)) {
    if (!byId.has(id)) throw new UsageError(`${path}: files names ${id}, which is not a ticket of the frontier`);
    if (typeof list !== 'string' || !list) throw new UsageError(`${path}: ${id}: a files list is a path`);
    if (byId.get(id).state !== 'open') continue;
    const file = resolve(dir, list);
    predicted.set(id, parseList(read(file), file));
  }
  for (const t of frontier.tickets) {
    if (t.state === 'open' && !predicted.has(t.id)) throw new UsageError(`${path}: open ticket ${t.id} has no files list`);
  }

  const ignore = plan.ignore ?? [];
  if (!Array.isArray(ignore) || ignore.some((i) => typeof i !== 'string' || !i)) {
    throw new UsageError(`${path}: ignore is an array of non-empty strings`);
  }
  const hostHeld = plan.held ?? [];
  if (!Array.isArray(hostHeld)) throw new UsageError(`${path}: held is an array`);
  const base = plan.base ?? null;
  if (base !== null && (typeof base !== 'string' || !base)) throw new UsageError(`${path}: base is a non-empty string`);
  if (!base) throw new UsageError(`${path}: a plan needs base, the branch the lines merge into`);
  const held = hostHeld.map((h, i) => {
    if (!h || typeof h.id !== 'string' || !h.id) throw new UsageError(`${path}: held[${i}] has no id`);
    if (typeof h.files !== 'string' || !h.files) throw new UsageError(`${path}: held ${h.id} has no files list`);
    if (typeof h.release !== 'string' || !h.release) throw new UsageError(`${path}: held ${h.id} has no release condition`);
    const file = resolve(dir, h.files);
    return { id: h.id, files: parseList(read(file), file), release: h.release };
  });
  const bundleCap = plan.bundleCap ?? BUNDLE_CAP;
  if (!Number.isInteger(bundleCap) || bundleCap < 2) throw new UsageError(`${path}: bundleCap is a whole number of at least 2`);
  const bundles = plan.bundles ?? [];
  if (!Array.isArray(bundles)) throw new UsageError(`${path}: bundles is an array of ticket id arrays`);
  return { repo, frontier, predicted, ignore, held, base, bundles, bundleCap };
}

// ---------- preflight ----------

/** owner/repo from a remote URL (https, ssh or scp-like), lower-cased; null when it has no such tail. */
export function remoteSlug(url) {
  const m = /[/:]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

export function preflight({ repo, tracker, source, base }, { git, gh }) {
  const checks = [];
  let top = null;
  try {
    top = git(repo, ['rev-parse', '--show-toplevel']).trim();
  } catch (e) {
    checks.push({ name: 'git-repo', ok: false, detail: `${repo}: not a git working tree (${detail(e)})` });
  }
  if (top) {
    try {
      git(top, ['rev-parse', '--verify', '--quiet', 'HEAD']);
      checks.push({ name: 'git-repo', ok: true, detail: top });
    } catch {
      checks.push({ name: 'git-repo', ok: false, detail: `${top}: HEAD has no commit` });
      top = null;
    }
  }
  if (top) {
    const dirty = git(top, ['status', '--porcelain']).split(/\r?\n/).filter(Boolean);
    checks.push(
      dirty.length
        ? { name: 'clean', ok: false, detail: `${dirty.length} uncommitted or untracked: ${dirty.slice(0, 5).join('; ')}${dirty.length > 5 ? '; ...' : ''}` }
        : { name: 'clean', ok: true, detail: 'working tree clean' },
    );
  }
  if (tracker === 'github') {
    try {
      gh(['auth', 'status']);
      checks.push({ name: 'gh-auth', ok: true, detail: 'gh auth status exited 0' });
    } catch (e) {
      checks.push({ name: 'gh-auth', ok: false, detail: `gh auth status failed: ${detail(e)}` });
    }
    if (top) {
      const urls = uniqueSorted(git(top, ['remote', '-v']).split(/\r?\n/).map((l) => l.split(/\s+/)[1]).filter(Boolean));
      const hit = urls.find((u) => remoteSlug(u) === source.toLowerCase());
      checks.push(
        hit
          ? { name: 'repo-match', ok: true, detail: `${source} is ${hit}` }
          : { name: 'repo-match', ok: false, detail: `no remote points at ${source}; remotes: ${urls.join(', ') || 'none'}` },
      );
    }
    checks.push(baseCheck(baseVerdict({ base, repo: source }, gh)));
  } else if (top) {
    // The base's CI comes from the git remote, not the tracker: gh, run in the repository, finds the GitHub
    // repository from its remotes. No `origin`: no CI to read (the lines go on local verification, as in tick).
    let origin = true;
    try {
      git(top, ['remote', 'get-url', 'origin']);
    } catch {
      origin = false;
    }
    checks.push(
      origin
        ? baseCheck(baseVerdict({ base, cwd: top }, gh))
        : { name: 'base-ci', ok: true, warning: false, detail: `${base}: the repository has no origin remote, no CI to read`, ci: null },
    );
  }
  return { top, result: { ok: checks.every((c) => c.ok), checks } };
}

// A red base, or one whose CI could not be read, is a warning: `ok` stays true and the freeze goes on.
function baseCheck(v) {
  const { format: _f, command: _c, ...ci } = v;
  const at = `${v.branch} ${v.sha ?? '(latest SHA unknown)'}`;
  if (v.verdict === 'red') return { name: 'base-ci', ok: true, warning: true, detail: `${at} is red; failed runs: ${v.failed.join(', ') || 'none listed'}`, ci };
  if (v.verdict === 'query-failed') return { name: 'base-ci', ok: true, warning: true, detail: `${at}: CI could not be read (${v.error})`, ci };
  return { name: 'base-ci', ok: true, warning: false, detail: `${at} is ${v.verdict}${v.reason ? ` (${v.reason})` : ''}`, ci };
}

// ---------- held files ----------

export function parseWorktrees(porcelain) {
  const out = [];
  let cur = null;
  for (const line of porcelain.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      cur = { path: line.slice('worktree '.length), branch: null, bare: false, prunable: false };
      out.push(cur);
    } else if (cur && line.startsWith('branch ')) cur.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    else if (cur && line === 'bare') cur.bare = true;
    else if (cur && (line === 'prunable' || line.startsWith('prunable '))) cur.prunable = true;
  }
  return out;
}

function heldFiles({ top, tracker, source, ignore, hostHeld }, { git, gh }) {
  const head = git(top, ['rev-parse', 'HEAD']).trim();
  let current = null;
  try {
    current = git(top, ['symbolic-ref', '--quiet', '--short', 'HEAD']).trim() || null;
  } catch {
    current = null; // detached HEAD
  }
  const here = canonical(top);
  const ignored = (...names) => names.some((n) => n && ignore.some((i) => i === n || canonical(top, i) === canonical(top, n)));
  const held = [];
  const checkedOut = new Set();
  for (const wt of parseWorktrees(git(top, ['worktree', 'list', '--porcelain']))) {
    if (wt.branch) checkedOut.add(wt.branch);
    if (wt.bare || wt.prunable || canonical(wt.path) === here || ignored(wt.path, wt.branch)) continue;
    const base = git(wt.path, ['merge-base', head, 'HEAD']).trim();
    const files = uniqueSorted([
      ...z(git(wt.path, ['diff', '--name-only', '--no-renames', '-z', base])),
      ...z(git(wt.path, ['ls-files', '--others', '--exclude-standard', '-z'])),
    ]);
    if (files.length) {
      held.push({
        source: 'worktree',
        id: wt.path,
        branch: wt.branch,
        files,
        release: `the worktree is removed, or its work is merged into ${current ?? head} and nothing is left uncommitted`,
      });
    }
  }
  const branches = z(git(top, ['for-each-ref', '--no-merged=HEAD', '--format=%(refname)%00', 'refs/heads']))
    .map((r) => r.trim().replace(/^refs\/heads\//, ''))
    .filter(Boolean)
    .sort();
  for (const b of branches) {
    if (b === current || checkedOut.has(b) || ignored(b)) continue;
    const files = uniqueSorted(z(git(top, ['diff', '--name-only', '--no-renames', '-z', `${head}...refs/heads/${b}`])));
    if (files.length) {
      held.push({ source: 'branch', id: b, branch: b, files, release: `branch ${b} is merged into ${current ?? head} or deleted` });
    }
  }
  if (tracker === 'github') {
    const prs = JSON.parse(gh(['pr', 'list', '--repo', source, '--state', 'open', '--limit', '1000', '--json', 'number,headRefName,files']));
    for (const pr of [...prs].sort((a, b) => a.number - b.number)) {
      const id = `#${pr.number}`;
      if (pr.headRefName === current || ignored(id)) continue;
      const files = uniqueSorted((pr.files ?? []).map((f) => f.path));
      if (files.length) {
        held.push({ source: 'pr', id, branch: pr.headRefName ?? null, files, release: `PR ${id} is merged or closed` });
      }
    }
  }
  for (const h of hostHeld) {
    held.push({ source: 'host', id: h.id, branch: null, files: h.files.map(display), release: h.release });
  }
  return held;
}

// ---------- tickets ----------

const pathsOverlapping = (mine, theirs) => mine.filter((p) => theirs.some((q) => overlaps(p, q)));

export function freezeTickets({ frontier, predicted, held }) {
  const order = new Map(frontier.tickets.map((t, i) => [t.id, i]));
  const byOrder = (a, b) => order.get(a) - order.get(b);
  // Held files as entries: git reports whole files; only a host-known holder's list can name symbols.
  const entries = (h) => h.files.map((f) => (h.source === 'host' ? parseEntry(f) : whole(f)));

  // Exclusion: an open ticket whose predicted entries overlap a held one.
  const excluded = [];
  for (const t of frontier.tickets) {
    if (t.state !== 'open') continue;
    const hits = held
      .map((h) => ({ with: h.id, source: h.source, paths: pathsOverlapping(predicted.get(t.id), entries(h)).map(display), release: h.release }))
      .filter((h) => h.paths.length);
    if (hits.length) excluded.push({ id: t.id, overlaps: hits });
  }
  const gone = new Set(excluded.map((e) => e.id));
  const kept = frontier.tickets.filter((t) => !gone.has(t.id));
  const keptIds = new Set(kept.map((t) => t.id));
  const inSetBlockers = (t) => t.blockedBy.filter((b) => b.inSet).map((b) => b.id);

  // Stalled by an exclusion, transitively, in frontier.mjs's terms.
  const stalledBy = new Map();
  for (let changed = true; changed; ) {
    changed = false;
    for (const t of kept) {
      if (t.state !== 'open' || t.stalled || stalledBy.has(t.id)) continue;
      const external = inSetBlockers(t).filter((b) => gone.has(b));
      const upstream = inSetBlockers(t).filter((b) => stalledBy.has(b));
      if (external.length) stalledBy.set(t.id, { stalled: 'blocked-external', by: external });
      else if (upstream.length) stalledBy.set(t.id, { stalled: 'blocked-upstream', by: upstream });
      else continue;
      changed = true;
    }
  }
  const stalled = kept.filter((t) => stalledBy.has(t.id)).map((t) => ({ id: t.id, ...stalledBy.get(t.id) }));

  // Lines without the excluded tickets: connected through in-set blocker edges, id = first ticket in order.
  const parent = new Map(kept.map((t) => [t.id, t.id]));
  const find = (x) => (parent.get(x) === x ? x : find(parent.get(x)));
  const union = (a, b) => {
    const [ra, rb] = [find(a), find(b)].sort(byOrder);
    if (ra !== rb) parent.set(rb, ra);
  };
  for (const t of kept) for (const b of inSetBlockers(t)) if (keptIds.has(b)) union(t.id, b);
  const baseLine = new Map(kept.map((t) => [t.id, find(t.id)]));

  // Joining: union-find over the base lines, an edge wherever two open tickets of different lines overlap.
  const open = kept.filter((t) => t.state === 'open').map((t) => t.id);
  const joins = [];
  for (let i = 0; i < open.length; i++) {
    for (let j = i + 1; j < open.length; j++) {
      const [a, b] = [open[i], open[j]];
      if (baseLine.get(a) === baseLine.get(b)) continue;
      const pa = predicted.get(a);
      const pb = predicted.get(b);
      const paths = uniqueSorted([...pathsOverlapping(pa, pb), ...pathsOverlapping(pb, pa)].map(display));
      if (!paths.length) continue;
      union(a, b);
      joins.push({ tickets: [a, b], paths });
    }
  }
  const groups = new Map();
  for (const t of kept) {
    const root = find(t.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(t.id);
  }
  const lineOf = new Map();
  const lines = [...groups.values()]
    .map((ids) => ids.sort(byOrder))
    .sort((a, b) => byOrder(a[0], b[0]))
    .map((ids) => {
      const id = ids[0];
      for (const t of ids) lineOf.set(t, id);
      const members = new Set(ids.map((t) => baseLine.get(t)));
      return {
        id,
        members: [...members].sort(byOrder),
        tickets: ids,
        files: uniqueSorted(ids.flatMap((t) => (predicted.get(t) ?? []).map(display))),
        joins: joins.filter((j) => ids.includes(j.tickets[0])),
      };
    });

  // Candidates: ready and kept; most open dependents in the remaining set first, ties in frontier order.
  const unlocks = (id) => kept.filter((t) => t.state === 'open' && inSetBlockers(t).includes(id)).length;
  const candidates = frontier.frontier
    .filter((id) => keptIds.has(id))
    .map((id) => ({ id, line: lineOf.get(id), unlocks: unlocks(id) }))
    .sort((a, b) => b.unlocks - a.unlocks || byOrder(a.id, b.id));

  // Bundle candidates (#205): within a line, the open tickets still able to start, connected by overlapping
  // predicted entries. The script lists them; the host rules which become bundles.
  const byId = new Map(kept.map((t) => [t.id, t]));
  const bundleable = new Set(kept.filter((t) => t.state === 'open' && !t.stalled && !stalledBy.has(t.id)).map((t) => t.id));
  const overlapOf = (a, b) => uniqueSorted([...pathsOverlapping(predicted.get(a), predicted.get(b)), ...pathsOverlapping(predicted.get(b), predicted.get(a))].map(display));
  const pairs = [];
  const ids = [...bundleable].sort(byOrder);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (lineOf.get(ids[i]) !== lineOf.get(ids[j])) continue;
      const paths = overlapOf(ids[i], ids[j]);
      if (paths.length) pairs.push({ tickets: [ids[i], ids[j]], paths });
    }
  }
  // Open in-set blocker edges, for the paths a bundle must not leave.
  const blocks = new Map(kept.map((t) => [t.id, []])); // blocker -> the open tickets it blocks
  for (const t of kept) if (t.state === 'open') for (const b of inSetBlockers(t)) if (byId.get(b)?.state === 'open') blocks.get(b).push(t.id);
  const reach = (from, next) => {
    const seen = new Set();
    const todo = [...from];
    while (todo.length) for (const x of next(todo.pop()) ?? []) if (!seen.has(x)) seen.add(x), todo.push(x);
    return seen;
  };
  const blockedByOpen = (x) => (byId.get(x) ? inSetBlockers(byId.get(x)).filter((b) => byId.get(b)?.state === 'open') : []);
  // An open ticket outside the group on a blocker path between two of its members: merging them would be a cycle.
  const through = (group) => {
    const g = new Set(group);
    const down = reach(group, (x) => blocks.get(x));
    const up = reach(group, blockedByOpen);
    return [...down].filter((x) => !g.has(x) && up.has(x)).sort(byOrder);
  };
  const components = new Map();
  const cp = new Map(ids.map((x) => [x, x]));
  const cfind = (x) => (cp.get(x) === x ? x : cfind(cp.get(x)));
  for (const { tickets: [a, b] } of pairs) {
    const [ra, rb] = [cfind(a), cfind(b)].sort(byOrder);
    if (ra !== rb) cp.set(rb, ra);
  }
  for (const x of ids) {
    const r = cfind(x);
    if (!components.has(r)) components.set(r, []);
    components.get(r).push(x);
  }
  const bundleCandidates = [...components.values()]
    .filter((g) => g.length > 1)
    .map((g) => g.sort(byOrder))
    .sort((a, b) => byOrder(a[0], b[0]))
    .map((g) => ({
      line: lineOf.get(g[0]),
      tickets: g,
      overlaps: pairs.filter((p) => g.includes(p.tickets[0])),
      edges: g.flatMap((t) => blockedByOpen(t).filter((b) => g.includes(b)).map((b) => [b, t])),
      through: through(g),
    }));

  const checkBundle = (group, cap) => {
    const why = [];
    if (!Array.isArray(group) || group.length < 2 || group.some((x) => typeof x !== 'string')) return ['a bundle lists at least two ticket ids'];
    if (new Set(group).size !== group.length) why.push('a ticket is listed twice');
    if (group.length > cap) why.push(`more than ${cap} tickets (bundleCap)`);
    for (const x of group) if (!bundleable.has(x)) why.push(`${x} is not an open ticket of the frozen set that can still start`);
    if (why.length) return why;
    if (new Set(group.map((x) => lineOf.get(x))).size > 1) why.push('its tickets are on different lines');
    const linked = reach([group[0]], (x) => pairs.filter((p) => p.tickets.includes(x)).map((p) => p.tickets.find((y) => y !== x)).filter((y) => group.includes(y)));
    linked.add(group[0]);
    if (group.some((x) => !linked.has(x))) why.push('its tickets are not connected by overlapping predicted entries');
    const t = through(group);
    if (t.length) why.push(`a blocker path between its tickets goes through ${t.join(', ')}, outside it`);
    return why;
  };

  return { excluded, stalled, lines, candidates, bundleCandidates, checkBundle };
}

/** The plan's bundles checked against the candidates; a bundle's lead is its first ticket in the frontier's order. */
export function freezeBundles(result, plan, order) {
  const taken = new Map();
  return (plan.bundles ?? []).map((group, i) => {
    const why = result.checkBundle(group, plan.bundleCap);
    for (const x of Array.isArray(group) ? group : []) {
      if (taken.has(x)) why.push(`${x} is already in bundle ${taken.get(x)}`);
      else taken.set(x, i);
    }
    if (why.length) throw new UsageError(`bundles[${i}] (${Array.isArray(group) ? group.join(', ') : group}): ${why.join('; ')}`);
    const tickets = [...group].sort((a, b) => order.get(a) - order.get(b));
    return { lead: tickets[0], tickets, line: result.lines.find((l) => l.tickets.includes(tickets[0])).id };
  });
}

// ---------- main ----------

export function freeze(plan, deps) {
  const { frontier } = plan;
  const { top, result } = preflight({ repo: plan.repo, tracker: frontier.tracker, source: frontier.source, base: plan.base }, deps);
  const out = { format: FORMAT, tracker: frontier.tracker, source: frontier.source, repo: top, preflight: result };
  if (!result.ok) return { ...out, held: null, excluded: null, stalled: null, lines: null, candidates: null, bundleCandidates: null, bundles: null };
  const held = heldFiles({ top, tracker: frontier.tracker, source: frontier.source, ignore: plan.ignore, hostHeld: plan.held }, deps);
  const { checkBundle, ...tickets } = freezeTickets({ frontier, predicted: plan.predicted, held });
  const order = new Map(frontier.tickets.map((t, i) => [t.id, i]));
  const bundles = freezeBundles({ ...tickets, checkBundle }, plan, order);
  return { ...out, held, ...tickets, bundleCap: plan.bundleCap, bundles };
}

export function defaultDeps() {
  const exec = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
  return {
    read: (p) => readFileSync(p, 'utf8'),
    git: (cwd, args) => exec('git', ['-C', cwd, ...args]),
    gh: (args, cwd) => exec('gh', args, cwd), // cwd: a local tracker's base CI, which gh reads from the repository's remotes
  };
}

// Returns { code, out, err } instead of touching the process, so tests can drive it.
export function main(argv, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  try {
    if (argv.length !== 1 || argv[0].startsWith('-')) throw new UsageError('expected exactly one plan file');
    const result = freeze(readPlan(resolve(argv[0]), d.read), d);
    return { code: 0, out: `${JSON.stringify(result, null, 2)}\n`, err: '' };
  } catch (e) {
    return failure('freeze', e);
  }
}

runIfEntry(import.meta.url, main);
