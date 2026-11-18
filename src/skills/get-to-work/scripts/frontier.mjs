#!/usr/bin/env node
// frontier: which tickets in a frozen set can start now. No dependencies: runs on a bare Node 20+.
//
// Usage
//   node frontier.mjs github --repo <owner>/<repo> [--done <n,...>] [--stuck <n,...>] [--line <id>] <n|#n|issue URL>...
//   node frontier.mjs local [--ref <git-ref>] [--line <id>] <ticket-file>...
//
// github  Blockers are the union of GitHub's native issue dependencies
//         (GET /repos/{owner}/{repo}/issues/{n}/dependencies/blocked_by) and the body's `Blocked by:` line or
//         `## Blocked by` list (`#n`, `owner/repo#n` or an issue URL), the tracker's fallback where dependencies
//         are unavailable. When the body lists blockers and native dependencies exist but the two differ, a
//         warning is added. A closed issue is done, whatever its state_reason (not_planned included): that is
//         how GitHub counts open blockers (issue_dependencies_summary.blocked_by) and what the tracker contract
//         says ("unblocked when every blocker is closed"). A ticket integrated during this run is still open on
//         GitHub, so pass it with --done; pass a ticket the run marked stuck with --stuck.
// local   One ticket file per issue (`.scratch/<feature>/issues/<NN>-<slug>.md`). Blockers come from the
//         `Blocked by:` line (or a `## Blocked by` list): `NN`, `#NN`, a file name or a repo-relative path,
//         comma-separated; "None ..." means no blockers. A ticket is done when it has a non-empty
//         `## sorry-matt completion` section and no unchecked `- [ ]` outside the `## Comments` and
//         `## sorry-matt ...` sections, and no `## sorry-matt blocker` after the completion (get-to-work appends
//         one when it reverts the merge); it is stuck when it has `## sorry-matt blocker` and is not done.
//         `Status:` alone (ready-for-human included) never makes it done. Without --ref the files are read
//         from the working tree; with --ref they are read from that commit.
// --line  Report only the tickets of that line (an id from `line`). With Local Markdown, done and stuck live on
//         each line's own integration branch, so run once per line with that branch as --ref and the line's
//         id as --line, passing the whole set each time; the run's frontier is the union of those outputs.
//
// Output (stdout, JSON, format "sorry-matt/frontier@1"; fields are only ever added, never renamed)
//   {
//     "format":   "sorry-matt/frontier@1",
//     "tracker":  "github" | "local",
//     "source":   "<owner>/<repo>" | "<git-ref>" | "worktree",
//     "tickets":  [{
//       "id":           "#11" | ".scratch/feat/issues/01-x.md",   // provider-native, as a string
//       "title":        "...",
//       "state":        "open" | "done" | "stuck",
//       "trackerState": "open" | "closed" | "<Status: value>" | null,  // raw tracker value, evidence only
//       "blockedBy":    [{ "id": "#5", "state": "open" | "done" | "stuck" | "missing", "inSet": true }],
//       "line":         "#5",     // id of the line: the first ticket, in sort order, of its connected set
//       "ready":        true,     // state is "open" and every blocker is "done"
//       "stalled":      null      // or why this open ticket can never become ready inside the set:
//                                 //   "cycle"            it is on a blocker cycle
//                                 //   "missing"          a blocker reference matches no ticket
//                                 //   "blocked-external" a blocker outside the set is not done
//                                 //   "blocked-upstream" a blocker in the set is stuck or stalled
//     }],
//     "lines":    [["#5", "#6"], ["#7"]],
//     "frontier": ["#7"],         // ids with ready === true
//     "warnings": ["..."]         // inconsistencies worth a look; never change the result
//   }
//   Tickets, blockers, lines and frontier are sorted (GitHub by number, local by path). Lines join only
//   tickets inside the set. A blocker outside the set keeps its tracker state.
//
// Exit codes: 0 output written; 1 tracker or git read failed, or --line names no line; 2 bad arguments.
import { readFileSync, readdirSync, existsSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, relative, sep, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORMAT = 'sorry-matt/frontier@1';

class UsageError extends Error {}

// ---------- shared ----------

function connectedLines(tickets, compare) {
  const parent = new Map(tickets.map((t) => [t.id, t.id]));
  const find = (x) => (parent.get(x) === x ? x : find(parent.get(x)));
  for (const t of tickets) {
    for (const b of t.blockedBy) if (b.inSet) parent.set(find(b.id), find(t.id));
  }
  const groups = new Map();
  for (const t of tickets) {
    const root = find(t.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(t.id);
  }
  return [...groups.values()].map((g) => g.sort(compare)).sort((a, b) => compare(a[0], b[0]));
}

// Open tickets on a cycle of in-set blocker edges between open tickets (Tarjan's SCC).
function cycleMembers(tickets) {
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const next = (t) => t.blockedBy.filter((b) => b.inSet && byId.get(b.id).state === 'open').map((b) => b.id);
  const index = new Map();
  const low = new Map();
  const stack = [];
  const onStack = new Set();
  const out = new Set();
  let counter = 0;
  const visit = (id) => {
    index.set(id, counter);
    low.set(id, counter++);
    stack.push(id);
    onStack.add(id);
    for (const w of next(byId.get(id))) {
      if (!index.has(w)) {
        visit(w);
        low.set(id, Math.min(low.get(id), low.get(w)));
      } else if (onStack.has(w)) low.set(id, Math.min(low.get(id), index.get(w)));
    }
    if (low.get(id) === index.get(id)) {
      const scc = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        scc.push(w);
      } while (w !== id);
      if (scc.length > 1 || next(byId.get(id)).includes(id)) scc.forEach((x) => out.add(x));
    }
  };
  for (const t of tickets) if (t.state === 'open' && !index.has(t.id)) visit(t.id);
  return out;
}

function stalledReasons(tickets) {
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const cycles = cycleMembers(tickets);
  const memo = new Map();
  const stalled = (t) => {
    if (t.state !== 'open') return null;
    if (cycles.has(t.id)) return 'cycle';
    if (memo.has(t.id)) return memo.get(t.id);
    let reason = null;
    if (t.blockedBy.some((b) => b.state === 'missing')) reason = 'missing';
    else if (t.blockedBy.some((b) => !b.inSet && b.state !== 'done')) reason = 'blocked-external';
    else if (t.blockedBy.some((b) => b.inSet && (b.state === 'stuck' || stalled(byId.get(b.id))))) reason = 'blocked-upstream';
    memo.set(t.id, reason);
    return reason;
  };
  return new Map(tickets.map((t) => [t.id, stalled(t)]));
}

function finish(tracker, source, tickets, compare, { line, warnings = [] } = {}) {
  tickets.sort((a, b) => compare(a.id, b.id));
  for (const t of tickets) {
    t.blockedBy.sort((a, b) => compare(a.id, b.id));
    t.ready = t.state === 'open' && t.blockedBy.every((b) => b.state === 'done');
  }
  const stalled = stalledReasons(tickets);
  let lines = connectedLines(tickets, compare);
  const lineOf = new Map(lines.flatMap((g) => g.map((id) => [id, g[0]])));
  if (line !== undefined) {
    lines = lines.filter((g) => g[0] === line);
    if (lines.length === 0) throw new Error(`--line ${line} names no line of this set at ${source}`);
    tickets = tickets.filter((t) => lineOf.get(t.id) === line);
  }
  return {
    format: FORMAT,
    tracker,
    source,
    tickets: tickets.map(({ id, title, state, trackerState, blockedBy, ready }) => ({
      id,
      title,
      state,
      trackerState,
      blockedBy,
      line: lineOf.get(id),
      ready,
      stalled: stalled.get(id),
    })),
    lines,
    frontier: tickets.filter((t) => t.ready).map((t) => t.id),
    warnings,
  };
}

// Section-aware reading of a ticket body.
function sections(text) {
  const out = [{ heading: '', body: [] }];
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const h = /^##\s+(.*?)\s*$/.exec(line);
    if (h) out.push({ heading: h[1], body: [] });
    else out[out.length - 1].body.push(line);
  }
  return out;
}

