// node --test scripts/deadline.test.mjs
// Drives deadline.mjs through main(). Fingerprints come from real git repositories built in a temp dir, with every
// git setting that could change a tree pinned by the test; times are fixed with --now, never by sleeping.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { main } from '../src/skills/get-to-work/scripts/deadline.mjs';

// Nothing a tree depends on is inherited from the machine: no system or global config, no system attributes, and
// (in repo() below) a fixed object format and an empty init template. The script's own git calls run in this
// process, so they see the same environment.
const pinned = mkdtempSync(join(tmpdir(), 'sorry-matt-deadline-pin-'));
after(() => rmSync(pinned, { recursive: true, force: true }));
mkdirSync(join(pinned, 'template'));
writeFileSync(join(pinned, 'gitconfig'), '');
Object.assign(process.env, { GIT_CONFIG_NOSYSTEM: '1', GIT_ATTR_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(pinned, 'gitconfig') });

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sorry-matt-deadline-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const put = (dir, name, text) => {
  mkdirSync(join(dir, name, '..'), { recursive: true });
  writeFileSync(join(dir, name), text);
};

// A repository with one commit: `.gitignore` ("*.log\n") and `a.txt` ("alpha\n"). Line endings, file modes and
// ignore rules do not depend on the machine.
function repo(t) {
  const dir = scratch(t);
  git(dir, 'init', '-q', '-b', 'main', '--object-format=sha1', `--template=${join(pinned, 'template')}`);
  for (const [k, v] of [
    ['user.name', 'test'],
    ['user.email', 'test@example.invalid'],
    ['core.autocrlf', 'false'],
    ['core.safecrlf', 'false'],
    ['core.fileMode', 'false'],
    ['core.excludesFile', join(dir, '.git', 'no-such-excludes')],
    ['core.attributesFile', join(dir, '.git', 'no-such-attributes')],
    ['commit.gpgsign', 'false'],
  ]) git(dir, 'config', k, v);
  put(dir, '.gitignore', '*.log\n');
  put(dir, 'a.txt', 'alpha\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'first');
  return dir;
}

const call = (argv) => {
  const r = main(argv);
  return { ...r, json: r.code === 0 ? JSON.parse(r.out) : null };
};
const NOW = '2026-03-10T12:00:00Z';
const record = (dir, now = NOW, limit = '30') => {
  const r = call(['record', '--worktree', dir, '--limit', limit, '--now', now]);
  assert.equal(r.code, 0, r.err);
  return r.json;
};
const print = (dir) => record(dir).fingerprint;
const plan = (dir, body) => {
  const path = join(dir, 'plan.json');
  writeFileSync(path, JSON.stringify(body));
  return path;
};
function scanOf(t, body, now) {
  const dir = scratch(t);
  const r = call(['scan', plan(dir, body), ...(now ? ['--now', now] : [])]);
  assert.equal(r.code, 0, r.err);
  return r.json;
}
function progressOf(t, body) {
  const dir = scratch(t);
  const r = call(['progress', plan(dir, body)]);
  assert.equal(r.code, 0, r.err);
  return r.json;
}

// --- record ----------------------------------------------------------------------------------------------------

test('record: assigned time, limit, deadline = assigned + limit, extended "no" and the fingerprint', (t) => {
  const dir = repo(t);
  const r = record(dir, '2026-03-10T12:00:00Z', '30');
  assert.deepEqual(r, {
    format: 'sorry-matt/deadline@1',
    command: 'record',
    assigned: '2026-03-10T12:00:00Z',
    limit: 30,
    deadline: '2026-03-10T12:30:00Z',
    extended: 'no',
    fingerprint: { head: git(dir, 'rev-parse', 'HEAD').trim(), tree: '465de65c84dc85ae87717f0c32d5eed4162a41ec' },
  });
});

test('record: a deadline that crosses midnight, a month end and a year end', (t) => {
  const dir = repo(t);
  assert.equal(record(dir, '2026-03-10T23:50:30Z', '20').deadline, '2026-03-11T00:10:30Z');
  assert.equal(record(dir, '2026-12-31T23:45:00Z', '15').deadline, '2027-01-01T00:00:00Z');
  assert.equal(record(dir, '2028-02-28T23:00:00Z', '90').deadline, '2028-02-29T00:30:00Z');
});

test('record: without --now the times are the system clock, in whole seconds', (t) => {
  const dir = repo(t);
  const before = Math.floor(Date.now() / 1000) * 1000;
  const r = call(['record', '--worktree', dir, '--limit', '5']);
  const after = Date.now();
  assert.equal(r.code, 0, r.err);
  assert.match(r.json.assigned, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  const assigned = Date.parse(r.json.assigned);
  assert.ok(assigned >= before && assigned <= after);
  assert.equal(Date.parse(r.json.deadline) - assigned, 5 * 60 * 1000);
});

test('record: the real index and the working tree are untouched and no temporary index is left', (t) => {
  const dir = repo(t);
  put(dir, 'staged.txt', 'staged\n');
  git(dir, 'add', 'staged.txt');
  put(dir, 'staged.txt', 'staged, then changed\n');
  put(dir, 'a.txt', 'alpha, unstaged\n');
  put(dir, 'new/untracked.txt', 'untracked\n');
  const before = git(dir, 'status', '--porcelain');
  const staged = git(dir, 'diff', '--cached');
  record(dir);
  assert.equal(git(dir, 'status', '--porcelain'), before);
  assert.equal(git(dir, 'diff', '--cached'), staged);
  assert.deepEqual(readdirSync(join(dir, '.git')).filter((f) => /fingerprint/.test(f)), []);
});

test('fingerprint: the tree of a pinned fixture is one literal hash on every platform', (t) => {
  const dir = repo(t);
  put(dir, 'a.txt', 'alpha two\n'); // tracked, changed, not staged
  put(dir, 'dir/b.txt', 'bravo\n'); // untracked, in an untracked directory
  put(dir, 'x.log', 'ignored\n');
  // From `git hash-object` and `git mktree` over .gitignore, a.txt ("alpha two\n") and dir/b.txt, by hand.
  assert.equal(print(dir).tree, '5fc608bedf2563acbc143f99ca0a661345d78369');
});

test('fingerprint: the tree changes when an untracked file changes content', (t) => {
  const dir = repo(t);
  put(dir, 'u.txt', 'one\n');
  const a = print(dir);
  put(dir, 'u.txt', 'two\n');
  const b = print(dir);
  assert.notEqual(b.tree, a.tree);
  assert.equal(b.head, a.head);
});

test('fingerprint: the tree changes when a new file lands in an untracked directory', (t) => {
  const dir = repo(t);
  put(dir, 'fresh/one.txt', 'one\n');
  const a = print(dir);
  put(dir, 'fresh/two.txt', 'two\n');
  assert.notEqual(print(dir).tree, a.tree);
});

test('fingerprint: the tree changes when a staged file is changed again', (t) => {
  const dir = repo(t);
  put(dir, 's.txt', 'staged\n');
  git(dir, 'add', 's.txt');
  const a = print(dir);
  put(dir, 's.txt', 'staged, then changed\n');
  assert.notEqual(print(dir).tree, a.tree);
});

test('fingerprint: the tree changes on an unstaged change to a tracked file', (t) => {
  const dir = repo(t);
  const a = print(dir);
  put(dir, 'a.txt', 'alpha, edited\n');
  assert.notEqual(print(dir).tree, a.tree);
});

test('fingerprint: head changes after a new commit', (t) => {
  const dir = repo(t);
  const a = print(dir);
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'second');
  const b = print(dir);
  assert.notEqual(b.head, a.head);
  assert.equal(b.head, git(dir, 'rev-parse', 'HEAD').trim());
  assert.equal(b.tree, a.tree, 'an empty commit changes no file');
});

test('fingerprint: ignored files, changed or new, leave head and tree alone', (t) => {
  const dir = repo(t);
  put(dir, 'run.log', 'first\n');
  const a = print(dir);
  put(dir, 'run.log', 'second\n');
  assert.deepEqual(print(dir), a);
  put(dir, 'deep/other.log', 'new\n');
  assert.deepEqual(print(dir), a);
});

test('record: an expansion agent records the expansions count of each ticket and reads no worktree', () => {
  const r = main(['record', '--expansions', '#12=0', '--expansions', '#13=2', '--limit', '15', '--now', NOW], {
    read: () => assert.fail('read a file'),
    git: () => assert.fail('called git'),
    clock: () => assert.fail('read the clock'),
  });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.out), {
    format: 'sorry-matt/deadline@1',
    command: 'record',
    assigned: '2026-03-10T12:00:00Z',
    limit: 15,
    deadline: '2026-03-10T12:15:00Z',
    extended: 'no',
    fingerprint: { expansions: { '#12': 0, '#13': 2 } },
  });
});

