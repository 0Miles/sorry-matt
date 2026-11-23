// node --test scripts/retro.test.mjs
// Drives retro.mjs through main() on fake counters, state and transcript files in a temp dir. The state is written by
// state.mjs's own main, so the two scripts are checked against each other; every expected token count is a literal
// summed by hand from the fixture transcripts below, not recomputed the way the script does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { kindOf, main, stageOf, transcriptUsage } from '../src/skills/get-to-work/scripts/retro.mjs';
import { ROLES } from '../src/skills/get-to-work/scripts/spawns.mjs';
import { main as state } from '../src/skills/get-to-work/scripts/state.mjs';
import { main as deadline } from '../src/skills/get-to-work/scripts/deadline.mjs';

const RUN = 'run-1';
const LINE = 'run-1/line-a';
const SNAP = 'a'.repeat(64);
const SHA1 = '1'.repeat(40);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../src/skills/get-to-work/scripts/retro.mjs', import.meta.url));

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sorry-matt-retro-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const write = (p, body) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body));
  return p;
};
const jsonl = (entries) => entries.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('\n') + '\n';
/** One transcript line of an assistant message. */
const msg = (id, usage, { model = 'claude-test-1', at = '2026-03-10T12:30:00Z' } = {}) => ({
  type: 'assistant',
  timestamp: at,
  message: { id, model, usage: { input_tokens: usage[0], output_tokens: usage[1], cache_creation_input_tokens: usage[2], cache_read_input_tokens: usage[3] } },
});

/**
 * A finished run of two tickets on one line: #1 delivered after a fix round (its initial review recorded with its
 * finding counts and tier reasons), #2 stuck in review. Spawns: #1 has an implementer, a review host and a finder
 * with transcripts; #2 an implementer with no transcript and a fix agent with no id; one simplify agent names no
 * ticket.
 */
