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
import { parseBudget, countersPath, readCounters, recordSpawn, withLock, decideSpawn, countSpawn, handle, CorruptCounters } from '../hooks/budget.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'hooks/spawns.mjs');

const fixture = () => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'sorry-matt-budget-')));
  const runs = join(dir, 'sorry-matt', 'runs');
  mkdirSync(runs, { recursive: true });
  return { dir, runs, git: () => ({ status: 0, stdout: `${dir}\n` }), done: () => rmSync(dir, { recursive: true, force: true }) };
};
const ledgerText = (limit, marker = 'active') =>
  [`<!-- sorry-matt:run ${marker} -->`, '# run', '## 9. Run metrics and budget', ...(limit === undefined ? [] : [`- budget: spawns ${limit}`]), '- budget: rounds 30', ''].join('\n');
const agentCall = (cwd = '.') => ({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { prompt: 'x', subagent_type: 'general-purpose' }, cwd });
const started = (agent_id, cwd = '.') => ({ hook_event_name: 'SubagentStart', agent_id, agent_type: 'general-purpose', cwd });
const reasonOf = (out) => out.hookSpecificOutput.permissionDecisionReason;
const decision = (...args) => decideSpawn(...args).decision;

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

test('parseBudget: the stage time limits share the format and leave the spawn limit alone', () => {
  const text = [
    '- budget: spawns 440',
    '- budget: timeout-implement 30',
    '- `budget: timeout-fix 20`',
    '- budget: timeout-expand 15',
    '- budget: timeout-merge 15',
  ].join('\n');
  assert.deepEqual(parseBudget(text), {
    spawns: 440,
    'timeout-implement': 30,
    'timeout-fix': 20,
    'timeout-expand': 15,
    'timeout-merge': 15,
  });
});

test('parseBudget: a space before the closing backtick does not hide the line', () => {
  assert.deepEqual(parseBudget('- `budget: spawns 200 `\n'), { spawns: 200 });
  assert.deepEqual(parseBudget('budget: `spawns 200 `\n'), { spawns: 200 });
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

test('readCounters: retries a transient file lock, then reads; corrupt content is CorruptCounters', () => {
  let calls = 0;
  const busy = (code, times, text) => () => {
    calls++;
    if (calls <= times) throw Object.assign(new Error(code), { code });
    return text;
  };
  for (const code of ['EBUSY', 'EPERM', 'EACCES']) {
    calls = 0;
    assert.equal(readCounters('/x.counters.json', { read: busy(code, 3, '{"spawns": 4, "agents": []}'), retry: { delay: 1 } }).spawns, 4, code);
    assert.equal(calls, 4);
  }
  calls = 0;
  assert.throws(() => readCounters('/x.counters.json', { read: busy('EBUSY', 99, ''), retry: { attempts: 2, delay: 1 } }), (e) => e.code === 'EBUSY' && !(e instanceof CorruptCounters));
  assert.equal(calls, 3);
  assert.throws(() => readCounters('/x.counters.json', { read: () => '{ half' }), CorruptCounters);
  assert.throws(() => readCounters('/x.counters.json', { read: () => 'null' }), CorruptCounters);
});

test('decideSpawn: a counters file still locked after the retries lets the spawn through with a warning', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.runs, 'r.md'), ledgerText(0));
    const locked = () => {
      throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
    };
    const { decision: out, warnings } = decideSpawn(agentCall(), { git: f.git, env: {}, read: locked });
    assert.equal(out, null);
    assert.match(warnings[0], /could not read the spawn count .*EBUSY.*let through/);
    const other = () => {
      throw Object.assign(new Error('EISDIR'), { code: 'EISDIR' });
    };
    assert.equal(decideSpawn(agentCall(), { git: f.git, env: {}, read: other }).decision, null);
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
    assert.equal(decision(agentCall(), deps), null);
    countSpawn(started('a1'), deps);
    assert.equal(decision(agentCall(), deps), null);
    countSpawn(started('a2'), deps);
    const out = decision(agentCall(), deps);
    assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(reasonOf(out), /has spawned 2 subagents and its limit is 2/);
    assert.ok(reasonOf(out).includes(ledger));
    assert.match(reasonOf(out), /only the user raises a limit/);
    assert.match(reasonOf(out), /SORRY_MATT_BUDGET=off/);

    writeFileSync(ledger, ledgerText(3));
    assert.equal(decision(agentCall(), deps), null, 'the hook re-reads the limit on every call');
  } finally {
    f.done();
  }
});

