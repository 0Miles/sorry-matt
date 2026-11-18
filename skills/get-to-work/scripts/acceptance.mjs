#!/usr/bin/env node
// acceptance: a ticket's acceptance criteria and where each came from, and whether they changed since a snapshot.
// No dependencies: runs on a bare Node 20+.
//
// Usage
//   node acceptance.mjs github --repo <owner>/<repo> <n|#n|issue URL> [--against <snapshot.json>]
//   node acceptance.mjs local [--ref <git-ref>] <ticket-file> [--against <snapshot.json>]
//
// Where criteria come from
//   original   The ticket body (GitHub issue body; Local Markdown ticket file). When it has an acceptance heading
//              (`Acceptance criteria`, `Acceptance` or `驗收…`, any level), the list items of that section; else
//              every checkbox item (`- [ ]`, `- [x]`) outside the `## Comments` and `## sorry-matt …` sections.
//   expansion  An expansion block, written by someone other than the implementer before the ticket starts:
//
//                <!-- sorry-matt:expansion -->
//                by: <who>
//                run: <run>
//                round: <n>
//
//                acceptance:
//                - [ ] <criterion>
//
//                rulings:
//                ...
//
//              GitHub: an issue comment whose first non-blank line is the marker. Local Markdown: the
//              `## sorry-matt expansion` section of the ticket file. The list items after `acceptance:` up to
//              the next `<key>:` line are the criteria.
//   A criterion's text is its list item with continuation lines joined and whitespace collapsed. A checkbox's
//   state is not part of it: ticking a box is not changing a criterion.
//
// --against  Compare with a snapshot this script wrote earlier (its output saved to a file at spawn time). Any
//            criterion removed, added, reworded, reordered or moved to another source counts as a change.
// --ref      Local Markdown only: read the ticket file from that commit instead of the working tree.
//
// Output (stdout, JSON, format "sorry-matt/acceptance@1"; fields are only ever added, never renamed)
//   {
//     "format":         "sorry-matt/acceptance@1",
//     "tracker":        "github" | "local",
//     "source":         "<owner>/<repo>" | "<git-ref>" | "worktree",
//     "id":             "#7" | ".scratch/feat/issues/03-x.md",
//     "title":          "...",
//     "items":          [{ "from": "original", "text": "..." },
//                        { "from": "expansion", "by": "expansion-agent", "run": "r1", "round": "2", "text": "..." }],
//     "expansions":     [{ "by": "...", "run": "...", "round": "...", "at": "<comment URL | ## sorry-matt expansion>" }],
//     "needsExpansion": true,       // no criteria from any source
//     "sha256":         "<hex>",    // over the items, in order
//     "check":          { "against": "<path>", "changed": false, "removed": [item...], "added": [item...] }
//                                   // only with --against
//   }
//
// Exit codes: 0 output written (a change is reported in "check", not in the exit code); 1 tracker, git or
// snapshot read failed; 2 bad arguments, or the snapshot belongs to another ticket.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORMAT = 'sorry-matt/acceptance@1';
export const MARKER = '<!-- sorry-matt:expansion -->';

class UsageError extends Error {}

const ACCEPTANCE_HEADING = /^(acceptance criteria|acceptance|驗收\S*)$/i;
const LIST_ITEM = /^\s*[-*+]\s+(?:\[[ xX]\]\s+)?(.*)$/;
const CHECKBOX = /^\s*[-*+]\s+\[[ xX]\]\s+(.*)$/;
const KEY_LINE = /^([a-z][a-z -]*):\s*(.*)$/;
const collapse = (s) => s.replace(/\s+/g, ' ').trim();

// List items of `lines`, each with its indented continuation lines; `pick` decides which lines start an item.
function listItems(lines, pick = LIST_ITEM) {
  const items = [];
  let open = false;
  for (const line of lines) {
    const m = pick.exec(line);
    if (m) {
      items.push(m[1]);
      open = true;
    } else if (open && /^\s+\S/.test(line) && !LIST_ITEM.test(line)) {
      items[items.length - 1] += ` ${line}`;
    } else {
      open = false;
    }
  }
  return items.map(collapse).filter(Boolean);
}