function world(t, { session = 's-1', run: RUN = 'run-1', dir = scratch(t) } = {}) {
  const LINE = `${RUN}/line-a`;
  const common = join(dir, 'common');
  // as get-to-work lays a run out: <common dir>/sorry-matt/runs/<run>/
  const runs = join(common, 'sorry-matt', 'runs', RUN);
  const statePath = join(runs, `${RUN}.state.json`);
  const S = (cmd, now, ...args) => {
    const r = state([cmd, statePath, ...args, '--now', now]);
    assert.equal(r.code, 0, r.err);
  };
  mkdirSync(runs, { recursive: true });
  S('init', '2026-03-10T12:00:00Z', '--run', RUN);
  S('add', '2026-03-10T12:00:00Z', '#1', '#2', '--line', LINE);
  S('set', '2026-03-10T12:00:00Z', '#1', '--snapshot', SNAP);
  S('set', '2026-03-10T12:00:00Z', '#2', '--snapshot', SNAP);
  S('stage', '2026-03-10T12:10:00Z', 'implementing', '#1', '#2');
  S('stage', '2026-03-10T12:40:00Z', 'in-review', '#1', '#2');
  S('review', '2026-03-10T13:00:00Z', '#1', '--mode', 'initial', '--verdict', 'fix', '--tier', 'full', '--tier-reason', 'sensitive', '--tier-reason', 'src/x.mjs#a b', '--tier-reason', 'c,d', '--findings', 'F1', '--candidates', '6', '--confirmed', '2', '--invalid', '4', '--blocking', '1');
  S('stage', '2026-03-10T13:00:00Z', 'fixing', '#1');
  S('stage', '2026-03-10T13:20:00Z', 'in-review', '#1');
  S('review', '2026-03-10T13:30:00Z', '#1', '--mode', 'recheck', '--verdict', 'pass', '--tier', 'full', '--tier-reason', 'sensitive', '--candidates', '0', '--confirmed', '0', '--invalid', '0', '--blocking', '0');
  S('stage', '2026-03-10T13:30:00Z', 'queued', '#1');
  S('stage', '2026-03-10T13:35:00Z', 'integrating', '#1');
  S('merge', '2026-03-10T13:40:00Z', '#1', SHA1);
  S('stage', '2026-03-10T13:40:00Z', 'delivered', '#1');
  S('stage', '2026-03-10T13:50:00Z', 'stuck', '#2', '--reason', 'review stuck');

  const counters = write(join(runs, `${RUN}.counters.json`), {
    spawns: 6,
    agents: ['a1', 'a2', 'a3', 'a4', 'a6'],
    log: [
      { id: 'a1', type: 'sorry-matt:implementer', description: 'implement #1', at: '2026-03-10T12:10:00Z' },
      { id: 'a2', type: 'general-purpose', description: 'review #1', at: '2026-03-10T12:40:00Z' },
      { id: 'a3', type: 'sorry-matt:finder', description: 'finder #1', at: '2026-03-10T12:45:00Z' },
      { id: 'a4', type: 'sorry-matt:implementer', description: 'implement #2', at: '2026-03-10T12:10:00Z' },
      { id: null, type: 'sorry-matt:implementer', description: 'fix #2', at: '2026-03-10T13:00:00Z' },
      { id: 'a6', type: 'general-purpose', description: `simplify ${LINE}`, at: '2026-03-10T13:45:00Z' },
    ],
  });
  const ledger = write(join(runs, `${RUN}.md`), `<!-- sorry-matt:run ended -->\n# run\n\n9. budget\n- budget: spawns 200\n${session ? `- session: ${session}\n` : ''}`);

  const projects = join(dir, 'projects');
  const sessionDir = join(projects, 'D--code-repo', 's-1');
  // a1: m1 three times (a message split over lines counts once), m2 once → 1+2 / 10+20 / 100+200 / 1000+2000
  write(join(sessionDir, 'subagents', 'agent-a1.jsonl'), jsonl([msg('m1', [1, 10, 100, 1000]), msg('m1', [1, 10, 100, 1000]), '{"cut off', msg('m1', [1, 10, 100, 1000]), msg('m2', [2, 20, 200, 2000]), { type: 'user', message: { role: 'user', content: 'x' } }]));
  write(join(sessionDir, 'subagents', 'agent-a2.jsonl'), jsonl([msg('r1', [5, 50, 500, 5000]), msg('r1', [5, 50, 500, 5000])]));
  write(join(sessionDir, 'subagents', 'agent-a3.jsonl'), jsonl([msg('f1', [7, 70, 700, 7000], { model: 'claude-test-2' })]));
  write(join(sessionDir, 'subagents', 'agent-a6.jsonl'), jsonl([msg('s1', [1, 2, 3, 4])]));
  // the host: one message before the run started (another run in the same session) is not this run's
  write(join(projects, 'D--code-repo', 's-1.jsonl'), jsonl([msg('h0', [9, 9, 9, 9], { at: '2026-03-09T00:00:00Z' }), msg('h1', [4, 40, 400, 4000]), msg('h1', [4, 40, 400, 4000])]));

  // the origin remote is not where CI is read (#172): `gh repo view` is, and it answers o/r
  const deps = {
    git: (args) => {
      if (args[0] === 'remote') return 'git@github.com:origin/remote.git\n';
      if (args.join(' ') === 'rev-parse --path-format=absolute --git-common-dir') return `${common}\n`;
      throw new Error('no git here');
    },
    gh: (args) => {
      if (args.join(' ') === 'repo view --json nameWithOwner') return '{"nameWithOwner":"o/r"}\n';
      throw new Error('gh: not found');
    },
    clock: () => Date.parse('2026-03-10T14:00:00Z'),
    env: {},
  };
  const retro = join(common, 'sorry-matt', 'retro.jsonl');
  const record = (...extra) => main(['record', '--state', statePath, '--counters', counters, '--ledger', ledger, '--projects', projects, '--now', '2026-03-10T14:00:00Z', ...extra], deps);
  const rows = () => readFileSync(retro, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  /** Changes the state file by hand: a field an older state lacks, or the tick configuration. */
  const edit = (fn) => {
    const s = JSON.parse(readFileSync(statePath, 'utf8'));
    fn(s);
    writeFileSync(statePath, JSON.stringify(s));
  };
  return { dir, common, statePath, counters, ledger, projects, retro, record, rows, deps, edit, run: RUN };
}

const ok = (r) => {
  assert.equal(r.code, 0, r.err);
  return r.out;
};

test('record writes one row per ticket with the tokens of each agent, one count per message id', (t) => {
  const w = world(t);
  const out = JSON.parse(ok(w.record()));
  assert.equal(out.retro, w.retro, 'the retro file sits in <common dir>/sorry-matt');
  assert.deepEqual([out.rows, out.replaced], [2, 0]);
  const [one, two] = w.rows();
  assert.deepEqual([one.ticket, two.ticket], ['#1', '#2']);
  assert.equal(one.format, 'sorry-matt/retro@1');
  assert.equal(one.run, RUN);
  assert.equal(one.repo, 'o/r');
  assert.equal(one.pluginVersion, JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version);
  assert.deepEqual(one.agents.map((a) => [a.id, a.kind, a.tokens]), [
    ['a1', 'implement', { input: 3, output: 30, cacheWrite: 300, cacheRead: 3000 }],
    ['a2', 'review', { input: 5, output: 50, cacheWrite: 500, cacheRead: 5000 }],
    ['a3', 'finder', { input: 7, output: 70, cacheWrite: 700, cacheRead: 7000 }],
  ]);
  assert.deepEqual(one.byKind, {
    implement: { spawns: 1, tokens: { input: 3, output: 30, cacheWrite: 300, cacheRead: 3000 } },
    review: { spawns: 1, tokens: { input: 5, output: 50, cacheWrite: 500, cacheRead: 5000 } },
    finder: { spawns: 1, tokens: { input: 7, output: 70, cacheWrite: 700, cacheRead: 7000 } },
  });
  assert.deepEqual(one.models, ['claude-test-1', 'claude-test-2']);
  // the host: only this run's messages, h1 once; the same on every row of the run
  assert.deepEqual(one.host, { session: 's-1', models: ['claude-test-1'], tokens: { input: 4, output: 40, cacheWrite: 400, cacheRead: 4000 } });
  assert.deepEqual(two.host, one.host);
});

test('a message split over several lines counts once, with the usage of its last line', () => {
  const u = transcriptUsage(jsonl([msg('x', [1, 5, 0, 0]), msg('x', [1, 500, 0, 0]), msg('y', [2, 20, 0, 0])]));
  assert.deepEqual(u.tokens, { input: 3, output: 520, cacheWrite: 0, cacheRead: 0 });
  assert.equal(u.messages, 2);
});

test("the agents that name no ticket of the run are the run's, on every row, and in the report's stages", (t) => {
  const w = world(t);
  ok(w.record());
  const [one, two] = w.rows();
  assert.deepEqual(one.runAgents.map((a) => [a.id, a.kind, a.tokens]), [['a6', 'simplify', { input: 1, output: 2, cacheWrite: 3, cacheRead: 4 }]]);
  assert.deepEqual(two.runAgents, one.runAgents);
  const g = JSON.parse(ok(main(['report', '--retro', w.retro, '--json'], w.deps))).groups[0];
  assert.deepEqual(g.tokensByStage.simplify, { input: 1, output: 2, cacheWrite: 3, cacheRead: 4, total: 10 }, 'counted once for the run');
  assert.equal(g.runs, 1);
});

test('the tracker, repo and base come from the tick configuration when the state has one', (t) => {
  const w = world(t);
  w.edit((s) => (s.tick = { config: { tracker: 'github', repo: 'x/y', base: 'main' } }));
  ok(w.record());
  assert.deepEqual(['repo', 'tracker', 'base'].map((k) => w.rows()[0][k]), ['x/y', 'github', 'main'], 'not gh repo view');
  // #172: the configured repo is where tick.mjs reads CI whatever the tracker
  w.edit((s) => (s.tick = { config: { tracker: 'local', repo: 'l/m', root: '/the/root', base: 'trunk' } }));
  ok(w.record());
  assert.deepEqual(['repo', 'tracker', 'base'].map((k) => w.rows()[0][k]), ['l/m', 'local', 'trunk']);
  w.edit((s) => (s.tick = { config: { tracker: 'local', repo: null, root: '/the/root', base: 'trunk' } }));
  const dirs = [];
  ok(main(['record', '--state', w.statePath, '--counters', w.counters, '--ledger', w.ledger, '--projects', w.projects, '--now', '2026-03-10T14:00:00Z'], { ...w.deps, gh: (args, dir) => (dirs.push(dir), w.deps.gh(args, dir)) }));
  // #172: without one, tick.mjs reads CI with gh's own repo of the configured root, so record asks gh there
  assert.deepEqual(['repo', 'tracker', 'base'].map((k) => w.rows()[0][k]), ['o/r', 'local', 'trunk']);
  assert.deepEqual(dirs, ['/the/root']);
  const gh = (args) => {
    if (args[0] === 'run') return JSON.stringify([{ conclusion: 'failure', createdAt: '2026-03-10T15:00:00Z', headSha: 'h1' }]);
    throw new Error(`no ${args[0]} on a local tracker`);
  };
  const e = JSON.parse(ok(main(['report', '--retro', w.retro, '--json'], { git: () => '', gh }))).groups[0].escaped;
  assert.deepEqual(e.tickets.map((s) => [s.ticket, s.mentions, s.ciRed]), [['#1', 'unknown', true]]);
  assert.deepEqual([e.delivered, e.escaped, e.unknown], [1, 1, 0]);
});

test("#172: with no tick configuration the repo is gh repo view's in the state's directory, not the origin remote; null when gh fails", (t) => {
  const w = world(t);
  const dirs = [];
  ok(main(['record', '--state', w.statePath, '--counters', w.counters, '--ledger', w.ledger, '--projects', w.projects, '--now', '2026-03-10T14:00:00Z'], { ...w.deps, gh: (args, dir) => (dirs.push(dir), w.deps.gh(args, dir)) }));
  assert.equal(w.rows()[0].repo, 'o/r', 'the origin remote is origin/remote');
  assert.deepEqual(dirs, [dirname(w.statePath)]);

  const noGh = () => {
    throw new Error('gh: not found');
  };
  ok(main(['record', '--state', w.statePath, '--counters', w.counters, '--ledger', w.ledger, '--projects', w.projects, '--now', '2026-03-10T14:00:00Z'], { ...w.deps, gh: noGh }));
  assert.deepEqual(w.rows().map((r) => r.repo), [null, null]);
  // with no repo the report cannot read CI, even with a gh that has runs to give
  const gh = (args) => (args[0] === 'run' ? JSON.stringify([{ conclusion: 'failure', createdAt: '2026-03-10T15:00:00Z', headSha: 'h1' }]) : '[]');
  const e = JSON.parse(ok(main(['report', '--retro', w.retro, '--json'], { git: () => '', gh }))).groups[0].escaped;
  assert.deepEqual(e.tickets.map((s) => [s.ticket, s.ciRed]), [['#1', 'unknown']]);
});

test('#172: record and report without --retro both use <git common dir>/sorry-matt/retro.jsonl, from the state and the --repo directories', (t) => {
  const w = world(t);
  const repoDir = join(w.dir, 'checkout');
  const asked = [];
  const git = (args, dir) => (args[0] === 'rev-parse' && asked.push([args.join(' '), dir]), w.deps.git(args, dir));
  const out = JSON.parse(ok(main(['record', '--state', w.statePath, '--counters', w.counters, '--ledger', w.ledger, '--projects', w.projects, '--now', '2026-03-10T14:00:00Z'], { ...w.deps, git })));
  assert.equal(out.retro, join(w.common, 'sorry-matt', 'retro.jsonl'));
  const r = JSON.parse(ok(main(['report', '--repo', repoDir, '--json'], { ...w.deps, git })));
  assert.equal(r.rows, 2, 'the rows record just wrote');
  assert.deepEqual(r.groups[0].escaped.tickets.map((s) => s.ticket), ['#1']);
  const q = 'rev-parse --path-format=absolute --git-common-dir';
  assert.deepEqual(asked, [[q, dirname(w.statePath)], [q, repoDir]]);
});

test('#172: record without --retro exits 1 and writes nothing when git cannot give the common dir', (t) => {
  const w = world(t);
  const before = readdirSync(dirname(w.statePath)).sort();
  const git = (args, dir) => {
    if (args[0] === 'rev-parse') throw Object.assign(new Error('git failed'), { stderr: 'fatal: not a git repository' });
    return w.deps.git(args, dir);
  };
  const r = main(['record', '--state', w.statePath, '--counters', w.counters, '--ledger', w.ledger, '--projects', w.projects, '--now', '2026-03-10T14:00:00Z'], { ...w.deps, git });
  assert.equal(r.code, 1);
  assert.match(r.err, /--retro/);
  assert.equal(existsSync(join(w.common, 'sorry-matt', 'retro.jsonl')), false);
  assert.deepEqual(readdirSync(join(w.common, 'sorry-matt')).sort(), ['runs']);
  assert.deepEqual(readdirSync(dirname(w.statePath)).sort(), before);
});

test("#172: every role word and every plugin agent's sorry-matt: type has a report stage; general-purpose is other", () => {
  const agents = readdirSync(join(ROOT, 'agents')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
  assert.ok(agents.length > 0);
  for (const role of ROLES) assert.notEqual(stageOf(kindOf({ type: 'general-purpose', description: `${role} #1` })), 'other', role);
  for (const name of agents) assert.notEqual(stageOf(kindOf({ type: `sorry-matt:${name}`, description: null })), 'other', `sorry-matt:${name}`);
  assert.equal(stageOf(kindOf({ type: 'general-purpose', description: 'look around #1' })), 'other');
  assert.equal(stageOf('constructor'), 'other', 'a key of Object.prototype is no stage');
});

test('an older state without per-ticket extensions: null when the run had some, 0 when it had none', (t) => {
  const w = world(t);
  w.edit((s) => {
    for (const x of Object.values(s.tickets)) delete x.timeoutExtensions;
    s.usage.timeoutExtensions = 2;
  });
  ok(w.record());
  assert.deepEqual(w.rows().map((r) => r.timeoutExtensions), [null, null]);
  w.edit((s) => (s.usage.timeoutExtensions = 0));
  ok(w.record());
  assert.deepEqual(w.rows().map((r) => r.timeoutExtensions), [0, 0]);
});

test('#156 F14: a state imported from a seed that counted extensions for the run only gives null, not 0', (t) => {
  const w = world(t);
  rmSync(w.statePath);
  const seed = write(join(w.dir, 'seed.json'), { run: RUN, usage: { timeoutExtensions: 2 }, tickets: { '#1': { line: LINE, stage: 'implementing', snapshotSha256: SNAP }, '#2': { line: LINE, stage: 'implementing', snapshotSha256: SNAP, timeoutExtensions: 1 } } });
  const r = state(['import', w.statePath, '--from', seed, '--now', '2026-03-10T12:00:00Z']);
  assert.equal(r.code, 0, r.err);
  ok(w.record());
  assert.deepEqual(w.rows().map((x) => [x.ticket, x.timeoutExtensions]), [['#1', null], ['#2', 1]]);
});

test('#171: an imported ticket whose seed gave no count is null after an extension; a seeded count is the count plus one', (t) => {
  const w = world(t);
  rmSync(w.statePath);
  // no run-level count in the seed either: only the extension below makes the run's count non-zero
  const seed = write(join(w.dir, 'seed.json'), { run: RUN, tickets: { '#1': { line: LINE, stage: 'expanding' }, '#2': { line: LINE, stage: 'expanding', timeoutExtensions: 0 } } });
  const S = (...argv) => {
    const r = state([argv[0], w.statePath, ...argv.slice(1), '--now', '2026-03-10T12:00:00Z']);
    assert.equal(r.code, 0, r.err);
  };
  S('import', '--from', seed);
  const out = deadline(['record', '--expansions', '#1=0', '--expansions', '#2=0', '--limit', '15', '--now', '2026-03-10T12:00:00Z']);
  assert.equal(out.code, 0, out.err);
  const rec = write(join(w.dir, 'rec.json'), out.out);
  S('assign', '#1', '#2', '--record', rec, '--type', 'sorry-matt:expander');
  S('extend', '#1', '#2', '--deadline', '2026-03-10T12:30:00Z');
  ok(w.record());
  assert.deepEqual(w.rows().map((x) => [x.ticket, x.timeoutExtensions]), [['#1', null], ['#2', 1]]);
});

test('#171: the host tokens stop at the run end the state recorded (tick.finished), else at --now', (t) => {
  const w = world(t);
  // h2 is after the run finished but before --now (a later record of the same run): not the run's
  const host = join(w.projects, 'D--code-repo', 's-1.jsonl');
  writeFileSync(host, readFileSync(host, 'utf8') + jsonl([msg('h2', [3, 30, 300, 3000], { at: '2026-03-10T13:55:00Z' })]));
  w.edit((s) => (s.tick = { finished: '2026-03-10T13:50:00Z' }));
  ok(w.record());
  assert.deepEqual(w.rows().map((r) => r.host.tokens), [{ input: 4, output: 40, cacheWrite: 400, cacheRead: 4000 }, { input: 4, output: 40, cacheWrite: 400, cacheRead: 4000 }]);
});

test('#171: without tick.finished (a run still going, or no tick at all) the host tokens run to --now', (t) => {
  const w = world(t);
  const host = join(w.projects, 'D--code-repo', 's-1.jsonl');
  writeFileSync(host, readFileSync(host, 'utf8') + jsonl([msg('h2', [3, 30, 300, 3000], { at: '2026-03-10T13:55:00Z' })]));
  ok(w.record());
  assert.deepEqual(w.rows()[0].host.tokens, { input: 7, output: 70, cacheWrite: 700, cacheRead: 7000 }, 'no tick: h1 and h2');
  w.edit((s) => (s.tick = { finished: null }));
  ok(w.record());
  assert.deepEqual(w.rows()[0].host.tokens, { input: 7, output: 70, cacheWrite: 700, cacheRead: 7000 }, 'tick.finished null: h1 and h2');
});

test('two runs recording into one retro file at the same time both keep their rows', async (t) => {
  const dir = scratch(t);
  const a = world(t, { run: 'run-a', dir: join(dir, 'a') });
  const b = world(t, { run: 'run-b', dir: join(dir, 'b') });
  const shared = join(dir, 'retro.jsonl');
  const go = (w) =>
    new Promise((done, fail) => {
      const p = spawn(process.execPath, [SCRIPT, 'record', '--state', w.statePath, '--counters', w.counters, '--ledger', w.ledger, '--projects', w.projects, '--retro', shared, '--now', '2026-03-10T14:00:00Z'], { stdio: 'ignore' });
      p.on('error', fail);
      p.on('exit', (code) => (code === 0 ? done() : fail(new Error(`record exited ${code}`))));
    });
  await Promise.all(Array.from({ length: 12 }, (_, i) => go(i % 2 ? a : b)));
  const runs = readFileSync(shared, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).run);
  assert.deepEqual([runs.filter((r) => r === 'run-a').length, runs.filter((r) => r === 'run-b').length], [2, 2]);
  assert.equal(existsSync(`${shared}.lock`), false, 'no lock left');
});

test('record keeps the review, counts, stage times and merge of each ticket', (t) => {
  const w = world(t);
  ok(w.record());
  const [one, two] = w.rows();
  assert.equal(one.endState, 'delivered');
  assert.equal(one.tier, 'full');
  // #173: reasons with a space or a comma reach the row whole, one entry each
  assert.deepEqual(one.tierReasons, ['sensitive', 'src/x.mjs#a b', 'c,d']);
  assert.deepEqual(one.reviews.map((r) => r.tierReasons), [['sensitive', 'src/x.mjs#a b', 'c,d'], ['sensitive']]);
  assert.equal(one.verdict, 'pass');
  assert.deepEqual(one.findingCounts, { candidates: 6, confirmed: 2, invalid: 4, blocking: 1 });
  assert.deepEqual(one.reviews.map((r) => [r.mode, r.verdict, r.findings]), [['initial', 'fix', 1], ['recheck', 'pass', null]]);
  assert.deepEqual([one.sendBacks, one.fixRounds, one.timeoutExtensions, one.timeoutReassignments], [0, 1, 0, 0]);
  // 12:10 → 12:40 implementing, 12:40 → 13:00 and 13:20 → 13:30 in review, 13:00 → 13:20 fixing, ...
  assert.deepEqual(one.stageSeconds, { implementing: 1800, 'in-review': 1800, fixing: 1200, queued: 300, integrating: 300 });
  assert.deepEqual([one.mergeSha, one.merges, one.deliveredAt], [SHA1, [SHA1], '2026-03-10T13:40:00Z']);
  assert.deepEqual(one.profile.review, 'full');
  assert.equal(two.endState, 'stuck');
  assert.deepEqual([two.tier, two.verdict, two.findingCounts, two.mergeSha, two.deliveredAt], [null, null, null, null, null]);
});

/** The world with a third ticket and spawns that name several tickets (#173). */
function multiTicketWorld(t) {
  const w = world(t);
  const r = state(['add', w.statePath, '#3', '--line', 'run-1/line-a', '--now', '2026-03-10T12:00:00Z']);
  assert.equal(r.code, 0, r.err);
  const counters = JSON.parse(readFileSync(w.counters, 'utf8'));
  counters.log.push(
    { id: 'a7', type: 'sorry-matt:expander', description: 'expand #1 #2 #3', at: '2026-03-10T12:05:00Z' },
    { id: null, type: 'general-purpose', description: 'expand #2 #3', at: '2026-03-10T12:06:00Z' },
    { id: 'a9', type: 'sorry-matt:expander', description: 'expand #98 #99', at: '2026-03-10T12:07:00Z' },
  );
  counters.spawns = counters.log.length;
  writeFileSync(w.counters, JSON.stringify(counters));
  write(join(w.projects, 'D--code-repo', 's-1', 'subagents', 'agent-a7.jsonl'), jsonl([msg('e1', [10, 100, 1000, 10000])]));
  return w;
}

test("#173: an agent naming several tickets of the run is in the agents and byKind of each; one naming none of them is the run's", (t) => {
  const w = multiTicketWorld(t);
  ok(w.record());
  const rows = w.rows();
  assert.deepEqual(rows.map((r) => r.ticket), ['#1', '#2', '#3']);
  const expanders = (r) => r.agents.filter((a) => a.kind === 'expand').map((a) => [a.id, a.description]);
  assert.deepEqual(expanders(rows[0]), [['a7', 'expand #1 #2 #3']]);
  assert.deepEqual(expanders(rows[1]), [['a7', 'expand #1 #2 #3'], [null, 'expand #2 #3']]);
  assert.deepEqual(expanders(rows[2]), [['a7', 'expand #1 #2 #3'], [null, 'expand #2 #3']]);
  const e = { input: 10, output: 100, cacheWrite: 1000, cacheRead: 10000 };
  assert.deepEqual(rows[0].byKind.expand, { spawns: 1, tokens: e });
  assert.deepEqual(rows[2].byKind, { expand: { spawns: 2, tokens: null, reason: 'the counters log has no agent id' } });
  // `expand #98 #99` names no ticket of this run
  assert.deepEqual(rows[0].runAgents.map((a) => a.id), ['a6', 'a9']);
  assert.deepEqual(rows[2].runAgents, rows[0].runAgents);
});

test('#173: the report counts an agent listed on several rows of its run once', (t) => {
  const w = multiTicketWorld(t);
  ok(w.record());
  const [g] = JSON.parse(ok(main(['report', '--retro', w.retro, '--json'], w.deps))).groups;
  // a7 on three rows, once: 10 + 100 + 1000 + 10000
  assert.deepEqual(g.tokensByStage.expand, { input: 10, output: 100, cacheWrite: 1000, cacheRead: 10000, total: 11110 });
  // a4 (no transcript), fix #2 (no id), expand #2 #3 (no id, on two rows: once), a9 (no transcript, the run's)
  assert.equal(g.unknownAgents, 4);
});

test('#173: a tier counts the review tokens of an agent of a run once; another run with the same id is another agent', (t) => {
  const shared = { id: 'x', kind: 'review', description: 'review #1 #2', at: '2026-03-10T12:00:00Z', tokens: tokens(0, 0, 0, 100) };
  const counted = [review('initial', 1)];
  const rows = [
    row({ run: 'r', ticket: '#1', tier: 'full', agents: [shared], reviews: counted }),
    row({ run: 'r', ticket: '#2', tier: 'full', agents: [shared], reviews: counted }),
    row({ run: 'r2', ticket: '#1', tier: 'full', agents: [shared], reviews: counted }),
    row({ run: 'r2', ticket: '#2', tier: 'light', agents: [shared], reviews: counted }),
  ];
  const [g] = reportOf(t, rows).groups;
  assert.equal(g.tokensByStage.review.total, 200, 'once in r, once in r2');
  assert.equal(g.byTier.full.reviewTokens, 200);
  assert.equal(g.byTier.light.reviewTokens, 100, "r2's agent is also on a light row");
  // without an id: the run, the description and the spawn time say who it is
  const noId = (description, at) => ({ id: null, kind: 'review', description, at, tokens: tokens(0, 0, 0, 10) });
  const rows2 = [
    row({ ticket: '#1', agents: [noId('review #1 #2', 'T1'), noId('review #1', 'T1')], reviews: counted }),
    row({ ticket: '#2', agents: [noId('review #1 #2', 'T1'), noId('review #1 #2', 'T2')], reviews: counted }),
  ];
  const [h] = reportOf(t, rows2).groups;
  assert.equal(h.tokensByStage.review.total, 30);
  assert.equal(h.byTier.standard.reviewTokens, 30);
  // --by tier: an agent on rows of two groups counts once in each
  const byTier = reportOf(t, rows.slice(2), ['--by', 'tier']).groups.map((x) => [x.key, x.tokensByStage.review.total]);
  assert.deepEqual(byTier, [['full', 100], ['light', 100]]);
});

test('a missing transcript or agent id leaves that sum null with its reason; nothing is estimated', (t) => {
  const w = world(t);
  const out = JSON.parse(ok(w.record()));
  const two = w.rows()[1];
  assert.deepEqual(two.agents.map((a) => [a.id, a.kind, a.tokens, a.reason]), [
    ['a4', 'implement', null, 'no transcript for agent a4'],
    [null, 'fix', null, 'the counters log has no agent id'],
  ]);
  assert.deepEqual(two.byKind, {
    implement: { spawns: 1, tokens: null, reason: 'no transcript for agent a4' },
    fix: { spawns: 1, tokens: null, reason: 'the counters log has no agent id' },
  });
  assert.deepEqual(out.gaps, ['no transcript for agent a4', 'the counters log has no agent id']);
});

test('without a session line, or without a counters file, the sums are null with the reason', (t) => {
  const w = world(t, { session: null });
  const out = JSON.parse(ok(w.record()));
  const one = w.rows()[0];
  assert.deepEqual(one.host, { session: null, models: [], tokens: null, reason: 'the ledger has no session: line' });
  assert.ok(one.agents.every((a) => a.tokens === null && a.reason === 'the ledger has no session: line'));
  assert.deepEqual(out.gaps, ['the ledger has no session: line']);

  rmSync(w.counters);
  ok(w.record());
  const again = w.rows()[0];
  assert.deepEqual([again.agents, again.byKind], [[], null]);
  assert.equal(again.byKindReason, `no counters file ${w.counters}`);
});

test('recording the same run again replaces its rows; other runs and lines that are not rows stay', (t) => {
  const w = world(t);
  const other = JSON.stringify({ format: 'sorry-matt/retro@1', run: 'run-0', ticket: '#9' });
  const later = JSON.stringify({ format: 'sorry-matt/retro@2', run: RUN, ticket: '#1' }); // a format this version does not write
  write(w.retro, `${other}\nnot json\n${later}\n`);
  assert.equal(JSON.parse(ok(w.record())).replaced, 0);
  const out = JSON.parse(ok(w.record()));
  assert.deepEqual([out.rows, out.replaced], [2, 2]);
  const lines = readFileSync(w.retro, 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 5);
  assert.deepEqual(lines.slice(0, 3), [other, 'not json', later]);
  assert.deepEqual(lines.slice(3).map((l) => [JSON.parse(l).run, JSON.parse(l).ticket]), [[RUN, '#1'], [RUN, '#2']]);
});

test('record and report refuse what they cannot use: exit 1 for an unreadable state or retro file, 2 for bad arguments', (t) => {
  const w = world(t);
  const missing = main(['record', '--state', join(w.dir, 'nope.json'), '--counters', w.counters, '--ledger', w.ledger], w.deps);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /nope\.json does not exist/);
  assert.equal(main(['record', '--state', w.statePath], w.deps).code, 2);
  assert.equal(main(['report', '--retro', w.retro, '--by', 'colour'], w.deps).code, 2);
  assert.equal(main(['report', '--retro', w.retro, '--since', 'May'], w.deps).code, 2);
  assert.equal(main(['report', '--retro', join(w.dir, 'none.jsonl')], w.deps).code, 1);
  assert.equal(main(['tally'], w.deps).code, 2);
});