test('decideSpawn: a spawn limit written with a space before the closing backtick still denies at the limit', () => {
  const f = fixture();
  try {
    const ledger = join(f.runs, 'r.md');
    writeFileSync(ledger, '<!-- sorry-matt:run active -->\n# run\n## 9. Run metrics and budget\n- `budget: spawns 1 `\n');
    const deps = { git: f.git, env: {} };
    assert.equal(decision(agentCall(), deps), null);
    countSpawn(started('a1'), deps);
    const out = decision(agentCall(), deps);
    assert.equal(out?.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(reasonOf(out), /has spawned 1 subagents and its limit is 1/);
  } finally {
    f.done();
  }
});

test('no run in progress, an ended run, no spawn limit, or the opt-out: nothing is counted or blocked', () => {
  const f = fixture();
  try {
    const deps = { git: f.git, env: {} };
    assert.equal(decision(agentCall(), { git: () => ({ status: 128, stdout: '' }), env: {} }), null);
    assert.equal(decision(agentCall(), deps), null, 'no ledger at all');
    assert.deepEqual(countSpawn(started('a1'), deps), []);

    const ledger = join(f.runs, 'r.md');
    writeFileSync(ledger, ledgerText(0, 'ended'));
    assert.equal(decision(agentCall(), deps), null);
    assert.deepEqual(countSpawn(started('a1'), deps), []);
    assert.ok(!existsSync(countersPath(ledger)));

    writeFileSync(ledger, ledgerText(undefined));
    assert.equal(decision(agentCall(), deps), null, 'no `budget: spawns` line');
    assert.equal(countSpawn(started('a1'), deps)[0].spawns, 1, 'usage is still counted for field 9');

    writeFileSync(ledger, ledgerText(0));
    assert.ok(decision(agentCall(), deps));
    assert.equal(decision(agentCall(), { ...deps, env: { SORRY_MATT_BUDGET: 'OFF' } }), null);
    assert.deepEqual(countSpawn(started('a2'), { ...deps, env: { SORRY_MATT_BUDGET: 'off' } }), []);
    assert.equal(decision(agentCall(), { ...deps, env: { SORRY_MATT_GUARD: 'off' } }) === null, false, 'the guard opt-out is separate');
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
    assert.ok(reasonOf(decision(agentCall(), deps)).includes(join(f.runs, 'b.md')));
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
    const out = decision(agentCall(), { git: f.git, env: {} });
    assert.match(reasonOf(out), /could not read the spawn count/);
    assert.match(reasonOf(out), /do not edit or delete the counters file yourself/);
    assert.match(countSpawn(started('a'), { git: f.git, env: {} })[0].error, /JSON/);
    const counted = handle(JSON.stringify(started('b')), { git: f.git, env: {} });
    assert.equal(counted.decision, null);
    assert.match(counted.warnings[0], /could not count this subagent for .*r.md: .*not JSON/);
  } finally {
    f.done();
  }
});

test('handle: only Agent calls are judged, other events and unreadable input pass', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.runs, 'r.md'), ledgerText(0));
    const deps = { git: f.git, env: {} };
    assert.ok(handle(JSON.stringify(agentCall()), deps).decision);
    assert.deepEqual(handle(JSON.stringify({ ...agentCall(), tool_name: 'Bash' }), deps), { decision: null, warnings: [] });
    assert.deepEqual(handle('not json', deps), { decision: null, warnings: [] });
    assert.deepEqual(handle(JSON.stringify(started('z')), deps), { decision: null, warnings: [] });
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
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'sorry-matt-budget-repo-')));
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

// --- #75: each counted spawn is logged with its agent type, the Agent call's description and the time ---

const typedCall = (subagent_type, description, cwd = '.') => ({
  hook_event_name: 'PreToolUse',
  tool_name: 'Agent',
  tool_input: { prompt: 'x', subagent_type, ...(description === undefined ? {} : { description }) },
  cwd,
});
const typedStart = (agent_id, agent_type, cwd = '.') => ({ hook_event_name: 'SubagentStart', agent_id, agent_type, cwd });
const send = (event, deps) => handle(JSON.stringify(event), deps);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

test('log: a SubagentStart adds one spawn and one log entry with id, type, description and time', () => {
  const f = fixture();
  try {
    const ledger = join(f.runs, 'r.md');
    writeFileSync(ledger, ledgerText(10));
    const deps = { git: f.git, env: {} };
    assert.deepEqual(send(typedStart('agent-1', 'sorry-matt:expander'), deps), { decision: null, warnings: [] });
    const counters = readCounters(countersPath(ledger));
    assert.equal(counters.spawns, 1);
    assert.equal(counters.log.length, 1);
    const [entry] = counters.log;
    assert.deepEqual(Object.keys(entry).sort(), ['at', 'description', 'id', 'type']);
    assert.equal(entry.id, 'agent-1');
    assert.equal(entry.type, 'sorry-matt:expander');
    assert.equal(entry.description, null, 'no Agent call was seen, so there is nothing to pair');
    assert.match(entry.at, ISO);
  } finally {
    f.done();
  }
});