const ownSection = (s) => !/^comments$/i.test(s.heading) && !/^sorry-matt\b/i.test(s.heading);

// `Name: v`, `**Name:** v` or `**Name**: v`.
const field = (text, name) => {
  const m = new RegExp(`^\\s*(?:\\*\\*)?${name}(?::\\*\\*|\\*\\*:|:)\\s*(.*)$`, 'im').exec(text);
  return m ? m[1].replace(/\*\*/g, '').trim() : null;
};

// The raw blocker references of a ticket: a `## Blocked by` list, else a `Blocked by:` line.
function blockerRefs(secs) {
  const listed = secs.find((s) => /^blocked by$/i.test(s.heading));
  const inline = field(secs.filter(ownSection).map((s) => s.body.join('\n')).join('\n'), 'Blocked by');
  const items = listed
    ? listed.body.filter((l) => /^\s*[-*]\s+/.test(l)).map((l) => l.replace(/^\s*[-*]\s+/, ''))
    : inline
      ? [inline]
      : [];
  return items
    .flatMap((i) => i.split(','))
    .map((s) => s.trim())
    .filter((s) => s && !/^none\b/i.test(s));
}

// ---------- GitHub ----------

const URL_RE = /^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/issues\/(\d+)/;
const sameRepo = (a, b) => a.toLowerCase() === b.toLowerCase();