// ---- report ----------------------------------------------------------------------------------------------------------

const tokens = (input, output, cacheWrite, cacheRead) => ({ input, output, cacheWrite, cacheRead });
/** A row as record writes it, with only the fields the report reads. */
const row = (o) => ({
  format: 'sorry-matt/retro@1',
  run: 'r',
  started: '2026-03-10T12:00:00Z',
  repo: 'o/r',
  line: 'r/l',
  endState: 'delivered',
  pluginVersion: '1.0.0',
  profile: { review: 'full' },
  models: ['m-a'],
  agents: [],
  tier: 'standard',
  reviews: [],
  merges: [],
  deliveredAt: null,
  ...o,
  mergeSha: o.merges?.[0] ?? null, // as record writes it: the first merge
});
const review = (mode, confirmed, extra = {}) => ({ mode, kind: 'full', verdict: confirmed ? 'fix' : 'pass', findingCounts: { candidates: confirmed + 1, confirmed, invalid: 1, blocking: confirmed }, ...extra });

function reportOf(t, rows, args = [], deps = {}) {
  const dir = scratch(t);
  const retro = write(join(dir, 'retro.jsonl'), jsonl(rows));
  const r = main(['report', '--retro', retro, '--json', ...args], { git: () => '', gh: () => '[]', ...deps });
  return JSON.parse(ok(r));
}

