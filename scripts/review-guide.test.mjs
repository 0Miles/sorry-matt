// node --test scripts/review-guide.test.mjs
// Drives review-guide.mjs through main() against a real git repository built the way get-to-work builds a line:
// `--no-ff` ticket merges, a red-light fix branch, a conflict resolved in the merge, a simplify commit and a
// base merge.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { main, readingOrder, subjectIds } from '../src/skills/get-to-work/scripts/review-guide.mjs';

const WEB = 'https://github.com/o/r';

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sorry-matt-guide-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function run(dir, plan) {
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan));
  const r = main([join(dir, 'plan.json')]);
  return { ...r, json: r.out ? JSON.parse(r.out) : null };
}

// A line with tickets #11 (plus its -ci fix), #13, #14, #15 (conflicts with #11), an unlisted ticket merge,
// merges a host wrote by hand (`Merge #20 (+#21): ...`, `Merge #22 fix: ...`, one with no ticket in its subject
// at all), a simplify commit and a merge of the advanced base.
function buildLine(dir) {
  const repo = join(dir, 'repo');
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (f, text) => writeFileSync(join(repo, f), text);
  const commit = (msg) => {
    git('add', '-A');
    git('commit', '-q', '-m', msg);
  };
  const ticket = (branch, from, edits, msgs) => {
    git('switch', '-q', '-c', branch, from);
    edits.forEach((edit, i) => {
      edit();
      commit(msgs[i]);
    });
    git('switch', '-q', 'line');
  };
  const merge = (branch, message) =>
    git('merge', '-q', '--no-ff', ...(message ? ['-m', message] : ['--no-edit']), branch);

  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'test');
  git('config', 'core.autocrlf', 'false');
  write('a.md', 'one\n');
  commit('base');
  const start = git('rev-parse', 'HEAD');
  git('switch', '-q', '-c', 'line');

  ticket('run/11-a', 'line', [() => write('a.md', 'one\ntwo\n'), () => write('b.md', 'b\n')], ['#11: add two', '#11: add b']);
  merge('run/11-a');
  ticket('run/13-c', 'line', [() => write('c.md', 'c\n')], ['#13: add c']);
  merge('run/13-c');
  ticket('run/14-d', 'line', [() => write('d.md', 'd\n')], ['#14: add d']);
  merge('run/14-d');
  // #15 was cut before #11 merged and edits the same line: the merge carries a resolution.
  ticket('run/15-e', start, [() => write('a.md', 'one\nTHREE\n')], ['#15: add three']);
  try {
    merge('run/15-e');
    throw new Error('expected a conflict');
  } catch (e) {
    if (e.message === 'expected a conflict') throw e;
  }
  write('a.md', 'one\ntwo\nTHREE\n');
  git('add', 'a.md');
  git('commit', '-q', '--no-edit');
  ticket('run/11-a-ci', 'line', [() => write('b.md', 'b\nfixed\n')], ['#11: fix CI']);
  merge('run/11-a-ci');
  ticket('run/99-x', 'line', [() => write('x.md', 'x\n')], ['#99: not in the plan']);
  merge('run/99-x');
  ticket('run/20-f', 'line', [() => write('f20.md', 'f\n')], ['#20: add f']);
  merge('run/20-f', 'Merge #20 (+#21): add f');
  ticket('run/22-g', 'line', [() => write('f22.md', 'g\n')], ['#22: add g']);
  merge('run/22-g', 'Merge #22 fix: add g');
  ticket('run/23-h', 'line', [() => write('f23.md', 'h\n')], ['#23: add h']);
  merge('run/23-h', 'Integrate h');
  const integrateH = git('rev-parse', 'HEAD');
  write('c.md', 'C\n');
  commit('refactor: simplify run/line');
  git('switch', '-q', 'main');
  write('m.md', 'm\n');
  commit('main moves');
  git('switch', '-q', 'line');
  merge('main');
  return { repo, git, integrateH };
}

// Building the line takes a few dozen git calls; every test reads the same one.
let shared;
before(() => {
  const dir = mkdtempSync(join(tmpdir(), 'sorry-matt-guide-'));
  shared = { dir, ...buildLine(dir) };
});
after(() => rmSync(shared.dir, { recursive: true, force: true }));

const plan = (repo, extra = {}) => ({
  worktree: repo,
  base: 'main',
  line: 'line',
  web: `${WEB}/`,
  tickets: [
    { id: '#13', branch: 'run/13-c', title: 'C', blockedBy: ['#14', '#404'], statusRecord: `${WEB}/issues/13#issuecomment-1` },
    { id: '#11', branch: 'run/11-a', title: 'A' },
    { id: '#15', branch: 'run/15-e' },
    { id: '#14', branch: 'run/14-d', blockedBy: [] },
    { id: '#20' },
    { id: '#21' },
    { id: '#22' },
    { id: '#23', merges: [shared.integrateH] },
  ],
  ...extra,
});