// Lines of the markdown, marking fenced code and headings (level and title).
function scan(text) {
  let fence = null;
  return text.split(/\r?\n/).map((line) => {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      return { line, fenced: true };
    }
    if (fence) return { line, fenced: true };
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    return h ? { line, level: h[1].length, title: h[2].trim() } : { line };
  });
}

// The lines under the first heading matching `test`, up to the next heading of the same or a higher level.
function section(text, test) {
  const rows = scan(text);
  const start = rows.findIndex((r) => r.level && test(r.title));
  if (start < 0) return null;
  const out = [];
  for (const r of rows.slice(start + 1)) {
    if (r.level && r.level <= rows[start].level) break;
    out.push(r.fenced ? '' : r.line);
  }
  return out;
}

export function originalCriteria(body) {
  const own = section(body, (t) => ACCEPTANCE_HEADING.test(t));
  if (own) return listItems(own);
  const lines = [];
  let skip = false;
  for (const r of scan(body)) {
    if (r.level === 2) skip = /^(comments|sorry-matt\b)/i.test(r.title);
    lines.push(skip || r.fenced ? '' : r.line);
  }
  return listItems(lines, CHECKBOX);
}

// Every expansion block in `text`: each starts at a marker line and runs to the next marker or the end.
export function expansionBlocks(text, at) {
  const lines = text.split(/\r?\n/);
  const starts = lines.flatMap((l, i) => (l.trim() === MARKER ? [i] : []));
  return starts.map((s, k) => {
    const block = lines.slice(s + 1, k + 1 < starts.length ? starts[k + 1] : lines.length);
    const meta = { by: null, run: null, round: null };
    const criteria = [];
    let inAcceptance = false;
    for (const line of block) {
      const key = KEY_LINE.exec(line);
      if (key) {
        inAcceptance = key[1] === 'acceptance';
        if (key[1] in meta && meta[key[1]] === null) meta[key[1]] = key[2].trim() || null;
        continue;
      }
      if (inAcceptance) criteria.push(line);
    }
    return { ...meta, at, criteria: listItems(criteria) };
  });
}

const itemKey = (item) => JSON.stringify([item.from, item.by ?? null, item.run ?? null, item.round ?? null, item.text]);

function assemble({ tracker, source, id, title, body, blocks }) {
  const items = [
    ...originalCriteria(body).map((text) => ({ from: 'original', text })),
    ...blocks.flatMap((b) => b.criteria.map((text) => ({ from: 'expansion', by: b.by, run: b.run, round: b.round, text }))),
  ];
  return {
    format: FORMAT,
    tracker,
    source,
    id,
    title,
    items,
    expansions: blocks.map(({ by, run, round, at }) => ({ by, run, round, at })),
    needsExpansion: items.length === 0,
    sha256: createHash('sha256').update(JSON.stringify(items.map(itemKey))).digest('hex'),
  };
}

export function compare(current, snapshot, against) {
  if (!snapshot || snapshot.format !== FORMAT || !Array.isArray(snapshot.items)) {
    throw new UsageError(`${against} is not a ${FORMAT} snapshot`);
  }
  if (snapshot.id !== current.id || snapshot.tracker !== current.tracker) {
    throw new UsageError(`${against} is the snapshot of ${snapshot.tracker} ${snapshot.id}, not ${current.tracker} ${current.id}`);
  }
  // Multiset difference, so a duplicated or dropped copy of the same criterion still counts.
  const left = new Map();
  for (const item of snapshot.items) left.set(itemKey(item), [...(left.get(itemKey(item)) || []), item]);
  const added = [];
  for (const item of current.items) {
    const same = left.get(itemKey(item));
    if (same && same.length) same.pop();
    else added.push(item);
  }
  const removed = [...left.values()].flat();
  const reordered = snapshot.items.map(itemKey).join('\n') !== current.items.map(itemKey).join('\n');
  return { against, changed: removed.length > 0 || added.length > 0 || reordered, removed, added };
}

// ---------- trackers ----------

