// node --test scripts/tick.test.mjs
// Replays of get-to-work's wake-ups through tick.mjs. Each test builds a real git repository with a bare origin and
// an integration worktree, a real state file (state.mjs), and plays the host: it runs every action tick hands out
// and records each result. Scripts run for real (state, deadline, brief, overlap, integrate, verify, git); only the network is canned
// (ci.mjs verdicts, frontier.mjs github, acceptance.mjs github, gh). The expected values are the pipeline's rules
// as SKILL.md states them, written here by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main as tick } from '../src/skills/get-to-work/scripts/tick.mjs';
import { main as stateMain } from '../src/skills/get-to-work/scripts/state.mjs';
import { main as deadlineMain } from '../src/skills/get-to-work/scripts/deadline.mjs';
import { main as briefMain } from '../src/skills/get-to-work/scripts/brief.mjs';
import { main as overlapMain } from '../src/skills/get-to-work/scripts/overlap.mjs';
import { main as integrateMain } from '../src/skills/get-to-work/scripts/integrate.mjs';
import { main as verifyMain } from '../src/skills/get-to-work/scripts/verify.mjs';
import { itemsHash } from '../src/skills/get-to-work/scripts/acceptance.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const REPO = 'o/r';
const LINE = 'r1/line-1';
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: ENV }).trim();
const write = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
const numOf = (id) => String(id).replace(/^#/, '');

class Crash extends Error {}

/** A run with tickets #1 and #2 on one line, set up as the freeze leaves it. */
function world(t, { profile = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sorry-matt-tick-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const origin = join(dir, 'origin.git');
  const repo = join(dir, 'repo');
  const intWt = join(dir, 'int');
  git(dir, 'init', '-q', '--bare', '-b', 'main', origin);
  git(dir, 'init', '-q', '-b', 'main', repo);
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'core.autocrlf', 'false');
  git(repo, 'config', 'user.name', 't'); // integrate.mjs commits with the repository's identity
  git(repo, 'config', 'user.email', 't@t');
  write(join(repo, 'README.md'), 'hello\n');
  write(join(repo, 'docs', 'agents', 'commands.md'), '# Commands\n\n## Full checks\n\n```bash\nnode -e "process.exit(0)"\n```\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'init');
  git(repo, 'remote', 'add', 'origin', origin);
  git(repo, 'push', '-q', '-u', 'origin', 'main');
  git(repo, 'worktree', 'add', '-q', '-b', LINE, intWt, 'main');
  git(intWt, 'push', '-q', '-u', 'origin', LINE);
  const runs = join(dir, 'runs');
  mkdirSync(runs, { recursive: true });
  const path = join(runs, 'r1.state.json');
  const W = join(runs, 'r1');

  const h = {
    line: profile?.integrate === 'direct' ? 'main' : LINE, // integrate: direct merges into the base branch itself
    dir,
    repo,
    intWt,
    path,
    W,
    now: Date.parse('2026-05-01T10:00:00Z'),
    agents: 0,
    log: [], // every action handed out, with the wake-up it came in
    wakes: [],
    reportsNext: [],
    titles: { '#1': 'First thing', '#2': 'Second thing' },
    blockers: {},
    acceptance: {},
    ci: () => 'green',
    agentOf: {}, // agent id → { tickets, role }
    silent: new Set(), // agents that do no work and never report
    crashAfter: null, // (action) => true to stop right after running it, before recording
    policy: {},
  };
  h.iso = () => new Date(h.now).toISOString().replace(/\.\d{3}Z$/, 'Z');
  h.S = (...args) => {
    const r = stateMain([args[0], path, ...args.slice(1), '--now', h.iso()]);
    assert.equal(r.code, 0, r.err);
    return JSON.parse(r.out);
  };
  h.state = () => JSON.parse(readFileSync(path, 'utf8'));
  h.tick = (...args) => tick([...args, '--now', h.iso()]);

  h.S('init', '--run', 'r1');
  h.S('add', '#1', '#2', '--line', h.line);
  h.S('line', h.line, '--tip', git(intWt, 'rev-parse', 'HEAD'));
  if (profile) h.S('profile', ...Object.entries(profile).flatMap(([k, v]) => [`--${k}`, String(v)]));
  write(join(W, 'files', '1.txt'), 'a.txt\n');
  write(join(W, 'files', '2.txt'), 'b.txt\n');
  const s = h.tick('setup', path, '--tracker', 'github', '--repo', REPO, '--root', repo, '--base', 'main', '--worktrees', join(dir, 'wts'));
  assert.equal(s.code, 0, s.err);

  h.record = (id, ...flags) => {
    const r = h.tick('record', path, id, ...flags);
    assert.equal(r.code, 0, `${id}: ${r.err}`);
    return JSON.parse(r.out);
  };

  // ---- the canned network ----
  h.verdict = (args) => {
    const i = args.indexOf('verdict');
    const [branch, sha] = args.slice(i + 1).filter((x, k, all) => x !== '--repo' && all[k - 1] !== '--repo');
    const verdict = h.ci(branch, sha);
    const runs =
      verdict === 'running'
        ? [{ id: 7, workflow: 'check', status: 'in_progress', conclusion: null }]
        : verdict === 'no-run'
          ? []
          : [{ id: 7, workflow: 'check', status: 'completed', conclusion: verdict === 'red' ? 'failure' : 'success' }];
    return { format: 'sorry-matt/ci@1', command: 'verdict', branch, sha, verdict, reason: verdict === 'no-run' ? 'empty' : null, error: null, runs, rerun: [] };
  };
  h.frontier = (args) => {
    const flag = (name) => (args.includes(name) ? new Set(args[args.indexOf(name) + 1].split(',')) : new Set());
    const done = flag('--done');
    const stuck = flag('--stuck');
    const ids = args.filter((x, k) => x.startsWith('#') && !['--done', '--stuck'].includes(args[k - 1]));
    const stateOf = (id) => (done.has(numOf(id)) ? 'done' : stuck.has(numOf(id)) ? 'stuck' : 'open');
    const tickets = ids.map((id) => {
      const blockedBy = (h.blockers[id] ?? []).map((b) => ({ id: b, state: stateOf(b), inSet: true }));
      const ready = stateOf(id) === 'open' && blockedBy.every((b) => b.state === 'done');
      return { id, title: h.titles[id], state: stateOf(id), trackerState: 'open', blockedBy, line: '#1', ready, stalled: null };
    });
    return { format: 'sorry-matt/frontier@1', tracker: 'github', source: REPO, tickets, lines: [ids], frontier: tickets.filter((x) => x.ready).map((x) => x.id), warnings: [] };
  };
  h.accept = (args) => {
    const id = `#${args[args.indexOf('--repo') + 2]}`;
    const spec = h.acceptance[id] ?? { items: [{ from: 'original', text: `criterion of ${id}` }], expansions: [] };
    const out = { format: 'sorry-matt/acceptance@1', tracker: 'github', source: REPO, id, title: h.titles[id], items: spec.items, expansions: spec.expansions, needsExpansion: spec.items.length === 0, sha256: itemsHash(spec.items) };
    if (args.includes('--against')) out.check = { against: args[args.indexOf('--against') + 1], snapshotIntact: true, changed: false, removed: [], added: [] };
    return out;
  };

  // ---- the host ----
  h.exec = (a) => {
    const [cmd, ...args] = a.argv;
    let code = 0;
    let out = '';
    if (cmd === 'node') {
      const script = basename(args[0]);
      const rest = args.slice(1);
      let r;
      if (script === 'state.mjs') r = stateMain(rest[0] === 'check' ? rest : [...rest, '--now', h.iso()]);
      else if (script === 'integrate.mjs') r = integrateMain([...rest, '--now', h.iso()]);
      else if (script === 'verify.mjs') r = verifyMain([...rest, '--now', h.iso()]);
      else if (script === 'deadline.mjs') r = deadlineMain(rest[0] === 'record' ? [...rest, '--now', h.iso()] : rest);
      else if (script === 'brief.mjs') r = briefMain(rest);
      else if (script === 'overlap.mjs') r = overlapMain(rest);
      else if (script === 'ci.mjs') r = { code: 0, out: JSON.stringify(h.verdict(rest)) };
      else if (script === 'frontier.mjs') r = { code: 0, out: JSON.stringify(h.frontier(rest)) };
      else if (script === 'acceptance.mjs') r = { code: 0, out: JSON.stringify(h.accept(rest)) };
      else throw new Error(`no stand-in for ${script}`);
      ({ code, out } = r);
      assert.ok(code === 0 || a.okExit.includes(code), `${a.id}: ${r.err}`);
    } else if (cmd === 'git') {
      try {
        out = execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: ENV });
      } catch (e) {
        code = e.status ?? 1;
      }
    } else if (cmd === 'gh') {
      if (args[0] === 'issue') out = `title: ${h.titles[`#${args[2]}`]}\n\nThe ticket text of #${args[2]}.\n`;
      else if (args[0] === 'run' && args[1] === 'list') out = '[]';
    } else throw new Error(`unknown command ${cmd}`);
    if (a.stdout) write(a.stdout, out);
    return code;
  };

  /** An agent does its work: a commit in its worktree, and its report arrives at the next wake-up. */
  h.work = (agent, tid) => {
    if (h.silent.has(agent)) return;
    const st = h.state();
    const wt = st.tickets[tid].assignment?.worktree;
    if (wt) {
      const file = join(wt, numOf(tid) === '1' ? 'a.txt' : 'b.txt');
      write(file, `${agent} ${(h.commits = (h.commits ?? 0) + 1)}\n`);
      git(wt, 'add', '-A');
      git(wt, 'commit', '-q', '-m', `work by ${agent}`);
    }
    h.reportsNext.push(agent);
  };

  const DEFAULTS = {
    collect: (a) => ({ implementing: 'green', expanding: 'reported', fixing: 'fixed', integrating: 'resolved' })[a.meta.stage] ?? 'logged',
    review: () => 'pass',
    'review-stuck': () => 'stuck',
    predict: () => 'written',
    send: (a) => {
      const st = h.state();
      h.work(st.tickets[a.tickets[0]].assignment.agentId ?? h.state().tick.flags[a.tickets[0]].pending.prevAgent, a.tickets[0]);
      return 'sent';
    },
    ignore: () => 'logged',
    timeout: () => 'reassign',
    'red-light': () => 'handled',
    'file-issue': () => ({ outcome: 'filed', value: '#99' }),
    'verify-local': () => 'green',
    'deliver-ticket': () => 'done',
    'deliver-line': () => 'done',
    simplify: () => 'done',
    'wrap-up': () => 'done',
    'wakeup-end': () => 'done',
  };

  h.judge = (a) => {
    const fn = h.policy[a.step] ?? DEFAULTS[a.step];
    if (!fn) throw new Error(`no policy for ${a.step}: ${a.do}`);
    let r = fn(a);
    if (typeof r === 'string') r = { outcome: r };
    const flags = ['--outcome', r.outcome];
    for (const k of ['value', 'findings', 'fixed', 'unfixed', 'agent']) if (r[k] !== undefined) flags.push(`--${k}`, r[k]);
    return flags;
  };

  h.spawn = (a) => {
    const agent = `a${++h.agents}`;
    const role = a.spawn.description.split(' ')[0];
    h.agentOf[agent] = { tickets: a.tickets, role };
    if (a.step === 'review') {
      const r = (h.policy.review ?? DEFAULTS.review)(a);
      const v = typeof r === 'string' ? { outcome: r } : r;
      return ['--agent', agent, '--outcome', v.outcome, ...(v.findings ? ['--findings', v.findings] : [])];
    }
    return { agent, flags: ['--agent', agent] };
  };

  /** Runs the actions batch by batch and records each. */
  h.run = (actions) => {
    const sorted = [...actions].sort((x, y) => x.batch - y.batch);
    for (const a of sorted) {
      h.log.push({ ...a, wakeup: h.wakes.length });
      if (a.kind === 'exec') {
        const code = h.exec(a);
        if (h.crashAfter?.(a)) throw new Crash(a.id);
        h.record(a.id, '--exit', String(code));
      } else if (a.kind === 'spawn') {
        const r = h.spawn(a);
        if (h.crashAfter?.(a)) throw new Crash(a.id);
        if (Array.isArray(r)) h.record(a.id, ...r);
        else {
          h.record(a.id, ...r.flags);
          if (r.agent && h.agentOf[r.agent].role === 'expand') {
            for (const tid of a.tickets) {
              h.acceptance[tid] = {
                items: [{ from: 'expansion', by: 'x', run: 'r1', round: '1', text: `expanded criterion of ${tid}` }],
                expansions: [{ by: 'x', run: 'r1', round: '1', at: 'u', text: '<!-- sorry-matt:expansion -->\nby: x' }],
              };
            }
            h.reportsNext.push(r.agent);
          } else if (r.agent) h.work(r.agent, a.tickets[0]);
        }
      } else {
        h.record(a.id, ...h.judge(a));
      }
    }
  };

  /** One wake-up: `next` until it says end (or done); returns every `next` output of it. */
  h.wake = ({ reported, minutes = 5 } = {}) => {
    h.now += minutes * 60_000;
    const reports = reported ?? h.reportsNext.splice(0);
    const outs = [];
    h.wakes.push(outs);
    for (let i = 0; i < 80; i += 1) {
      const r = h.tick('next', path, ...(i === 0 ? reports.flatMap((x) => ['--reported', x]) : []));
      assert.equal(r.code, 0, r.err);
      const out = JSON.parse(r.out);
      outs.push(out);
      h.run(out.actions);
      if (out.then !== 'tick') return outs;
    }
    throw new Error('the wake-up did not end');
  };
  h.actions = (outs) => outs.flatMap((o) => o.actions);
  return h;
}

