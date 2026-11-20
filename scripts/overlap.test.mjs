// node --test scripts/overlap.test.mjs
// Drives overlap.mjs through main() with real plan and list files in a temp dir; the in-flight case uses a real
// git repository with a ticket worktree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { main } from '../src/skills/get-to-work/scripts/overlap.mjs';

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sorry-matt-overlap-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// files: { name: "list text" }; plan refers to lists by name, relative to the plan file.
function run(dir, plan, files = {}) {
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan));
  const r = main([join(dir, 'plan.json')]);
  return { ...r, json: r.code === 0 ? JSON.parse(r.out) : null };
}

test('same-line candidates whose files do not overlap all start together', (t) => {
  const dir = scratch(t);
  const r = run(
    dir,
    { base: 'run/line', candidates: [{ id: '#11', files: 'a.txt' }, { id: '#12', files: 'b.txt' }, { id: '#13', files: 'c.txt' }] },
    { 'a.txt': 'src/skills/a/SKILL.md\n', 'b.txt': 'src/skills/b/\n# a comment\n\nREADME.md\n', 'c.txt': 'docs/x.md\n' },
  );
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.format, 'sorry-matt/overlap@1');
  assert.deepEqual(r.json.start, ['#11', '#12', '#13']);
  assert.deepEqual(r.json.wait, []);
});

test('a candidate overlapping a running prediction waits and names the holder and its own paths', (t) => {
  const dir = scratch(t);
  const r = run(
    dir,
    { base: 'run/line', running: [{ id: '#5', files: 'r.txt' }], candidates: [{ id: '#6', files: 'c6.txt' }, { id: '#7', files: 'c7.txt' }] },
    { 'r.txt': 'src/skills/get-to-work/\n', 'c6.txt': 'src/skills/get-to-work/SKILL.md\nREADME.md\n', 'c7.txt': 'src/skills/get-to-work-extra.md\n' },
  );
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.start, ['#7'], 'a sibling with the same prefix is not inside the directory');
  assert.deepEqual(r.json.wait, [{ id: '#6', overlaps: [{ with: '#5', paths: ['src/skills/get-to-work/SKILL.md'] }] }]);
  assert.deepEqual(r.json.running, [{ id: '#5', base: 'run/line', predicted: ['src/skills/get-to-work'], actual: [], unpredicted: [] }]);
});

test('candidates are taken in order: an earlier start holds its files against later candidates', (t) => {
  const dir = scratch(t);
  const r = run(
    dir,
    { candidates: [{ id: '#2', files: 'x.txt' }, { id: '#3', files: 'y.txt' }, { id: '#4', files: 'z.txt' }] },
    { 'x.txt': 'lib/a.mjs\n', 'y.txt': 'lib\n', 'z.txt': 'test/a.mjs\n' },
  );
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.start, ['#2', '#4']);
  assert.deepEqual(r.json.wait, [{ id: '#3', overlaps: [{ with: '#2', paths: ['lib'] }] }]);
});

test('"/" is the whole repository; paths are normalized', (t) => {
  const dir = scratch(t);
  const r = run(
    dir,
    { running: [{ id: '#1', files: 'all.txt' }], candidates: [{ id: '#2', files: 'one.txt' }] },
    { 'all.txt': '/\n', 'one.txt': '.\\src\\a.md\r\n./src//b/\r\n' },
  );
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.running[0].predicted, ['/']);
  assert.deepEqual(r.json.wait, [{ id: '#2', overlaps: [{ with: '#1', paths: ['src/a.md', 'src/b'] }] }]);
});

test('bad plans exit 2: empty list, absolute or parent paths, duplicate ids, worktree without base', (t) => {
  const dir = scratch(t);
  const cases = [
    [{ candidates: [{ id: '#1', files: 'empty.txt' }] }, /no path/],
    [{ candidates: [{ id: '#1', files: 'abs.txt' }] }, /repo-relative/],
    [{ candidates: [{ id: '#1', files: 'up.txt' }] }, /"\.\." is not allowed/],
    [{ candidates: [{ id: '#1', files: 'ok.txt' }, { id: '#1', files: 'ok.txt' }] }, /listed twice/],
    [{ running: [{ id: '#1', files: 'ok.txt', worktree: dir }] }, /#1 has a worktree but no base/],
    [{ base: '', candidates: [] }, /base is a non-empty string/],
    [{ candidates: [{ id: '#1', files: 'ok.txt', base: 'x' }] }, /only running tickets/],
    [{ candidates: [{ id: '#1', files: 'ok.txt', worktree: dir }] }, /only running tickets/],
    [{ candidates: [{ id: '#1' }] }, /no files list/],
  ];
  const files = { 'empty.txt': '# nothing yet\n\n', 'abs.txt': '/etc/passwd\n', 'up.txt': 'src/../x\n', 'ok.txt': 'a\n' };
  for (const [plan, message] of cases) {
    const r = run(dir, plan, files);
    assert.equal(r.code, 2, JSON.stringify(plan));
    assert.match(r.err, message);
  }
  assert.equal(main([]).code, 2);
  writeFileSync(join(dir, 'bad.json'), '{');
  assert.equal(main([join(dir, 'bad.json')]).code, 2);
});

test('a missing list file exits 1', (t) => {
  const dir = scratch(t);
  const r = run(dir, { candidates: [{ id: '#1', files: 'missing.txt' }] });
  assert.equal(r.code, 1);
  assert.match(r.err, /^overlap: /);
});

test('tickets in flight on other lines hold their files too, each read against its own line', (t) => {
  const dir = scratch(t);
  const r = run(
    dir,
    {
      running: [{ id: '#20', files: 'a.txt', base: 'run/line-a' }, { id: '#30', files: 'b.txt', base: 'run/line-b' }],
      candidates: [{ id: '#21', files: 'c.txt' }, { id: '#31', files: 'd.txt' }],
    },
    { 'a.txt': 'src/a\n', 'b.txt': 'src/b\n', 'c.txt': 'src/b/x.md\n', 'd.txt': 'docs\n' },
  );
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.running.map((x) => x.base), ['run/line-a', 'run/line-b']);
  assert.deepEqual(r.json.start, ['#31']);
  assert.deepEqual(r.json.wait, [{ id: '#21', overlaps: [{ with: '#30', paths: ['src/b/x.md'] }] }]);
});