test('report: tokens by stage, review over implement + fix, and per tier the tokens per confirmed finding and the zero-confirmed share', (t) => {
  // every agent has its own id, as record writes it: the report counts an agent of a run once (#173)
  const rows = [
    row({ ticket: '#1', tier: 'full', agents: [{ id: 'g1', kind: 'implement', tokens: tokens(1, 10, 100, 1000) }, { id: 'g2', kind: 'review', tokens: tokens(2, 20, 200, 2000) }, { id: 'g3', kind: 'sorry-matt:verifier', tokens: tokens(1, 1, 1, 1) }], reviews: [review('initial', 2), review('recheck', 0)] }),
    row({ ticket: '#2', tier: 'full', agents: [{ id: 'g4', kind: 'fix', tokens: tokens(0, 0, 0, 1000) }, { id: 'g5', kind: 'finder', tokens: null, reason: 'x' }], reviews: [review('initial', 0)] }),
    row({ ticket: '#3', tier: 'light', agents: [{ id: 'g6', kind: 'review', tokens: tokens(0, 0, 0, 500) }], reviews: [{ mode: 'initial', kind: 'minimal', verdict: 'pass', findingCounts: null, findings: null }] }),
    // a prove-it review recorded without its counts: its tokens bought findings no one counted
    row({ ticket: '#4', tier: 'full', agents: [{ id: 'g7', kind: 'review', tokens: tokens(0, 0, 0, 2000) }], reviews: [{ mode: 'initial', kind: 'full', verdict: 'pass', findingCounts: null, findings: null }] }),
  ];
  const [g] = reportOf(t, rows).groups;
  assert.equal(g.key, 'all');
  assert.equal(g.tickets, 4);
  assert.deepEqual(g.tokensByStage.implement, { input: 1, output: 10, cacheWrite: 100, cacheRead: 1000, total: 1111 });
  assert.deepEqual(g.tokensByStage.fix, { input: 0, output: 0, cacheWrite: 0, cacheRead: 1000, total: 1000 });
  assert.deepEqual(g.tokensByStage.review, { input: 3, output: 21, cacheWrite: 201, cacheRead: 4501, total: 4726 });
  assert.equal(g.unknownAgents, 1);
  assert.equal(g.reviewToImplement, 4726 / 2111);
  // full: 2222 + 4 review tokens of #1 (#2's finder has none) for 2 confirmed; one of its two counted initial reviews
  // found none; #4's review has no count, so neither its review nor its 2000 tokens are in the tier's figures
  assert.deepEqual(g.byTier.full, { tickets: 3, reviews: 3, confirmed: 2, reviewTokens: 2226, unknownCounts: 1, tokensPerConfirmed: 1113, zeroConfirmedShare: 0.5 });
  // light: a minimal review that found nothing counts as zero confirmed; no finding, so no tokens per finding
  assert.deepEqual(g.byTier.light, { tickets: 1, reviews: 1, confirmed: 0, reviewTokens: 500, unknownCounts: 0, tokensPerConfirmed: null, zeroConfirmedShare: 1 });
});