const ids = (actions) => actions.map((a) => a.id);
const stage = (h, id) => h.state().tickets[id].stage;

test('a plain run: dispatch, close-out, finish, in batches', (t) => {
  const h = world(t);
  const w1 = h.wake();
  const a1 = h.actions(w1);
  // the first dispatch point: progress, CI, frontier, acceptance, overlap, then a branch and an agent per ticket
  assert.deepEqual(w1[0].dispatch.reasons, ['first wake-up']);
  const spawns = a1.filter((a) => a.kind === 'spawn');
  assert.deepEqual(spawns.map((a) => a.spawn.description).sort(), ['implement #1', 'implement #2']);
  assert.ok(spawns.every((a) => a.spawn.subagent_type === 'sorry-matt:implementer' && a.spawn.background));
  // #107: what does not depend on each other goes out in one batch; the assignment record comes before the spawn
  const last = w1.find((o) => o.actions.some((a) => a.kind === 'spawn'));
  const at = Object.fromEntries(last.actions.map((a) => [a.id, a.batch]));
  const branch1 = last.actions.find((a) => a.step === 'ticket-branch' && a.tickets[0] === '#1');
  const branch2 = last.actions.find((a) => a.step === 'ticket-branch' && a.tickets[0] === '#2');
  assert.equal(branch1.batch, 1);
  assert.equal(branch2.batch, 1);
  assert.ok(at['rec:#1:1'] < at['assign:#1:1'] && at['assign:#1:1'] < at['spawn:#1:1']);
  assert.equal(at['spawn:#1:1'], at['spawn:#2:1']);
  assert.equal(w1.at(-1).then, 'end');
  assert.ok(w1.at(-1).fallback, 'agents in flight: a fallback wake-up');
  assert.equal(w1.at(-1).actions.at(-1).step, 'wakeup-end');
  assert.equal(stage(h, '#1'), 'implementing');

  const w2 = h.wake();
  assert.deepEqual(w2[0].reports.map((r) => [r.agent, r.accepted, r.why]), [
    ['a1', true, 'current'],
    ['a2', true, 'current'],
  ]);
  assert.equal(stage(h, '#1'), 'delivered');
  assert.equal(stage(h, '#2'), 'delivered');
  const st = h.state();
  // one --no-ff merge commit per ticket, its SHA recorded, the line's tip at the last one, pushed
  const tip = git(h.intWt, 'rev-parse', 'HEAD');
  assert.equal(st.tickets['#2'].merges[0].sha, tip);
  assert.equal(git(h.repo, 'rev-parse', `origin/${LINE}`), tip);
  assert.equal(git(h.intWt, 'rev-list', '--first-parent', '--merges', '--count', `main..${LINE}`), '2');
  // the ticket worktrees and branches are gone
  assert.equal(git(h.repo, 'branch', '--list', 'r1/0*'), '');
  // a dispatch point after the integration, which finds nothing left; then the finish, in the same wake-up
  assert.ok(w2.some((o) => o.dispatch?.reasons.includes('a ticket was integrated')));
  const steps = h.actions(w2).map((a) => a.step);
  const order = ['simplify', 'sync-base', 'deliver-line', 'wrap-up'].map((s) => steps.indexOf(s));
  assert.ok(order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1])), `the finish in order: ${order}`);
  assert.deepEqual([h.state().lines[LINE].ci.sha, h.state().lines[LINE].ci.verdict], [git(h.intWt, 'rev-parse', 'HEAD'), 'green'], 'verified at the latest SHA');
  assert.equal(w2.at(-1).then, 'done');
  assert.ok(h.state().lines[LINE].base.synced);
  const w3 = h.wake();
  assert.deepEqual([w3.length, w3[0].then, w3[0].actions], [1, 'done', []]);
  // every action points to what it needs to read
  assert.ok(h.log.every((a) => a.reference.length && a.reference.every((r) => r.path || r.skill)));
});

