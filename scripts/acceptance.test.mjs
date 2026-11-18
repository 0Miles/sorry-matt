// node --test scripts/acceptance.test.mjs
// GitHub cases drive the script through its `gh` seam with fixtures; nothing calls the real GitHub.
// Local Markdown cases use in-memory text, plus one real git repository in a temp dir for --ref and --against.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { githubAcceptance, localAcceptance, compare, main, defaultDeps } from '../src/skills/get-to-work/scripts/acceptance.mjs';

const REPO = 'acme/app';

// `issues` maps a number to { title, body, comments: [body...] }; comments come back 100 per page.
function fakeGh(issues) {
  const calls = [];
  const gh = (path) => {
    calls.push(path);
    const comments = /^repos\/acme\/app\/issues\/(\d+)\/comments\?per_page=100&page=(\d+)$/.exec(path);
    const one = /^repos\/acme\/app\/issues\/(\d+)$/.exec(path);
    const issue = issues[Number((comments || one || [])[1])];
    if (!issue) {
      const e = new Error('Command failed: gh api');
      e.stderr = 'gh: Not Found (HTTP 404)';
      throw e;
    }
    if (one) return { number: Number(one[1]), title: issue.title, body: issue.body };
    const page = Number(comments[2]);
    return issue.comments
      .map((body, i) => ({ body, html_url: `https://github.com/${REPO}/issues/${comments[1]}#issuecomment-${i + 1}` }))
      .slice((page - 1) * 100, page * 100);
  };
  return { gh, calls };
}

const BODY = `## What to build

Users can export.

## Acceptance criteria

- [ ] Export writes a CSV
- [x] The header row lists every column,
  in table order
- [ ] Empty tables export a header only

## Blocked by

- #3
`;

const EXPANSION = `<!-- sorry-matt:expansion -->
by: expansion-agent
run: issue-4-automation
round: 2

acceptance:
- [ ] Export of 10k rows finishes under 2 s
- [ ] A cell with a comma is quoted

rulings:
| # | decision | reason | cost to reverse | evidence |
| --- | --- | --- | --- | --- |
| 1 | seam: exportTable() | highest public seam | one test file | src/export.ts |
`;

const STATUS = `<!-- sorry-matt:status -->
- [ ] not a criterion: the implementer's own record
`;

test('github: original criteria come from the acceptance section, expansion criteria from the marked comment', () => {
  const { gh } = fakeGh({ 7: { title: 'Export', body: BODY, comments: ['looks good', EXPANSION, STATUS] } });
  const out = githubAcceptance({ repo: REPO, ticket: '#7', gh });
  const expansion = { from: 'expansion', by: 'expansion-agent', run: 'issue-4-automation', round: '2' };
  assert.deepEqual(out.items, [
    { from: 'original', text: 'Export writes a CSV' },
    { from: 'original', text: 'The header row lists every column, in table order' },
    { from: 'original', text: 'Empty tables export a header only' },
    { ...expansion, text: 'Export of 10k rows finishes under 2 s' },
    { ...expansion, text: 'A cell with a comma is quoted' },
  ]);
  assert.deepEqual(out.expansions, [
    { by: 'expansion-agent', run: 'issue-4-automation', round: '2', at: `https://github.com/${REPO}/issues/7#issuecomment-2` },
  ]);
  assert.equal(out.format, 'sorry-matt/acceptance@1');
  assert.equal(out.id, '#7');
  assert.equal(out.title, 'Export');
  assert.equal(out.needsExpansion, false);
  assert.match(out.sha256, /^[0-9a-f]{64}$/);
});

test('github: a ticket with only scope and blockers needs expansion', () => {
  const { gh } = fakeGh({ 8: { title: 'Later', body: '## What to build\n\nScope only.\n\n## Blocked by\n\n- #7\n', comments: [] } });
  const out = githubAcceptance({ repo: REPO, ticket: `https://github.com/${REPO}/issues/8`, gh });
  assert.deepEqual(out.items, []);
  assert.equal(out.needsExpansion, true);
});

test('github: a Chinese acceptance heading is read; a marker that is not the first line does not make an expansion', () => {
  const body = '## 問題\n\n- 不是驗收\n\n## 驗收\n\n- [ ] 第一項\n- [ ] 第二項\n\n## 依據\n\n- 連結\n';
  const quoted = `> earlier note\n${EXPANSION}`;
  const { gh } = fakeGh({ 9: { title: 'Zh', body, comments: [quoted] } });
  const out = githubAcceptance({ repo: REPO, ticket: '9', gh });
  assert.deepEqual(out.items.map((i) => i.text), ['第一項', '第二項']);
  assert.deepEqual(out.expansions, []);
});

test('github: comments are read past the first page', () => {
  const comments = Array.from({ length: 100 }, (_, i) => `comment ${i}`).concat([EXPANSION]);
  const { gh, calls } = fakeGh({ 7: { title: 'Export', body: BODY, comments } });
  const out = githubAcceptance({ repo: REPO, ticket: '7', gh });
  assert.equal(out.items.filter((i) => i.from === 'expansion').length, 2);
  assert.ok(calls.includes('repos/acme/app/issues/7/comments?per_page=100&page=2'));
});

const LOCAL = `# 03: Export

**What to build:** export a table.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Export writes a CSV
- [ ] Empty tables export a header only

## sorry-matt expansion

${EXPANSION}
## sorry-matt status

- [ ] implementer's notes are not criteria
`;

