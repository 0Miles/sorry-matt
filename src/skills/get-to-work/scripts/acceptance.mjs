#!/usr/bin/env node
// acceptance: a ticket's acceptance criteria and where each came from, and whether they changed since a snapshot.
// No dependencies: runs on a bare Node 20+.
//
// Usage
//   node acceptance.mjs github --repo <owner>/<repo> <n|#n|issue URL> [--against <snapshot.json> --sha <hex>]
//   node acceptance.mjs local [--ref <git-ref>] <ticket-file> [--against <snapshot.json> --sha <hex>]
//
// Where criteria come from
//   original   The ticket body (GitHub issue body; Local Markdown ticket file), leaving out fenced code and every
//              section titled `Comments` or `sorry-matt …` (any level, down to the next heading of that level or
//              higher). When what is left has an acceptance heading (`Acceptance criteria`, `Acceptance` or `驗收…`,
//              any level), the list items of that section; else every checkbox item (`- [ ]`, `- [x]`, `1. [ ]`).
//              A list item is ticket.mjs's: a `-`, `*` or `+` bullet, or a number followed by `.` or `)`, then
//              whitespace and at least one non-blank character.
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
//              `## sorry-matt expansion` section of the ticket file. The keys are exactly by, run, round, acceptance
//              and rulings, each at the start of a line; any other `word: …` line is ordinary text. The list items
//              between `acceptance:` and the next key line are the criteria.
//   A criterion's text is its list item with continuation lines (indented, or lazy ones directly below) joined and
//   whitespace collapsed. A checkbox's state is not part of it: ticking a box is not changing a criterion.
//
// --against  Compare with a snapshot this script wrote earlier (its output saved to a file at spawn time). Any
//            criterion removed, added, reworded, reordered or moved to another source (`from`, `by`, `run`, `round`)
//            counts as a change.
// --sha      Required with --against: the snapshot's sha256 as recorded when it was saved. The script recomputes the
//            hash from the snapshot's items; when it differs, the snapshot itself was edited, which counts as a
//            change (check.snapshotIntact false, exit 3).
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
//     "expansions":     [{ "by": "...", "run": "...", "round": "...", "at": "<comment URL | ## sorry-matt expansion>",
//                          "text": "<the block, marker line included>" }],
//     "needsExpansion": true,       // no criteria from any source
//     "sha256":         "<hex>",    // over the items, in order
//     "check":          { "against": "<path>", "snapshotIntact": true, "changed": false,
//                         "removed": [item...], "added": [item...] }      // only with --against
//   }
//
// Exit codes: 0 output written (a change in the ticket is reported in "check", not in the exit code); 1 tracker,
// git or snapshot read failed; 2 bad arguments, or the snapshot belongs to another ticket; 3 output written, but the
// snapshot's items do not match --sha.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, relative, sep } from 'node:path';
import { UsageError, parseJson, run, canonical, failure, runIfEntry } from './cli.mjs';
import { scan, section, ownRows, lines, startsHeading, listItem } from './ticket.mjs';

export const FORMAT = 'sorry-matt/acceptance@1';
export const MARKER = '<!-- sorry-matt:expansion -->';

const ACCEPTANCE_HEADING = /^(acceptance criteria|acceptance|驗收\S*)$/i;
// A checkbox at the start of a list item's text; its state is not part of the criterion.
const CHECKBOX = /^\[[ xX]\](?:\s+|$)/;
const KEY_LINE = /^(by|run|round|acceptance|rulings):\s*(.*)$/;
const collapse = (s) => s.replace(/\s+/g, ' ').trim();

// List items of `input` (text lines), each with its continuation lines and without its checkbox. With `checkboxOnly`,
// only checkbox items start an item. A blank line, a heading, or a list item that is not picked ends the item.
function listItems(input, { checkboxOnly = false } = {}) {
  const items = [];
  let open = false;
  for (const line of input) {
    const text = listItem(line);
    if (text !== null && (!checkboxOnly || CHECKBOX.test(text))) {
      items.push(text.replace(CHECKBOX, ''));
      open = true;
    } else if (open && line.trim() && text === null && !startsHeading(line)) {
      items[items.length - 1] += ` ${line}`;
    } else {
      open = false;
    }
  }
  return items.map(collapse).filter(Boolean);
}

export function originalCriteria(body) {
  // Blank out fenced code and the Comments / sorry-matt sections, whatever their level, so an expansion section
  // nested under the acceptance heading is never counted twice.
  const rows = ownRows(scan(body));
  const own = section(rows, (t) => ACCEPTANCE_HEADING.test(t));
  return own ? listItems(lines(own)) : listItems(lines(rows), { checkboxOnly: true });
}