test("the ledger's limits stop the run at a dispatch point: what was not dispatched awaits a ruling", (t) => {
  const h = world(t);
  const ledger = join(h.dir, 'runs', 'r1.md');
  write(ledger, '<!-- sorry-matt:run active -->\n- `budget: rounds 1`\n- budget: timeout-implement 45\n');
  assert.equal(h.tick('setup', h.path, '--tracker', 'github', '--repo', REPO, '--root', h.repo, '--base', 'main', '--ledger', ledger, '--worktrees', join(h.dir, 'wts')).code, 0);
  h.blockers['#2'] = ['#1'];
  const w1 = h.wake();
  const rec = h.actions(w1).find((a) => a.id === 'rec:#1:1');
  assert.equal(rec.argv[rec.argv.indexOf('--limit') + 1], '45', 'the stage time limit from the ledger');
  assert.equal(stage(h, '#2'), 'candidate', '#2 waits for its blocker');
  h.wake();
  const st = h.state();
  assert.deepEqual(st.stop.stoppedBy, ['rounds']);
  assert.equal(st.tickets['#1'].stage, 'delivered');
  assert.equal(st.tickets['#2'].stage, 'awaiting-ruling');
  assert.match(st.tickets['#2'].reason, /^run stopped at rounds/);
  assert.equal(h.wakes.at(-1).at(-1).then, 'done', 'the finish follows once nothing is in flight');
});