test('each ticket maps to its merges, its commit range and links; line-level commits stay apart', () => {
  const { dir, repo, git } = shared;
  const r = run(dir, plan(repo));
  assert.equal(r.code, 0, r.err);
  const g = r.json;
  assert.equal(g.format, 'sorry-matt/review-guide@1');
  assert.deepEqual(g.base, { ref: 'main', sha: git('rev-parse', 'main') });
  assert.deepEqual(g.line, { ref: 'line', sha: git('rev-parse', 'line') });

  // Reading order: #13 waits for its blocker #14; otherwise merge order. #404 is not listed and is dropped.
  assert.deepEqual(
    g.tickets.map((x) => [x.order, x.id]),
    [[1, '#11'], [2, '#14'], [3, '#13'], [4, '#15'], [5, '#20'], [6, '#21'], [7, '#22'], [8, '#23']],
  );
  const [a, , c, e, f20, f21, f22, f23] = g.tickets;
  assert.deepEqual(c.blockedBy, ['#14']);
  assert.equal(c.statusRecord, `${WEB}/issues/13#issuecomment-1`);
  assert.equal(c.title, 'C');
  assert.equal(e.title, null);

  // #11: its own merge and the -ci fix merge, each with the second-parent range.
  assert.deepEqual(a.merges.map((m) => [m.matchedBy, m.subject]), [
    ['branch', "Merge branch 'run/11-a' into line"],
    ['branch', "Merge branch 'run/11-a-ci' into line"],
  ]);
  const m = a.merges[0];
  const [p1, p2] = [git('rev-parse', `${m.sha}^1`), git('rev-parse', `${m.sha}^2`)];
  assert.equal(m.range, `${p1}..${p2}`);
  assert.equal(m.compare, `${WEB}/compare/${p1}...${p2}`);
  assert.equal(m.url, `${WEB}/commit/${m.sha}`);
  assert.deepEqual(m.commits.map((x) => x.subject), ['#11: add two', '#11: add b']);
  assert.equal(m.commits[0].url, `${WEB}/commit/${m.commits[0].sha}`);
  assert.deepEqual(m.stat, { files: 2, insertions: 2, deletions: 0 });
  assert.equal(m.resolved, false);
  assert.equal(m.remergeDiff, null);
  assert.deepEqual(a.merges[1].commits.map((x) => x.subject), ['#11: fix CI']);

  // #15: the conflict resolution lives in its merge commit, not in the ticket's commits.
  assert.deepEqual(e.merges[0].commits.map((x) => x.subject), ['#15: add three']);
  assert.deepEqual(e.merges[0].stat, { files: 1, insertions: 1, deletions: 0 });
  assert.equal(e.merges[0].resolved, true);
  assert.equal(e.merges[0].remergeDiff, `git show --remerge-diff ${e.merges[0].sha}`);

  // Hand-written subjects: the leading id and its (+id) alias share one merge; a recorded SHA needs no subject.
  assert.deepEqual([f20, f21, f22, f23].map((x) => x.merges.map((y) => [y.matchedBy, y.subject])), [
    [['id', 'Merge #20 (+#21): add f']],
    [['id', 'Merge #20 (+#21): add f']],
    [['id', 'Merge #22 fix: add g']],
    [['sha', 'Integrate h']],
  ]);
  assert.deepEqual(f20.merges[0].commits.map((x) => x.subject), ['#20: add f']);
  assert.equal(f23.merges[0].sha, shared.integrateH);

  assert.deepEqual(
    g.lineCommits.map((x) => [x.kind, x.subject, x.resolved]),
    [
      ['merge', "Merge branch 'run/99-x' into line", false],
      ['commit', 'refactor: simplify run/line', null],
      ['base-merge', "Merge branch 'main' into line", false],
    ],
  );
  assert.equal(g.lineCommits[1].url, `${WEB}/commit/${g.lineCommits[1].sha}`);

  // The PR diff from the merge base: a.md +2, b.md +2, c.md +1, d.md +1, x.md +1, f20/f22/f23.md +1 each.
  assert.deepEqual(g.size, { files: 8, insertions: 10, deletions: 0, total: 10, threshold: 400, over: false });
  assert.deepEqual(g.missing, []);
  assert.deepEqual(g.warnings, []);
});

test('over the threshold only when the changed lines exceed it', () => {
  const { dir, repo } = shared;
  assert.equal(run(dir, plan(repo, { threshold: 10 })).json.size.over, false);
  assert.equal(run(dir, plan(repo, { threshold: 9 })).json.size.over, true);
});