const issueNumber = (arg, repo) => {
  const s = String(arg).trim();
  const url = new RegExp(`${URL_RE.source}/?$`).exec(s);
  if (url) {
    if (!sameRepo(url[1], repo)) throw new UsageError(`${s} is not in --repo ${repo}`);
    return Number(url[2]);
  }
  const m = /^#?(\d+)$/.exec(s);
  if (!m) throw new UsageError(`not an issue number or URL: ${arg}`);
  return Number(m[1]);
};

// "#7" < "#11" < "other/repo#2": same-repo ids first, by number.
const ghCompare = (a, b) => {
  const key = (id) => {
    const m = /^(.*)#(\d+)$/.exec(id);
    return m ? [m[1], Number(m[2])] : [`￿${id}`, 0];
  };
  const [ra, na] = key(a);
  const [rb, nb] = key(b);
  return ra === rb ? na - nb : ra < rb ? -1 : 1;
};

const notFound = (e) => /\b404\b|Not Found/i.test(`${e.stderr || ''} ${e.message || ''}`);

// `gh(path)` is the seam: it returns the parsed JSON of `gh api <path>`.
export function githubFrontier({ repo, numbers, done = [], stuck = [], line, gh }) {
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo || '')) throw new UsageError('--repo <owner>/<repo> is required');
  if (numbers.length === 0) throw new UsageError('no issue numbers given');
  const set = [...new Set(numbers.map((n) => issueNumber(n, repo)))];
  const doneSet = new Set(done.map((n) => issueNumber(n, repo)));
  const stuckSet = new Set(stuck.map((n) => issueNumber(n, repo)));
  for (const n of [...doneSet, ...stuckSet]) {
    if (!set.includes(n)) throw new UsageError(`#${n} is passed as done or stuck but is not in the ticket set`);
  }
  const idFor = (r, n) => (sameRepo(r, repo) ? `#${n}` : `${r}#${n}`);
  const repoOf = (issue) => (/\/repos\/([^/]+\/[^/]+)$/.exec(issue.repository_url || '') || [])[1] || repo;
  // A body reference -> blocker id, or null when it is not an issue reference.
  const bodyRef = (ref) => {
    const token = ref.split(/\s+/)[0];
    const url = URL_RE.exec(token);
    if (url) return { id: idFor(url[1], url[2]), repo: url[1], n: Number(url[2]) };
    const m = /^(?:([\w.-]+\/[\w.-]+))?#(\d+)\b/.exec(token);
    return m ? { id: idFor(m[1] || repo, m[2]), repo: m[1] || repo, n: Number(m[2]) } : null;
  };

  const raw = set.map((n) => ({
    n,
    issue: gh(`repos/${repo}/issues/${n}`),
    native: gh(`repos/${repo}/issues/${n}/dependencies/blocked_by?per_page=100`),
  }));
  const stateOf = new Map(
    raw.map(({ n, issue }) => [
      `#${n}`,
      issue.state === 'closed' || doneSet.has(n) ? 'done' : stuckSet.has(n) ? 'stuck' : 'open',
    ]),
  );
  const outside = new Map(); // id -> tracker state of a blocker outside the set
  const outsideState = (ref) => {
    if (!outside.has(ref.id)) {
      try {
        outside.set(ref.id, gh(`repos/${ref.repo}/issues/${ref.n}`).state === 'closed' ? 'done' : 'open');
      } catch (e) {
        if (!notFound(e)) throw e;
        outside.set(ref.id, 'missing');
      }
    }
    return outside.get(ref.id);
  };

  const warnings = [];
  const tickets = raw.map(({ n, issue, native }) => {
    for (const b of native) outside.set(idFor(repoOf(b), b.number), b.state === 'closed' ? 'done' : 'open');
    const nativeIds = native.map((b) => idFor(repoOf(b), b.number));
    const body = blockerRefs(sections(issue.body || '')).map((r) => bodyRef(r) || { id: r, missing: true });
    const bodyIds = body.map((r) => r.id);
    const id = `#${n}`;
    if (nativeIds.length && bodyIds.length) {
      const differ = bodyIds.some((x) => !nativeIds.includes(x)) || nativeIds.some((x) => !bodyIds.includes(x));
      if (differ) {
        warnings.push(`${id}: body Blocked by (${bodyIds.join(', ')}) differs from native dependencies (${nativeIds.join(', ')}); using both`);
      }
    }
    const blockedBy = new Map();
    for (const bid of nativeIds) blockedBy.set(bid, null);
    for (const r of body) if (!blockedBy.has(r.id)) blockedBy.set(r.id, r);
    return {
      id,
      title: issue.title,
      state: stateOf.get(id),
      trackerState: issue.state,
      blockedBy: [...blockedBy].map(([bid, ref]) => {
        if (stateOf.has(bid)) return { id: bid, state: stateOf.get(bid), inSet: true };
        if (ref && ref.missing) return { id: bid, state: 'missing', inSet: false };
        return { id: bid, state: ref ? outsideState(ref) : outside.get(bid), inSet: false };
      }),
    };
  });
  return finish('github', repo, tickets, ghCompare, { line, warnings });
}