test('the same report delivered twice is taken once', (t) => {
  const h = world(t);
  h.wake();
  h.reportsNext = ['a1']; // #2 stays in flight, so the run goes on
  h.wake();
  assert.equal(stage(h, '#1'), 'delivered');
  const before = h.state().tickets['#1'].history.length;
  const w3 = h.wake({ reported: ['a1'] });
  assert.deepEqual(w3[0].reports, [{ agent: 'a1', accepted: false, tickets: ['#1'], why: 'duplicate' }]);
  assert.ok(!ids(h.actions(w3)).some((x) => x.startsWith('collect:a1') || x.startsWith('ignore:a1')));
  assert.equal(h.state().tickets['#1'].history.length, before);
  // a second delivery inside the same wake-up, before the first is recorded, is one collect
  const h2 = world(t);
  h2.wake();
  const r = JSON.parse(h2.tick('next', h2.path, '--reported', 'a1', '--reported', 'a1').out);
  assert.equal(r.actions.filter((a) => a.step === 'collect').length, 1);
});

test('a report from an agent replaced after a timeout is ignored, not taken', (t) => {
  const h = world(t);
  h.wake();
  // a1 never shows progress or reports; a2 is fine
  h.silent.add('a1');
  h.reportsNext = h.reportsNext.filter((x) => x !== 'a1');
  git(join(h.dir, 'wts', basename(h.state().tickets['#1'].branch)), 'reset', '-q', '--hard', LINE);
  const w2 = h.wake({ minutes: 31, reported: [] });
  const a2 = h.actions(w2);
  const timeout = a2.find((a) => a.step === 'timeout');
  assert.ok(timeout, 'the overdue agent is stopped');
  assert.deepEqual(timeout.tickets, ['#1']);
  assert.match(timeout.do, /reassign/);
  // the reassignment: a new assignment with --reassign and a new agent
  assert.ok(a2.some((a) => a.step === 'assignment' && a.argv.includes('--reassign')));
  const st = h.state();
  const now = st.tickets['#1'].assignment.agentId;
  assert.notEqual(now, 'a1');
  assert.equal(st.tickets['#1'].timeoutReassignments.implementing, 1);
  // the stopped agent reports after all
  const w3 = h.wake({ reported: ['a1'] });
  assert.deepEqual(w3[0].reports.find((r) => r.agent === 'a1'), { agent: 'a1', accepted: false, tickets: ['#1'], why: 'stopped' });
  const a3 = h.actions(w3);
  assert.ok(a3.some((a) => a.id === 'ignore:a1' && a.kind === 'judge'));
  assert.ok(!a3.some((a) => a.id.startsWith('collect:a1')));
  assert.equal(h.state().tickets['#1'].assignment.agentId, now);
  assert.equal(stage(h, '#1'), 'implementing');
});