export function githubAcceptance({ repo, ticket, gh }) {
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo || '')) throw new UsageError('--repo must be <owner>/<repo>');
  const m = /^(?:#?(\d+)|https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)\/?)$/.exec(ticket || '');
  if (!m) throw new UsageError(`cannot read an issue number from ${ticket}`);
  if (m[2] && m[2].toLowerCase() !== repo.toLowerCase()) throw new UsageError(`${ticket} is not in ${repo}`);
  const n = Number(m[1] || m[3]);
  const issue = gh(`repos/${repo}/issues/${n}`);
  const blocks = [];
  for (let page = 1; ; page++) {
    const comments = gh(`repos/${repo}/issues/${n}/comments?per_page=100&page=${page}`);
    for (const c of comments) {
      const first = (c.body || '').split(/\r?\n/).find((l) => l.trim());
      if (first && first.trim() === MARKER) blocks.push(...expansionBlocks(c.body, c.html_url));
    }
    if (comments.length < 100) break;
  }
  return assemble({ tracker: 'github', source: repo, id: `#${n}`, title: issue.title, body: issue.body || '', blocks });
}

export function localAcceptance({ path, text, source }) {
  const own = section(text, (t) => /^sorry-matt expansion$/i.test(t));
  const blocks = own ? expansionBlocks(own.join('\n'), '## sorry-matt expansion') : [];
  const title = (/^#\s+(.*)$/m.exec(text) || [])[1] || path;
  return assemble({ tracker: 'local', source, id: path, title: title.trim(), body: text, blocks });
}

// ---------- CLI ----------

function parseArgs(argv) {
  const [tracker, ...rest] = argv;
  const opts = { positional: [] };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    const value = () => {
      if (i + 1 >= rest.length) throw new UsageError(`${a} needs a value`);
      return rest[++i];
    };
    if (a === '--repo') opts.repo = value();
    else if (a === '--ref') opts.ref = value();
    else if (a === '--against') opts.against = value();
    else if (a.startsWith('--')) throw new UsageError(`unknown option ${a}`);
    else opts.positional.push(a);
  }
  if (tracker !== 'github' && tracker !== 'local') throw new UsageError('first argument must be github or local');
  if (opts.positional.length !== 1) throw new UsageError('give exactly one ticket');
  if (tracker === 'local' && opts.repo) throw new UsageError('--repo is github only');
  if (tracker === 'github' && opts.ref) throw new UsageError('--ref is local only');
  return { tracker, ticket: opts.positional[0], ...opts };
}

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] });

export function defaultDeps(cwd = process.cwd()) {
  return {
    gh: (path) => JSON.parse(run('gh', ['api', path], cwd)),
    git: (args) => run('git', args, cwd),
    readFile: (p) => readFileSync(resolve(cwd, p), 'utf8'),
    cwd,
  };
}

function readLocal(deps, file, ref) {
  const root = deps.git(['rev-parse', '--show-toplevel']).trim();
  const path = relative(root, resolve(deps.cwd, file)).split(sep).join('/');
  if (!ref) return { path, text: deps.readFile(resolve(root, path)) };
  // `<ref>:<path>` resolves from the repo root, whatever the cwd.
  return { path, text: deps.git(['show', `${ref}:${path}`]) };
}

// Returns { code, out, err } instead of touching the process, so tests can drive it.
export function main(argv, deps = defaultDeps()) {
  try {
    const args = parseArgs(argv);
    let result;
    if (args.tracker === 'github') {
      result = githubAcceptance({ repo: args.repo, ticket: args.ticket, gh: deps.gh });
    } else {
      const { path, text } = readLocal(deps, args.ticket, args.ref);
      result = localAcceptance({ path, text, source: args.ref || 'worktree' });
    }
    if (args.against) {
      let snapshot;
      try {
        snapshot = JSON.parse(deps.readFile(args.against));
      } catch (e) {
        throw new Error(`cannot read snapshot ${args.against}: ${e.message}`);
      }
      result.check = compare(result, snapshot, args.against);
    }
    return { code: 0, out: `${JSON.stringify(result, null, 2)}\n`, err: '' };
  } catch (e) {
    const usage = e instanceof UsageError;
    const detail = (e.stderr && String(e.stderr).trim()) || e.message;
    return { code: usage ? 2 : 1, out: '', err: `acceptance: ${detail}\n${usage ? 'usage: see the header of acceptance.mjs\n' : ''}` };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { code, out, err } = main(process.argv.slice(2));
  process.stdout.write(out);
  process.stderr.write(err);
  process.exitCode = code;
}