test('a running worktree holds what it changed since branching, not what the base gained since', (t) => {
  const dir = scratch(t);
  const repo = join(dir, 'repo');
  const wt = join(dir, 'wt');
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['init', '-q', '-b', 'line', repo]);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'test');
  git(repo, 'config', 'core.autocrlf', 'false');
  for (const f of ['a.md', 'b.md', 'c.md', 'old.md']) writeFileSync(join(repo, f), `${f}\n`);
  writeFileSync(join(repo, '.gitignore'), 'build/\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  git(repo, 'worktree', 'add', '-q', '-b', 'ticket', wt);
  // The ticket: a committed edit, a rename, an unstaged edit, an untracked file and an ignored one.
  writeFileSync(join(wt, 'a.md'), 'ticket\n');
  git(wt, 'mv', 'old.md', 'new.md');
  git(wt, 'commit', '-q', '-am', 'ticket work');
  writeFileSync(join(wt, 'b.md'), 'unstaged\n');
  writeFileSync(join(wt, 'fresh.md'), 'untracked\n');
  mkdirSync(join(wt, 'build'));
  writeFileSync(join(wt, 'build', 'out.js'), 'ignored\n');
  // The line moves on after the ticket branched: c.md is not the ticket's.
  writeFileSync(join(repo, 'c.md'), 'merged elsewhere\n');
  git(repo, 'commit', '-q', '-am', 'another ticket merged');
  // A second line, cut from the first commit, with its own ticket in flight on d.md.
  const wt2 = join(dir, 'wt2');
  git(repo, 'branch', 'other', 'HEAD~1');
  git(repo, 'worktree', 'add', '-q', '-b', 'ticket2', wt2, 'other');
  writeFileSync(join(wt2, 'd.md'), 'other line\n');

  const r = run(
    dir,
    {
      base: 'line',
      running: [{ id: '#8', files: 'p8.txt', worktree: wt }, { id: '#12', files: 'p12.txt', worktree: wt2, base: 'other' }],
      candidates: [{ id: '#9', files: 'p9.txt' }, { id: '#10', files: 'p10.txt' }, { id: '#11', files: 'p11.txt' }, { id: '#13', files: 'p13.txt' }],
    },
    { 'p8.txt': 'a.md\n', 'p9.txt': 'fresh.md\n', 'p10.txt': 'c.md\n', 'p11.txt': 'old.md\n', 'p12.txt': 'e.md\n', 'p13.txt': 'd.md\n' },
  );
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.running, [
    { id: '#8', base: 'line', predicted: ['a.md'], actual: ['a.md', 'b.md', 'fresh.md', 'new.md', 'old.md'], unpredicted: ['b.md', 'fresh.md', 'new.md', 'old.md'] },
    { id: '#12', base: 'other', predicted: ['e.md'], actual: ['d.md'], unpredicted: ['d.md'] },
  ]);
  assert.deepEqual(r.json.start, ['#10']);
  assert.deepEqual(r.json.wait.map((w) => w.id), ['#9', '#11', '#13']);

  const missing = run(dir, { base: 'line', running: [{ id: '#8', files: 'p8.txt', worktree: join(dir, 'nope') }] });
  assert.equal(missing.code, 1);
});

test('a plan file that starts with a UTF-8 BOM is read', (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, 'a.txt'), 'a.md\n');
  writeFileSync(join(dir, 'plan.json'), `\uFEFF${JSON.stringify({ base: 'run/line', candidates: [{ id: '#11', files: 'a.txt' }] })}`);
  const r = main([join(dir, 'plan.json')]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.out).start, ['#11']);
});

// ---------- path#symbol ----------