test('log: the description comes from the Agent call let through before the SubagentStart of the same type', () => {
  const f = fixture();
  try {
    const ledger = join(f.runs, 'r.md');
    writeFileSync(ledger, ledgerText(10));
    const deps = { git: f.git, env: {} };
    assert.deepEqual(send(typedCall('general-purpose', 'implement #72'), deps), { decision: null, warnings: [] });
    send(typedStart('agent-1', 'general-purpose'), deps);
    const counters = readCounters(countersPath(ledger));
    assert.equal(counters.spawns, 1);
    assert.equal(counters.log[0].description, 'implement #72');
    assert.equal(counters.log[0].type, 'general-purpose');
    assert.deepEqual(counters.pending, [], 'a paired call is no longer waiting');
  } finally {
    f.done();
  }
});

test('log: starts arriving out of order pair by type; the same type pairs first come, first served', () => {
  const f = fixture();
  try {
    const ledger = join(f.runs, 'r.md');
    writeFileSync(ledger, ledgerText(10));
    const deps = { git: f.git, env: {} };
    send(typedCall('sorry-matt:expander', 'expand #75 #83'), deps);
    send(typedCall('general-purpose', 'implement #72'), deps);
    send(typedStart('g1', 'general-purpose'), deps);
    send(typedStart('e1', 'sorry-matt:expander'), deps);
    send(typedCall('general-purpose', 'finder #72'), deps);
    send(typedCall('general-purpose', 'verifier #72'), deps);
    send(typedStart('g2', 'general-purpose'), deps);
    send(typedStart('g3', 'general-purpose'), deps);
    const byId = Object.fromEntries(readCounters(countersPath(ledger)).log.map((e) => [e.id, e.description]));
    assert.deepEqual(byId, { g1: 'implement #72', e1: 'expand #75 #83', g2: 'finder #72', g3: 'verifier #72' });
  } finally {
    f.done();
  }
});

test('log: a resumed subagent changes neither the count nor the log, and leaves a waiting call alone', () => {
  const f = fixture();
  try {
    const ledger = join(f.runs, 'r.md');
    writeFileSync(ledger, ledgerText(10));
    const deps = { git: f.git, env: {} };
    send(typedStart('agent-1', 'general-purpose'), deps);
    const before = readCounters(countersPath(ledger));
    send(typedCall('general-purpose', 'implement #73'), deps);
    send(typedStart('agent-1', 'general-purpose'), deps);
    const after = readCounters(countersPath(ledger));
    assert.equal(after.spawns, 1);
    assert.deepEqual(after.log, before.log);
    send(typedStart('agent-2', 'general-purpose'), deps);
    assert.equal(readCounters(countersPath(ledger)).log[1].description, 'implement #73');
  } finally {
    f.done();
  }
});

test('log: an Agent call denied by the budget leaves nothing to pair', () => {
  const f = fixture();
  try {
    const ledger = join(f.runs, 'r.md');
    writeFileSync(ledger, ledgerText(0));
    const deps = { git: f.git, env: {} };
    const out = send(typedCall('general-purpose', 'implement #72'), deps);
    assert.equal(out.decision.hookSpecificOutput.permissionDecision, 'deny');
    assert.ok(!existsSync(countersPath(ledger)), 'a denied call writes nothing');
    writeFileSync(ledger, ledgerText(5));
    send(typedStart('agent-1', 'general-purpose'), deps);
    const counters = readCounters(countersPath(ledger));
    assert.equal(counters.spawns, 1);
    assert.equal(counters.log[0].description, null);
  } finally {
    f.done();
  }
});

test('log: a call still waiting after ten minutes never happened and is dropped', () => {
  const f = fixture();
  try {
    const ledger = join(f.runs, 'r.md');
    writeFileSync(ledger, ledgerText(10));
    const at = (iso) => ({ git: f.git, env: {}, now: () => new Date(iso) });
    send(typedCall('general-purpose', 'implement #72'), at('2026-11-19T10:00:00.000Z'));
    send(typedCall('general-purpose', 'implement #73'), at('2026-11-19T10:05:00.000Z'));
    send(typedStart('agent-1', 'general-purpose'), at('2026-11-19T10:10:00.001Z'));
    const counters = readCounters(countersPath(ledger));
    assert.equal(counters.log[0].description, 'implement #73');
    assert.equal(counters.log[0].at, '2026-11-19T10:10:00.001Z');
    assert.deepEqual(counters.pending, []);
  } finally {
    f.done();
  }
});

