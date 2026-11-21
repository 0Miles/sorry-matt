// node --test scripts/retro.test.mjs
// Drives retro.mjs through main() on fake counters, state and transcript files in a temp dir. The state is written by
// state.mjs's own main, so the two scripts are checked against each other; every expected token count is a literal
// summed by hand from the fixture transcripts below, not recomputed the way the script does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { main, transcriptUsage } from '../src/skills/get-to-work/scripts/retro.mjs';
import { main as state } from '../src/skills/get-to-work/scripts/state.mjs';

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
  const runs = join(dir, 'common', 'sorry-matt', 'runs');
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
  S('review', '2026-03-10T13:00:00Z', '#1', '--mode', 'initial', '--verdict', 'fix', '--tier', 'full', '--tier-reasons', 'sensitive', '--findings', 'F1', '--candidates', '6', '--confirmed', '2', '--invalid', '4', '--blocking', '1');
  S('stage', '2026-03-10T13:00:00Z', 'fixing', '#1');
  S('stage', '2026-03-10T13:20:00Z', 'in-review', '#1');
  S('review', '2026-03-10T13:30:00Z', '#1', '--mode', 'recheck', '--verdict', 'pass', '--tier', 'full', '--tier-reasons', 'sensitive', '--candidates', '0', '--confirmed', '0', '--invalid', '0', '--blocking', '0');
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

  const deps = {
    git: (args) => {
      if (args[0] === 'remote') return 'git@github.com:o/r.git\n';
      throw new Error('no git here');
    },
    gh: () => {
      throw new Error('gh: not found');
    },
    clock: () => Date.parse('2026-03-10T14:00:00Z'),
    env: {},
  };
  const retro = join(dir, 'common', 'sorry-matt', 'retro.jsonl');
  const record = (...extra) => main(['record', '--state', statePath, '--counters', counters, '--ledger', ledger, '--projects', projects, '--now', '2026-03-10T14:00:00Z', ...extra], deps);
  const rows = () => readFileSync(retro, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  /** Changes the state file by hand: a field an older state lacks, or the tick configuration. */
  const edit = (fn) => {
    const s = JSON.parse(readFileSync(statePath, 'utf8'));
    fn(s);
    writeFileSync(statePath, JSON.stringify(s));
  };
  return { dir, statePath, counters, ledger, projects, retro, record, rows, deps, edit, run: RUN };
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
  assert.deepEqual(['repo', 'tracker', 'base'].map((k) => w.rows()[0][k]), ['x/y', 'github', 'main'], 'not the origin remote');
  w.edit((s) => (s.tick = { config: { tracker: 'local', repo: null, root: '/the/root', base: 'trunk' } }));
  const dirs = [];
  ok(main(['record', '--state', w.statePath, '--counters', w.counters, '--ledger', w.ledger, '--projects', w.projects, '--now', '2026-03-10T14:00:00Z'], { ...w.deps, git: (args, dir) => (dirs.push(dir), w.deps.git(args, dir)) }));
  // #156 F13: a Local Markdown run still reads CI on its origin remote, the configured root's
  assert.deepEqual(['repo', 'tracker', 'base'].map((k) => w.rows()[0][k]), ['o/r', 'local', 'trunk']);
  assert.deepEqual(dirs, ['/the/root']);
  const gh = (args) => {
    if (args[0] === 'run') return JSON.stringify([{ conclusion: 'failure', createdAt: '2026-03-10T15:00:00Z' }]);
    throw new Error(`no ${args[0]} on a local tracker`);
  };
  const e = JSON.parse(ok(main(['report', '--retro', w.retro, '--json'], { git: () => '', gh }))).groups[0].escaped;
  assert.deepEqual(e.tickets.map((s) => [s.ticket, s.mentions, s.ciRed]), [['#1', 'unknown', true]]);
  assert.deepEqual([e.delivered, e.escaped, e.unknown], [1, 1, 0]);
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
  assert.deepEqual(one.tierReasons, ['sensitive']);
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
  assert.match(missing.err, /no such file/);
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
});
const review = (mode, confirmed, extra = {}) => ({ mode, kind: 'full', verdict: confirmed ? 'fix' : 'pass', findingCounts: { candidates: confirmed + 1, confirmed, invalid: 1, blocking: confirmed }, ...extra });

function reportOf(t, rows, args = [], deps = {}) {
  const dir = scratch(t);
  const retro = write(join(dir, 'retro.jsonl'), jsonl(rows));
  const r = main(['report', '--retro', retro, '--json', ...args], { git: () => '', gh: () => '[]', ...deps });
  return JSON.parse(ok(r));
}

test('report: tokens by stage, review over implement + fix, and per tier the tokens per confirmed finding and the zero-confirmed share', (t) => {
  const rows = [
    row({ ticket: '#1', tier: 'full', agents: [{ kind: 'implement', tokens: tokens(1, 10, 100, 1000) }, { kind: 'review', tokens: tokens(2, 20, 200, 2000) }, { kind: 'sorry-matt:verifier', tokens: tokens(1, 1, 1, 1) }], reviews: [review('initial', 2), review('recheck', 0)] }),
    row({ ticket: '#2', tier: 'full', agents: [{ kind: 'fix', tokens: tokens(0, 0, 0, 1000) }, { kind: 'finder', tokens: null, reason: 'x' }], reviews: [review('initial', 0)] }),
    row({ ticket: '#3', tier: 'light', agents: [{ kind: 'review', tokens: tokens(0, 0, 0, 500) }], reviews: [{ mode: 'initial', kind: 'minimal', verdict: 'pass', findingCounts: null, findings: null }] }),
    // a prove-it review recorded without its counts: its tokens bought findings no one counted
    row({ ticket: '#4', tier: 'full', agents: [{ kind: 'review', tokens: tokens(0, 0, 0, 2000) }], reviews: [{ mode: 'initial', kind: 'full', verdict: 'pass', findingCounts: null, findings: null }] }),
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
    if (args[0] === 'run') return JSON.stringify(args.includes('r/red') ? [{ conclusion: 'failure', createdAt: '2026-03-10T14:00:00Z' }] : [{ conclusion: 'failure', createdAt: '2026-03-10T12:00:00Z' }, { conclusion: 'success', createdAt: '2026-03-10T14:00:00Z' }]);
    throw new Error(args.join(' '));
  };
  const git = (args) => (args[0] === 'log' ? `fix\n\nThis reverts commit ${'2'.repeat(40)}.\n` : '');
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
    if (args[0] === 'run') return JSON.stringify(args.includes('main') ? [{ conclusion: 'failure', createdAt: '2026-03-10T14:00:00Z' }] : []);
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
