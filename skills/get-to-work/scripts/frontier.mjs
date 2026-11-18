#!/usr/bin/env node
// frontier: which tickets in a frozen set can start now. No dependencies: runs on a bare Node 20+.
//
// Usage
//   node frontier.mjs github --repo <owner>/<repo> [--done <n,...>] [--stuck <n,...>] <n|#n|issue URL>...
//   node frontier.mjs local [--ref <git-ref>] <ticket-file>...
//
// github  Blockers come from GitHub's native issue dependencies
//         (GET /repos/{owner}/{repo}/issues/{n}/dependencies/blocked_by). A closed issue is done.
//         A ticket integrated during this run is still open on GitHub, so pass it with --done;
//         pass a ticket the run marked stuck with --stuck.
// local   One ticket file per issue (`.scratch/<feature>/issues/<NN>-<slug>.md`). Blockers come from the
//         `Blocked by:` line (or a `## Blocked by` list): `NN`, `#NN`, a file name or a repo-relative path,
//         comma-separated; "None ..." means no blockers. A ticket is done when it has a non-empty
//         `## sorry-matt completion` section and no unchecked `- [ ]` outside the `## Comments` and
//         `## sorry-matt ...` sections; it is stuck when it has `## sorry-matt blocker` and is not done.
//         `Status:` alone (ready-for-human included) never makes it done. Without --ref the files are read
//         from the working tree; with --ref they are read from that commit (run once per line, with the
//         line's integration branch).
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
//       "ready":        true      // state is "open" and every blocker is "done"
//     }],
//     "lines":    [["#5", "#6"], ["#7"]],
//     "frontier": ["#7"]          // ids with ready === true
//   }
//   Tickets, blockers, lines and frontier are sorted (GitHub by number, local by path). Lines join only
//   tickets inside the set. A blocker outside the set keeps its tracker state; "missing" means the
//   reference could not be resolved, so the ticket is not ready.
//
// Exit codes: 0 output written; 1 tracker or git read failed; 2 bad arguments.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
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

function finish(tracker, source, tickets, compare) {
  tickets.sort((a, b) => compare(a.id, b.id));
  for (const t of tickets) {
    t.blockedBy.sort((a, b) => compare(a.id, b.id));
    t.ready = t.state === 'open' && t.blockedBy.every((b) => b.state === 'done');
  }
  const lines = connectedLines(tickets, compare);
  const lineOf = new Map(lines.flatMap((g) => g.map((id) => [id, g[0]])));
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
    })),
    lines,
    frontier: tickets.filter((t) => t.ready).map((t) => t.id),
  };
}

// ---------- GitHub ----------

const issueNumber = (arg) => {
  const m = /^(?:#?(\d+)|https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)\/?)$/.exec(String(arg).trim());
  if (!m) throw new UsageError(`not an issue number or URL: ${arg}`);
  return Number(m[1] || m[2]);
};

// "#7" < "#11" < "other/repo#2": same-repo ids first, by number.
const ghCompare = (a, b) => {
  const key = (id) => {
    const m = /^(.*)#(\d+)$/.exec(id);
    return [m[1], Number(m[2])];
  };
  const [ra, na] = key(a);
  const [rb, nb] = key(b);
  return ra === rb ? na - nb : ra < rb ? -1 : 1;
};

// `gh(path)` is the seam: it returns the parsed JSON of `gh api <path>`.
export function githubFrontier({ repo, numbers, done = [], stuck = [], gh }) {
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo || '')) throw new UsageError('--repo <owner>/<repo> is required');
  if (numbers.length === 0) throw new UsageError('no issue numbers given');
  const set = [...new Set(numbers.map(issueNumber))];
  const doneSet = new Set(done.map(issueNumber));
  const stuckSet = new Set(stuck.map(issueNumber));
  for (const n of [...doneSet, ...stuckSet]) {
    if (!set.includes(n)) throw new UsageError(`#${n} is passed as done or stuck but is not in the ticket set`);
  }
  const idOf = (issue) => {
    const owner = /\/repos\/([^/]+\/[^/]+)$/.exec(issue.repository_url || '');
    const r = owner ? owner[1] : repo;
    return r.toLowerCase() === repo.toLowerCase() ? `#${issue.number}` : `${r}#${issue.number}`;
  };

  const raw = set.map((n) => ({
    n,
    issue: gh(`repos/${repo}/issues/${n}`),
    blockers: gh(`repos/${repo}/issues/${n}/dependencies/blocked_by?per_page=100`),
  }));
  const stateOf = new Map(
    raw.map(({ n, issue }) => [
      `#${n}`,
      issue.state === 'closed' || doneSet.has(n) ? 'done' : stuckSet.has(n) ? 'stuck' : 'open',
    ]),
  );
  const tickets = raw.map(({ n, issue, blockers }) => ({
    id: `#${n}`,
    title: issue.title,
    state: stateOf.get(`#${n}`),
    trackerState: issue.state,
    blockedBy: blockers.map((b) => {
      const id = idOf(b);
      return stateOf.has(id)
        ? { id, state: stateOf.get(id), inSet: true }
        : { id, state: b.state === 'closed' ? 'done' : 'open', inSet: false };
    }),
  }));
  return finish('github', repo, tickets, ghCompare);
}