test('report --by groups the rows by version, model, tier or profile; --since drops older runs', (t) => {
  const rows = [
    row({ ticket: '#1', pluginVersion: '1.0.0', models: ['m-a'], tier: 'full', profile: { review: 'full' } }),
    row({ ticket: '#2', pluginVersion: '1.1.0', models: ['m-a', 'm-b'], tier: 'light', profile: { review: 'minimal' } }),
    row({ ticket: '#3', pluginVersion: '1.1.0', models: [], tier: null, profile: { review: 'full' }, started: '2026-02-01T00:00:00Z' }),
  ];
  const keys = (args) => reportOf(t, rows, args).groups.map((g) => [g.key, g.tickets]);
  assert.deepEqual(keys(['--by', 'version']), [['1.0.0', 1], ['1.1.0', 2]]);
  assert.deepEqual(keys(['--by', 'model']), [['m-a', 1], ['m-a+m-b', 1], ['unknown', 1]]);
  assert.deepEqual(keys(['--by', 'tier']), [['full', 1], ['light', 1], ['none', 1]]);
  assert.deepEqual(keys(['--by', 'profile']), [['review=full', 2], ['review=minimal', 1]]);
  assert.deepEqual(keys(['--by', 'version', '--since', '2026-03-01']), [['1.0.0', 1], ['1.1.0', 1]]);
  const out = reportOf(t, rows, ['--since', '2026-03-01']);
  assert.deepEqual([out.rows, out.since, out.by], [2, '2026-03-01', null]);
});