test('record: bad arguments exit 2', (t) => {
  const dir = repo(t);
  for (const argv of [
    ['record', '--limit', '30'],
    ['record', '--worktree', dir],
    ['record', '--worktree', dir, '--limit', '0'],
    ['record', '--worktree', dir, '--limit', '1.5'],
    ['record', '--worktree', dir, '--expansions', '#1=0', '--limit', '30'],
    ['record', '--worktree', dir, '--limit', '30', '--now', '2026-03-10 12:00:00'],
    ['record', '--worktree', dir, '--limit', '30', '--now', '2026-03-10T12:00:00.000Z'],
    ['record', '--expansions', '#1', '--limit', '30'],
    ['record', '--worktree', dir, '--limit', '30', '--bogus', 'x'],
    ['nothing'],
    [],
  ]) assert.equal(main(argv).code, 2, argv.join(' '));
});

test('record: a worktree git cannot read exits 1', (t) => {
  const dir = scratch(t); // not a repository
  const r = main(['record', '--worktree', dir, '--limit', '30', '--now', NOW]);
  assert.equal(r.code, 1);
  assert.equal(r.out, '');
});

// --- scan ------------------------------------------------------------------------------------------------------

const expander = (id, deadline, was, is, extended = 'no') => ({
  id,
  assigned: '2026-03-10T11:00:00Z',
  limit: 15,
  deadline,
  extended,
  fingerprint: { expansions: was },
  expansions: is,
});
// An agent assigned in `dir` at 11:00 with a 30-minute limit: overdue at NOW (12:00).
const assignedIn = (dir, id = 'agent-1') => {
  const r = record(dir, '2026-03-10T11:00:00Z', '30');
  return { id, assigned: r.assigned, limit: r.limit, deadline: r.deadline, extended: r.extended, fingerprint: r.fingerprint, worktree: dir };
};