test('local: checkboxes outside the sorry-matt sections are original; the expansion section adds its own', () => {
  const out = localAcceptance({ path: '.scratch/x/issues/03-export.md', text: LOCAL, source: 'worktree' });
  assert.deepEqual(
    out.items.map((i) => [i.from, i.text]),
    [
      ['original', 'Export writes a CSV'],
      ['original', 'Empty tables export a header only'],
      ['expansion', 'Export of 10k rows finishes under 2 s'],
      ['expansion', 'A cell with a comma is quoted'],
    ],
  );
  assert.deepEqual(out.expansions, [{ by: 'expansion-agent', run: 'issue-4-automation', round: '2', at: '## sorry-matt expansion' }]);
  assert.equal(out.title, '03: Export');
});

test('compare: ticking a box is not a change; rewording, dropping, adding and reordering are', () => {
  const at = (text) => localAcceptance({ path: 't.md', text, source: 'worktree' });
  const before = at('- [ ] A\n- [ ] B\n');
  assert.equal(compare(at('- [x] A\n- [X] B\n'), before, 's.json').changed, false);

  const reworded = compare(at('- [ ] A\n- [ ] B, mostly\n'), before, 's.json');
  assert.equal(reworded.changed, true);
  assert.deepEqual(reworded.removed, [{ from: 'original', text: 'B' }]);
  assert.deepEqual(reworded.added, [{ from: 'original', text: 'B, mostly' }]);

  assert.deepEqual(compare(at('- [ ] A\n'), before, 's.json').removed, [{ from: 'original', text: 'B' }]);
  assert.deepEqual(compare(at('- [ ] A\n- [ ] B\n- [ ] B\n'), before, 's.json').added, [{ from: 'original', text: 'B' }]);

  const reordered = compare(at('- [ ] B\n- [ ] A\n'), before, 's.json');
  assert.deepEqual([reordered.changed, reordered.removed, reordered.added], [true, [], []]);
});

test('compare: moving a criterion from the expansion into the ticket body is a change', () => {
  const { gh } = fakeGh({
    7: { title: 'Export', body: BODY, comments: [EXPANSION] },
    17: { title: 'Export', body: BODY.replace('- [ ] Empty', '- [ ] A cell with a comma is quoted\n- [ ] Empty'), comments: [EXPANSION.replace(/- \[ \] A cell.*\n/, '')] },
  });
  const before = githubAcceptance({ repo: REPO, ticket: '7', gh });
  const after = { ...githubAcceptance({ repo: REPO, ticket: '17', gh }), id: '#7' };
  const result = compare(after, before, 's.json');
  assert.equal(result.changed, true);
  assert.deepEqual(result.removed.map((i) => i.from), ['expansion']);
  assert.deepEqual(result.added.map((i) => i.from), ['original']);
});

test('cli: bad arguments and a snapshot of another ticket exit 2; an unreadable issue exits 1', () => {
  const { gh } = fakeGh({ 7: { title: 'Export', body: BODY, comments: [] } });
  const deps = { gh, readFile: () => JSON.stringify({ format: 'sorry-matt/acceptance@1', tracker: 'github', id: '#8', items: [] }) };
  assert.equal(main(['github', '7'], deps).code, 2);
  assert.equal(main(['github', '--repo', REPO, '7', '8'], deps).code, 2);
  assert.equal(main(['local', '--repo', REPO, 't.md'], deps).code, 2);
  assert.equal(main(['github', '--repo', REPO, '--ref', 'main', '7'], deps).code, 2);
  assert.equal(main(['github', '--repo', REPO, 'https://github.com/other/repo/issues/7'], deps).code, 2);
  const other = main(['github', '--repo', REPO, '7', '--against', 's.json'], deps);
  assert.equal(other.code, 2);
  assert.match(other.err, /snapshot of github #8/);
  assert.equal(main(['github', '--repo', REPO, '99'], deps).code, 1);
});

test('cli local: a snapshot taken on the integration branch is checked against the ticket branch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acceptance-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    git('init', '-q', '-b', 'line');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 't');
    git('config', 'core.autocrlf', 'false');
    mkdirSync(join(dir, '.scratch/x/issues'), { recursive: true });
    const file = '.scratch/x/issues/03-export.md';
    writeFileSync(join(dir, file), LOCAL);
    git('add', '.');
    git('commit', '-q', '-m', 'expand 03');
    git('checkout', '-q', '-b', 'ticket');

    const deps = defaultDeps(dir);
    const snap = main(['local', '--ref', 'line', file], deps);
    assert.equal(snap.code, 0, snap.err);
    writeFileSync(join(dir, 'snap.json'), snap.out);

    // The implementer writes its status record and ticks a box: not a change.
    writeFileSync(join(dir, file), `${LOCAL.replace('- [ ] Export writes', '- [x] Export writes')}- [ ] more notes\n`);
    git('commit', '-q', '-am', 'status');
    const same = JSON.parse(main(['local', '--ref', 'ticket', file, '--against', 'snap.json'], deps).out);
    assert.equal(same.check.changed, false);
    assert.equal(same.source, 'ticket');

    // The implementer drops an expansion criterion it could not meet: a change.
    writeFileSync(join(dir, file), LOCAL.replace('- [ ] A cell with a comma is quoted\n', ''));
    git('commit', '-q', '-am', 'drop');
    const dropped = JSON.parse(main(['local', '--ref', 'ticket', file, '--against', 'snap.json'], deps).out);
    assert.equal(dropped.check.changed, true);
    assert.deepEqual(dropped.check.removed.map((i) => i.text), ['A cell with a comma is quoted']);

    // Without --ref the working tree is read.
    assert.equal(JSON.parse(main(['local', file], deps).out).source, 'worktree');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