test('a red line is read every wake-up; its result comes a wake-up late; green reopens dispatching', (t) => {
  const h = world(t);
  const red = git(h.intWt, 'rev-parse', 'HEAD');
  h.ci = (branch, sha) => (sha === red ? 'red' : h.later ?? 'running');
  h.policy['red-light'] = () => {
    // the round's fix: a commit on the integration branch, pushed
    write(join(h.intWt, 'fix.txt'), 'fix\n');
    git(h.intWt, 'add', '-A');
    git(h.intWt, 'commit', '-q', '-m', 'fix the red light');
    git(h.intWt, 'push', '-q', 'origin', LINE);
    return 'handled';
  };
  const w1 = h.wake();
  const a1 = h.actions(w1);
  assert.ok(a1.some((a) => a.step === 'red-light'));
  assert.ok(!a1.some((a) => a.kind === 'spawn'), 'no new ticket on a red line');
  const fixed = git(h.intWt, 'rev-parse', 'HEAD');

  const w2 = h.wake();
  const a2 = h.actions(w2);
  const read = a2.find((a) => a.step === 'ci-read');
  assert.ok(read, 'the red line is read again this wake-up');
  assert.equal(read.argv.at(-1), fixed);
  assert.equal(h.state().lines[LINE].ci.verdict, 'running');
  assert.ok(!a2.some((a) => a.kind === 'spawn'));
  assert.ok(w2.every((o) => o.dispatch === null), 'no dispatch point while the line is still red');

  h.later = 'green';
  const w3 = h.wake();
  const a3 = h.actions(w3);
  assert.ok(w3.some((o) => o.dispatch?.reasons.includes('a red line turned green')));
  assert.deepEqual(a3.filter((a) => a.kind === 'spawn').map((a) => a.tickets[0]).sort(), ['#1', '#2']);
});

test('merged but not recorded: the resumed host follows git and does not merge again', (t) => {
  const h = world(t);
  h.wake();
  // the host is interrupted inside integrate.mjs merge, after git merged and before anything was recorded
  h.crashAfter = (a) => {
    if (a.step !== 'stage' || a.argv[4] !== 'integrating') return false;
    git(h.intWt, 'merge', '--no-ff', '--no-edit', h.state().tickets[a.tickets[0]].branch);
    return true;
  };
  assert.throws(() => h.wake(), Crash);
  h.crashAfter = null;
  const merged = git(h.intWt, 'rev-parse', 'HEAD');
  const st = h.state();
  const [id] = Object.entries(st.tickets).find(([, x]) => x.stage === 'integrating');
  assert.deepEqual(st.tickets[id].merges, []);
  // resume: nothing but the state file, the ledger and git
  const r = JSON.parse(h.tick('next', h.path).out);
  assert.deepEqual(r.reconcile.find((x) => x.ticket === id), { ticket: id, state: 'integrating, no merge SHA recorded', git: `merged into ${LINE} at ${merged}`, follow: 'git' });
  const merges = r.actions.filter((a) => a.step === 'merge');
  assert.deepEqual(ids(merges), [`merge:${id}:@${merged.slice(0, 12)}`], 'integrate.mjs merge once more, to finish what is left');
  h.run(r.actions);
  const out = JSON.parse(readFileSync(merges[0].stdout, 'utf8'));
  assert.deepEqual([out.found, out.merge], ['git', merged], 'it found the merge git has; it did not merge again');
  h.wake({ reported: [] });
  const after = h.state();
  assert.equal(after.tickets[id].stage, 'delivered');
  assert.deepEqual(after.tickets[id].merges.map((m) => m.sha), [merged]);
  assert.equal(git(h.intWt, 'rev-list', '--first-parent', '--merges', '--count', `main..${LINE}`), '2');
});