test('scan: only a deadline earlier than now is overdue; equal is not, and an agent on time has no action', (t) => {
  const r = scanOf(
    t,
    {
      agents: [
        expander('late', '2026-03-10T11:59:59Z', { '#1': 0 }, { '#1': 0 }),
        expander('exact', '2026-03-10T12:00:00Z', { '#2': 0 }, { '#2': 0 }),
        expander('early', '2026-03-10T12:00:01Z', { '#3': 0 }, { '#3': 0 }),
      ],
    },
    NOW,
  );
  assert.equal(r.format, 'sorry-matt/deadline@1');
  assert.equal(r.command, 'scan');
  assert.equal(r.now, NOW);
  assert.deepEqual(r.agents.map((a) => [a.id, a.overdue, a.action]), [
    ['late', true, 'stop'],
    ['exact', false, null],
    ['early', false, null],
  ]);
  assert.deepEqual(r.agents[1], { id: 'exact', overdue: false, action: null, deadline: '2026-03-10T12:00:00Z', extended: 'no', fingerprint: null, error: null });
});

test('scan: the plan\'s `now` is used when --now is absent, and --now wins over it', (t) => {
  const agents = [expander('x', '2026-03-10T12:30:00Z', { '#1': 0 }, { '#1': 0 })];
  assert.equal(scanOf(t, { now: '2026-03-10T12:10:00Z', agents }).agents[0].overdue, false);
  assert.equal(scanOf(t, { now: '2026-03-10T13:00:00Z', agents }).agents[0].overdue, true);
  assert.equal(scanOf(t, { now: '2026-03-10T13:00:00Z', agents }, '2026-03-10T12:10:00Z').agents[0].overdue, false);
});