// ---------- Local Markdown ----------

const pathCompare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Splits a ticket file into its `## ` sections; the text before the first one is under "".
function sections(text) {
  const out = [{ heading: '', body: [] }];
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const h = /^##\s+(.*?)\s*$/.exec(line);
    if (h) out.push({ heading: h[1], body: [] });
    else out[out.length - 1].body.push(line);
  }
  return out;
}

// `Name: v`, `**Name:** v` or `**Name**: v`.
const field = (text, name) => {
  const m = new RegExp(`^\\s*(?:\\*\\*)?${name}(?::\\*\\*|\\*\\*:|:)\\s*(.*)$`, 'im').exec(text);
  return m ? m[1].replace(/\*\*/g, '').trim() : null;
};

export function parseTicket(text) {
  const secs = sections(text);
  const own = (s) => !/^comments$/i.test(s.heading) && !/^sorry-matt\b/i.test(s.heading);
  const ownText = secs.filter(own).map((s) => s.body.join('\n')).join('\n');

  const listed = secs.find((s) => /^blocked by$/i.test(s.heading));
  const inline = field(ownText, 'Blocked by');
  const items = listed
    ? listed.body.filter((l) => /^\s*[-*]\s+/.test(l)).map((l) => l.replace(/^\s*[-*]\s+/, ''))
    : inline
      ? [inline]
      : [];
  const refs = items
    .flatMap((i) => i.split(','))
    .map((s) => s.trim())
    .filter((s) => s && !/^none\b/i.test(s));

  const completion = secs.find((s) => /^sorry-matt completion$/i.test(s.heading));
  const unchecked = secs.filter(own).some((s) => s.body.some((l) => /^\s*[-*]\s+\[ \]/.test(l)));
  const done = Boolean(completion && completion.body.some((l) => l.trim()) && !unchecked);
  const stuck = !done && secs.some((s) => /^sorry-matt blocker$/i.test(s.heading));
  return {
    title: (/^#\s+(.*)$/m.exec(text) || [])[1]?.trim() ?? null,
    status: field(ownText, 'Status'),
    refs,
    state: done ? 'done' : stuck ? 'stuck' : 'open',
  };
}

// `read(path)` returns the file text or null; `list(dir)` returns the file names in it.
// Both take repo-relative forward-slash paths. They are the seam.
export function localFrontier({ paths, read, list, source = 'worktree' }) {
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
  return finish('local', source, tickets, pathCompare);
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

function localDeps(deps, ref) {
  const root = deps.git(['rev-parse', '--show-toplevel']).trim();
  const rel = (p) => relative(root, resolve(deps.cwd, p)).split(sep).join('/');
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
    read: (p) => {
      try {
        return deps.git(['show', `${ref}:${p}`]);
      } catch {
        return null;
      }
    },
    list: (dir) =>
      deps.git(['ls-tree', '--name-only', ref, `${dir}/`]).split('\n').filter(Boolean).map((f) => posix.basename(f)),
  };
}

// Returns { code, out, err } instead of touching the process, so tests can drive it.
export function main(argv, deps = defaultDeps()) {
  try {
    const args = parseArgs(argv);
    let result;
    if (args.tracker === 'github') {
      result = githubFrontier({ repo: args.repo, numbers: args.positional, done: args.done, stuck: args.stuck, gh: deps.gh });
    } else {
      const { rel, read, list } = localDeps(deps, args.ref);
      result = localFrontier({ paths: args.positional.map(rel), read, list, source: args.ref || 'worktree' });
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