test('report: escaped defects from newer tickets naming the ticket or its merge, reverts and red CI; unknown without gh', (t) => {
  const sha = 'abcdef1234567890abcdef1234567890abcdef12';
  const rows = [
    row({ ticket: '#1', merges: [sha], deliveredAt: '2026-03-10T13:00:00Z' }),
    row({ ticket: '#2', merges: ['2'.repeat(40)], deliveredAt: '2026-03-10T13:00:00Z' }),
    row({ ticket: '#3', merges: ['3'.repeat(40)], deliveredAt: '2026-03-10T13:00:00Z', line: 'r/red' }),
    row({ ticket: '#4', endState: 'stuck', merges: ['4'.repeat(40)], deliveredAt: '2026-03-10T13:00:00Z' }),
    row({ ticket: '#5', endState: 'stuck' }), // never delivered: not counted
  ];
  const issues = [
    { number: 7, title: 'regression', body: 'broke after #1 landed', createdAt: '2026-03-11T00:00:00Z' },
    { number: 8, title: 'old', body: 'mentions #2 but before it was delivered', createdAt: '2026-03-01T00:00:00Z' },
    { number: 9, title: `bad merge ${sha.slice(0, 7)}`, body: '', createdAt: '2026-03-12T00:00:00Z' },
    { number: 10, title: 'not it', body: 'see #11 and #1a', createdAt: '2026-03-12T00:00:00Z' },
  ];
  const gh = (args) => {
    if (args[0] === 'issue') return JSON.stringify(issues);
    // a run on `post` has the ticket's merge, one on `pre` does not
    if (args[0] === 'run') return JSON.stringify(args.includes('r/red') ? [ciRun('failure', '2026-03-10T14:00:00Z', 'post')] : [ciRun('failure', '2026-03-10T12:00:00Z', 'pre'), ciRun('success', '2026-03-10T14:00:00Z', 'post')]);
    throw new Error(args.join(' '));
  };
  const covers = ancestry({ covering: ['post'] });
  const git = (args, cwd) => (args[0] === 'log' ? `fix\n\nThis reverts commit ${'2'.repeat(40)}.\n` : covers(args, cwd));
  const e = reportOf(t, rows, [], { gh, git }).groups[0].escaped;
  assert.deepEqual([e.delivered, e.escaped, e.unknown], [4, 4, 0]);
  assert.deepEqual(e.tickets.map((s) => [s.ticket, s.mentions, s.reverted, s.ciRed]), [
    ['#1', ['#7', '#9'], false, false],
    ['#2', [], true, false],
    ['#3', [], false, true],
    ['#4', [], true, false],
  ]);

  // gh missing: what only gh can tell is unknown; the revert from git still counts, and the report is still written
  const none = reportOf(t, rows, [], { gh: () => { throw new Error('gh: not found'); }, git }).groups[0].escaped;
  assert.deepEqual(none.tickets.map((s) => [s.ticket, s.mentions, s.reverted, s.ciRed]), [
    ['#1', 'unknown', false, 'unknown'],
    ['#2', 'unknown', true, 'unknown'],
    ['#3', 'unknown', false, 'unknown'],
    ['#4', 'unknown', true, 'unknown'],
  ]);
  assert.deepEqual([none.escaped, none.unknown], [2, 2]);
});