test('scan: overdue, not extended, a new commit (head differs) → extend to now + the same limit', (t) => {
  const dir = repo(t);
  const agent = assignedIn(dir);
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'work');
  const r = scanOf(t, { agents: [agent] }, NOW);
  const head = git(dir, 'rev-parse', 'HEAD').trim();
  assert.notEqual(head, agent.fingerprint.head);
  assert.deepEqual(r.agents, [
    {
      id: 'agent-1',
      overdue: true,
      action: 'extend',
      deadline: '2026-03-10T12:30:00Z',
      extended: 'yes',
      fingerprint: { assigned: agent.fingerprint, current: { head, tree: agent.fingerprint.tree } },
      error: null,
    },
  ]);
});

test('scan: overdue, not extended, the working tree changed (tree differs) → extend', (t) => {
  const dir = repo(t);
  const agent = assignedIn(dir);
  put(dir, 'wip.txt', 'half done\n');
  const [a] = scanOf(t, { agents: [agent] }, '2026-03-10T23:45:00Z').agents;
  assert.equal(a.action, 'extend');
  assert.equal(a.deadline, '2026-03-11T00:15:00Z');
  assert.equal(a.extended, 'yes');
  assert.equal(a.fingerprint.current.head, agent.fingerprint.head);
  assert.notEqual(a.fingerprint.current.tree, agent.fingerprint.tree);
});

test('scan: overdue, not extended, the fingerprint is the same → stop, deadline and extended unchanged', (t) => {
  const dir = repo(t);
  const agent = assignedIn(dir);
  const r = scanOf(t, { agents: [agent] }, NOW);
  assert.deepEqual(r.agents, [
    {
      id: 'agent-1',
      overdue: true,
      action: 'stop',
      deadline: '2026-03-10T11:30:00Z',
      extended: 'no',
      fingerprint: { assigned: agent.fingerprint, current: agent.fingerprint },
      error: null,
    },
  ]);
});

test('scan: overdue and already extended → stop, even when the fingerprint changed', (t) => {
  const dir = repo(t);
  const agent = { ...assignedIn(dir), extended: 'yes' };
  put(dir, 'wip.txt', 'more\n');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'work');
  const [a] = scanOf(t, { agents: [agent] }, NOW).agents;
  assert.equal(a.action, 'stop');
  assert.equal(a.extended, 'yes');
  assert.equal(a.deadline, '2026-03-10T11:30:00Z');
  assert.notEqual(a.fingerprint.current.head, agent.fingerprint.head);
  assert.notEqual(a.fingerprint.current.tree, agent.fingerprint.tree);
});

test('scan: an expansion agent progresses when any of its tickets has more expansions → extend', (t) => {
  const r = scanOf(t, { agents: [expander('exp', '2026-03-10T11:15:00Z', { '#1': 0, '#2': 1 }, { '#1': 0, '#2': 2 })] }, NOW);
  assert.deepEqual(r.agents, [
    {
      id: 'exp',
      overdue: true,
      action: 'extend',
      deadline: '2026-03-10T12:15:00Z',
      extended: 'yes',
      fingerprint: { assigned: { expansions: { '#1': 0, '#2': 1 } }, current: { expansions: { '#1': 0, '#2': 2 } } },
      error: null,
    },
  ]);
});

test('scan: an expansion agent with no ticket above its recorded count → stop', (t) => {
  const r = scanOf(t, { agents: [expander('exp', '2026-03-10T11:15:00Z', { '#1': 0, '#2': 1 }, { '#1': 0, '#2': 1 })] }, NOW);
  assert.equal(r.agents[0].action, 'stop');
  assert.deepEqual(r.agents[0].fingerprint, {
    assigned: { expansions: { '#1': 0, '#2': 1 } },
    current: { expansions: { '#1': 0, '#2': 1 } },
  });
});

