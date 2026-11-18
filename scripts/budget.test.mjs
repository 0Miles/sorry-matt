// node --test scripts/budget.test.mjs
// The spawn budget hooks in hooks/: SubagentStart counts each new subagent of a run in progress next to its
// ledger, PreToolUse on Agent denies a spawn once the count reaches the ledger's `budget: spawns` limit, and
// with no run in progress, or no limit, nothing is counted against or blocked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { parseBudget, countersPath, readCounters, recordSpawn, withLock, decideSpawn, countSpawn, handle } from '../hooks/budget.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'hooks/spawns.mjs');

const fixture = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'sorry-matt-budget-')));
  const runs = join(dir, 'sorry-matt', 'runs');
  mkdirSync(runs, { recursive: true });
  return { dir, runs, git: () => ({ status: 0, stdout: `${dir}\n` }), done: () => rmSync(dir, { recursive: true, force: true }) };
};
const ledgerText = (limit, marker = 'active') =>
  [`<!-- sorry-matt:run ${marker} -->`, '# run', '## 9. Run metrics and budget', ...(limit === undefined ? [] : [`- budget: spawns ${limit}`]), '- budget: rounds 30', ''].join('\n');
const agentCall = (cwd = '.') => ({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { prompt: 'x', subagent_type: 'general-purpose' }, cwd });
const started = (agent_id, cwd = '.') => ({ hook_event_name: 'SubagentStart', agent_id, agent_type: 'general-purpose', cwd });
const reasonOf = (out) => out.hookSpecificOutput.permissionDecisionReason;

test('parseBudget: budget lines with a name and an integer, bullets and backticks allowed, first one wins', () => {
  const text = [
    '<!-- sorry-matt:run active -->',
    '- budget: spawns 200',
    '* `budget: rounds 30`',
    'budget: hours 12',
    'budget: no-progress 3',
    'budget: spawns 5',
    'budget: spawns many',
    'the budget: spawns 1 is prose',
  ].join('\r\n');
  assert.deepEqual(parseBudget(text), { spawns: 200, rounds: 30, hours: 12, 'no-progress': 3 });
  assert.deepEqual(parseBudget('# nothing here\n'), {});
});

test('countersPath sits next to the ledger', () => {
  assert.equal(countersPath('/r/.git/sorry-matt/runs/issue-4.md'), '/r/.git/sorry-matt/runs/issue-4.counters.json');
});

test('recordSpawn: counts each agent once, also without an id, and readCounters reads it back', () => {
  const f = fixture();
  try {
    const ledger = join(f.runs, 'r.md');
    writeFileSync(ledger, ledgerText(10));
    assert.deepEqual(readCounters(countersPath(ledger)), { spawns: 0, agents: [] });
    assert.equal(recordSpawn(ledger, 'a1'), 1);
    assert.equal(recordSpawn(ledger, 'a2'), 2);
    assert.equal(recordSpawn(ledger, 'a1'), 2, 'a resumed subagent is not a new spawn');
    assert.equal(recordSpawn(ledger, null), 3);
    const counters = readCounters(countersPath(ledger));
    assert.equal(counters.spawns, 3);
    assert.deepEqual(counters.agents, ['a1', 'a2']);
    assert.ok(!Number.isNaN(Date.parse(counters.updated)));
    assert.deepEqual(readdirSync(f.runs).sort(), ['r.counters.json', 'r.md'], 'no lock or temporary file left behind');
  } finally {
    f.done();
  }
});

test('readCounters: a corrupt file throws instead of reading as zero', () => {
  const f = fixture();
  try {
    const path = join(f.runs, 'r.counters.json');
    writeFileSync(path, '{ half');
    assert.throws(() => readCounters(path));
    writeFileSync(path, '{"spawns": -1, "agents": []}');
    assert.throws(() => readCounters(path), /not a sorry-matt counters file/);
  } finally {
    f.done();
  }
});