test("report: CI of the base branch under integrate: direct; an upstream revert is not the ticket's; a local tracker has no mentions to read", (t) => {
  const at = '2026-03-10T13:00:00Z';
  const rows = [
    row({ ticket: '#1', merges: ['1'.repeat(40)], deliveredAt: at, profile: { review: 'full', integrate: 'direct' }, base: 'main' }),
    row({ ticket: '#2', endState: 'stuck', reason: 'upstream reverted: #9 (abc1234)', merges: ['2'.repeat(40)], deliveredAt: at }),
    row({ ticket: '#3', tracker: 'local', merges: ['3'.repeat(40)], deliveredAt: at }),
  ];
  const gh = (args) => {
    if (args[0] === 'issue') return JSON.stringify([{ number: 7, title: 'broke #3', body: '', createdAt: '2026-03-11T00:00:00Z' }]);
    if (args[0] === 'run') return JSON.stringify(args.includes('main') ? [ciRun('failure', '2026-03-10T14:00:00Z', 'h1')] : []);
    throw new Error(args.join(' '));
  };
  const e = reportOf(t, rows, [], { gh, git: () => 'nothing reverted\n' }).groups[0].escaped;
  assert.deepEqual(e.tickets.map((s) => [s.ticket, s.mentions, s.reverted, s.ciRed]), [
    ['#1', [], false, true],
    ['#2', [], false, false],
    ['#3', 'unknown', false, false],
  ]);
  assert.deepEqual([e.escaped, e.unknown], [1, 1]);
});

/** A fake `git` whose `merge-base --is-ancestor <merge> <head>` holds for the heads in `covering`, exits 1 for the
 * other heads, and fails like a SHA missing here for the heads in `failing`; each call's cwd and merge go into `calls`. */