test('scan: an extended expansion agent stops even with more expansions', (t) => {
  const r = scanOf(t, { agents: [expander('exp', '2026-03-10T11:15:00Z', { '#1': 0 }, { '#1': 1 }, 'yes')] }, NOW);
  assert.equal(r.agents[0].action, 'stop');
});

test('scan: fallback seconds are the raw delay; scheduleWakeup is clamped to 60–3600', (t) => {
  const one = (deadline) => scanOf(t, { agents: [expander('x', deadline, { '#1': 0 }, { '#1': 0 })] }, NOW).fallback;
  assert.deepEqual(one('2026-03-10T12:00:30Z'), { deadline: '2026-03-10T12:00:30Z', seconds: 30, scheduleWakeup: 60 });
  assert.deepEqual(one('2026-03-10T12:10:00Z'), { deadline: '2026-03-10T12:10:00Z', seconds: 600, scheduleWakeup: 600 });
  assert.deepEqual(one('2026-03-10T13:23:20Z'), { deadline: '2026-03-10T13:23:20Z', seconds: 5000, scheduleWakeup: 3600 });
  assert.deepEqual(one('2026-03-10T12:01:00Z'), { deadline: '2026-03-10T12:01:00Z', seconds: 60, scheduleWakeup: 60 });
  assert.deepEqual(one('2026-03-10T13:00:00Z'), { deadline: '2026-03-10T13:00:00Z', seconds: 3600, scheduleWakeup: 3600 });
});

test('scan: fallback takes the earliest deadline still in flight — extended ones at their new deadline, stopped ones out', (t) => {
  const r = scanOf(
    t,
    {
      agents: [
        expander('stopped', '2026-03-10T11:00:00Z', { '#1': 0 }, { '#1': 0 }),
        expander('on-time', '2026-03-10T12:40:00Z', { '#2': 0 }, { '#2': 0 }),
        expander('extended', '2026-03-10T11:50:00Z', { '#3': 0 }, { '#3': 1 }), // new deadline 12:15
      ],
    },
    NOW,
  );
  assert.deepEqual(r.agents.map((a) => a.action), ['stop', null, 'extend']);
  assert.deepEqual(r.fallback, { deadline: '2026-03-10T12:15:00Z', seconds: 900, scheduleWakeup: 900 });
});

test('scan: fallback is the on-time agent when it is due before the extended one', (t) => {
  const r = scanOf(
    t,
    {
      agents: [
        expander('extended', '2026-03-10T11:50:00Z', { '#3': 0 }, { '#3': 1 }),
        expander('on-time', '2026-03-10T12:05:00Z', { '#2': 0 }, { '#2': 0 }),
      ],
    },
    NOW,
  );
  assert.deepEqual(r.fallback, { deadline: '2026-03-10T12:05:00Z', seconds: 300, scheduleWakeup: 300 });
});

test('scan: fallback is null when no agent is in flight after the scan', (t) => {
  assert.equal(scanOf(t, { agents: [] }, NOW).fallback, null);
  const r = scanOf(t, { agents: [expander('stopped', '2026-03-10T11:00:00Z', { '#1': 0 }, { '#1': 0 })] }, NOW);
  assert.equal(r.agents[0].action, 'stop');
  assert.equal(r.fallback, null);
});

test('scan: an agent on time needs no readable worktree', (t) => {
  const dir = scratch(t);
  const agent = {
    id: 'a',
    assigned: '2026-03-10T11:50:00Z',
    limit: 30,
    deadline: '2026-03-10T12:20:00Z',
    extended: 'no',
    fingerprint: { head: 'a'.repeat(40), tree: 'b'.repeat(40) },
    worktree: join(dir, 'gone'),
  };
  assert.equal(scanOf(t, { agents: [agent] }, NOW).agents[0].action, null);
});