test('the integration branch moves between wake-ups: the state follows git and CI reads the new tip', (t) => {
  const h = world(t);
  h.wake();
  h.reportsNext = ['a1']; // #2's report comes later
  h.wake();
  assert.equal(stage(h, '#1'), 'delivered');
  const merged1 = h.state().tickets['#1'].merges[0].sha;
  // a host commit on the integration branch between two wake-ups
  write(join(h.intWt, 'note.md'), 'host\n');
  git(h.intWt, 'add', '-A');
  git(h.intWt, 'commit', '-q', '-m', 'host record');
  const moved = git(h.intWt, 'rev-parse', 'HEAD');
  const w3 = h.wake({ reported: ['a2'] });
  assert.deepEqual(w3[0].reconcile.find((x) => x.line === LINE), { line: LINE, state: `tip ${merged1}`, git: `tip ${moved}`, follow: 'git' });
  assert.ok(w3[0].actions.some((a) => a.id === `tip:${LINE}@${moved}`));
  const a3 = h.actions(w3);
  assert.ok(!a3.some((a) => a.step === 'merge' && a.tickets[0] === '#1'), '#1 is not merged again');
  assert.equal(stage(h, '#2'), 'delivered');
  const tip = git(h.intWt, 'rev-parse', 'HEAD');
  assert.equal(git(h.intWt, 'rev-parse', `${tip}^1`), moved, '#2 merged on top of the moved tip');
  const reads = a3.filter((a) => a.step === 'ci-read');
  assert.equal(reads.at(-1).argv.at(-1), tip, 'CI is read at the latest SHA');
  assert.equal(h.state().lines[LINE].tip, tip);
  assert.equal(h.state().tickets['#1'].merges.length, 1);
});

test('a merge that conflicts goes to a merge agent with a time limit, then on through close-out', (t) => {
  const h = world(t);
  // both agents write the same file, which neither prediction names
  const work = h.work;
  h.work = (agent, tid) => {
    const wt = h.state().tickets[tid].assignment?.worktree;
    write(join(wt, 'same.txt'), `${tid}\n`);
    git(wt, 'add', '-A');
    git(wt, 'commit', '-q', '-m', `work on ${tid}`);
    h.reportsNext.push(agent);
  };
  h.wake();
  h.work = work;
  h.policy['merge-agent'] = (a) => {
    // N1: integrate.mjs aborted the conflict, so the merge agent finds a clean worktree and merges again itself
    assert.throws(() => git(h.intWt, 'rev-parse', '-q', '--verify', 'MERGE_HEAD'), 'no merge left in progress');
    assert.equal(git(h.intWt, 'status', '--porcelain', '--untracked-files=no'), '');
    const agent = `a${++h.agents}`;
    assert.throws(() => git(h.intWt, 'merge', '--no-ff', '--no-edit', h.state().tickets[a.tickets[0]].branch));
    write(join(h.intWt, 'same.txt'), 'both\n');
    git(h.intWt, 'add', '-A');
    git(h.intWt, 'commit', '-q', '--no-edit');
    h.reportsNext.push(agent);
    return { outcome: 'spawned', agent };
  };
  const w2 = h.wake();
  const a2 = h.actions(w2);
  const conflicted = a2.find((a) => a.step === 'merge-agent');
  assert.ok(conflicted, 'the conflict goes to a merge agent');
  const [id] = conflicted.tickets;
  const merge = a2.find((a) => a.step === 'merge' && a.tickets[0] === id);
  assert.ok(merge.okExit.includes(4), 'integrate.mjs merge exits 4 on a conflict, which is not a failure');
  assert.deepEqual(JSON.parse(readFileSync(merge.stdout, 'utf8')).files, ['same.txt']);
  assert.match(conflicted.do, /same\.txt/, 'the merge agent is told which files conflict');
  assert.ok(a2.some((a) => a.id === `rec:${id}:2` && a.argv.includes('--limit') && a.argv[a.argv.indexOf('--limit') + 1] === '15'), 'the merge stage time limit');
  assert.match(conflicted.do, new RegExp(`merge ${id}`));
  assert.equal(stage(h, id), 'integrating');
  const w3 = h.wake();
  assert.deepEqual(w3[0].reports.map((r) => r.why), ['current']);
  assert.ok(h.actions(w3).some((a) => a.step === 'collect' && a.meta.stage === 'integrating'));
  assert.equal(stage(h, id), 'delivered');
  const sha = h.state().tickets[id].merges[0].sha;
  assert.equal(git(h.intWt, 'rev-list', '--parents', '-n', '1', sha).split(' ').length, 3, 'one merge commit, two parents');
});