test('withLock: waits for a held lock, removes a stale one, and gives up after the wait', () => {
  const f = fixture();
  try {
    const path = join(f.runs, 'r.counters.json');
    writeFileSync(`${path}.lock`, '');
    const old = new Date(Date.now() - 60_000);
    utimesSync(`${path}.lock`, old, old);
    assert.equal(withLock(path, () => 'ran'), 'ran', 'a stale lock is taken over');
    assert.ok(!existsSync(`${path}.lock`));

    writeFileSync(`${path}.lock`, '');
    assert.throws(() => withLock(path, () => 'ran', { wait: 50, stale: 60_000 }), /could not lock/);
  } finally {
    f.done();
  }
});

test('parallel SubagentStart hooks lose no count', async () => {
  const f = fixture();
  try {
    // A real repo, so each hook process finds the common directory through git itself.
    const repo = join(f.dir, 'repo');
    mkdirSync(repo);
    spawnSync('git', ['-C', repo, 'init', '-q']);
    const runs = join(repo, '.git', 'sorry-matt', 'runs');
    mkdirSync(runs, { recursive: true });
    const repoLedger = join(runs, 'r.md');
    writeFileSync(repoLedger, ledgerText(100));
    const n = 12;
    const exits = await Promise.all(
      Array.from({ length: n }, (_, i) =>
        new Promise((resolve) => {
          const child = spawn(process.execPath, [entry], { stdio: ['pipe', 'ignore', 'pipe'], env: { ...process.env, SORRY_MATT_BUDGET: '' } });
          let err = '';
          child.stderr.on('data', (c) => (err += c));
          child.on('close', (code) => resolve({ code, err }));
          child.stdin.end(JSON.stringify(started(`agent-${i}`, repo)));
        }),
      ),
    );
    for (const { code, err } of exits) {
      assert.equal(code, 0);
      assert.equal(err, '');
    }
    const counters = readCounters(countersPath(repoLedger));
    assert.equal(counters.spawns, n);
    assert.equal(new Set(counters.agents).size, n);
  } finally {
    f.done();
  }
});

test('decideSpawn: lets spawns through below the limit and denies at it', () => {
  const f = fixture();
  try {
    const ledger = join(f.runs, 'r.md');
    writeFileSync(ledger, ledgerText(2));
    const deps = { git: f.git, env: {} };
    assert.equal(decideSpawn(agentCall(), deps), null);
    countSpawn(started('a1'), deps);
    assert.equal(decideSpawn(agentCall(), deps), null);
    countSpawn(started('a2'), deps);
    const out = decideSpawn(agentCall(), deps);
    assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(reasonOf(out), /has spawned 2 subagents and its limit is 2/);
    assert.ok(reasonOf(out).includes(ledger));
    assert.match(reasonOf(out), /only the user raises a limit/);
    assert.match(reasonOf(out), /SORRY_MATT_BUDGET=off/);

    writeFileSync(ledger, ledgerText(3));
    assert.equal(decideSpawn(agentCall(), deps), null, 'the hook re-reads the limit on every call');
  } finally {
    f.done();
  }
});

test('no run in progress, an ended run, no spawn limit, or the opt-out: nothing is counted or blocked', () => {
  const f = fixture();
  try {
    const deps = { git: f.git, env: {} };
    assert.equal(decideSpawn(agentCall(), { git: () => ({ status: 128, stdout: '' }), env: {} }), null);
    assert.equal(decideSpawn(agentCall(), deps), null, 'no ledger at all');
    assert.deepEqual(countSpawn(started('a1'), deps), []);

    const ledger = join(f.runs, 'r.md');
    writeFileSync(ledger, ledgerText(0, 'ended'));
    assert.equal(decideSpawn(agentCall(), deps), null);
    assert.deepEqual(countSpawn(started('a1'), deps), []);
    assert.ok(!existsSync(countersPath(ledger)));

    writeFileSync(ledger, ledgerText(undefined));
    assert.equal(decideSpawn(agentCall(), deps), null, 'no `budget: spawns` line');
    assert.equal(countSpawn(started('a1'), deps)[0].spawns, 1, 'usage is still counted for field 9');

    writeFileSync(ledger, ledgerText(0));
    assert.ok(decideSpawn(agentCall(), deps));
    assert.equal(decideSpawn(agentCall(), { ...deps, env: { SORRY_MATT_BUDGET: 'OFF' } }), null);
    assert.deepEqual(countSpawn(started('a2'), { ...deps, env: { SORRY_MATT_BUDGET: 'off' } }), []);
    assert.equal(decideSpawn(agentCall(), { ...deps, env: { SORRY_MATT_GUARD: 'off' } }) === null, false, 'the guard opt-out is separate');
  } finally {
    f.done();
  }
});