test('scan: an overdue agent whose worktree is gone carries an error; the others are judged and the scan exits 0', (t) => {
  const dir = repo(t);
  const healthy = assignedIn(dir, 'healthy');
  put(dir, 'wip.txt', 'half done\n');
  const gone = { ...healthy, id: 'gone', worktree: join(dir, 'no-such-worktree') };
  const onTime = expander('on-time', '2026-03-10T12:20:00Z', { '#2': 0 }, { '#2': 0 });
  const r = scanOf(t, { agents: [gone, healthy, onTime] }, NOW);
  const [a, b, c] = r.agents;
  assert.equal(typeof a.error, 'string');
  assert.ok(a.error.length > 0);
  assert.deepEqual({ ...a, error: null }, {
    id: 'gone',
    overdue: true,
    action: null,
    deadline: '2026-03-10T11:30:00Z',
    extended: 'no',
    fingerprint: { assigned: healthy.fingerprint, current: null },
    error: null,
  });
  assert.deepEqual([b.id, b.action, b.deadline, b.extended, b.error], ['healthy', 'extend', '2026-03-10T12:30:00Z', 'yes', null]);
  assert.deepEqual([c.id, c.action, c.error], ['on-time', null, null]);
  assert.deepEqual(r.fallback, { deadline: '2026-03-10T12:20:00Z', seconds: 1200, scheduleWakeup: 1200 });
});

test('scan: an agent with an error is not counted in the fallback', (t) => {
  const dir = scratch(t);
  const gone = {
    id: 'gone',
    assigned: '2026-03-10T11:00:00Z',
    limit: 30,
    deadline: '2026-03-10T11:30:00Z',
    extended: 'no',
    fingerprint: { head: 'a'.repeat(40), tree: 'b'.repeat(40) },
    worktree: join(dir, 'no-such-worktree'),
  };
  const r = scanOf(t, { agents: [gone] }, NOW);
  assert.equal(r.agents[0].action, null);
  assert.notEqual(r.agents[0].error, null);
  assert.equal(r.fallback, null);
});

test('record: the ticket in --expansions may itself hold "="', () => {
  const r = call(['record', '--expansions', 'a=b.md=3', '--limit', '15', '--now', NOW]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.fingerprint, { expansions: { 'a=b.md': 3 } });
});

test('scan: a log on an ignored path rewritten on every retry is no progress → stop (#74)', (t) => {
  const dir = repo(t);
  put(dir, 'test-output.log', 'FAIL attempt 1\n');
  const first = record(dir, '2026-03-10T11:00:00Z', '30');
  put(dir, 'test-output.log', 'FAIL attempt 2, a different trace\n');
  const second = record(dir, '2026-03-10T11:10:00Z', '30');
  assert.deepEqual(second.fingerprint, first.fingerprint);
  put(dir, 'test-output.log', 'FAIL attempt 3\n');
  const agent = { id: 'impl', assigned: first.assigned, limit: 30, deadline: first.deadline, extended: 'no', fingerprint: first.fingerprint, worktree: dir };
  const [a] = scanOf(t, { agents: [agent] }, NOW).agents;
  assert.equal(a.overdue, true);
  assert.equal(a.action, 'stop');
  assert.deepEqual(a.fingerprint.current, first.fingerprint);
});

test('scan: bad plans exit 2', (t) => {
  const dir = scratch(t);
  const ok = expander('x', '2026-03-10T12:30:00Z', { '#1': 0 }, { '#1': 0 });
  const bad = [
    { agents: 'none' },
    { agents: [ok, ok] },
    { agents: [{ ...ok, id: '' }] },
    { agents: [{ ...ok, deadline: '—' }] },
    { agents: [{ ...ok, limit: 0 }] },
    { agents: [{ ...ok, extended: 'maybe' }] },
    { agents: [{ ...ok, expansions: {} }] },
    { agents: [{ ...ok, expansions: { '#9': 1 } }] },
    { agents: [{ ...ok, fingerprint: { head: 'a' } }] },
    { agents: [{ ...ok, fingerprint: { head: 'a', tree: 'b' } }] }, // no worktree
  ];
  for (const body of bad) assert.equal(main(['scan', plan(dir, body), '--now', NOW]).code, 2, JSON.stringify(body));
  writeFileSync(join(dir, 'broken.json'), '{');
  assert.equal(main(['scan', join(dir, 'broken.json')]).code, 2);
  assert.equal(main(['scan']).code, 2);
  assert.equal(main(['scan', join(dir, 'missing.json')]).code, 1);
});