test('N3: a spawn interrupted before its record comes back as a check, not as a second spawn', (t) => {
  const h = world(t);
  let crashed = null;
  h.crashAfter = (a) => a.kind === 'spawn' && !crashed && (crashed = a);
  assert.throws(() => h.wake(), Crash);
  h.crashAfter = null;
  const started = `a${h.agents}`; // the agent the interrupted spawn did start
  const [id] = crashed.tickets;
  const other = id === '#1' ? '#2' : '#1';
  const r = JSON.parse(h.tick('next', h.path).out);
  assert.ok(!r.actions.some((a) => a.kind === 'spawn'), 'no blind second spawn');
  const checks = r.actions.filter((a) => a.step === 'spawn-check');
  assert.deepEqual(checks.map((a) => a.meta.of).sort(), [`spawn:${id}:1`, `spawn:${other}:1`].sort());
  assert.ok(checks.every((a) => a.kind === 'judge' && a.outcomes.join() === 'spawned,none'));
  // the interrupted one was spawned: its agent fills the assignment
  h.record(checks.find((a) => a.meta.of === crashed.id).id, '--outcome', 'spawned', '--agent', started);
  assert.equal(h.state().tickets[id].assignment.agentId, started);
  // the other one never went out: none issues the spawn again, once
  h.record(checks.find((a) => a.meta.of !== crashed.id).id, '--outcome', 'none');
  const r2 = JSON.parse(h.tick('next', h.path).out);
  assert.deepEqual(ids(r2.actions.filter((a) => a.kind === 'spawn')), [`spawn:${other}:1`]);
  assert.ok(!r2.actions.some((a) => a.step === 'spawn-check'));
});

test('no origin: the dispatch points and the finish verify the line through verify.mjs', (t) => {
  const h = world(t);
  git(h.repo, 'remote', 'remove', 'origin');
  for (let i = 0; i < 6 && h.wakes.at(-1)?.at(-1)?.then !== 'done'; i += 1) h.wake();
  assert.equal(h.wakes.at(-1).at(-1).then, 'done');
  const verifies = h.log.filter((a) => a.step === 'verify-local');
  assert.ok(verifies.length >= 2, 'the first dispatch point and the one after the integrations');
  assert.ok(verifies.every((a) => a.kind === 'exec' && a.argv[a.argv.indexOf('--reason') + 1] === 'no-origin'));
  const tip = git(h.intWt, 'rev-parse', 'HEAD');
  const L = h.state().lines[LINE];
  assert.ok(L.local.some((x) => x.sha === tip && x.result === 'green'), 'the latest SHA has its per-SHA record');
  assert.equal(new Set(L.local.map((x) => x.sha)).size, L.local.length, 'one record per SHA');
  assert.ok(!h.log.some((a) => ['ci-read', 'push'].includes(a.step)), 'nothing reads CI or pushes');
  assert.deepEqual(Object.values(h.state().tickets).map((x) => x.stage), ['delivered', 'delivered']);
});

test('a failed command comes back as a judge; retry issues it again', (t) => {
  const h = world(t);
  const exec = h.exec;
  let failOnce = true;
  h.exec = (a) => {
    if (a.step === 'frontier' && failOnce) {
      failOnce = false;
      return 1;
    }
    return exec(a);
  };
  h.policy.failed = () => 'retry';
  const w1 = h.wake();
  const a1 = h.actions(w1);
  assert.ok(a1.some((a) => a.id === 'failed:frontier:r1' && a.kind === 'judge'));
  assert.equal(a1.filter((a) => a.id === 'frontier:r1').length, 2, 'issued again after the retry');
  assert.equal(stage(h, '#1'), 'implementing');
});

test('#126: implementation agents spawn as sorry-matt:implementer with a general-purpose fallback; --type re-records the assignment', (t) => {
  const h = world(t);
  const spawn = h.spawn;
  // #2's host has no sorry-matt:implementer: it sends the fallback and records the type it used
  h.spawn = (a) => {
    const r = spawn(a);
    if (a.tickets[0] === '#2') r.flags.push('--type', 'general-purpose');
    return r;
  };
  const spawns = h.actions(h.wake()).filter((a) => a.kind === 'spawn');
  assert.deepEqual(spawns.map((a) => a.spawn.description).sort(), ['implement #1', 'implement #2']);
  for (const a of spawns) {
    assert.equal(a.spawn.subagent_type, 'sorry-matt:implementer');
    const brief = a.spawn.prompt.match(/^Read (.+) in full and follow it\.$/)[1];
    assert.equal(a.spawn.fallback.subagent_type, 'general-purpose');
    assert.equal(a.spawn.fallback.prompt, `Read ${brief.replace(/\.md$/, '.general-purpose.md')} in full and follow it.`);
    assert.ok(existsSync(brief.replace(/\.md$/, '.general-purpose.md')), 'brief.mjs wrote the fallback');
    assert.match(a.record, /--agent <agent id> \[--type general-purpose\]$/);
  }
  const st = h.state();
  const [one, two] = ['#1', '#2'].map((id) => st.tickets[id].assignment);
  assert.equal(one.type, 'sorry-matt:implementer');
  assert.equal(two.type, 'general-purpose', 'the fallback re-recorded the assignment');
  assert.ok(two.agentId && two.worktree, 'with its agent and worktree');
  assert.equal(st.tick.agents[one.agentId].type, 'sorry-matt:implementer');
  assert.equal(st.tick.agents[two.agentId].type, 'general-purpose');
});