test('more than one run in progress: each counts the spawn, and any run at its limit denies', () => {
  const f = fixture();
  try {
    const deps = { git: f.git, env: {} };
    writeFileSync(join(f.runs, 'a.md'), ledgerText(5));
    writeFileSync(join(f.runs, 'b.md'), ledgerText(1));
    assert.deepEqual(countSpawn(started('x'), deps).map((c) => c.spawns), [1, 1]);
    assert.ok(reasonOf(decideSpawn(agentCall(), deps)).includes(join(f.runs, 'b.md')));
  } finally {
    f.done();
  }
});

test('a corrupt counters file blocks the spawn of a run with a limit and says so', () => {
  const f = fixture();
  try {
    const ledger = join(f.runs, 'r.md');
    writeFileSync(ledger, ledgerText(5));
    writeFileSync(countersPath(ledger), 'not json');
    const out = decideSpawn(agentCall(), { git: f.git, env: {} });
    assert.match(reasonOf(out), /could not read the spawn count/);
    assert.match(reasonOf(out), /do not edit or delete the counters file yourself/);
    assert.match(countSpawn(started('a'), { git: f.git, env: {} })[0].error, /JSON/);
  } finally {
    f.done();
  }
});

test('handle: only Agent calls are judged, other events and unreadable input pass', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.runs, 'r.md'), ledgerText(0));
    const deps = { git: f.git, env: {} };
    assert.ok(handle(JSON.stringify(agentCall()), deps));
    assert.equal(handle(JSON.stringify({ ...agentCall(), tool_name: 'Bash' }), deps), null);
    assert.equal(handle('not json', deps), null);
    assert.equal(handle(JSON.stringify(started('z')), deps), null);
    assert.equal(readCounters(countersPath(join(f.runs, 'r.md'))).spawns, 1);
  } finally {
    f.done();
  }
});

test('hooks.json wires spawns.mjs to PreToolUse on Agent and to every SubagentStart', () => {
  const config = JSON.parse(readFileSync(join(root, 'hooks/hooks.json'), 'utf8'));
  const pre = config.hooks.PreToolUse.find((e) => e.hooks.some((h) => h.command.includes('hooks/spawns.mjs')));
  assert.equal(pre.matcher, 'Agent');
  const start = config.hooks.SubagentStart.find((e) => e.hooks.some((h) => h.command.includes('hooks/spawns.mjs')));
  assert.ok(start);
  assert.equal(start.matcher, undefined, 'every agent type counts');
});

test('end to end: the entry counts in a real repo worktree, denies at the limit, and stops once the run ends', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'sorry-matt-budget-repo-')));
  try {
    const git = (...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
    git('init', '-q');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
    const tree = join(dir, 'wt');
    git('worktree', 'add', '-q', tree);
    const runs = join(dir, '.git', 'sorry-matt', 'runs');
    mkdirSync(runs, { recursive: true });
    const ledger = join(runs, 'r.md');
    writeFileSync(ledger, ledgerText(1));
    const run = (event) => spawnSync(process.execPath, [entry], { input: JSON.stringify(event), encoding: 'utf8', env: { ...process.env, SORRY_MATT_BUDGET: '' } });

    const first = run(agentCall(tree));
    assert.equal(first.status, 0);
    assert.equal(first.stdout, '');
    const counted = run(started('agent-1', tree));
    assert.equal(counted.status, 0);
    assert.equal(counted.stdout, '');
    assert.equal(readCounters(countersPath(ledger)).spawns, 1);

    const denied = run(agentCall(tree));
    assert.equal(denied.status, 0);
    assert.equal(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision, 'deny');

    writeFileSync(ledger, ledgerText(1, 'ended'));
    assert.equal(run(agentCall(tree)).stdout, '');

    const outside = run(agentCall(tmpdir()));
    assert.equal(outside.status, 0);
    assert.equal(outside.stdout, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