// ---------- Local Markdown ----------

const pathCompare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function parseTicket(text) {
  const secs = sections(text);
  const ownText = secs.filter(ownSection).map((s) => s.body.join('\n')).join('\n');
  const completion = secs.find((s) => /^sorry-matt completion$/i.test(s.heading));
  const blockerAt = secs.findLastIndex((s) => /^sorry-matt blocker$/i.test(s.heading));
  const unchecked = secs.filter(ownSection).some((s) => s.body.some((l) => /^\s*[-*]\s+\[ \]/.test(l)));
  // A blocker after the completion record (a reverted merge) undoes it.
  const done = Boolean(completion && completion.body.some((l) => l.trim()) && !unchecked && blockerAt < secs.indexOf(completion));
  const stuck = !done && blockerAt >= 0;
  return {
    title: (/^#\s+(.*)$/m.exec(text) || [])[1]?.trim() ?? null,
    status: field(ownText, 'Status'),
    refs: blockerRefs(secs),
    state: done ? 'done' : stuck ? 'stuck' : 'open',
  };
}

// `read(path)` returns the file text or null; `list(dir)` returns the file names in it.
// Both take repo-relative forward-slash paths. They are the seam.
export function localFrontier({ paths, read, list, line, source = 'worktree' }) {
  if (paths.length === 0) throw new UsageError('no ticket files given');
  const set = [...new Set(paths.map((p) => posix.normalize(p.split(sep).join('/'))))];
  const parsed = new Map();
  const load = (p) => {
    if (!parsed.has(p)) {
      const text = read(p);
      parsed.set(p, text === null ? null : parseTicket(text));
    }
    return parsed.get(p);
  };

  const resolveRef = (ticket, ref) => {
    const dir = posix.dirname(ticket);
    const token = ref.split(/\s+/)[0];
    if (/\.md$/i.test(token)) {
      const p = token.includes('/') ? posix.normalize(token.replace(/^\.\//, '')) : `${dir}/${token}`;
      return load(p) ? p : null;
    }
    const m = /^#?(\d+)\b/.exec(token);
    if (!m) return null;
    const hits = list(dir).filter((f) => {
      const nn = /^(\d+)-.*\.md$/i.exec(f);
      return nn && Number(nn[1]) === Number(m[1]);
    });
    return hits.length === 1 && load(`${dir}/${hits[0]}`) ? `${dir}/${hits[0]}` : null;
  };

  const tickets = set.map((p) => {
    const t = load(p);
    if (!t) throw new Error(`cannot read ticket file ${p} at ${source}`);
    return {
      id: p,
      title: t.title,
      state: t.state,
      trackerState: t.status,
      blockedBy: t.refs.map((ref) => {
        const target = resolveRef(p, ref);
        if (!target) return { id: ref, state: 'missing', inSet: false };
        return { id: target, state: load(target).state, inSet: set.includes(target) };
      }),
    };
  });
  return finish('local', source, tickets, pathCompare, { line });
}

// ---------- CLI ----------

function parseArgs(argv) {
  const [tracker, ...rest] = argv;
  const opts = { positional: [], done: [], stuck: [] };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    const value = () => {
      if (i + 1 >= rest.length) throw new UsageError(`${a} needs a value`);
      return rest[++i];
    };
    if (a === '--repo') opts.repo = value();
    else if (a === '--ref') opts.ref = value();
    else if (a === '--line') opts.line = value();
    else if (a === '--done') opts.done.push(...value().split(',').filter(Boolean));
    else if (a === '--stuck') opts.stuck.push(...value().split(',').filter(Boolean));
    else if (a.startsWith('--')) throw new UsageError(`unknown option ${a}`);
    else opts.positional.push(a);
  }
  if (tracker !== 'github' && tracker !== 'local') throw new UsageError('first argument must be github or local');
  if (tracker === 'local' && (opts.repo || opts.done.length || opts.stuck.length)) {
    throw new UsageError('local reads done and stuck from the ticket files; --repo, --done and --stuck are github only');
  }
  if (tracker === 'github' && opts.ref) throw new UsageError('--ref is local only');
  return { tracker, ...opts };
}

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] });