test('recorded merge SHAs win over subjects, and a SHA off the walk is a warning', () => {
  const { dir, repo, git } = shared;
  const first = git('log', '--first-parent', '--format=%H', '--grep=^Merge branch .run/11-a. ', 'line');
  const simplify = git('rev-parse', 'line^');
  const r = run(dir, { ...plan(repo), tickets: [{ id: '#11', branch: 'run/11-a', merges: [first.slice(0, 10), simplify] }] });
  assert.equal(r.code, 0, r.err);
  const [a] = r.json.tickets;
  assert.deepEqual(a.merges.map((m) => [m.matchedBy, m.sha]), [['sha', first]]);
  assert.ok(
    r.json.lineCommits.some((x) => x.kind === 'merge' && x.subject === "Merge branch 'run/11-a-ci' into line"),
    'with recorded SHAs, the -ci merge is not claimed by its subject',
  );
  assert.deepEqual(r.json.warnings, [`#11: merge ${simplify} is not a two-parent first-parent merge between base and line`]);
});

test('subject ids: the leading id and its (+id) aliases; git default subjects name none', () => {
  assert.deepEqual(subjectIds('Merge #5 (+#6): cut rules'), ['#5', '#6']);
  assert.deepEqual(subjectIds('Merge #11 fix: address review'), ['#11']);
  assert.deepEqual(subjectIds('Merge #7'), ['#7']);
  assert.deepEqual(subjectIds('Merge #8 (+#9, +#10): three at once'), ['#8', '#9', '#10']);
  assert.deepEqual(subjectIds('Merge 0012-local.md: a Local Markdown ticket'), ['0012-local.md']);
  assert.deepEqual(subjectIds("Merge branch 'run/11-a' into line"), []);
  assert.deepEqual(subjectIds('refactor: simplify'), []);
});

test('a listed ticket with no merge on the line exits 3 with the guide still written', () => {
  const { dir, repo } = shared;
  const p = plan(repo);
  p.tickets.push({ id: '#16', branch: 'run/16-never' });
  const r = run(dir, p);
  assert.equal(r.code, 3);
  assert.match(r.err, /no merge on the line for #16/);
  assert.deepEqual(r.json.missing, ['#16']);
  assert.equal(r.json.tickets.at(-1).id, '#16');
  assert.deepEqual(r.json.tickets.at(-1).merges, []);
});

test('a blocker cycle is broken at the earliest merged ticket and warned about', () => {
  const tickets = [
    { id: '#2', blockedBy: ['#1'] },
    { id: '#1', blockedBy: ['#2'] },
    { id: '#3', blockedBy: [] },
  ];
  const key = (x) => ({ '#1': 1, '#2': 0, '#3': 2 })[x.id];
  const { order, warnings } = readingOrder(tickets, key);
  assert.deepEqual(order.map((x) => x.id), ['#3', '#2', '#1']);
  assert.match(warnings[0], /cycle among #2, #1: broken at #2/);
});

test('bad plans exit 2; an unknown ref exits 1', (t) => {
  const dir = scratch(t);
  const ok = { worktree: dir, base: 'main', line: 'line', web: WEB, tickets: [] };
  const cases = [
    [{ ...ok, web: '' }, /web is a non-empty string/],
    [{ ...ok, worktree: undefined }, /worktree is a non-empty string/],
    [{ ...ok, threshold: -1 }, /threshold is a non-negative integer/],
    [{ ...ok, tickets: {} }, /tickets is an array/],
    [{ ...ok, tickets: [{ branch: 'b' }] }, /has no id/],
    [{ ...ok, tickets: [{ id: '#1', branch: '' }] }, /#1\): branch is a non-empty string/],
    [{ ...ok, tickets: [{ id: '#1', merges: 'abc' }] }, /merges is an array of SHAs/],
    [{ ...ok, tickets: [{ id: '#1', branch: 'a' }, { id: '#1', branch: 'b' }] }, /#1 listed twice/],
    [{ ...ok, tickets: [{ id: '#1', branch: 'a' }, { id: '#2', branch: 'a' }] }, /branch a listed twice/],
    [{ ...ok, tickets: [{ id: '#1', branch: 'a', blockedBy: '#2' }] }, /blockedBy is an array/],
  ];
  for (const [p, message] of cases) {
    const r = run(dir, p);
    assert.equal(r.code, 2, JSON.stringify(p));
    assert.match(r.err, message);
  }
  assert.equal(main([]).code, 2);
  writeFileSync(join(dir, 'bad.json'), '{');
  assert.equal(main([join(dir, 'bad.json')]).code, 2);

  const r = run(dir, { ...ok, worktree: shared.repo, line: 'no-such-branch' });
  assert.equal(r.code, 1);
  assert.match(r.err, /^review-guide: /);
});

test('a plan file that starts with a UTF-8 BOM is read like one without', () => {
  const { dir, repo } = shared;
  const file = join(dir, 'bom.plan.json');
  writeFileSync(file, `\uFEFF${JSON.stringify(plan(repo))}`);
  const r = main([file]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.out), run(dir, plan(repo)).json);
});