test('log: a recording failure on the Agent call changes no decision and only warns', () => {
  const f = fixture();
  try {
    const ledger = join(f.runs, 'r.md');
    const deps = { git: f.git, env: {}, lock: { wait: 30, stale: 60_000 } };
    // Held by someone else: the counters file cannot be locked, so the call cannot be recorded.
    writeFileSync(`${countersPath(ledger)}.lock`, '');

    writeFileSync(ledger, ledgerText(5));
    const through = send(typedCall('general-purpose', 'implement #72'), deps);
    assert.equal(through.decision, null, 'below the limit it is still let through');
    assert.equal(through.warnings.length, 1);
    assert.match(through.warnings[0], /could not record this Agent call for .*r\.md.*could not lock/);
    assert.ok(!existsSync(countersPath(ledger)));

    writeFileSync(ledger, ledgerText(0));
    const blocked = send(typedCall('general-purpose', 'implement #72'), deps);
    assert.equal(blocked.decision.hookSpecificOutput.permissionDecision, 'deny', 'at the limit it is still denied');
    assert.match(reasonOf(blocked.decision), /has spawned 0 subagents and its limit is 0/);
    assert.deepEqual(blocked.warnings, []);

    // Not writable at all: the counters path is a directory.
    rmSync(`${countersPath(ledger)}.lock`);
    writeFileSync(ledger, ledgerText(undefined));
    mkdirSync(countersPath(ledger));
    const unwritable = send(typedCall('general-purpose', 'implement #72'), { git: f.git, env: {} });
    assert.equal(unwritable.decision, null);
    assert.equal(unwritable.warnings.length, 1);
    assert.match(unwritable.warnings[0], /could not record this Agent call/);
  } finally {
    f.done();
  }
});

test('log: the old counters format reads as before, and the next spawn starts the log', () => {
  const f = fixture();
  try {
    const ledger = join(f.runs, 'r.md');
    const path = countersPath(ledger);
    assert.deepEqual(readCounters(path), { spawns: 0, agents: [] }, 'a missing file is still zero');
    writeFileSync(path, '{"spawns": 4, "agents": ["a","b"], "updated": "2026-11-18T00:00:00.000Z"}');
    assert.deepEqual(readCounters(path), { spawns: 4, agents: ['a', 'b'], updated: '2026-11-18T00:00:00.000Z' });
    const deps = { git: f.git, env: {} };
    writeFileSync(ledger, ledgerText(4));
    assert.match(reasonOf(decision(agentCall(), deps)), /has spawned 4 subagents and its limit is 4/);
    writeFileSync(ledger, ledgerText(5));
    assert.equal(decision(agentCall(), deps), null);

    send(typedStart('c', 'general-purpose'), deps);
    const counters = readCounters(path);
    assert.equal(counters.spawns, 5);
    assert.deepEqual(counters.agents, ['a', 'b', 'c']);
    assert.equal(counters.log.length, 1);
    assert.equal(counters.log[0].id, 'c');
  } finally {
    f.done();
  }
});

test('log: an Agent call without a subagent_type or a description pairs as general-purpose with no description', () => {
  const f = fixture();
  try {
    const ledger = join(f.runs, 'r.md');
    writeFileSync(ledger, ledgerText(10));
    const deps = { git: f.git, env: {} };
    send({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { prompt: 'x' }, cwd: '.' }, deps);
    assert.deepEqual(
      readCounters(countersPath(ledger)).pending.map(({ type, description }) => ({ type, description })),
      [{ type: 'general-purpose', description: null }],
    );
    send({ hook_event_name: 'SubagentStart', agent_id: 'n1', cwd: '.' }, deps);
    const counters = readCounters(countersPath(ledger));
    assert.equal(counters.log[0].type, null, 'an event without agent_type is logged as it came');
    assert.equal(counters.spawns, 1);
  } finally {
    f.done();
  }
});

test('end to end: the entry pairs an Agent call with its SubagentStart across two hook processes', () => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'sorry-matt-budget-log-')));
  try {
    spawnSync('git', ['-C', dir, 'init', '-q']);
    const runs = join(dir, '.git', 'sorry-matt', 'runs');
    mkdirSync(runs, { recursive: true });
    const ledger = join(runs, 'r.md');
    writeFileSync(ledger, ledgerText(3));
    const run = (event) => spawnSync(process.execPath, [entry], { input: JSON.stringify(event), encoding: 'utf8', env: { ...process.env, SORRY_MATT_BUDGET: '' } });
    const call = run(typedCall('general-purpose', 'merge #72', dir));
    assert.deepEqual([call.status, call.stdout, call.stderr], [0, '', '']);
    const start = run(typedStart('agent-1', 'general-purpose', dir));
    assert.deepEqual([start.status, start.stdout, start.stderr], [0, '', '']);
    const counters = JSON.parse(readFileSync(countersPath(ledger), 'utf8'));
    assert.equal(counters.spawns, 1);
    assert.equal(counters.log[0].description, 'merge #72');
    assert.deepEqual(readdirSync(runs).sort(), ['r.counters.json', 'r.md']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