// --- progress --------------------------------------------------------------------------------------------------

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const ROOMY = { rounds: 40, spawns: 200, hours: 12, 'no-progress': 3 };
const USAGE = { rounds: 4, spawns: 20, hours: 1.5 };
const base = (over = {}) => ({
  previous: { tips: { 'run/one': A, 'run/two': B }, terminal: ['#1', '#2'] },
  tips: { 'run/one': A, 'run/two': B },
  terminal: ['#1', '#2'],
  noProgress: 1,
  usage: USAGE,
  limits: ROOMY,
  ...over,
});

test('progress: tips and terminal tickets unchanged → the count goes up by one', (t) => {
  assert.deepEqual(progressOf(t, base()), {
    format: 'sorry-matt/deadline@1',
    command: 'progress',
    progressed: false,
    noProgress: 2,
    snapshot: { tips: { 'run/one': A, 'run/two': B }, terminal: ['#1', '#2'] },
    stop: false,
    stoppedBy: [],
    rounds: 5,
  });
});

test('progress: only a tip changed → the count is 0', (t) => {
  const r = progressOf(t, base({ tips: { 'run/one': A, 'run/two': C } }));
  assert.equal(r.progressed, true);
  assert.equal(r.noProgress, 0);
  assert.deepEqual(r.snapshot.tips, { 'run/one': A, 'run/two': C });
});

test('progress: only one more terminal ticket → the count is 0', (t) => {
  const r = progressOf(t, base({ terminal: ['#1', '#2', '#3'] }));
  assert.equal(r.progressed, true);
  assert.equal(r.noProgress, 0);
  assert.deepEqual(r.snapshot.terminal, ['#1', '#2', '#3']);
});

test('progress: terminal tickets and lines in another order are unchanged', (t) => {
  const r = progressOf(t, base({ tips: { 'run/two': B, 'run/one': A }, terminal: ['#2', '#1'] }));
  assert.equal(r.progressed, false);
  assert.equal(r.noProgress, 2);
  assert.deepEqual(r.snapshot, { tips: { 'run/one': A, 'run/two': B }, terminal: ['#1', '#2'] });
});

test('progress: a line that appeared since the last snapshot is a change', (t) => {
  const r = progressOf(t, base({ previous: { tips: { 'run/one': A }, terminal: ['#1', '#2'] } }));
  assert.equal(r.noProgress, 0);
});

test('progress: no previous snapshot → the count is 0 and the snapshot is given', (t) => {
  for (const previous of [null, undefined]) {
    const r = progressOf(t, base({ previous, noProgress: 0 }));
    assert.equal(r.progressed, null);
    assert.equal(r.noProgress, 0);
    assert.deepEqual(r.snapshot, { tips: { 'run/one': A, 'run/two': B }, terminal: ['#1', '#2'] });
    assert.equal(r.stop, false);
    assert.equal(r.rounds, 5);
  }
});

// Each limit alone: reached at equal and above, not one short. Progress is made, so no-progress stays out of it.
const moving = (over) => base({ tips: { 'run/one': C, 'run/two': B }, ...over });

test('progress: rounds — stops at the limit, not one short', (t) => {
  const at = (rounds) => progressOf(t, moving({ usage: { ...USAGE, rounds }, limits: { ...ROOMY, rounds: 10 } }));
  assert.deepEqual([at(9).stop, at(9).stoppedBy], [false, []]);
  assert.deepEqual([at(10).stop, at(10).stoppedBy], [true, ['rounds']]);
  assert.deepEqual([at(11).stop, at(11).stoppedBy], [true, ['rounds']]);
});