test('path#symbol: the same path with disjoint symbols does not overlap; the same symbol does', (t) => {
  const dir = scratch(t);
  const r = run(
    dir,
    {
      running: [{ id: '#1', files: 'r.txt' }],
      candidates: [{ id: '#2', files: 'c2.txt' }, { id: '#3', files: 'c3.txt' }, { id: '#4', files: 'c4.txt' }],
    },
    {
      'r.txt': 'src/tick.mjs#nextActions\n',
      'c2.txt': 'src/tick.mjs#record\n',
      'c3.txt': 'src/tick.mjs#nextActions\n',
      'c4.txt': 'SKILL.md#2. 判斷\nsrc/tick.mjs#record\n',
    },
  );
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.running[0].predicted, ['src/tick.mjs#nextActions']);
  assert.deepEqual(r.json.start, ['#2']);
  assert.deepEqual(r.json.wait, [
    { id: '#3', overlaps: [{ with: '#1', paths: ['src/tick.mjs#nextActions'] }] },
    { id: '#4', overlaps: [{ with: '#2', paths: ['src/tick.mjs#record'] }] },
  ]);
});

test('path#symbol: a path without a symbol is the whole file on either side', (t) => {
  const dir = scratch(t);
  const r = run(
    dir,
    {
      running: [{ id: '#1', files: 'whole.txt' }, { id: '#2', files: 'sym.txt' }],
      candidates: [{ id: '#3', files: 'c3.txt' }, { id: '#4', files: 'c4.txt' }, { id: '#5', files: 'c5.txt' }],
    },
    {
      'whole.txt': 'a.md\n',
      'sym.txt': 'b.md#Usage\n',
      'c3.txt': 'a.md#Intro\n', // a symbol inside a file held whole
      'c4.txt': 'b.md\n', // the whole file against a held symbol
      'c5.txt': 'docs#Intro\n', // a symbol under a directory: the directory is held by nobody
    },
  );
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.start, ['#5']);
  assert.deepEqual(r.json.wait, [
    { id: '#3', overlaps: [{ with: '#1', paths: ['a.md#Intro'] }] },
    { id: '#4', overlaps: [{ with: '#2', paths: ['b.md'] }] },
  ]);
});

test('path#symbol: a nested symbol is written from the outermost one, and the outer one covers it', (t) => {
  const dir = scratch(t);
  const r = run(
    dir,
    { running: [{ id: '#1', files: 'r.txt' }], candidates: [{ id: '#2', files: 'c2.txt' }, { id: '#3', files: 'c3.txt' }] },
    {
      'r.txt': 'SKILL.md#2. 判斷#預計檔案\n',
      'c2.txt': 'SKILL.md#2. 判斷\n', // the parent section holds its subsections
      'c3.txt': 'SKILL.md#2. 判斷#集中修正\nSKILL.md # 1. 喚醒 \n', // a sibling subsection; spaces around # are trimmed
    },
  );
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.start, ['#3']);
  assert.deepEqual(r.json.wait, [{ id: '#2', overlaps: [{ with: '#1', paths: ['SKILL.md#2. 判斷'] }] }]);
});

test('path#symbol: a symbol on "/" or an empty symbol exits 2', (t) => {
  const dir = scratch(t);
  for (const [text, message] of [['/#x\n', /whole repository has no symbol/], ['a.md#\n', /empty symbol/], ['a.md#x##y\n', /empty symbol/]]) {
    const r = run(dir, { candidates: [{ id: '#1', files: 'bad.txt' }] }, { 'bad.txt': text });
    assert.equal(r.code, 2, text);
    assert.match(r.err, message);
  }
});

test('path#symbol: a running worktree that changed a file it predicted by symbol holds only those symbols', (t) => {
  const dir = scratch(t);
  const repo = join(dir, 'repo');
  const wt = join(dir, 'wt');
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['init', '-q', '-b', 'line', repo]);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'test');
  for (const f of ['a.md', 'b.md']) writeFileSync(join(repo, f), `${f}\n`);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  git(repo, 'worktree', 'add', '-q', '-b', 'ticket', wt);
  writeFileSync(join(wt, 'a.md'), 'ticket\n');
  writeFileSync(join(wt, 'b.md'), 'ticket\n');

  const r = run(
    dir,
    {
      base: 'line',
      running: [{ id: '#1', files: 'p1.txt', worktree: wt }],
      candidates: [{ id: '#2', files: 'p2.txt' }, { id: '#3', files: 'p3.txt' }],
    },
    { 'p1.txt': 'a.md#Intro\n', 'p2.txt': 'a.md#Usage\n', 'p3.txt': 'b.md#Usage\n' },
  );
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.running, [
    { id: '#1', base: 'line', predicted: ['a.md#Intro'], actual: ['a.md', 'b.md'], unpredicted: ['b.md'] },
  ]);
  assert.deepEqual(r.json.start, ['#2'], 'a.md is changed where the ticket said it would be');
  assert.deepEqual(r.json.wait, [{ id: '#3', overlaps: [{ with: '#1', paths: ['b.md#Usage'] }] }]);
});