test('record refuses what tick did not issue and a second, different result', (t) => {
  const h = world(t);
  const r = JSON.parse(h.tick('next', h.path).out);
  const usage = r.actions.find((a) => a.step === 'usage');
  assert.equal(h.tick('record', h.path, 'made-up:1', '--exit', '0').code, 3);
  assert.equal(h.tick('record', h.path, usage.id).code, 2, 'an exec needs --exit');
  h.record(usage.id, '--exit', '0');
  assert.equal(JSON.parse(h.tick('record', h.path, usage.id, '--exit', '0').out).already, true);
  assert.equal(h.tick('record', h.path, usage.id, '--exit', '1').code, 3);
  assert.equal(h.tick('next', join(h.dir, 'missing.state.json')).code, 1);
});

// The profile trims the action list and nothing else: the same events under the default and a relaxed profile.
test('a relaxed profile drops exactly the actions it relaxes', (t) => {
  const RELAXED = { review: 'minimal', recheck: false, onUnfixed: 'file-issue', expand: 'skip', ci: 'skip', simplify: false, integrate: 'direct' };
  const play = (profile) => {
    const h = world(t, { profile });
    h.acceptance['#1'] = { items: [], expansions: [] }; // #1 has no criteria yet
    h.policy.review = (a) => (a.tickets[0] === '#1' && a.meta.mode === 'initial' ? { outcome: 'fix', findings: 'F1,F2' } : 'pass');
    h.policy.collect = (a) => (a.meta.stage === 'fixing' ? { outcome: 'fixed', fixed: 'F1', unfixed: 'F2' } : { implementing: 'green', expanding: 'reported' }[a.meta.stage]);
    for (let i = 0; i < 8 && h.wakes.at(-1)?.at(-1)?.then !== 'done'; i += 1) h.wake();
    assert.equal(h.wakes.at(-1).at(-1).then, 'done', `the run under ${profile ? 'the relaxed' : 'the default'} profile finished`);
    const st = h.state();
    assert.deepEqual(Object.values(st.tickets).map((x) => x.stage), ['delivered', 'delivered']);
    return { h, sigs: new Set(h.log.map(signature)) };
  };
  const strict = play(null);
  const relaxed = play(RELAXED);
  // every file a reference names exists; the agents' reports are read from their definitions (#126)
  for (const a of [...strict.h.log, ...relaxed.h.log])
    for (const r of a.reference) if (r.path) assert.ok(existsSync(r.path), `${a.id}: ${r.path} exists`);
  const collected = (stage) => strict.h.log.find((a) => a.step === 'collect' && a.meta.stage === stage).reference.map((r) => r.path);
  assert.ok(collected('implementing').includes(join(root, 'src', 'agents', 'implementer.md')));
  assert.ok(collected('expanding').includes(join(root, 'src', 'agents', 'expander.md')));
  const only = (a, b) => [...a.sigs].filter((x) => !b.sigs.has(x)).sort();
  assert.deepEqual(only(strict, relaxed), [
    'assignment:expand', // expand: skip
    'brief:expand',
    'ci-read', // ci: skip
    'ci-record',
    'collect:expanding',
    'deliver-line', // integrate: direct (no aggregate PR) …
    'gate', // … no finish gate (its assertions assume aggregate PRs and a CI read) …
    'review:initial', // review: minimal (no prove-it judge) …
    'review:recheck', // … and recheck: false
    'simplify', // simplify: false
    'spawn:sorry-matt:expander:expand',
    'stage:expanding',
    'sync-base', // … and no base sync
  ]);
  assert.deepEqual(only(relaxed, strict), [
    'file-issue', // onUnfixed: file-issue
    'push', // integrate: direct (the base branch is pushed by the host, so the guard hook sees it)
    'spawn:general-purpose:review', // review: minimal
  ]);
  // integrate: direct merged into the base branch itself; the default into the line
  assert.equal(git(relaxed.h.repo, 'rev-list', '--first-parent', '--merges', '--count', 'main'), '2');
  assert.equal(git(strict.h.repo, 'rev-list', '--first-parent', '--merges', '--count', 'main'), '0');
  assert.equal(git(relaxed.h.repo, 'rev-parse', 'origin/main'), git(relaxed.h.repo, 'rev-parse', 'main'), 'the host pushed the base branch');
  assert.equal(relaxed.h.state().tickets['#1'].unfixedIssue, '#99');
});

function signature(a) {
  if (a.kind === 'spawn') return `spawn:${a.spawn.subagent_type}:${a.spawn.description.split(' ')[0]}`;
  if (a.kind === 'exec') {
    if (a.step === 'stage') return `stage:${a.argv[4]}`;
    if (a.step === 'assignment' && a.argv.includes('--expansions')) return 'assignment:expand';
    if (a.step === 'brief') return `brief:${a.argv[2]}`;
    return a.step;
  }
  if (a.step === 'collect') return `collect:${a.meta.stage}`;
  if (a.step === 'review') return `review:${a.meta.mode}`;
  return a.step;
}