test('progress: spawns — stops at the limit, not one short', (t) => {
  const at = (spawns) => progressOf(t, moving({ usage: { ...USAGE, spawns }, limits: { ...ROOMY, spawns: 50 } }));
  assert.deepEqual([at(49).stop, at(49).stoppedBy], [false, []]);
  assert.deepEqual([at(50).stop, at(50).stoppedBy], [true, ['spawns']]);
  assert.deepEqual([at(51).stop, at(51).stoppedBy], [true, ['spawns']]);
});

test('progress: hours — stops at the limit, not just under it', (t) => {
  const at = (hours) => progressOf(t, moving({ usage: { ...USAGE, hours }, limits: { ...ROOMY, hours: 2 } }));
  assert.deepEqual([at(1.99).stop, at(1.99).stoppedBy], [false, []]);
  assert.deepEqual([at(2).stop, at(2).stoppedBy], [true, ['hours']]);
  assert.deepEqual([at(2.01).stop, at(2.01).stoppedBy], [true, ['hours']]);
});

test('progress: no-progress — the count just computed is what meets the limit', (t) => {
  const at = (noProgress) => progressOf(t, base({ noProgress }));
  assert.deepEqual([at(1).noProgress, at(1).stop, at(1).stoppedBy], [2, false, []]);
  assert.deepEqual([at(2).noProgress, at(2).stop, at(2).stoppedBy], [3, true, ['no-progress']]);
  const moved = progressOf(t, moving({ noProgress: 2 }));
  assert.deepEqual([moved.noProgress, moved.stop], [0, false], 'progress resets the count before the limit is checked');
});

test('progress: several limits at once are all named, in a fixed order; rounds stays put when stopped', (t) => {
  const r = progressOf(t, base({ noProgress: 2, usage: { rounds: 7, spawns: 9, hours: 3 }, limits: { 'no-progress': 3, hours: 3, spawns: 9, rounds: 7 } }));
  assert.equal(r.stop, true);
  assert.deepEqual(r.stoppedBy, ['rounds', 'spawns', 'hours', 'no-progress']);
  assert.equal(r.rounds, 7);
  const two = progressOf(t, moving({ usage: { rounds: 7, spawns: 9, hours: 3 }, limits: { ...ROOMY, hours: 3, spawns: 9 } }));
  assert.deepEqual(two.stoppedBy, ['spawns', 'hours']);
  assert.equal(two.rounds, 7);
});

test('progress: not stopped → rounds is the usage plus one', (t) => {
  const r = progressOf(t, moving({ usage: { rounds: 0, spawns: 0, hours: 0 } }));
  assert.equal(r.stop, false);
  assert.equal(r.rounds, 1);
});

test('progress: bad plans exit 2', (t) => {
  const dir = scratch(t);
  const bad = [
    base({ tips: undefined }),
    base({ terminal: 'none' }),
    base({ tips: { 'run/one': '' } }),
    base({ previous: { tips: {} } }),
    base({ noProgress: -1 }),
    base({ noProgress: undefined }),
    base({ usage: { rounds: 1, spawns: 1 } }),
    base({ usage: { ...USAGE, rounds: 1.5 } }),
    base({ limits: { rounds: 40, spawns: 200, hours: 12 } }),
    base({ limits: undefined }),
  ];
  for (const body of bad) assert.equal(main(['progress', plan(dir, body)]).code, 2, JSON.stringify(body));
  assert.equal(main(['progress']).code, 2);
  assert.equal(main(['progress', plan(dir, base()), '--now', NOW]).code, 2);
});

test('scan: a plan file that starts with a UTF-8 BOM is read', (t) => {
  const dir = scratch(t);
  const path = join(dir, 'plan.json');
  writeFileSync(path, `\uFEFF${JSON.stringify({ agents: [expander('late', '2026-03-10T11:59:59Z', { '#1': 0 }, { '#1': 0 })] })}`);
  const r = call(['scan', path, '--now', NOW]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.agents.map((a) => [a.id, a.overdue, a.action]), [['late', true, 'stop']]);
});