// Every expansion block in `text`: each starts at a marker line and runs to the next marker or the end.
export function expansionBlocks(blockText, at) {
  const lines = blockText.split(/\r?\n/);
  const starts = lines.flatMap((l, i) => (l.trim() === MARKER ? [i] : []));
  return starts.map((s, k) => {
    const end = k + 1 < starts.length ? starts[k + 1] : lines.length;
    const block = lines.slice(s + 1, end);
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
    const raw = lines.slice(s, end).join('\n').trim();
    return { ...meta, at, text: raw, criteria: listItems(criteria) };
  });
}

const itemKey = (item) => JSON.stringify([item.from, item.by ?? null, item.run ?? null, item.round ?? null, item.text]);
export const itemsHash = (items) => createHash('sha256').update(JSON.stringify(items.map(itemKey))).digest('hex');

function assemble({ tracker, source, id, title, body, blocks }) {
  const items = [
    ...originalCriteria(body).map((t) => ({ from: 'original', text: t })),
    ...blocks.flatMap((b) => b.criteria.map((t) => ({ from: 'expansion', by: b.by, run: b.run, round: b.round, text: t }))),
  ];
  return {
    format: FORMAT,
    tracker,
    source,
    id,
    title,
    items,
    expansions: blocks.map(({ by, run, round, at, text: raw }) => ({ by, run, round, at, text: raw })),
    needsExpansion: items.length === 0,
    sha256: itemsHash(items),
  };
}

export function compare(current, snapshot, against, sha) {
  if (!snapshot || snapshot.format !== FORMAT || !Array.isArray(snapshot.items)) {
    throw new UsageError(`${against} is not a ${FORMAT} snapshot`);
  }
  if (snapshot.id !== current.id || snapshot.tracker !== current.tracker) {
    throw new UsageError(`${against} is the snapshot of ${snapshot.tracker} ${snapshot.id}, not ${current.tracker} ${current.id}`);
  }
  const snapshotIntact = itemsHash(snapshot.items) === String(sha).toLowerCase();
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
  return { against, snapshotIntact, changed: !snapshotIntact || removed.length > 0 || added.length > 0 || reordered, removed, added };
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

export function localAcceptance({ path, text: body, source }) {
  const own = section(scan(body), (t) => /^sorry-matt expansion$/i.test(t));
  const blocks = own ? expansionBlocks(own.map((r) => r.line).join('\n'), '## sorry-matt expansion') : [];
  const title = (/^#\s+(.*)$/m.exec(body) || [])[1] || path;
  return assemble({ tracker: 'local', source, id: path, title: title.trim(), body, blocks });
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
    else if (a === '--sha') opts.sha = value();
    else if (a.startsWith('--')) throw new UsageError(`unknown option ${a}`);
    else opts.positional.push(a);
  }
  if (tracker !== 'github' && tracker !== 'local') throw new UsageError('first argument must be github or local');
  if (opts.positional.length !== 1) throw new UsageError('give exactly one ticket');
  if (tracker === 'local' && opts.repo) throw new UsageError('--repo is github only');
  if (tracker === 'github' && opts.ref) throw new UsageError('--ref is local only');
  if (Boolean(opts.against) !== Boolean(opts.sha)) throw new UsageError('--against and --sha go together');
  if (opts.sha && !/^[0-9a-f]{64}$/i.test(opts.sha)) throw new UsageError('--sha must be a 64-digit hex sha256');
  return { tracker, ticket: opts.positional[0], ...opts };
}

export function defaultDeps(cwd = process.cwd()) {
  return {
    gh: (path) => JSON.parse(run('gh', ['api', path], cwd)),
    git: (args) => run('git', args, cwd),
    readFile: (p) => readFileSync(resolve(cwd, p), 'utf8'),
    cwd,
  };
}

function readLocal(deps, file, ref) {
  const root = canonical(deps.git(['rev-parse', '--show-toplevel']).trim());
  const path = relative(root, canonical(deps.cwd, file)).split(sep).join('/');
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
      const { path, text: body } = readLocal(deps, args.ticket, args.ref);
      result = localAcceptance({ path, text: body, source: args.ref || 'worktree' });
    }
    let code = 0;
    let err = '';
    if (args.against) {
      let snapshot;
      try {
        snapshot = parseJson(deps.readFile(args.against));
      } catch (e) {
        throw new Error(`cannot read snapshot ${args.against}: ${e.message}`);
      }
      result.check = compare(result, snapshot, args.against, args.sha);
      if (!result.check.snapshotIntact) {
        code = 3;
        err = `acceptance: ${args.against} does not match --sha: the snapshot was edited after it was saved\n`;
      }
    }
    return { code, out: `${JSON.stringify(result, null, 2)}\n`, err };
  } catch (e) {
    return failure('acceptance', e);
  }
}

runIfEntry(import.meta.url, main);