const ancestry = ({ covering = [], failing = [], calls = [] } = {}) => (args, cwd) => {
  if (args[0] !== 'merge-base') return '';
  calls.push({ cwd, merge: args[2] });
  assert.deepEqual(args.slice(0, 2), ['merge-base', '--is-ancestor']);
  const head = args[3];
  if (covering.includes(head)) return '';
  const e = new Error(failing.includes(head) ? `fatal: Not a valid commit name ${head}` : 'not an ancestor');
  e.status = failing.includes(head) ? 128 : 1;
  throw e;
};
const ciRun = (conclusion, createdAt, headSha) => ({ conclusion, createdAt, headSha });

test('#171: ciRed is the first finished run that covers the delivery merge going red from green', (t) => {
  const dir = scratch(t);
  const at = '2026-03-10T13:00:00Z';
  const tickets = ['#1', '#2', '#3', '#4', '#5'];
  const rows = tickets.map((id, i) => row({ ticket: id, line: `r/l${i + 1}`, merges: [`${i + 1}`.repeat(40), 'f'.repeat(40)], deliveredAt: at }));
  const runs = {
    // green, then the first run with the merge red; a cancelled and a running one in between are not results; the
    // list comes in any order
    'r/l1': [ciRun('failure', '2026-03-10T14:00:00Z', 'c1'), ciRun('', '2026-03-10T13:40:00Z', 'c1b'), ciRun('cancelled', '2026-03-10T13:30:00Z', 'c1a'), ciRun('success', '2026-03-10T12:00:00Z', 'n1')],
    // no finished run before it: the line was green from its base
    'r/l2': [ciRun('failure', '2026-03-10T14:00:00Z', 'c2')],
    // red before the delivery: not this ticket's red
    'r/l3': [ciRun('failure', '2026-03-10T12:00:00Z', 'n3'), ciRun('failure', '2026-03-10T14:00:00Z', 'c3')],
    // green with the merge, red later (another ticket delivered after it)
    'r/l4': [ciRun('success', '2026-03-10T12:00:00Z', 'n4'), ciRun('success', '2026-03-10T14:00:00Z', 'c4'), ciRun('failure', '2026-03-10T15:00:00Z', 'c4b')],
    // no run has the merge (a red one after the delivery time on a head without it is still not this ticket's)
    'r/l5': [ciRun('success', '2026-03-10T12:00:00Z', 'n5'), ciRun('failure', '2026-03-10T14:00:00Z', 'n5b')],
  };
  const gh = (args) => {
    if (args[0] === 'run') return JSON.stringify(runs[args[args.indexOf('--branch') + 1]]);
    return '[]';
  };
  const calls = [];
  const git = ancestry({ covering: ['c1', 'c1a', 'c1b', 'c2', 'c3', 'c4', 'c4b'], calls });
  const e = reportOf(t, rows, ['--repo', dir], { gh, git }).groups[0].escaped;
  assert.deepEqual(e.tickets.map((s) => [s.ticket, s.ciRed]), [['#1', true], ['#2', true], ['#3', false], ['#4', false], ['#5', false]]);
  assert.ok(calls.length > 0 && calls.every((c) => c.cwd === dir), 'git runs in the --repo directory');
  // the delivery merge, never the -ci merge after it
  assert.deepEqual([...new Set(calls.map((c) => c.merge))].sort(), tickets.map((_, i) => `${i + 1}`.repeat(40)));
});

test('#171: ciRed is unknown when git cannot tell whether a run that decides it covers the merge; the report goes on', (t) => {
  const at = '2026-03-10T13:00:00Z';
  const rows = [
    row({ ticket: '#1', line: 'r/l1', merges: ['1'.repeat(40)], deliveredAt: at }),
    row({ ticket: '#2', line: 'r/l2', merges: ['2'.repeat(40)], deliveredAt: at }),
  ];
  const runs = {
    // x1 red after green: whether it has the merge decides between true and false
    'r/l1': [ciRun('success', '2026-03-10T12:00:00Z', 'n1'), ciRun('failure', '2026-03-10T14:00:00Z', 'x1')],
    // the line was red already: false whether x2 has the merge or not
    'r/l2': [ciRun('failure', '2026-03-10T12:00:00Z', 'n2'), ciRun('failure', '2026-03-10T14:00:00Z', 'x2')],
  };
  const gh = (args) => (args[0] === 'run' ? JSON.stringify(runs[args[args.indexOf('--branch') + 1]]) : '[]');
  const e = reportOf(t, rows, [], { gh, git: ancestry({ failing: ['x1', 'x2'] }) }).groups[0].escaped;
  assert.deepEqual(e.tickets.map((s) => [s.ticket, s.ciRed]), [['#1', 'unknown'], ['#2', false]]);
  assert.deepEqual([e.delivered, e.escaped, e.unknown], [2, 0, 1]);
  // git not there at all: every coverage question fails
  const none = reportOf(t, rows, [], { gh, git: () => { throw new Error('spawn git ENOENT'); } }).groups[0].escaped;
  assert.deepEqual(none.tickets.map((s) => [s.ticket, s.ciRed]), [['#1', 'unknown'], ['#2', 'unknown']], 'n2 may have the merge too');
});

test('report without --json writes a Markdown table per group, unknown where a value is missing', (t) => {
  const dir = scratch(t);
  const retro = write(join(dir, 'retro.jsonl'), jsonl([row({ ticket: '#1', agents: [{ kind: 'review', tokens: tokens(0, 0, 0, 10) }], deliveredAt: '2026-03-10T13:00:00Z', merges: ['1'.repeat(40)] })]));
  const md = ok(main(['report', '--retro', retro, '--by', 'tier'], { git: () => { throw new Error('no git'); }, gh: () => { throw new Error('no gh'); } }));
  assert.match(md, /^# Retro report by tier$/m);
  assert.match(md, /^## standard$/m);
  assert.match(md, /^\| review \| 0 \| 0 \| 0 \| 10 \| 10 \|$/m);
  assert.match(md, /review \/ implement \+ fix tokens: unknown/);
  assert.match(md, /^\| r \| #1 \| unknown \| unknown \| unknown \|$/m);
});

test('the scripts are in CI and in the targeted checks table', () => {
  const ci = readFileSync(join(ROOT, '.github', 'workflows', 'check.yml'), 'utf8');
  assert.match(ci, /scripts\/retro\.test\.mjs/);
  const commands = readFileSync(join(ROOT, 'docs', 'agents', 'commands.md'), 'utf8');
  assert.match(commands, /\| `src\/skills\/get-to-work\/scripts\/retro\.mjs` \| `scripts\/retro\.test\.mjs` \|/);
});