export function defaultDeps(cwd = process.cwd()) {
  return {
    gh: (path) => JSON.parse(run('gh', ['api', path], cwd)),
    git: (args) => run('git', args, cwd),
    fs: { readFileSync, readdirSync, existsSync },
    cwd,
  };
}

// A Windows 8.3 short name (C:\Users\RUNNER~1) and its long name are one directory, but path.relative compares
// text; so do symlinked spellings elsewhere. Relativize only canonical paths: `p` against `base`, through the real
// path when it exists, else through the real base.
const realOr = (p, fallback) => {
  try {
    return realpathSync.native(p);
  } catch {
    return fallback;
  }
};
const canonical = (base, p = '.') => realOr(resolve(base, p), resolve(realOr(base, base), p));

function localDeps(deps, ref) {
  const root = canonical(deps.git(['rev-parse', '--show-toplevel']).trim());
  const rel = (p) => relative(root, canonical(deps.cwd, p)).split(sep).join('/');
  if (!ref) {
    const abs = (p) => resolve(root, p);
    return {
      rel,
      read: (p) => (deps.fs.existsSync(abs(p)) ? deps.fs.readFileSync(abs(p), 'utf8') : null),
      list: (dir) => (deps.fs.existsSync(abs(dir)) ? deps.fs.readdirSync(abs(dir)) : []),
    };
  }
  deps.git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  return {
    rel,
    // `<ref>:<path>` and --full-tree both resolve from the repo root, whatever the cwd.
    read: (p) => {
      try {
        return deps.git(['show', `${ref}:${p}`]);
      } catch {
        return null;
      }
    },
    list: (dir) =>
      deps
        .git(['ls-tree', '--full-tree', '--name-only', ref, '--', `${dir}/`])
        .split('\n')
        .filter(Boolean)
        .map((f) => posix.basename(f)),
  };
}

// Returns { code, out, err } instead of touching the process, so tests can drive it.
export function main(argv, deps = defaultDeps()) {
  try {
    const args = parseArgs(argv);
    let result;
    if (args.tracker === 'github') {
      const { repo, positional: numbers, done, stuck, line } = args;
      result = githubFrontier({ repo, numbers, done, stuck, line, gh: deps.gh });
    } else {
      const { rel, read, list } = localDeps(deps, args.ref);
      result = localFrontier({ paths: args.positional.map(rel), read, list, line: args.line, source: args.ref || 'worktree' });
    }
    return { code: 0, out: `${JSON.stringify(result, null, 2)}\n`, err: '' };
  } catch (e) {
    const usage = e instanceof UsageError;
    const detail = (e.stderr && String(e.stderr).trim()) || e.message;
    return { code: usage ? 2 : 1, out: '', err: `frontier: ${detail}\n${usage ? 'usage: see the header of frontier.mjs\n' : ''}` };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { code, out, err } = main(process.argv.slice(2));
  process.stdout.write(out);
  process.stderr.write(err);
  process.exitCode = code;
}
