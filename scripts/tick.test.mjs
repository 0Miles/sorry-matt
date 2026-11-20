// node --test scripts/tick.test.mjs
// Replays of get-to-work's wake-ups through tick.mjs. Each test builds a real git repository with a bare origin and
// an integration worktree, a real state file (state.mjs), and plays the host: it runs every action tick hands out
// and records each result. Scripts run for real (state, deadline, brief, overlap, integrate, verify, git); only the network is canned
// (ci.mjs verdicts, frontier.mjs github, acceptance.mjs github, gh). The expected values are the pipeline's rules
// as SKILL.md states them, written here by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync, utimesSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main as tick, defaultDeps, bashExecutor, bashUsable } from '../src/skills/get-to-work/scripts/tick.mjs';
import { main as stateMain } from '../src/skills/get-to-work/scripts/state.mjs';
import { main as deadlineMain } from '../src/skills/get-to-work/scripts/deadline.mjs';
import { main as briefMain } from '../src/skills/get-to-work/scripts/brief.mjs';
import { main as overlapMain } from '../src/skills/get-to-work/scripts/overlap.mjs';
import { main as integrateMain } from '../src/skills/get-to-work/scripts/integrate.mjs';
import { main as verifyMain } from '../src/skills/get-to-work/scripts/verify.mjs';
import { main as ciMain, defaultDeps as ciDeps } from '../src/skills/get-to-work/scripts/ci.mjs';
import { itemsHash } from '../src/skills/get-to-work/scripts/acceptance.mjs';
import { main as tierMain, defaultDeps as tierDeps } from '../src/skills/prove-it/scripts/tier.mjs';
import { classify } from '../hooks/classify.mjs';

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

/**
 * A bash that runs tick's commands as the host's does: any on POSIX, Git Bash / MSYS / Cygwin on win32 (not WSL). The
 * judgement is tick.mjs's own, the one bashExecutor makes (#130); when it says no, `NO_BASH` is why, `uname -s` in it.
 */
const BASH_CHECK = bashUsable();
const BASH = BASH_CHECK.ok;
const NO_BASH = BASH ? null : `no bash that runs tick's commands: ${BASH_CHECK.why}`;

/** The ticket files a Local Markdown run's tickets live in (`--tickets-dir`). */
const TICKETS_DIR = '.scratch/issues';
const localTicket = (id, title) => `# ${title}\n\nThe ticket text of ${id}.\n\n## Acceptance criteria\n\n- [ ] criterion of ${id}\n`;

/**
 * A run with two tickets on one line, set up as the freeze leaves it: #1 and #2 on GitHub, or (`tracker: 'local'`)
 * two ticket files under TICKETS_DIR. `h.ids` holds the two ids. `check` is the contract's Full checks.
 */
function world(t, { profile = null, tracker = 'github', check = 'node -e "process.exit(0)"' } = {}) {
  const local = tracker === 'local';
  const [ID1, ID2] = local ? ['01-first.md', '02-second.md'] : ['#1', '#2'];
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
  write(join(repo, 'docs', 'agents', 'commands.md'), `# Commands\n\n## Full checks\n\n\`\`\`bash\n${check}\n\`\`\`\n`);
  if (local) {
    write(join(repo, TICKETS_DIR, ID1), localTicket(ID1, 'First thing'));
    write(join(repo, TICKETS_DIR, ID2), localTicket(ID2, 'Second thing'));
  }
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
    ids: [ID1, ID2],
    titles: { [ID1]: 'First thing', [ID2]: 'Second thing' },
    comments: {}, // GitHub: ticket id → the issue's comments, as `gh issue view --json comments` gives them
    blockers: {},
    acceptance: {},
    ci: () => 'green',
    agentOf: {}, // agent id → { tickets, role }
    silent: new Set(), // agents that do no work and never report
    crashAfter: null, // (action) => true to stop right after running it, before recording
    policy: {},
    // #139: what an agent's work changes, per ticket: { path, lines }. The default is a code file of 60 lines, which
    // tier.mjs judges standard (a prove-it review); 50 lines or fewer is light (a minimal review under review: full).
    change: {},
  };
  h.iso = () => new Date(h.now).toISOString().replace(/\.\d{3}Z$/, 'Z');
  /** A reviewer's report written on the run's clock: its mtime is the test's `now` (or `at`), not the wall clock's. */
  h.writeReport = (file, text, at = h.now) => {
    write(file, text);
    utimesSync(file, at / 1000, at / 1000);
  };
  h.S = (...args) => {
    const r = stateMain([args[0], path, ...args.slice(1), '--now', h.iso()]);
    assert.equal(r.code, 0, r.err);
    return JSON.parse(r.out);
  };
  h.state = () => JSON.parse(readFileSync(path, 'utf8'));
  h.tick = (...args) => tick([...args, '--now', h.iso()]);

  h.S('init', '--run', 'r1');
  h.S('add', ID1, ID2, '--line', h.line);
  h.S('line', h.line, '--tip', git(intWt, 'rev-parse', 'HEAD'));
  if (profile) h.S('profile', ...Object.entries(profile).flatMap(([k, v]) => [`--${k}`, String(v)]));
  write(join(W, 'files', `${numOf(ID1)}.txt`), 'a.txt\n');
  write(join(W, 'files', `${numOf(ID2)}.txt`), 'b.txt\n');
  const where = local ? ['--tracker', 'local', '--tickets-dir', TICKETS_DIR] : ['--tracker', 'github', '--repo', REPO];
  const s = h.tick('setup', path, ...where, '--root', repo, '--base', 'main', '--worktrees', join(dir, 'wts'));
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
    const ids = local ? args.filter((x) => x.endsWith('.md')) : args.filter((x, k) => x.startsWith('#') && !['--done', '--stuck'].includes(args[k - 1]));
    const stateOf = (id) => (done.has(numOf(id)) ? 'done' : stuck.has(numOf(id)) ? 'stuck' : 'open');
    const tickets = ids.map((id) => {
      const blockedBy = (h.blockers[id] ?? []).map((b) => ({ id: b, state: stateOf(b), inSet: true }));
      const ready = stateOf(id) === 'open' && blockedBy.every((b) => b.state === 'done');
      return { id, title: h.titles[basename(id)] ?? h.titles[id], state: stateOf(id), trackerState: 'open', blockedBy, line: '#1', ready, stalled: null };
    });
    return { format: 'sorry-matt/frontier@1', tracker, source: local ? 'worktree' : REPO, tickets, lines: [ids], frontier: tickets.filter((x) => x.ready).map((x) => x.id), warnings: [] };
  };
  h.accept = (args) => {
    const key = local ? basename(args[3]) : `#${args[args.indexOf('--repo') + 2]}`;
    const id = local ? args[3] : key;
    const spec = h.acceptance[key] ?? { items: [{ from: 'original', text: `criterion of ${key}` }], expansions: [] };
    const out = { format: 'sorry-matt/acceptance@1', tracker, source: local ? args[2] : REPO, id, title: h.titles[key], items: spec.items, expansions: spec.expansions, needsExpansion: spec.items.length === 0, sha256: itemsHash(spec.items) };
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
      else if (script === 'tier.mjs') r = tierMain(rest, tierDeps(a.cwd ?? process.cwd())); // #139: run for real, on the repo
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
      if (args[0] === 'issue') {
        // gh issue view off a TTY: --json gives the fields asked for; --comments prints the comments only, not the body
        const id = `#${args[2]}`;
        const comments = h.comments[id] ?? [];
        if (args.includes('--json')) {
          const fields = args[args.indexOf('--json') + 1].split(',');
          const all = { title: h.titles[id], body: `The ticket text of ${id}.`, comments };
          out = `${JSON.stringify(Object.fromEntries(fields.map((f) => [f, all[f]])))}\n`;
        } else if (args.includes('--comments')) out = comments.map((x) => `author:\t${x.author.login}\n--\n${x.body}\n--\n`).join('');
        else out = `title:\t${h.titles[id]}\n--\nThe ticket text of ${id}.\n`;
      }
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
      const { path: name = tid === ID1 ? 'a.js' : 'b.js', lines = 60 } = h.change[tid] ?? {};
      const n = (h.commits = (h.commits ?? 0) + 1);
      write(join(wt, name), Array.from({ length: lines }, (_, i) => `${agent}(${n}, ${i});\n`).join(''));
      git(wt, 'add', '-A');
      git(wt, 'commit', '-q', '-m', `work by ${agent}`);
    }
    h.reportsNext.push(agent);
  };
  /** A ci-fix agent on a line that maps to no ticket: a commit in the integration worktree, then its report (#144). */
  h.ciFixSilent = false;
  h.fixLine = (agent) => {
    if (h.ciFixSilent) return;
    write(join(h.intWt, 'fix.txt'), `${agent}\n`);
    git(h.intWt, 'add', '-A');
    git(h.intWt, 'commit', '-q', '-m', 'fix the red light');
    h.reportsNext.push(agent);
  };

  const DEFAULTS = {
    collect: (a) => ({ implementing: 'green', expanding: 'reported', fixing: 'fixed', integrating: 'resolved', 'ci-fix': 'fixed' })[a.meta.stage] ?? 'logged',
    review: () => 'pass',
    'agent-report': (a) => {
      write(a.meta.agentReport, h.agentReport({ tickets: a.tickets, meta: { agent: 'the-last-agent' } }));
      return 'written';
    },
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
    simplify: () => ({ outcome: 'none', value: 'looked at the line: nothing to reuse or remove' }),
    'wrap-up': () => 'done',
    'wakeup-end': () => 'done',
  };

  h.judge = (a) => {
    const fn = h.policy[a.step] ?? DEFAULTS[a.step];
    if (!fn) throw new Error(`no policy for ${a.step}: ${a.do}`);
    let r = fn(a);
    if (typeof r === 'string') r = { outcome: r };
    // #138: the host writes the agent's report it takes to the file the collect names, before a review follows
    if (a.step === 'collect' && a.meta.agentReport && ['green', 'fixed'].includes(r.outcome)) write(a.meta.agentReport, h.agentReport(a));
    const flags = ['--outcome', r.outcome];
    for (const k of ['value', 'findings', 'fixed', 'unfixed', 'agent']) if (r[k] !== undefined) flags.push(`--${k}`, r[k]);
    return flags;
  };
  /** The implementation (or fix) agent's report as agents/implementer.md section 5 has it. */
  h.agentReport = (a) =>
    `ticket: ${a.tickets[0]}\ncommit: c-${a.meta.agent} (branch ${h.state().tickets[a.tickets[0]].branch})\ntargeted checks: source=commands.md; node --test by ${a.meta.agent} → green\nstatus record: none\n`;

  h.spawn = (a) => {
    const agent = `a${++h.agents}`;
    const role = a.spawn.description.split(' ')[0];
    h.agentOf[agent] = { tickets: a.tickets, role };
    if (a.step === 'review') {
      const r = (h.policy.review ?? DEFAULTS.review)(a);
      const v = typeof r === 'string' ? { outcome: r } : r;
      // the minimal reviewer writes its report to the file its brief names (#128); the review host writes a block
      if (a.meta.kind === 'minimal') h.writeReport(reportOf(a), `verdict: ${v.outcome}\n${(v.findings ?? '').split(',').filter(Boolean).map((f) => `${f}: a.txt:1 wrong (evidence)\n`).join('')}`);
      return ['--agent', agent, '--outcome', v.outcome, ...(v.findings ? ['--findings', v.findings] : [])];
    }
    if (a.step === 'simplify') {
      // the simplify agent (#153): applied is one commit on the line, without a ticket id; none and skipped commit nothing
      const r = (h.policy.simplify ?? DEFAULTS.simplify)(a);
      const v = typeof r === 'string' ? { outcome: r } : r;
      if (v.outcome === 'applied') {
        write(join(h.intWt, 'simplified.txt'), `${agent}\n`);
        git(h.intWt, 'add', '-A');
        git(h.intWt, 'commit', '-q', '-m', `refactor: simplify ${a.line}`);
      }
      return ['--agent', agent, '--outcome', v.outcome, ...(v.value !== undefined ? ['--value', v.value] : [])];
    }
    return { agent, flags: ['--agent', agent] };
  };

  /** The host's turn as SKILL.md has it: batch 1 of the list, each recorded; the later batches come in later lists. */
  h.run = (actions) => {
    for (const a of actions.filter((x) => x.batch === 1)) {
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
              // the expansion agent's block: on GitHub an issue comment, which acceptance.mjs reads back
              const block = `<!-- sorry-matt:expansion -->\nby: x\nrun: r1\nround: 1\n\nacceptance:\n- [ ] expanded criterion of ${tid}`;
              h.acceptance[tid] = {
                items: [{ from: 'expansion', by: 'x', run: 'r1', round: '1', text: `expanded criterion of ${tid}` }],
                expansions: [{ by: 'x', run: 'r1', round: '1', at: 'u', text: block }],
              };
              (h.comments[tid] ??= []).push({ author: { login: 'x' }, body: block, createdAt: h.iso() });
            }
            h.reportsNext.push(r.agent);
          } else if (r.agent && h.agentOf[r.agent].role === 'ci-fix') h.fixLine(r.agent);
          else if (r.agent) h.work(r.agent, a.tickets[0]);
        }
      } else {
        h.record(a.id, ...h.judge(a));
      }
    }
  };

  /** One wake-up: `next` (or `via`) until it says end (or done); returns every output of it. */
  h.wake = ({ reported, minutes = 5, via = (...args) => h.tick('next', path, ...args) } = {}) => {
    h.now += minutes * 60_000;
    const reports = reported ?? h.reportsNext.splice(0);
    const outs = [];
    h.wakes.push(outs);
    for (let i = 0; i < 400; i += 1) {
      const r = via(...(i === 0 ? reports.flatMap((x) => ['--reported', x]) : []));
      assert.equal(r.code, 0, r.err);
      const out = JSON.parse(r.out);
      outs.push(out);
      h.run(out.actions);
      if (out.then !== 'tick') return outs;
    }
    throw new Error('the wake-up did not end');
  };
  h.actions = (outs) => outs.flatMap((o) => o.actions);

  /** `tick.mjs run`, its execs through the host's stand-in (h.exec) unless `execute` is given (#129). */
  h.execute = null;
  h.runTick = (...args) => tick(['run', path, ...args, '--now', h.iso()], { ...defaultDeps(), execute: h.execute ?? ((a) => ({ code: h.exec(a) })) });
  /** One wake-up as SKILL.md has it with run: run, then the host does batch 1 of what is left, until end or done. */
  h.runWake = ({ minutes = 5 } = {}) => h.wake({ minutes, via: h.runTick });
  /** Wake-ups (`wake`, h.wake by default) until the run is done, at most six; returns the last output. */
  h.untilDone = (wake = h.wake) => {
    for (let i = 0; i < 6 && h.wakes.at(-1)?.at(-1)?.then !== 'done'; i += 1) wake();
    return h.wakes.at(-1)?.at(-1);
  };
  return h;
}

const ids = (actions) => actions.map((a) => a.id);
/** Each action once: a later batch is listed again by the lists after it until it is run (#128). */
const distinct = (actions) => [...new Map(actions.map((a) => [a.id, a])).values()];
const stage = (h, id) => h.state().tickets[id].stage;
/** The file a spawn's prompt tells the agent to read. */
const briefOf = (a) => a.spawn.prompt.match(/^Read (.+) in full and follow it\.$/)[1];
/** The report file of a minimal reviewer: beside its brief, `.report.md` (#128). */
const reportOf = (a) => briefOf(a).replace(/\.md$/, '.report.md');

test('a plain run: dispatch, close-out, finish, in batches', (t) => {
  const h = world(t);
  const w1 = h.wake();
  const a1 = h.actions(w1);
  // the first dispatch point: progress, CI, frontier, acceptance, overlap, then a branch and an agent per ticket
  assert.deepEqual(w1[0].dispatch.reasons, ['first wake-up']);
  const spawns = distinct(a1).filter((a) => a.kind === 'spawn');
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
  assert.deepEqual(distinct(a3).filter((a) => a.kind === 'spawn').map((a) => a.tickets[0]).sort(), ['#1', '#2']);
});

/** A red light at the line's first SHA that the host finds maps to no ticket: it writes the failing lines, records unmatched (#144). */
function unmatchedRed(h) {
  const red = git(h.intWt, 'rev-parse', 'HEAD');
  h.ci = (branch, sha) => (sha === red ? 'red' : 'green');
  h.redJudges = [];
  h.policy['red-light'] = (a) => {
    h.redJudges.push(a);
    if (!a.outcomes.includes('unmatched')) return 'failed'; // the two fix rounds are used
    write(a.meta.failure, `check: test x failed at ${red}\n`);
    return 'unmatched';
  };
  return red;
}
const ciFixSpawns = (h) => distinct(h.log).filter((a) => a.kind === 'spawn' && a.spawn.description.startsWith('ci-fix'));

test('#144: a red light that maps to no ticket: tick spawns ci-fix on the integration branch, with the assignment on the line', (t) => {
  const h = world(t);
  const red = unmatchedRed(h);
  const w1 = h.wake();
  const [spawn] = ciFixSpawns(h);
  assert.ok(spawn, 'tick hands out the ci-fix spawn');
  assert.equal(h.redJudges[0].step, 'red-light');
  assert.equal(spawn.spawn.description, `ci-fix ${LINE}`);
  assert.equal(spawn.spawn.subagent_type, 'general-purpose');
  assert.ok(spawn.spawn.background);
  assert.deepEqual([spawn.line, spawn.tickets], [LINE, []]);
  // the brief names the integration worktree, the branch and the failing lines; tick pushes, the agent does not
  const brief = readFileSync(briefOf(spawn), 'utf8');
  assert.ok(brief.includes(resolve(h.intWt)), 'the integration worktree');
  assert.ok(brief.includes(h.redJudges[0].meta.failure), 'the failure output');
  assert.ok(brief.includes(red), 'the red SHA');
  assert.match(brief, /do not push/i);
  assert.match(brief, /no ticket id/i);
  // the assignment record is the line's: its worktree, the fix time limit, the agent that was spawned
  const st = h.state();
  const a = st.lines[LINE].assignment;
  const agent = Object.keys(h.agentOf).find((x) => h.agentOf[x].role === 'ci-fix');
  assert.deepEqual([a.agentId, a.type, a.limit, a.extended], [agent, 'general-purpose', 20, 'no']);
  assert.equal(resolve(a.worktree), resolve(h.intWt));
  assert.equal(a.fingerprint.head, red);
  assert.equal(Date.parse(a.deadline) - Date.parse(a.assigned), 20 * 60_000);
  assert.ok(Object.values(st.tickets).every((x) => x.assignment === null), 'no ticket holds it');
  assert.ok(!h.actions(w1).some((x) => x.kind === 'spawn' && x.spawn.description.startsWith('implement')), 'no new ticket on a red line');
  assert.ok(w1.at(-1).fallback, 'an agent in flight: a fallback wake-up');
  assert.equal(w1.at(-1).fallback.deadline, a.deadline);

  // its report is taken, the line released; tick pushes the fix and reads CI at it; green reopens dispatching
  const w2 = h.wake();
  const a2 = h.actions(w2);
  const collect = a2.find((x) => x.step === 'collect' && x.meta?.agent === agent);
  assert.ok(collect && collect.line === LINE && collect.meta.stage === 'ci-fix');
  assert.equal(h.state().lines[LINE].assignment.deadline, null);
  const fixed = git(h.intWt, 'rev-parse', 'HEAD');
  assert.notEqual(fixed, red);
  assert.equal(git(h.repo, 'rev-parse', `origin/${LINE}`), fixed);
  assert.ok(a2.some((x) => x.step === 'ci-read' && x.argv.at(-1) === fixed));
  assert.ok(w2.some((o) => o.dispatch?.reasons.includes('a red line turned green')));
  assert.equal(ciFixSpawns(h).length, 1);
});

test('#144: a ci-fix agent past its time limit goes through the timeout handling; each stop is a fix round, two fail the line', (t) => {
  const h = world(t);
  const red = unmatchedRed(h);
  h.ciFixSilent = true;
  h.policy.timeout = (a) => {
    assert.deepEqual([a.line, a.tickets, a.meta.stage], [LINE, [], 'ci-fix']);
    assert.ok(a.outcomes.includes('stopped'));
    return 'stopped';
  };
  h.wake();
  assert.equal(ciFixSpawns(h).length, 1);
  // not overdue yet: no stop, no second round
  const w2 = h.wake({ minutes: 10 });
  assert.ok(!h.actions(w2).some((x) => x.step === 'timeout'));
  assert.equal(w2.at(-1).fallback.deadline, h.state().lines[LINE].assignment.deadline);
  // overdue with no progress: stopped, the round counted, and the next red-light judge opens round 2
  const w3 = h.wake({ minutes: 11 });
  const a3 = h.actions(w3);
  assert.ok(a3.some((x) => x.step === 'timeout' && x.line === LINE));
  assert.equal(h.state().usage.timeoutStops, 1);
  assert.equal(h.redJudges.length, 2, 'the stopped round is judged again');
  assert.equal(h.redJudges[1].meta.round, 2);
  assert.equal(ciFixSpawns(h).length, 2);
  assert.equal(git(h.intWt, 'rev-parse', 'HEAD'), red);
  // round 2 overdue too: the line fails verification, unmatched is no longer an outcome
  h.wake({ minutes: 21 });
  assert.equal(h.state().usage.timeoutStops, 2);
  assert.equal(h.redJudges.length, 3);
  assert.ok(!h.redJudges[2].outcomes.includes('unmatched'), 'two rounds used: no third');
  assert.ok(h.state().tick.failed[LINE], 'the line failed verification');
  assert.equal(ciFixSpawns(h).length, 2);
  assert.equal(stage(h, '#1'), 'awaiting-ruling');
  assert.equal(stage(h, '#2'), 'awaiting-ruling');
});

test('#144: record unmatched is refused (3) until the failure output is written where the judge says', (t) => {
  const h = world(t);
  const red = git(h.intWt, 'rev-parse', 'HEAD');
  h.ci = (branch, sha) => (sha === red ? 'red' : 'green');
  let judged = null;
  h.policy['red-light'] = (a) => {
    judged = a;
    const r = h.tick('record', h.path, a.id, '--outcome', 'unmatched');
    assert.equal(r.code, 3, r.err);
    assert.match(r.err, /failure/);
    write(a.meta.failure, 'check: test x failed\n');
    return 'unmatched';
  };
  h.wake();
  assert.ok(judged);
  assert.equal(ciFixSpawns(h).length, 1);
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

test('#128 D1: next makes the directory of every exec stdout before it returns; the command runs as written in bash', (t) => {
  const h = world(t);
  assert.equal(existsSync(join(h.W, 'tick')), false, 'no tick/ directory before the first next');
  // The programs are stubbed as shell functions; the command line itself, its cd and its redirect, run as written.
  // It runs from the test's temporary directory, and only in a bash that reads Windows paths (Git Bash, MSYS, Cygwin)
  // on win32: WSL's bash would flatten them and write the files into the working directory.
  const STUBS = `node() { echo 'stub'; }; gh() { echo 'stub'; }; `;
  // Without such a bash only the directories are checked here; the output says so and why (#130).
  if (!BASH) t.diagnostic(`#128 D1: the bash runs and redirect checks are skipped (${NO_BASH})`);
  const run = h.run;
  const seen = [];
  h.run = (actions) => {
    for (const a of actions.filter((x) => x.kind === 'exec' && x.stdout)) {
      assert.ok(existsSync(dirname(a.stdout)), `${a.id} (batch ${a.batch}): ${dirname(a.stdout)} exists when next returns`);
      if (BASH) {
        const p = spawnSync('bash', ['-c', `${STUBS}${a.command}`], { encoding: 'utf8', cwd: h.dir });
        assert.equal(p.status, 0, `${a.id}: ${p.stderr}`);
        assert.doesNotMatch(p.stderr, /No such file or directory/);
        assert.equal(readFileSync(a.stdout, 'utf8'), 'stub\n', `${a.id}: the redirect wrote ${a.stdout}`);
      }
      seen.push(a);
    }
    run(actions);
  };
  assert.equal(h.untilDone().then, 'done');
  const steps = new Set(seen.map((a) => a.step));
  for (const step of ['progress', 'ci-read', 'frontier', 'acceptance', 'overlap', 'assignment', 'brief', 'body', 'merge', 'acceptance-check'])
    assert.ok(steps.has(step), `an exec of ${step} with its stdout was checked`);
  assert.ok(seen.some((a) => a.batch > 1), 'later batches included');
});

test('#128 D2: the host sends batch 1 of each list and runs next after each record: no spawn-check, on to done', (t) => {
  const h = world(t);
  assert.equal(h.untilDone().then, 'done');
  assert.deepEqual(Object.values(h.state().tickets).map((x) => x.stage), ['delivered', 'delivered']);
  const lists = h.wakes.flat();
  assert.ok(!lists.some((o) => o.actions.some((a) => a.step === 'spawn-check')), 'no list carries a spawn-check');
  assert.ok(lists.some((o) => o.actions.some((a) => a.kind === 'spawn' && a.batch > 1)), 'a spawn was listed at a later batch first');
  assert.ok(h.log.every((a) => a.batch === 1), 'the host ran batch 1 only');
  assert.equal(h.log.filter((a) => a.kind === 'spawn' && a.step === 'spawn').length, 2, 'one spawn per ticket');
});

test('#128 D2: a background spawn listed at batch 2 or later and not recorded comes back as the same spawn', (t) => {
  const h = world(t);
  let late = null;
  for (let i = 0; i < 80 && !late; i += 1) {
    const out = JSON.parse(h.tick('next', h.path).out);
    late = out.actions.find((a) => a.kind === 'spawn' && a.batch > 1);
    h.run(out.actions);
  }
  assert.ok(late, 'a list with a spawn at batch 2 or later');
  const r = JSON.parse(h.tick('next', h.path).out);
  assert.ok(!r.actions.some((a) => a.step === 'spawn-check'), 'not a check: it was never handed out');
  assert.equal(r.actions.find((a) => a.id === late.id)?.kind, 'spawn', `${late.id} is issued again as a spawn`);
});

/** The full ticket text a spawn file of IMPLEMENTER.md carries: from its `票面全文` item to the expansion block's. */
const fullTextOf = (brief) => brief.slice(brief.indexOf('- 票面全文：'), brief.indexOf('- 展開區塊：'));
const inOrder = (text, parts) => {
  const at = parts.map((p) => text.indexOf(p));
  return at.every((i, k) => i >= 0 && (k === 0 || i > at[k - 1]));
};

test('#137: on GitHub the ticket face holds the title, body and comments, then the expansion block; the expansion and implementation spawn files embed it', (t) => {
  const h = world(t);
  h.acceptance['#1'] = { items: [], expansions: [] }; // #1 goes to expansion first
  h.comments['#1'] = [{ author: { login: 'maintainer' }, body: 'A comment on #1.', createdAt: '2026-04-30T09:00:00Z' }];
  const expand = distinct(h.actions(h.wake())).find((a) => a.kind === 'spawn' && a.spawn.description === 'expand #1');
  assert.ok(expand, '#1 goes to an expansion agent');
  const expansionBrief = readFileSync(briefOf(expand), 'utf8');
  assert.ok(inOrder(expansionBrief, ['First thing', 'The ticket text of #1.', 'A comment on #1.']), `the title, body and comment of #1 in\n${expansionBrief}`);
  assert.ok(!expansionBrief.includes('<!-- sorry-matt:expansion -->'), 'no expansion block before the expansion');

  const implement = distinct(h.actions(h.wake())).find((a) => a.kind === 'spawn' && a.spawn.description === 'implement #1');
  assert.ok(implement, '#1 is dispatched after its expansion');
  const face = readFileSync(join(h.W, 'tick', 'body', '1.md'), 'utf8');
  assert.ok(inOrder(face, ['First thing', 'The ticket text of #1.', 'A comment on #1.', '<!-- sorry-matt:expansion -->', 'expanded criterion of #1']), `title, body, comment, then the expansion block:\n${face}`);
  assert.equal(face.split('<!-- sorry-matt:expansion -->').length, 2, 'the expansion block once');
  const fullText = fullTextOf(readFileSync(briefOf(implement), 'utf8'));
  for (const text of ['First thing', 'The ticket text of #1.', 'A comment on #1.', 'expanded criterion of #1']) assert.ok(fullText.includes(text), `${JSON.stringify(text)} in the full ticket text:\n${fullText}`);
  // every fetch asks gh for the JSON of the title, body and comments
  const fetches = distinct(h.log).filter((a) => a.step === 'body');
  assert.ok(fetches.length >= 2, 'fetched for the expansion and again for the implementation');
  for (const a of fetches) assert.deepEqual(a.argv.slice(-2), ['--json', 'title,body,comments'], a.command);
});

test('#137: on Local Markdown the ticket face is the ticket file, as before: no gh fetch, the spawn file embeds the file', (t) => {
  const h = world(t, { tracker: 'local' });
  const [id] = h.ids;
  const implement = distinct(h.actions(h.wake())).find((a) => a.kind === 'spawn' && a.spawn.description === `implement ${id}`);
  assert.ok(implement, `${id} is dispatched`);
  assert.ok(!h.log.some((a) => a.step === 'body' || (a.kind === 'exec' && a.argv[0] === 'gh' && a.argv[1] === 'issue')), 'no ticket fetch');
  const fullText = fullTextOf(readFileSync(briefOf(implement), 'utf8'));
  for (const line of localTicket(id, 'First thing').split('\n').filter(Boolean)) assert.ok(fullText.includes(line), `${JSON.stringify(line)} in the full ticket text:\n${fullText}`);
});

test('#128 D3: under expand: skip the spawn file says the ticket text is the acceptance; under agent, the criteria', (t) => {
  for (const [profile, line] of [
    [{ expand: 'skip' }, '- 驗收來源：票面文字就是驗收\n'],
    [null, '- 驗收來源：驗收項與展開區塊\n'],
  ]) {
    const h = world(t, { profile });
    if (profile) h.acceptance['#1'] = { items: [], expansions: [] }; // no criteria: under skip it goes on with its text
    const spawn = h.actions(h.wake()).find((a) => a.kind === 'spawn' && a.tickets[0] === '#1');
    assert.ok(spawn, `#1 is dispatched under ${profile ? 'skip' : 'agent'}`);
    for (const file of [briefOf(spawn), briefOf({ spawn: spawn.spawn.fallback })]) assert.ok(readFileSync(file, 'utf8').includes(line), `${file} has ${JSON.stringify(line)}`);
  }
});

test('#130: under expand: skip a ticket whose snapshot has criteria (a previous run expanded it) gets criteria, not ticket-text', (t) => {
  const EXPANDED = '<!-- sorry-matt:expansion -->\nby: expansion-agent\nrun: r0\nround: 1\n\nacceptance:\n- [ ] it works';
  for (const [spec, acceptance, line, expansion] of [
    [{ items: [{ from: 'expansion', by: 'expansion-agent', run: 'r0', round: '1', text: 'it works' }], expansions: [{ by: 'expansion-agent', run: 'r0', round: '1', at: 'u', text: EXPANDED }] }, 'criteria', '- 驗收來源：驗收項與展開區塊\n', `- 展開區塊：${EXPANDED.replace(/\n(?=.)/g, '\n  ')}\n`],
    [{ items: [{ from: 'original', text: 'criterion of #1' }], expansions: [] }, 'criteria', '- 驗收來源：驗收項與展開區塊\n', '- 展開區塊：none\n'],
    [{ items: [], expansions: [] }, 'ticket-text', '- 驗收來源：票面文字就是驗收\n', '- 展開區塊：none\n'],
  ]) {
    const h = world(t, { profile: { expand: 'skip' } });
    h.acceptance['#1'] = spec;
    const spawn = h.actions(h.wake()).find((a) => a.kind === 'spawn' && a.tickets[0] === '#1');
    assert.ok(spawn, `#1 is dispatched with ${spec.items.length} criteria`);
    const values = JSON.parse(readFileSync(join(h.W, 'tick', 'brief', '1-1.values.json'), 'utf8'));
    assert.equal(values.acceptance, acceptance, `${spec.items.length} criteria: acceptance ${acceptance}`);
    const brief = readFileSync(briefOf(spawn), 'utf8');
    assert.ok(brief.includes(line), `${JSON.stringify(line)} in\n${brief}`);
    assert.ok(brief.includes(expansion), `${JSON.stringify(expansion)} in\n${brief}`);
  }
});

test('#128 D4: the minimal reviewer writes its report to a file; record fix is refused until the file holds it', (t) => {
  const h = world(t, { profile: { review: 'minimal' } });
  const spawn = h.spawn;
  let refused = 0;
  h.spawn = (a) => {
    if (a.step !== 'review' || a.tickets[0] !== '#1' || a.meta.mode !== 'initial') return spawn(a);
    const report = reportOf(a);
    const W = h.W.replace(/\\/g, '/');
    assert.equal(report.replace(/\\/g, '/'), `${W}/tick/review/1-1.report.md`);
    const brief = readFileSync(briefOf(a), 'utf8');
    assert.ok(brief.includes(report), 'the brief names the report file');
    assert.match(brief, /write your full report/i);
    const fix = () => h.tick('record', h.path, a.id, '--agent', 'rv1', '--outcome', 'fix', '--findings', 'F1');
    assert.equal(existsSync(report), false);
    assert.equal(fix().code, 3, 'no report file: refused');
    write(report, '  \n');
    assert.equal(fix().code, 3, 'an empty report file: refused');
    h.writeReport(report, 'verdict: fix\nF1: a.txt:1 wrong (evidence)\n');
    refused += 1;
    return ['--agent', 'rv1', '--outcome', 'fix', '--findings', 'F1'];
  };
  h.untilDone();
  assert.equal(refused, 1);
  assert.equal(h.state().tickets['#1'].reviews[0].verdict, 'fix', 'the same record is taken once the file holds the report');
  // the fix round reads its findings from that file, not from the status record
  const send = h.log.find((a) => a.step === 'send' && a.tickets[0] === '#1');
  assert.ok(send.do.includes(join(h.W, 'tick', 'review', '1-1.report.md')), send.do);
  assert.doesNotMatch(send.do, /status record/);
  // #130: the batched fix the send points to says that under review: minimal the report file is what is handed over
  const ref = send.reference.find((r) => r.path.endsWith('SKILL.md') && r.part === 'section 2, Batched fix');
  assert.ok(ref, 'the send points to SKILL.md section 2, Batched fix');
  for (const [skill, heading, line] of [
    [ref.path, '### 集中修正', /`review: minimal` 時.*交回原 agent 的是 reviewer 報告檔.*的路徑，不是審查區塊的位置/],
    [join(root, 'skills', 'get-to-work', 'SKILL.md'), '### Batched fix', /Under `review: minimal`.*hand the original agent the path of the reviewer's report file.*not a review block's location/],
  ]) {
    const text = readFileSync(skill, 'utf8').replace(/\r\n/g, '\n');
    const section = text.slice(text.indexOf(heading), text.indexOf('\n### ', text.indexOf(heading) + 1));
    assert.match(section.replace(/\n/g, ' '), line, `${skill}: ${heading}`);
  }
  assert.equal(h.wakes.at(-1).at(-1).then, 'done');
});

/** A minimal review of #1 at its initial review, played by `play(a)` (the reviewer's flags for its record). */
function minimalReview(t, play, profile = {}) {
  const h = world(t, { profile: { review: 'minimal', ...profile } });
  const spawn = h.spawn;
  const seen = [];
  h.spawn = (a) => {
    if (a.step !== 'review' || a.tickets[0] !== '#1' || a.meta.mode !== 'initial') return spawn(a);
    seen.push(a);
    return play(a, h);
  };
  return { h, seen };
}
const recordReview = (h, a, outcome) => h.tick('record', h.path, a.id, '--agent', 'rv1', '--outcome', outcome, ...(outcome === 'fix' ? ['--findings', 'F1'] : []));

test('#130: minimal record review is refused (3) when the report says another verdict: fix recorded on a pass report', (t) => {
  const { h, seen } = minimalReview(t, (a, h) => {
    h.writeReport(reportOf(a), 'verdict: pass\n');
    const r = recordReview(h, a, 'fix');
    assert.equal(r.code, 3, 'fix on a report that says pass');
    assert.match(r.err, /verdict/);
    return ['--agent', 'rv1', '--outcome', 'pass'];
  });
  assert.equal(h.untilDone().then, 'done');
  assert.equal(seen.length, 1);
  assert.equal(h.state().tickets['#1'].reviews[0].verdict, 'pass', 'the verdict the report holds is taken');
});

test('#130: minimal record review is refused (3) when the report says another verdict: pass recorded on a fix report', (t) => {
  const { h, seen } = minimalReview(t, (a, h) => {
    h.writeReport(reportOf(a), 'verdict: fix\nF1: a.txt:1 wrong (evidence)\n');
    const r = recordReview(h, a, 'pass');
    assert.equal(r.code, 3, 'pass on a report that says fix');
    assert.match(r.err, /verdict/);
    h.writeReport(reportOf(a), 'F1: a.txt:1 wrong (evidence)\n');
    assert.equal(recordReview(h, a, 'fix').code, 3, 'a report with no verdict line');
    h.writeReport(reportOf(a), 'verdict: fix\nF1: a.txt:1 wrong (evidence)\n');
    return ['--agent', 'rv1', '--outcome', 'fix', '--findings', 'F1'];
  });
  assert.equal(h.untilDone().then, 'done');
  assert.equal(seen.length, 1);
  assert.equal(h.state().tickets['#1'].reviews[0].verdict, 'fix');
});

test("#130: minimal record review is refused (3) when the report was written before the round's review spawn was first issued", (t) => {
  const { h, seen } = minimalReview(t, (a, h) => {
    const issued = h.state().tick.issued[a.id].at;
    assert.equal(issued, h.iso(), 'tick keeps when it issued the review spawn');
    // an interrupted round left this report behind: written a minute before the spawn was issued again
    for (const outcome of ['fix', 'pass']) {
      h.writeReport(reportOf(a), `verdict: ${outcome}\n`, Date.parse(issued) - 60_000);
      const r = recordReview(h, a, outcome);
      assert.equal(r.code, 3, `an old report: ${outcome} refused`);
      assert.match(r.err, /before/);
    }
    h.writeReport(reportOf(a), 'verdict: fix\nF1: a.txt:1 wrong (evidence)\n');
    return ['--agent', 'rv1', '--outcome', 'fix', '--findings', 'F1'];
  });
  assert.equal(h.untilDone().then, 'done');
  assert.equal(seen.length, 1);
  assert.equal(h.state().tickets['#1'].reviews[0].verdict, 'fix', 'the report this round wrote is taken');
});

test('#130: minimal record review accepts the report this round wrote with the verdict it records', (t) => {
  const { h, seen } = minimalReview(t, (a, h) => {
    h.writeReport(reportOf(a), 'verdict: fix\nF1: a.txt:1 wrong (evidence)\n');
    return ['--agent', 'rv1', '--outcome', 'fix', '--findings', 'F1']; // h.record asserts exit 0
  });
  assert.equal(h.untilDone().then, 'done');
  assert.equal(seen.length, 1);
  assert.equal(h.state().tickets['#1'].reviews[0].verdict, 'fix');
  assert.equal(h.state().tickets['#1'].reviews.at(-1).verdict, 'pass', 'the recheck passes');
});

/** The host runs `next` once more before it records the review spawn `a`: the list hands the same spawn out again. */
const nextAgain = (h, a) => {
  const r = h.tick('next', h.path);
  assert.equal(r.code, 0, r.err);
  assert.ok(JSON.parse(r.out).actions.some((x) => x.id === a.id), `${a.id} is handed out again, not recorded yet`);
};

test('#145: a report written before one more `next` is accepted: issuing the same round again keeps its issue time', (t) => {
  const { h, seen } = minimalReview(t, (a, h) => {
    const first = h.state().tick.issued[a.id].at;
    assert.equal(first, h.iso(), 'the round was first issued now');
    h.now += 60_000;
    h.writeReport(reportOf(a), 'verdict: fix\nF1: a.txt:1 wrong (evidence)\n');
    h.now += 60_000;
    nextAgain(h, a);
    assert.equal(h.state().tick.issued[a.id].at, first, "the issue time is still the round's first");
    return ['--agent', 'rv1', '--outcome', 'fix', '--findings', 'F1']; // h.record asserts exit 0
  });
  assert.equal(h.untilDone().then, 'done');
  assert.equal(seen.length, 1);
  assert.equal(h.state().tickets['#1'].reviews[0].verdict, 'fix', 'the report written before the extra next is taken');
});

test('#145: a report from before the round was first issued is still refused after one more `next`', (t) => {
  const { h, seen } = minimalReview(t, (a, h) => {
    const first = h.state().tick.issued[a.id].at;
    h.writeReport(reportOf(a), 'verdict: fix\nF1: a.txt:1 wrong (evidence)\n', Date.parse(first) - 60_000);
    h.now += 60_000;
    nextAgain(h, a);
    const r = recordReview(h, a, 'fix');
    assert.equal(r.code, 3, "an older round's report: refused");
    assert.match(r.err, /before/);
    assert.ok(r.err.includes(first), r.err);
    h.writeReport(reportOf(a), 'verdict: fix\nF1: a.txt:1 wrong (evidence)\n');
    return ['--agent', 'rv1', '--outcome', 'fix', '--findings', 'F1'];
  });
  assert.equal(h.untilDone().then, 'done');
  assert.equal(seen.length, 1);
  assert.equal(h.state().tickets['#1'].reviews[0].verdict, 'fix', 'the report this round wrote is taken');
});

test('#145: the initial review and each recheck are rounds of their own, each with the time it was first issued', (t) => {
  const h = world(t, { profile: { review: 'minimal', fixRounds: 2 } });
  const spawn = h.spawn;
  const rounds = [];
  h.spawn = (a) => {
    if (a.step !== 'review' || a.tickets[0] !== '#1') return spawn(a);
    const first = h.state().tick.issued[a.id].at;
    rounds.push({ id: a.id, mode: a.meta.mode, first, now: h.iso() });
    h.now += 60_000;
    nextAgain(h, a); // the same round issued again: its time stays
    assert.equal(h.state().tick.issued[a.id].at, first, `${a.id}: the round's first issue time`);
    const outcome = rounds.length < 3 ? 'fix' : 'pass';
    h.writeReport(reportOf(a), `verdict: ${outcome}\n${outcome === 'fix' ? 'F1: a.txt:1 wrong (evidence)\n' : ''}`);
    return ['--agent', `rv${rounds.length}`, '--outcome', outcome, ...(outcome === 'fix' ? ['--findings', 'F1'] : [])];
  };
  assert.equal(h.untilDone().then, 'done');
  assert.deepEqual(
    rounds.map((r) => r.mode),
    ['initial', 'recheck', 'recheck'],
  );
  assert.equal(new Set(rounds.map((r) => r.id)).size, 3, 'each round is its own action');
  for (const r of rounds) assert.equal(r.first, r.now, `${r.id}: written when the round was first issued`);
  assert.ok(rounds.every((r, k) => k === 0 || Date.parse(r.first) > Date.parse(rounds[k - 1].first)), 'each round a new, later time');
});

test('#130: with onUnfixed: stuck the mark-stuck judge names the report file (minimal) or the review block (full)', (t) => {
  for (const profile of [{ review: 'minimal' }, null]) {
    const h = world(t, { profile });
    h.policy.review = (a) => (a.tickets[0] === '#1' ? { outcome: 'fix', findings: 'F1' } : 'pass');
    h.policy['mark-stuck'] = (a) => {
      // as SEND-BACK.md has it: the ticket's worktree and branch are removed
      const branch = h.state().tickets[a.tickets[0]].branch;
      const blocks = git(h.repo, 'worktree', 'list', '--porcelain').split(/\n\s*\n/);
      const wt = blocks.find((b) => b.includes(`branch refs/heads/${branch}`))?.match(/^worktree (.+)$/m)?.[1];
      if (wt) git(h.repo, 'worktree', 'remove', '--force', wt);
      git(h.repo, 'branch', '-D', branch);
      return { outcome: 'stuck', value: 'findings still open' };
    };
    assert.equal(h.untilDone().then, 'done', `the run under ${profile ? 'minimal' : 'full'} finished`);
    assert.equal(stage(h, '#1'), 'stuck');
    const mark = h.log.find((a) => a.step === 'mark-stuck' && a.tickets[0] === '#1');
    assert.ok(mark, 'a mark-stuck judge');
    if (profile) {
      const last = h.log.filter((a) => a.step === 'review' && a.tickets[0] === '#1').at(-1);
      assert.ok(mark.do.includes(`the open findings are in ${reportOf(last)}, the reviewer's report`), mark.do);
      assert.doesNotMatch(mark.do, /review block/);
    } else {
      assert.match(mark.do, /the open findings are in the latest review block of its status record/);
      assert.ok(!mark.do.includes('.report.md'), mark.do);
    }
  }
});

test('#130: the minimal reviewer brief names the ticket text file and the acceptance source; its spawn waits for the text', (t) => {
  for (const [profile, items, source] of [
    [{}, null, (h) => `- Acceptance: the \`items\` of the acceptance snapshot ${join(h.W, 'acceptance', '1.json')}.`],
    [{ expand: 'skip' }, [], () => '- Acceptance: the ticket text is the acceptance (expand: skip, and the snapshot has no criteria).'],
  ]) {
    const { h, seen } = minimalReview(
      t,
      (a, h) => {
        h.writeReport(reportOf(a), 'verdict: pass\n');
        return ['--agent', 'rv1', '--outcome', 'pass'];
      },
      profile,
    );
    if (items) h.acceptance['#1'] = { items, expansions: [] };
    assert.equal(h.untilDone().then, 'done');
    assert.equal(seen.length, 1);
    const brief = readFileSync(briefOf(seen[0]), 'utf8');
    const body = resolve(join(h.W, 'tick', 'body', '1.md'));
    assert.ok(brief.includes(`- Ticket text: ${body} (the full ticket text).`), brief);
    assert.ok(brief.includes(source(h)), `${JSON.stringify(source(h))} in\n${brief}`);
    assert.match(readFileSync(body, 'utf8'), /The ticket text of #1\./);
    const first = h.wakes.flat().flatMap((o) => o.actions).find((a) => a.id === seen[0].id);
    assert.ok(first.after.includes(`body:#1:review:1`), `the review spawn waits for the ticket text: ${first.after}`);
  }
});

test('#128 D4: a fix round given to a new agent names the findings source: the report file (minimal) or the status record (full)', (t) => {
  for (const profile of [{ review: 'minimal' }, null]) {
    const h = world(t, { profile });
    h.policy.review = (a) => (a.tickets[0] === '#1' && a.meta.mode === 'initial' ? { outcome: 'fix', findings: 'F1' } : 'pass');
    h.policy.send = () => 'gone'; // the implementer is gone: a new agent takes the fix round
    assert.equal(h.untilDone().then, 'done', `the run under ${profile ? 'minimal' : 'full'} finished`);
    const send = h.log.find((a) => a.step === 'send' && a.tickets[0] === '#1');
    const respawn = h.log.find((a) => a.kind === 'spawn' && a.step === 'spawn' && a.tickets[0] === '#1' && a.spawn.description === 'fix #1');
    assert.ok(send && respawn, 'a send, then a spawn of a fix agent');
    const brief = readFileSync(briefOf(respawn), 'utf8');
    const report = join(h.W, 'tick', 'review', '1-1.report.md');
    if (profile) {
      for (const text of [send.do, brief]) {
        assert.ok(text.includes(report), `names ${report}`);
        assert.doesNotMatch(text, /status record|狀態紀錄/);
      }
    } else {
      assert.match(send.do, /verbatim \(summary, evidence, fix\) from the status record/);
      assert.match(brief, /from the status record/);
      assert.ok(!send.do.includes('.report.md') && !brief.includes('.report.md'));
    }
  }
});

// ---- #138: the prove-it review is a spawn with a spawn file brief.mjs review filled -----------------------------------

/** The value lines a review host's spawn file for #1 carries (brief.mjs review's labels), every one filled. */
function reviewHostValues(h, { mode, tag, report, previous }) {
  const st = h.state();
  return [
    `- mode: ${mode}\n`,
    `- repo: ${resolve(h.repo)}\n`,
    '- tracker: GitHub (o/r)\n',
    `- ticket: #1; ticket face (the ticket text with its expansion blocks): ${resolve(h.W, 'tick', 'body', '1.md')}\n`,
    '- status record: the comment on o/r#1 whose first line is `<!-- sorry-matt:status -->`\n',
    `- acceptance snapshot: ${resolve(h.W, 'acceptance', '1.json')}; comparison: ${resolve(h.W, 'tick', 'against', `1-${tag}.json`)}\n`,
    `- fixed point: ${LINE}\n`,
    `- ticket branch: ${st.tickets['#1'].branch}\n`,
    `- targeted checks: source=commands.md; node --test by ${report.meta.agent} → green (commit c-${report.meta.agent} (branch ${st.tickets['#1'].branch}); the agent's report: ${resolve(report.meta.agentReport)})\n`,
    '- CI coverage: covered\n',
    `- previous review block: ${previous}\n`,
    '- reviewer: primary\n',
    `- scratchpad: ${resolve(h.dir, 'wts', 'review', '1')}\n`,
  ];
}

test('#138: a prove-it review is a foreground spawn whose spawn file brief.mjs review filled, at the initial review and the recheck', (t) => {
  const h = world(t);
  h.policy.review = (a) => (a.tickets[0] === '#1' && a.meta.mode === 'initial' ? { outcome: 'fix', findings: 'F1' } : 'pass');
  assert.equal(h.untilDone().then, 'done');
  const reviews = h.log.filter((a) => a.step === 'review' && a.tickets[0] === '#1');
  assert.deepEqual(reviews.map((a) => [a.kind, a.meta.mode]), [['spawn', 'initial'], ['spawn', 'recheck']], 'no review judge is handed to the host');
  const collects = h.log.filter((a) => a.step === 'collect' && a.tickets[0] === '#1');
  assert.deepEqual(collects.map((a) => a.meta.stage), ['implementing', 'fixing']);
  for (const [k, a] of reviews.entries()) {
    assert.deepEqual(
      { type: a.spawn.subagent_type, background: a.spawn.background, description: a.spawn.description, fallback: a.spawn.fallback ?? null, outcomes: a.outcomes },
      { type: 'general-purpose', background: false, description: 'review #1', fallback: null, outcomes: ['pass', 'fix', 'stuck'] },
    );
    assert.match(a.record, /--agent <agent id> --outcome pass\|fix\|stuck/);
    // the list that first hands it out (a later batch) names what it waits for in that list
    const first = h.wakes.flat().flatMap((o) => o.actions).find((x) => x.id === a.id);
    const brief = h.log.find((x) => x.step === 'brief' && x.argv[2] === 'review' && first.after.includes(x.id));
    assert.ok(brief, `${a.id} waits for brief.mjs review: ${first.after}`);
    // and for the ticket face fetched again: in the same list, or (#139: fetched while the tier is judged) before it
    const body = `body:#1:review:${k + 1}`;
    assert.ok(first.after.includes(body) || h.log.findIndex((x) => x.id === body) < h.log.findIndex((x) => x.id === a.id), 'the ticket face is fetched again before the spawn');
    assert.ok(h.log.some((x) => x.id === body), `${body} ran`);
    const file = readFileSync(briefOf(a), 'utf8');
    assert.doesNotMatch(file, /\{[^{}]*\}/, 'no placeholder is left for the host');
    assert.ok(file.startsWith('你是審查主持 agent：'), 'REVIEWER.md fixed rules first');
    const expected = reviewHostValues(h, { mode: a.meta.mode, tag: k + 1, report: collects[k], previous: k ? 'in the status record' : 'none' });
    for (const line of expected) assert.ok(file.includes(line), `${a.id}: ${JSON.stringify(line)} in\n${file.slice(file.lastIndexOf('\n---\n'))}`);
  }
  // the review host is recorded as an agent of the run with the role word review
  const agents = Object.values(h.state().tick.agents).filter((x) => x.role === 'review');
  assert.equal(agents.length, h.log.filter((a) => a.step === 'review').length);
  assert.deepEqual(h.state().tickets['#1'].reviews.map((r) => [r.kind, r.mode, r.verdict]), [['full', 'initial', 'fix'], ['full', 'recheck', 'pass']]);
});

test('#138: record green is refused (3) until the agent report the collect names holds a targeted checks line', (t) => {
  const h = world(t);
  let checked = 0;
  h.policy.collect = (a) => {
    if (a.meta.stage === 'implementing' && a.tickets[0] === '#1' && !checked) {
      assert.ok(a.do.includes(a.meta.agentReport), `the collect names the report file: ${a.do}`);
      const green = () => h.tick('record', h.path, a.id, '--outcome', 'green');
      assert.equal(green().code, 3, 'no report file');
      write(a.meta.agentReport, 'ticket: #1\ncommit: abc\n');
      const r = green();
      assert.equal(r.code, 3, 'a report without its targeted checks line');
      assert.match(r.err, /targeted checks/);
      assert.equal(h.state().tickets['#1'].stage, 'implementing', 'nothing moved');
      checked += 1;
    }
    return { implementing: 'green', expanding: 'reported', fixing: 'fixed', integrating: 'resolved' }[a.meta.stage];
  };
  assert.equal(h.untilDone().then, 'done');
  assert.equal(checked, 1);
});

test('#138: a ticket in review with no agent report on file gets a judge to write it before the review spawn', (t) => {
  const h = world(t);
  const record = h.record;
  h.record = (id, ...flags) => {
    const r = record(id, ...flags);
    const a = h.log.findLast((x) => x.id === id);
    if (a?.step === 'collect' && a.tickets[0] === '#1' && a.meta.stage === 'implementing') rmSync(a.meta.agentReport); // lost, or a state from before #138
    return r;
  };
  h.policy['agent-report'] = (a) => {
    assert.equal(h.tick('record', h.path, a.id, '--outcome', 'written').code, 3, 'refused while the file is missing');
    write(a.meta.agentReport, h.agentReport({ tickets: a.tickets, meta: { agent: 'a1' } }));
    return 'written';
  };
  assert.equal(h.untilDone().then, 'done');
  const judges = h.log.filter((a) => a.step === 'agent-report');
  assert.deepEqual(judges.map((a) => a.tickets), [['#1']]);
  const review = h.log.find((a) => a.step === 'review' && a.tickets[0] === '#1');
  assert.ok(readFileSync(briefOf(review), 'utf8').includes(`the agent's report: ${resolve(judges[0].meta.agentReport)})`));
});

test('#138: Local Markdown: the status record is the ticket file in the ticket worktree', (t) => {
  const h = world(t, { tracker: 'local' });
  const seen = [];
  const spawn = h.spawn;
  h.spawn = (a) => {
    if (a.step === 'review') seen.push({ a, file: readFileSync(briefOf(a), 'utf8'), wt: h.state().tickets[a.tickets[0]].assignment?.worktree });
    return spawn(a);
  };
  assert.equal(h.untilDone().then, 'done');
  const one = seen.find((x) => x.a.tickets[0] === h.ids[0]);
  assert.equal(one.a.spawn.description, `review ${h.ids[0]}`);
  assert.ok(one.file.includes('- tracker: Local Markdown\n'));
  assert.ok(one.file.includes(`- status record: ${resolve(one.wt, TICKETS_DIR, h.ids[0])}\n`), one.file.slice(one.file.lastIndexOf('\n---\n')));
});

test('#128 D4: under review: minimal a fix agent reassigned after a timeout is pointed at the report file', (t) => {
  const h = world(t, { profile: { review: 'minimal' } });
  h.policy.review = (a) => (a.tickets[0] === '#1' && a.meta.mode === 'initial' ? { outcome: 'fix', findings: 'F1' } : 'pass');
  h.policy.send = () => 'sent'; // the fix agent takes the round and then does nothing: no commit, no report
  h.wake();
  h.wake();
  assert.equal(stage(h, '#1'), 'fixing');
  const w3 = h.wake({ minutes: 31, reported: [] });
  const timeout = h.actions(w3).find((a) => a.step === 'timeout');
  assert.ok(timeout && timeout.tickets[0] === '#1', 'the silent fix agent is stopped and reassigned');
  const respawn = h.log.find((a) => a.kind === 'spawn' && a.step === 'spawn' && a.tickets[0] === '#1' && a.spawn.description === 'fix #1');
  assert.ok(respawn, 'a new fix agent');
  const brief = readFileSync(briefOf(respawn), 'utf8');
  assert.match(brief, /timed out and was stopped/);
  // #130: the record it updates is the status record; the findings of this round are in the reviewer's report
  assert.match(brief, /Update the existing status record in place/);
  assert.ok(brief.includes(`The findings of this fix round are in ${join(h.W, 'tick', 'review', '1-1.report.md')}`), 'the findings are in the reviewer report');
  assert.doesNotMatch(brief, /this ticket's existing record/);
  assert.doesNotMatch(brief, /review block/);
});

/** Seeds the line as settled "CI does not cover the integration branch" (state.mjs ci sets it after two empty reads). */
const settleNotCovering = (h) => {
  const st = h.state();
  st.lines[LINE].ciNotCovering = { sha: st.lines[LINE].tip, at: h.iso() };
  writeFileSync(h.path, `${JSON.stringify(st, null, 2)}\n`);
};

for (const [name, reason, setup] of [
  ['no origin', 'no-origin', (h) => git(h.repo, 'remote', 'remove', 'origin')],
  ['CI not covering the line', 'ci-not-covering', settleNotCovering],
]) {
  test(`#141: ${name}: no local verification at the dispatch points; a green finish verifies the latest SHA once`, (t) => {
    const h = world(t);
    setup(h);
    assert.equal(h.untilDone().then, 'done');
    const tip = git(h.intWt, 'rev-parse', 'HEAD');
    const verifies = h.log.filter((a) => a.step === 'verify-local');
    assert.deepEqual(
      verifies.map((a) => [a.argv[a.argv.indexOf('--sha') + 1], a.argv[a.argv.indexOf('--reason') + 1]]),
      [[tip, reason]],
      'one verification, at the finish, of the latest SHA',
    );
    assert.ok(!h.log.some((a) => a.step === 'red-light'), 'green: no red-light handling');
    const L = h.state().lines[LINE];
    assert.deepEqual(L.local.map((x) => [x.sha, x.result]), [[tip, 'green']], 'one per-SHA record: the latest SHA');
    assert.ok(!h.log.some((a) => a.step === 'ci-read'), 'nothing reads CI');
    assert.deepEqual(Object.values(h.state().tickets).map((x) => x.stage), ['delivered', 'delivered']);
  });
}

for (const [culprit, file] of [
  ['#1', 'a.js'],
  ['#2', 'b.js'],
]) {
  test(`#141: no origin: a red finish verifies the integration SHAs from the oldest; the first red, ${culprit}'s merge, is the earliest red`, (t) => {
    // the Full checks fail once the culprit's file is in the tree: from its merge on
    const h = world(t, { check: `node -e "process.exit(require('fs').existsSync('${file}') ? 1 : 0)"` });
    git(h.repo, 'remote', 'remove', 'origin');
    let handed = null;
    h.policy['red-light'] = (a) => {
      // RED-LIGHT.md step 1: ci.mjs earliest-red on the state's per-SHA records, `ci` false on a line on local verification
      const st = h.state();
      const plan = join(h.W, 'ci', 'line-1.plan.json');
      write(
        plan,
        JSON.stringify({
          worktree: h.intWt,
          line: LINE,
          base: 'main',
          ci: false,
          local: st.lines[LINE].local.map((x) => `local: ${LINE} ${x.sha} ${x.result} ${x.reason}`),
          tickets: Object.entries(st.tickets).map(([id, x]) => ({ id, merges: x.merges.map((m) => m.sha) })),
        }),
      );
      const r = ciMain(['earliest-red', plan], ciDeps());
      assert.equal(r.code, 0, r.err);
      handed = { action: a, logged: h.log.length, earliest: JSON.parse(r.out) };
      return 'failed'; // the line failed verification: on to the delivery
    };
    assert.equal(h.untilDone().then, 'done');
    const st = h.state();
    const tip = git(h.intWt, 'rev-parse', 'HEAD');
    const merges = git(h.intWt, 'rev-list', '--first-parent', '--merges', '--reverse', `main..${LINE}`).split('\n'); // oldest first
    const earliest = st.tickets[culprit].merges[0].sha;
    const scanned = merges.slice(0, merges.indexOf(earliest) + 1).filter((x) => x !== tip);
    const verified = h.log.filter((a) => a.step === 'verify-local').map((a) => a.argv[a.argv.indexOf('--sha') + 1]);
    assert.deepEqual(verified, [tip, ...scanned], 'the finish verifies the tip once; then each integration SHA from the oldest, up to the first red');
    assert.deepEqual(
      st.lines[LINE].local.map((x) => [x.sha, x.result]),
      [[tip, 'red'], ...scanned.map((x) => [x, x === earliest ? 'red' : 'green'])],
    );
    assert.ok(handed, 'the red goes to red-light handling');
    assert.equal(h.log.filter((a) => a.step === 'red-light').length, 1);
    assert.equal(handed.action.meta.earliestRed, earliest);
    assert.match(handed.action.do, new RegExp(`earliest red SHA ${earliest}`));
    assert.ok(h.log.slice(handed.logged).every((a) => a.step !== 'verify-local'), 'every verification came before it');
    assert.equal(handed.earliest.earliestRed, earliest, 'ci.mjs earliest-red on those records finds the same SHA');
    assert.deepEqual(handed.earliest.tickets, [culprit]);
    const trees = git(h.repo, 'worktree', 'list', '--porcelain');
    assert.ok(!scanned.some((x) => trees.includes(x.slice(0, 12))), 'the worktrees of the scan are removed');
    assert.equal(git(h.intWt, 'rev-parse', 'HEAD'), tip, 'the integration worktree stays at the tip');
  });
}

test('#141: no origin: after a fix round the new tip is verified once; green ends the red-light handling', (t) => {
  const h = world(t, { check: `node -e "process.exit(require('fs').existsSync('b.js') ? 1 : 0)"` });
  git(h.repo, 'remote', 'remove', 'origin');
  h.policy['red-light'] = () => {
    git(h.intWt, 'rm', '-q', 'b.js');
    git(h.intWt, 'commit', '-q', '-m', 'fix the red light');
    return 'handled';
  };
  assert.equal(h.untilDone().then, 'done');
  const st = h.state();
  const [m1, m2] = [st.tickets['#1'].merges[0].sha, st.tickets['#2'].merges[0].sha];
  const fixed = git(h.intWt, 'rev-parse', 'HEAD');
  const verified = h.log.filter((a) => a.step === 'verify-local').map((a) => a.argv[a.argv.indexOf('--sha') + 1]);
  assert.deepEqual(verified, [m2, m1, fixed], 'the red tip, the scan, then the fixed tip: each once');
  assert.equal(st.lines[LINE].local.find((x) => x.sha === fixed).result, 'green');
  assert.equal(h.log.filter((a) => a.step === 'red-light').length, 1);
  assert.ok(h.log.some((a) => a.step === 'deliver-line'), 'the line is delivered');
  assert.equal(st.tick.red[LINE], undefined);
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
  const spawns = distinct(h.actions(h.wake())).filter((a) => a.kind === 'spawn');
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
    'brief:review', // review: minimal (no review host, so no spawn file from brief.mjs review, #138) …
    'ci-read', // ci: skip
    'ci-record',
    'collect:expanding',
    'deliver-line', // integrate: direct (no aggregate PR) …
    'gate', // … no finish gate (its assertions assume aggregate PRs and a CI read) …
    'review:full:initial', // … no prove-it review …
    'review:full:recheck', // … and recheck: false
    'spawn:general-purpose:simplify', // simplify: false
    'spawn:sorry-matt:expander:expand',
    'stage:expanding',
    'sync-base', // … and no base sync
    'tier', // review: minimal judges no review tier (#139)
  ]);
  assert.deepEqual(only(relaxed, strict), [
    'file-issue', // onUnfixed: file-issue
    'push', // integrate: direct (the base branch is pushed by the host, so the guard hook sees it)
    'review:minimal:initial', // review: minimal
  ]);
  // integrate: direct merged into the base branch itself; the default into the line
  assert.equal(git(relaxed.h.repo, 'rev-list', '--first-parent', '--merges', '--count', 'main'), '2');
  assert.equal(git(strict.h.repo, 'rev-list', '--first-parent', '--merges', '--count', 'main'), '0');
  assert.equal(git(relaxed.h.repo, 'rev-parse', 'origin/main'), git(relaxed.h.repo, 'rev-parse', 'main'), 'the host pushed the base branch');
  assert.equal(relaxed.h.state().tickets['#1'].unfixedIssue, '#99');
});

function signature(a) {
  if (a.step === 'review') return `review:${a.meta.kind}:${a.meta.mode}`; // the review host's spawn or the minimal reviewer's
  if (a.kind === 'spawn') return `spawn:${a.spawn.subagent_type}:${a.spawn.description.split(' ')[0]}`;
  if (a.kind === 'exec') {
    if (a.step === 'stage') return `stage:${a.argv[4]}`;
    if (a.step === 'assignment' && a.argv.includes('--expansions')) return 'assignment:expand';
    if (a.step === 'brief') return `brief:${a.argv[2]}`;
    return a.step;
  }
  if (a.step === 'collect') return `collect:${a.meta.stage}`;
  return a.step;
}

// ---- #129: tick.mjs run ----------------------------------------------------------------------------------------------

/** One `run` output, which must have exited 0 with nothing on stderr. */
const runOut = (h, ...args) => {
  const r = h.runTick(...args);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.err, '');
  return JSON.parse(r.out);
};
/** An exec run leaves to the host: one the guard hook's classification gives a verdict, so the guard sees it (#146). */
const guarded = (a) => classify({ tool_name: 'Bash', tool_input: { command: a.command }, cwd: process.cwd() }).length > 0;
const leftForHost = (a) => a.kind === 'exec' && guarded(a);

test('#129: run checks its arguments as next does; with no exec to run it lists what next lists, and ran is []', (t) => {
  const h = world(t);
  for (const args of [['--bogus', 'x'], ['--reported'], ['extra.json']]) {
    const r = h.runTick(...args);
    assert.equal(r.code, 2, `${args.join(' ')}: ${r.err}`);
    assert.equal(r.out, '');
  }
  const none = tick(['run'], { ...defaultDeps(), execute: () => assert.fail('nothing runs') });
  assert.equal(none.code, 2);
  assert.equal(none.out, '');
  // an interrupted spawn: batch 1 is a spawn-check judge, so nothing runs and run lists what next lists
  h.crashAfter = (a) => a.kind === 'spawn';
  assert.throws(() => h.wake(), Crash);
  h.crashAfter = null;
  const plain = JSON.parse(h.tick('next', h.path).out);
  assert.ok(plain.actions.filter((a) => a.batch === 1).every((a) => a.kind !== 'exec'), 'batch 1 holds no exec');
  h.execute = () => assert.fail('nothing runs');
  const out = runOut(h);
  assert.equal(out.format, 'sorry-matt/tick@1');
  assert.equal(out.command, 'run');
  assert.deepEqual(out.ran, []);
  assert.deepEqual(ids(out.actions), ids(plain.actions));
  for (const k of ['run', 'wakeup', 'now', 'profile', 'reports', 'reconcile', 'dispatch', 'wrote', 'fallback', 'then']) assert.ok(k in out, `${k} is in the output`);
});

test('#129: run goes from the dispatch point to the first implementation spawn, each exec recorded with its exit', (t) => {
  const h = world(t);
  const seen = [];
  h.execute = (a) => {
    seen.push(a.id);
    return { code: h.exec(a) };
  };
  let out = null;
  const ran = [];
  const implement = (o) => o.actions.find((a) => a.kind === 'spawn' && a.batch === 1 && a.spawn.description.startsWith('implement '));
  for (let i = 0; i < 20; i += 1) {
    out = runOut(h);
    ran.push(...out.ran);
    if (implement(out)) break;
    h.run(out.actions); // a judge on the way: the host settles it and runs run again
  }
  assert.ok(ran.length > 5, 'run ran the dispatch point');
  assert.deepEqual(ran.map((x) => x.id), seen, 'in list order, each once');
  const st = h.state();
  for (const x of ran) {
    assert.equal(st.tick.done[x.id].exit, x.exit, `${x.id} recorded with its exit`);
    assert.equal(x.exit, 0);
    assert.equal(dirname(x.log), join(h.W, 'tick', 'run'));
    assert.ok(basename(x.log).endsWith('.log'));
  }
  assert.equal(new Set(ran.map((x) => x.log)).size, ran.length, 'one log per exec');
  const left = new Set(ids(out.actions));
  assert.ok(!out.ran.some((x) => left.has(x.id)), 'no exec it ran is still listed');
  assert.ok(out.actions.filter((a) => a.batch === 1 && a.kind === 'exec').every(leftForHost), 'batch 1 holds no exec but one the guard classifies');
  const spawn = implement(out);
  assert.ok(spawn, 'an implementation spawn');
  assert.equal(spawn.spawn.subagent_type, 'sorry-matt:implementer');
  assert.equal(stage(h, spawn.tickets[0]), 'implementing');
});

test('#129: a spawn at batch 1 stops run after that list; a spawn at batch 2 comes out at batch 1 as a spawn, never a spawn-check', (t) => {
  const h = world(t);
  h.acceptance['#2'] = { items: [], expansions: [] }; // #2's expansion spawn comes up while #1's chain still has execs
  const mixed = []; // batch-1 execs run while a background spawn of the same list was at batch 1, not recorded
  const late = new Set(); // background spawns listed behind an exec run
  h.execute = (a) => {
    const st = h.state().tick;
    for (const [id, x] of Object.entries(st.issued)) {
      if (x.kind !== 'spawn' || x.step !== 'spawn' || st.done[id]) continue;
      if (x.batch === 1) mixed.push({ exec: a.id, spawn: id });
      else late.add(id);
    }
    return { code: h.exec(a) };
  };
  const outs = [];
  for (let i = 0; i < 6 && h.wakes.at(-1)?.at(-1)?.then !== 'done'; i += 1) outs.push(...h.runWake());
  assert.equal(outs.at(-1).then, 'done');
  assert.deepEqual(Object.values(h.state().tickets).map((x) => x.stage), ['delivered', 'delivered']);
  assert.ok(!outs.some((o) => o.actions.some((a) => a.step === 'spawn-check')), 'no output carries a spawn-check');
  assert.ok(mixed.length, 'a list held a spawn and an exec at batch 1');
  for (const m of mixed) {
    const out = outs.find((o) => o.ran.some((x) => x.id === m.exec));
    const spawn = out.actions.find((a) => a.id === m.spawn);
    assert.equal(spawn?.kind, 'spawn', `${m.spawn} is listed as a spawn after ${m.exec} ran`);
    assert.equal(spawn.batch, 1);
    assert.ok(!out.actions.some((x) => x.id === m.exec), `${m.exec}, which run ran, is not listed beside it`);
  }
  assert.ok(late.size, 'a spawn was listed behind an exec');
  for (const id of late) {
    const out = outs.find((o) => o.actions.some((a) => a.id === id && a.batch === 1));
    assert.ok(out, `${id} came out at batch 1`);
    assert.equal(out.actions.find((a) => a.id === id).kind, 'spawn');
  }
  const spawned = h.log.filter((a) => a.kind === 'spawn' && a.step === 'spawn').map((a) => a.spawn.description).sort();
  assert.deepEqual(spawned, ['expand #2', 'implement #1', 'implement #2'], 'each spawn once');
});

test('#129: an exit not in okExit is recorded once and run stops at its failed judge; an okExit exit other than 0 goes on', (t) => {
  const h = world(t);
  const exec = h.exec;
  let failed = 0;
  h.exec = (a) => {
    if (a.step !== 'frontier') return exec(a);
    failed += 1;
    return 1;
  };
  let out = null;
  for (let i = 0; i < 10 && !out?.actions.some((a) => a.step === 'failed'); i += 1) {
    out = runOut(h);
    if (!out.actions.some((a) => a.step === 'failed')) h.run(out.actions);
  }
  const judged = out.actions.find((a) => a.id === 'failed:frontier:r1');
  assert.ok(judged && judged.kind === 'judge' && judged.batch === 1, 'the failed judge is listed');
  const ran = out.ran.filter((x) => x.id === 'frontier:r1');
  assert.equal(ran.length, 1, 'run did not retry it');
  assert.equal(ran[0].exit, 1);
  assert.equal(failed, 1);
  assert.equal(h.state().tick.done['frontier:r1'].exit, 1, 'recorded as it exited');
  assert.ok(judged.do.includes(ran[0].log), 'the judge names the log file');

  // exit 4 of a conflicting merge is in okExit: recorded, and run goes on to the merge agent
  const c = world(t);
  c.work = (agent, tid) => {
    const wt = c.state().tickets[tid].assignment?.worktree;
    write(join(wt, 'same.txt'), `${tid}\n`);
    git(wt, 'add', '-A');
    git(wt, 'commit', '-q', '-m', `work on ${tid}`);
    c.reportsNext.push(agent);
  };
  c.runWake();
  c.policy['merge-agent'] = () => ({ outcome: 'spawned', agent: `a${++c.agents}` });
  const outs = c.runWake();
  const conflict = outs.flatMap((o) => o.ran).find((x) => x.id.startsWith('merge:') && x.exit === 4);
  assert.ok(conflict, 'a merge exited 4');
  assert.equal(c.state().tick.done[conflict.id].exit, 4);
  const after = outs.find((o) => o.ran.includes(conflict));
  assert.ok(after.actions.some((a) => a.step === 'merge-agent' && a.batch === 1), 'run went on to the list after it: the merge agent');
  assert.ok(!after.actions.some((a) => a.step === 'failed'));
});

test('#129: run stops at then end without recording wakeup-end, and at then done', (t) => {
  const h = world(t);
  let out = null;
  for (let i = 0; i < 20 && out?.then !== 'end'; i += 1) {
    out = runOut(h);
    if (out.then !== 'end') h.run(out.actions);
  }
  assert.equal(out.then, 'end');
  const end = out.actions.at(-1);
  assert.equal(end.step, 'wakeup-end');
  const st = h.state().tick;
  assert.equal(st.done[end.id], undefined, 'wakeup-end is left to the host');
  assert.equal(st.wakeup, 1);
  assert.equal(runOut(h).then, 'end', 'run again: the same end');
  assert.equal(h.state().tick.wakeup, 1);
  h.run(out.actions);
  assert.equal(h.untilDone(h.runWake).then, 'done');
  const done = runOut(h);
  assert.equal(done.then, 'done');
  assert.deepEqual(done.ran, []);
});

test('#129: run leaves a push to the host: integrate: direct lists push:main as an exec, and origin main is not pushed', (t) => {
  const h = world(t, { profile: { integrate: 'direct' } });
  let out = null;
  const hasPush = (o) => o?.actions.some((a) => a.step === 'push');
  for (let i = 0; i < 6 && !hasPush(out); i += 1) {
    const outs = [];
    h.now += 5 * 60_000;
    const reports = h.reportsNext.splice(0);
    for (let k = 0; k < 400; k += 1) {
      out = runOut(h, ...(k === 0 ? reports.flatMap((x) => ['--reported', x]) : []));
      outs.push(out);
      if (hasPush(out)) break;
      h.run(out.actions);
      if (out.then !== 'tick') break;
    }
  }
  assert.ok(hasPush(out), 'a list with a push');
  const push = out.actions.find((a) => a.step === 'push');
  const main = git(h.repo, 'rev-parse', 'main');
  assert.equal(push.id, `push:main:@${main}`);
  assert.equal(push.batch, 1);
  assert.equal(push.kind, 'exec');
  assert.ok(push.command.includes('push') && push.record.includes('--exit'));
  assert.ok(!out.ran.some((x) => x.id === push.id), 'run did not run it');
  assert.notEqual(git(h.repo, 'rev-parse', 'origin/main'), main, 'origin main is not pushed');
  assert.equal(h.state().tick.done[push.id], undefined);
});

test('#129: run executes through bash, writing each redirect and each log', { skip: NO_BASH ?? false }, (t) => {
  const h = world(t);
  // The programs are stubbed as shell functions; the command line itself, its cd and its redirect, run as written.
  const STUBS = `node() { echo stub; echo stub-err >&2; }; gh() { echo stub; }; `;
  const bash = bashExecutor();
  const ranActions = [];
  h.execute = (a, log) => {
    ranActions.push(a);
    return bash({ ...a, command: `${STUBS}${a.command}` }, log);
  };
  const out = runOut(h);
  assert.ok(out.ran.length, 'something ran');
  const done = h.state().tick.done;
  const withStdout = ranActions.filter((a) => a.stdout && a.argv[0] === 'node');
  const without = ranActions.filter((a) => !a.stdout && a.argv[0] === 'node');
  assert.ok(withStdout.length && without.length, 'execs with and without a stdout file ran');
  for (const a of ranActions) {
    assert.equal(done[a.id].exit, 0, `${a.id} ran in bash`);
    assert.ok(existsSync(done[a.id].log), `${a.id}: ${done[a.id].log} written`);
  }
  for (const a of withStdout) {
    assert.equal(readFileSync(a.stdout, 'utf8'), 'stub\n', `${a.id}: the redirect wrote ${a.stdout}`);
    assert.equal(readFileSync(done[a.id].log, 'utf8'), 'stub-err\n', `${a.id}: its stderr is in the log`);
  }
  for (const a of without) assert.equal(readFileSync(done[a.id].log, 'utf8'), 'stub\nstub-err\n', `${a.id}: stdout and stderr in the log`);
});

test('#130: bashUsable is the one judgement of a usable bash; its why names what uname -s said', () => {
  const wsl = bashUsable({ spawn: () => ({ status: 0, stdout: 'Linux\n' }), platform: 'win32' });
  assert.deepEqual([wsl.ok, wsl.uname], [false, 'Linux']);
  assert.match(wsl.why, /uname -s: Linux/);
  assert.deepEqual(bashUsable({ spawn: () => ({ status: 0, stdout: 'MINGW64_NT-10.0-26300\n' }), platform: 'win32' }), { ok: true, uname: 'MINGW64_NT-10.0-26300', why: null });
  assert.equal(bashUsable({ spawn: () => ({ status: 0, stdout: 'Linux\n' }), platform: 'linux' }).ok, true);
  const missing = bashUsable({ spawn: () => ({ error: new Error('spawnSync bash ENOENT'), status: null }) });
  assert.equal(missing.ok, false);
  assert.match(missing.why, /bash could not be started \(spawnSync bash ENOENT\)/);
  // the test file's own BASH is this judgement of the bash on PATH
  assert.equal(BASH, bashUsable().ok);
});

test('#129: a bash that is missing or is not Git Bash / MSYS / Cygwin on win32 ends run with exit 1; what was recorded stays, and stdout says so (#147)', (t) => {
  const h = world(t);
  const log = join(h.dir, 'x.log');
  const wsl = bashExecutor({ spawn: () => ({ status: 0, stdout: 'Linux\n' }), platform: 'win32' });
  assert.throws(() => wsl({ id: 'x', command: 'true' }, log), /not Git Bash, MSYS or Cygwin/);
  const missing = bashExecutor({ spawn: () => ({ error: new Error('spawnSync bash ENOENT'), status: null }) });
  assert.throws(() => missing({ id: 'x', command: 'true' }, log), /bash could not be started/);
  const calls = [];
  const posix = bashExecutor({ spawn: (cmd, args) => (calls.push(args[1]), { status: args[1] === 'true' ? 3 : 0, stdout: 'Linux\n' }), platform: 'linux' });
  assert.deepEqual(posix({ id: 'x', command: 'true' }, log), { code: 3 });
  assert.deepEqual(calls, ['uname -s', 'true'], 'bash -c <command>, after one check');
  h.execute = wsl;
  const r = h.runTick();
  assert.equal(r.code, 1);
  assert.match(r.err, /WSL/);
  // #147: stdout says what ran (nothing) and the exec run stopped at, before it ran
  const o = JSON.parse(r.out);
  assert.deepEqual([o.command, o.exit, o.ran], ['run', 1, []]);
  assert.match(o.error, /WSL/);
  assert.equal(o.blocked.at, 'execute');
  assert.equal(o.blocked.exit, null);
  assert.equal(h.state().tick.done[o.blocked.id], undefined, 'nothing recorded for it');
  assert.equal(o.do, undefined, 'the exit-3 handling is for exit 3 only');
  // the first exec runs and is recorded, then bash goes missing
  let first = null;
  h.execute = (a, file) => {
    if (first) return missing(a, file);
    first = a.id;
    return { code: h.exec(a) };
  };
  const r2 = h.runTick();
  assert.equal(r2.code, 1);
  assert.equal(h.state().tick.done[first].exit, 0, `${first} stays recorded`);
  const o2 = JSON.parse(r2.out);
  assert.deepEqual(o2.ran.map((x) => [x.id, x.exit]), [[first, 0]]);
  assert.equal(o2.blocked.at, 'execute');
  assert.notEqual(o2.blocked.id, first);
  assert.equal(h.state().tick.done[o2.blocked.id], undefined);
});

test('#129: without --now, run reads the clock again for each list and each record', (t) => {
  const h = world(t);
  h.now += 5 * 60_000;
  const start = h.iso();
  // each exec takes a minute: the clock moves while run runs
  const deps = {
    ...defaultDeps(),
    clock: () => h.now,
    execute: (a) => {
      h.now += 60_000;
      return { code: h.exec(a) };
    },
  };
  const r = tick(['run', h.path], deps);
  assert.equal(r.code, 0, r.err);
  const out = JSON.parse(r.out);
  assert.ok(out.ran.length > 2, 'execs over more than one list');
  const minute = (k) => new Date(Date.parse(start) + k * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const done = h.state().tick.done;
  out.ran.forEach((x, k) => assert.equal(done[x.id].at, minute(k + 1), `${x.id} recorded at the time it ended`));
  assert.equal(out.now, minute(out.ran.length), 'the last list is made at the time after the last exec');
  assert.notEqual(out.now, start);
});

test('#129: --reported goes to the first next of run only', (t) => {
  const h = world(t);
  h.wake(); // a1 and a2 implement
  h.reportsNext = [];
  // a1's report comes: the host runs next, one list at a time, until a1's collect is recorded
  h.now += 5 * 60_000;
  const collected = () => h.log.some((a) => a.step === 'collect' && a.tickets.includes('#1'));
  for (let i = 0; i < 40 && !collected(); i += 1) {
    const r = h.tick('next', h.path, ...(i === 0 ? ['--reported', 'a1'] : []));
    assert.equal(r.code, 0, r.err);
    const out = JSON.parse(r.out);
    if (i === 0) assert.deepEqual(out.reports.map((x) => [x.agent, x.why]), [['a1', 'current']]);
    h.run(out.actions);
  }
  assert.ok(collected(), "a1's collect is recorded");
  // the same report again: the first next of run takes it as a duplicate, the later lists never see it
  const out = runOut(h, '--reported', 'a1');
  // three lists: the acceptance check, the review tier (#139) and the ticket face ran in the first, the review's spawn
  // file (#138) in the second; the review spawn they lead to is listed by the next after them
  assert.deepEqual(out.ran.map((x) => x.id), ['against:#1:1', 'tier:#1:1', 'body:#1:review:1', 'brief:#1:review-1']);
  assert.ok(out.actions.some((a) => a.step === 'review' && a.tickets[0] === '#1' && a.batch === 1), 'the list after the exec');
  assert.deepEqual(out.reports, [], 'the last list was not handed the report');
  // #147: the first list's take of it is still in the output, beside what that list ran
  assert.deepEqual(out.lists.map((l) => l.reports.map((x) => [x.agent, x.why])), [[['a1', 'duplicate']], [], []]);
  assert.deepEqual(out.lists.map((l) => l.ran), [['against:#1:1', 'tier:#1:1', 'body:#1:review:1'], ['brief:#1:review-1'], []]);
});

// ---- #147: run's output and use -----------------------------------------------------------------------------------------

test('#147: a flag is never taken as the value of the flag before it; --reported with no value is a usage error', (t) => {
  const h = world(t);
  const before = readFileSync(h.path, 'utf8');
  for (const command of ['run', 'next']) {
    for (const args of [['--reported', '--now', h.iso()], ['--reported'], ['--now', '--reported', 'a1']]) {
      const r = tick([command, h.path, ...args], { ...defaultDeps(), execute: () => assert.fail('nothing runs') });
      assert.equal(r.code, 2, `${command} ${args.join(' ')}: ${r.err}`);
      assert.equal(r.out, '');
      assert.match(r.err, new RegExp(`^tick: ${args[0]} needs a value\n`), `${command} ${args.join(' ')}: the missing value is named`);
    }
  }
  const rec = tick(['record', h.path, 'x', '--exit', '--now', h.iso()], defaultDeps());
  assert.equal(rec.code, 2);
  assert.match(rec.err, /^tick: --exit needs a value\n/);
  // a value that only starts with one dash is a value
  const neg = tick(['record', h.path, 'x', '--exit', '-1'], defaultDeps());
  assert.doesNotMatch(neg.err, /needs a value/);
  assert.equal(readFileSync(h.path, 'utf8'), before, 'nothing was written');
});

test('#147: run lists the reports, reconcile, dispatch and wrote of every list it made, not only the last', (t) => {
  const h = world(t);
  // the first run of the run: the dispatch point's list comes before the lists of its execs' results
  const first = runOut(h);
  assert.ok(Array.isArray(first.lists) && first.lists.length > 1, 'more than one list');
  for (const l of first.lists) for (const k of ['now', 'reports', 'reconcile', 'dispatch', 'wrote', 'ran']) assert.ok(k in l, `${k} is in each list`);
  const last = first.lists.at(-1);
  for (const k of ['now', 'reports', 'reconcile', 'dispatch', 'wrote']) assert.deepEqual(last[k], first[k], `the last list's ${k} is the output's`);
  assert.deepEqual(first.lists.flatMap((l) => l.ran), first.ran.map((x) => x.id), 'each exec run under the list that listed it, in order');
  assert.deepEqual(last.ran, [], 'the last list ran nothing: run stopped at it');
  const opened = first.lists.findIndex((l) => l.dispatch?.round === 1);
  assert.ok(opened >= 0 && opened < first.lists.length - 1, 'the dispatch point opened in a list before the last');
  const wrote = first.lists.slice(0, -1).flatMap((l) => l.wrote);
  assert.ok(wrote.length, 'an earlier list wrote files');
  assert.ok(wrote.some((f) => !first.wrote.includes(f)), 'a file only an earlier list wrote is still in the output');

});

test('#147: a refused record ends run with exit 3; stdout lists what ran and the exec it was blocked at, with what to do', (t) => {
  const h = world(t);
  // the host's own record of the second exec lands while run runs it: run's record of it is refused
  let n = 0;
  let second = null;
  h.execute = (a) => {
    const code = h.exec(a);
    if ((n += 1) === 2) {
      second = a;
      h.record(a.id, '--exit', '7');
    }
    return { code };
  };
  const r = h.runTick();
  assert.equal(r.code, 3, r.err);
  assert.match(r.err, /^tick: refused: .*already recorded/);
  const out = JSON.parse(r.out);
  assert.equal(out.format, 'sorry-matt/tick@1');
  assert.equal(out.command, 'run');
  assert.equal(out.exit, 3);
  assert.match(out.error, /already recorded/);
  assert.equal(out.ran.length, 1, 'the exec before it ran and was recorded');
  assert.equal(h.state().tick.done[out.ran[0].id].exit, 0);
  const { log, ...blocked } = out.blocked;
  assert.deepEqual(blocked, { id: second.id, step: second.step, at: 'record', exit: 0, record: second.record }, 'it ran, exit 0; its record was refused');
  assert.equal(dirname(log), join(h.W, 'tick', 'run'));
  assert.notEqual(log, out.ran[0].log);
  assert.match(out.do, /ran/);
  assert.match(out.do, /run `run` again/); // #146: the next run records blocked, it does not run it again
  assert.match(out.do, /not run again/);
  assert.match(out.do, /blocked\.exit/);
  assert.deepEqual(out.lists.flatMap((l) => l.ran), [out.ran[0].id]);
});

// ---- #146: what run's execs leave behind when it fails, and which execs it leaves to the host -------------------------

test('#146: a run that throws does not count the batch-1 spawns of its list as handed out; a run that returns does', (t) => {
  const h = world(t);
  h.acceptance['#2'] = { items: [], expansions: [] }; // #2's expansion spawn comes up while #1's chain still has execs
  let thrown = null;
  h.execute = (a) => {
    const st = h.state().tick;
    const spawn = Object.keys(st.issued).find((id) => st.issued[id].kind === 'spawn' && st.issued[id].batch === 1 && !st.done[id]);
    if (spawn && !thrown) {
      thrown = { exec: a.id, spawn };
      throw new Error('execute broke');
    }
    return { code: h.exec(a) };
  };
  assert.throws(() => h.runWake(), /execute broke/);
  assert.ok(thrown, 'an exec ran beside a batch-1 spawn and threw');
  // the host never saw that list: the next one hands the spawn out again, as a spawn
  const again = JSON.parse(h.tick('next', h.path).out);
  assert.ok(!again.actions.some((a) => a.step === 'spawn-check'), 'no spawn-check for a spawn the host never saw');
  const spawn = again.actions.find((a) => a.id === thrown.spawn);
  assert.equal(spawn?.kind, 'spawn');
  assert.equal(spawn.batch, 1);
  h.run(again.actions); // the host takes that list
  // a run that returns its list hands its batch-1 spawns out: interrupted before their record, they come back as checks
  h.execute = null;
  let out = null;
  for (let i = 0; i < 10 && !out?.actions.some((a) => a.kind === 'spawn' && a.batch === 1); i += 1) {
    out = runOut(h);
    if (!out.actions.some((a) => a.kind === 'spawn' && a.batch === 1)) h.run(out.actions);
  }
  const handed = out.actions.filter((a) => a.kind === 'spawn' && a.batch === 1 && a.spawn.background);
  assert.ok(handed.length, 'run returned a background spawn at batch 1');
  const checks = JSON.parse(h.tick('next', h.path).out).actions.filter((a) => a.step === 'spawn-check');
  assert.deepEqual(checks.map((a) => a.meta.of).sort(), ids(handed).sort());
});

test('#146: an exec killed by a signal is no normal end: exit 128 + the signal number, said in its log, and its failed judge', (t) => {
  const h = world(t);
  const log = join(h.dir, 'killed.log');
  const killedBy = (signal) => bashExecutor({ spawn: (cmd, args) => (args[1] === 'uname -s' ? { status: 0, stdout: 'Linux\n' } : { status: null, signal }), platform: 'linux' });
  assert.deepEqual(killedBy('SIGKILL')({ id: 'x', command: 'true' }, log), { code: 137, signal: 'SIGKILL' });
  assert.match(readFileSync(log, 'utf8'), /killed by SIGKILL/);
  assert.deepEqual(killedBy('SIGTERM')({ id: 'x', command: 'true' }, log), { code: 143, signal: 'SIGTERM' });
  // in run: the first exec is killed; it is recorded as killed, not as exit 1 (which some execs take as a normal end)
  const kill = killedBy('SIGKILL');
  let first = null;
  h.execute = (a, file) => {
    if (first) return { code: h.exec(a) };
    first = a.id;
    return kill(a, file);
  };
  const out = runOut(h);
  assert.deepEqual(out.ran[0], { id: first, exit: 137, signal: 'SIGKILL', log: out.ran[0].log });
  assert.equal(h.state().tick.done[first].exit, 137);
  const judged = out.actions.find((a) => a.id === `failed:${first}`);
  assert.ok(judged && judged.batch === 1, 'its failed judge is listed');
  assert.match(readFileSync(out.ran[0].log, 'utf8'), /killed by SIGKILL/);
});

test('#146: an exec whose record failed is not run again: the next run records it with the exit it had', (t) => {
  const h = world(t);
  const seen = new Set(); // CI runs at each SHA's first read: the finish reads it again, and its record counts a full verification
  h.ci = (branch, sha) => (seen.has(sha) ? 'green' : (seen.add(sha), 'running'));
  // state.mjs refuses the usage write of the finish's CI record once: the exec ran, its record is refused
  const plain = defaultDeps().stateMain;
  let refuse = true;
  const stateMain = (argv) => {
    if (refuse && argv[0] === 'usage' && argv.includes('fullVerifications=1')) {
      refuse = false;
      return { code: 3, out: '', err: 'state: refused: usage is held (test)\n' };
    }
    return plain(argv);
  };
  const counts = {};
  const deps = {
    ...defaultDeps(),
    stateMain,
    execute: (a) => {
      counts[a.id] = (counts[a.id] ?? 0) + 1;
      return { code: h.exec(a) };
    },
  };
  let refused = null;
  let listed = null;
  let after = null;
  const via = (...args) => {
    const r = tick(['run', h.path, ...args, '--now', h.iso()], deps);
    if (r.code !== 3 || refused) return r;
    refused = JSON.parse(r.out);
    // a host on next sees it ran and is pointed at its record, not at its command
    listed = JSON.parse(h.tick('next', h.path).out).actions.find((a) => a.id === refused.blocked.id);
    // the refusal settled (state.mjs no longer says no): run again, as its `do` says
    const again = tick(['run', h.path, '--now', h.iso()], deps);
    after = JSON.parse(again.out);
    return again;
  };
  assert.equal(h.untilDone(() => h.wake({ via })).then, 'done');
  assert.ok(refused, 'a record was refused');
  assert.equal(refused.exit, 3);
  const { blocked } = refused;
  assert.equal(blocked.at, 'record');
  assert.equal(blocked.exit, 0);
  assert.match(refused.do, /run `run` again/);
  assert.doesNotMatch(refused.do, /do not run `run` again/i);
  assert.deepEqual([listed.kind, listed.ran.exit], ['exec', 0], 'next lists it with what it ran');
  assert.match(listed.note, /do not run it again/i);
  assert.equal(counts[blocked.id], 1, `${blocked.id} ran once`);
  assert.deepEqual(after.ran.find((x) => x.id === blocked.id), { id: blocked.id, exit: 0, log: blocked.log }, 'the run after records it with its exit');
  const st = h.state();
  assert.equal(st.tick.done[blocked.id].exit, 0);
  assert.equal(st.tick.ran?.[blocked.id], undefined, 'nothing left to record');
  assert.equal(st.usage.fullVerifications, 1, 'its record applied once');
  assert.ok(Object.values(counts).every((n) => n === 1), 'no exec ran twice');
});

test("#146: which execs run leaves to the host is the guard hook's classification, not the step: a push of a line is run, a flagged exec is left", (t) => {
  // a push of the integration branch: no verdict from the guard, so run runs it (#144's ci-fix commit)
  const h = world(t);
  unmatchedRed(h);
  h.runWake();
  assert.equal(ciFixSpawns(h).length, 1, 'the ci-fix spawn');
  const outs = h.runWake();
  const fixed = git(h.intWt, 'rev-parse', 'HEAD');
  const pushed = outs.flatMap((o) => o.ran).find((x) => x.id === `push:${LINE}:@${fixed}`);
  assert.ok(pushed, 'run pushed the line itself');
  assert.equal(pushed.exit, 0);
  assert.equal(git(h.repo, 'rev-parse', `origin/${LINE}`), fixed);
  assert.ok(!h.log.some((a) => a.step === 'push'), 'the host was not handed the push');

  // an exec the guard gives a verdict, whatever its step: left to the host at batch 1, not run
  const g = world(t);
  const flagged = (event) => (/frontier\.mjs/.test(event.tool_input.command) ? [{ category: 'release-deploy', level: 'ask', detail: 'x' }] : []);
  const r = tick(['run', g.path, '--now', g.iso()], { ...defaultDeps(), classify: flagged, execute: (a) => ({ code: g.exec(a) }) });
  assert.equal(r.code, 0, r.err);
  const out = JSON.parse(r.out);
  const frontier = out.actions.find((a) => a.step === 'frontier');
  assert.ok(frontier && frontier.batch === 1 && frontier.kind === 'exec', 'the flagged exec is listed for the host');
  assert.ok(!out.ran.some((x) => x.id === frontier.id), 'run did not run it');

  // no classification to go by (the plugin's hooks are not beside the skill): run runs nothing, exit 1, as without bash
  const n = world(t);
  const r2 = tick(['run', n.path, '--now', n.iso()], { ...defaultDeps(), classify: null, execute: () => assert.fail('nothing runs') });
  assert.equal(r2.code, 1);
  assert.match(r2.err, /classify\.mjs/);
  const o2 = JSON.parse(r2.out);
  assert.deepEqual(o2.ran, []);
  assert.equal(o2.blocked.at, 'execute');
});

// #153: the finish's simplify pass is a spawn; the simplify agent judges first and reports applied, none or skipped.
test('#153: the finish spawns the simplify agent in the foreground on the line, with the criteria in its brief', (t) => {
  const h = world(t);
  h.wake();
  const w2 = h.wake();
  const spawns = distinct(h.actions(w2)).filter((a) => a.step === 'simplify');
  assert.equal(spawns.length, 1);
  const [a] = spawns;
  assert.equal(a.kind, 'spawn');
  assert.equal(a.id, `simplify:${LINE}`);
  assert.equal(a.line, LINE);
  assert.deepEqual(a.outcomes, ['applied', 'none', 'skipped']);
  assert.deepEqual(a.spawn, { subagent_type: 'general-purpose', description: `simplify ${LINE}`, prompt: a.spawn.prompt, background: false });
  assert.match(a.record, /--agent <agent id> --outcome applied\|none\|skipped --value <one-line reason>/);
  const brief = readFileSync(briefOf(a), 'utf8');
  // the worktree, the diff to judge, the criteria, the Skill tool call, the commit and the reply
  assert.ok(brief.includes(`Worktree: ${git(h.intWt, 'rev-parse', '--show-toplevel')} (branch ${LINE})`), 'the integration worktree, as git names it');
  assert.ok(brief.includes(`git diff origin/main...${LINE}`), 'the whole line against the base');
  for (const rule of [
    'only documentation',
    'only deletions',
    'only configuration or data files',
    'no new logic',
    'duplicate implementation',
    'reusable function',
    'a branch or a layer of indirection',
    'When unsure, simplify',
    'There is no line-count threshold',
    'call the Skill tool with `simplify`',
    `refactor: simplify ${LINE}`,
    'outcome: applied | none | skipped',
  ])
    assert.ok(brief.includes(rule), `the brief says: ${rule}`);
  // the line was verified and delivered after it; the agent is on the books as a simplify agent
  assert.equal(w2.at(-1).then, 'done');
  const st = h.state();
  assert.equal(st.tick.done[a.id].outcome, 'none');
  assert.equal(st.tick.done[a.id].value, 'looked at the line: nothing to reuse or remove');
  const agent = st.tick.done[a.id].agent;
  assert.deepEqual([st.tick.agents[agent].role, st.tick.agents[agent].tickets], ['simplify', []]);
  assert.ok(!git(h.intWt, 'log', '--format=%s', `main..${LINE}`).includes('refactor: simplify'), 'none: no commit');
  const wrap = h.actions(w2).find((x) => x.step === 'wrap-up');
  assert.equal(wrap.meta, undefined, 'no line skipped the simplify pass');
});

test('#153: record simplify takes applied, none or skipped with a one-line reason, nothing else', (t) => {
  const h = world(t);
  h.wake();
  h.policy.simplify = () => {
    throw new Crash('stop at the simplify spawn');
  };
  assert.throws(() => h.wake(), Crash);
  const id = `simplify:${LINE}`;
  assert.ok(h.state().tick.issued[id], 'the simplify spawn was handed out');
  const rec = (...flags) => h.tick('record', h.path, id, ...flags);
  assert.equal(rec('--agent', 'a9', '--outcome', 'done', '--value', 'x').code, 2, 'done is no longer an outcome');
  assert.equal(rec('--agent', 'a9', '--outcome', 'skipped').code, 2, 'a reason is required');
  assert.equal(rec('--agent', 'a9', '--outcome', 'none', '--value', 'two\nlines').code, 2, 'the reason is one line');
  assert.equal(rec('--outcome', 'none', '--value', 'x').code, 2, 'the agent id is required');
  assert.equal(rec('--agent', 'a9', '--outcome', 'none', '--value', 'nothing to reuse').code, 0);
  assert.equal(rec('--agent', 'a9', '--outcome', 'applied', '--value', 'nothing to reuse').code, 3, 'a different result is not taken');
});

test('#153: applied is one commit on the line, verified with the line; skipped is listed at the wrap-up for the self-answer log', (t) => {
  const applied = world(t);
  applied.policy.simplify = () => ({ outcome: 'applied', value: 'folded the two copies of the parser into one' });
  applied.wake();
  const w = applied.wake();
  assert.equal(w.at(-1).then, 'done');
  const subjects = git(applied.intWt, 'log', '--first-parent', '--format=%s', `main..${LINE}`).split('\n');
  assert.ok(subjects.includes(`refactor: simplify ${LINE}`), 'the applied fixes are one commit on the line');
  const tip = git(applied.intWt, 'rev-parse', 'HEAD');
  assert.equal(applied.state().lines[LINE].ci.sha, tip, 'the full verification is of the tip after the simplify commit');
  assert.equal(applied.actions(w).find((x) => x.step === 'wrap-up').meta, undefined);

  const skipped = world(t);
  skipped.policy.simplify = () => ({ outcome: 'skipped', value: 'only documentation changed' });
  skipped.wake();
  const w2 = skipped.wake();
  assert.equal(w2.at(-1).then, 'done');
  assert.ok(!git(skipped.intWt, 'log', '--format=%s', `main..${LINE}`).includes('refactor: simplify'), 'skipped: no commit');
  const wrap = skipped.actions(w2).find((x) => x.step === 'wrap-up');
  assert.deepEqual(wrap.meta, { simplifySkipped: [{ line: LINE, reason: 'only documentation changed' }] });
  assert.ok(wrap.do.includes(`${LINE}: only documentation changed`), 'the wrap-up names the line and its reason');
  assert.match(wrap.do, /self-answer log/);
  assert.match(wrap.do, /closing summary/);
});

test('#153: simplify: false sends no simplify agent and lists no skipped line', (t) => {
  const h = world(t, { profile: { simplify: false } });
  h.policy.simplify = () => {
    throw new Error('no simplify agent under simplify: false');
  };
  h.wake();
  const w2 = h.wake();
  assert.equal(w2.at(-1).then, 'done');
  assert.ok(!h.log.some((a) => a.step === 'simplify'));
  assert.ok(!Object.keys(h.state().tick.issued).some((x) => x.startsWith('simplify:')));
  assert.equal(h.actions(w2).find((x) => x.step === 'wrap-up').meta, undefined);
});

// ---- #139: tick judges the review tier first, then picks the review -------------------------------------------------

/** The tier judgements tick handed out for `id`, each once. */
const tierJudges = (h, id) => distinct(h.log).filter((a) => a.step === 'tier' && a.tickets[0] === id);
const reviewsOf = (h, id) => h.log.filter((a) => a.step === 'review' && a.tickets[0] === id);
const recorded = (h, id) => h.state().tickets[id].reviews.map((r) => [r.kind, r.tier ?? null, r.mode, r.verdict]);

test('#139: on one line a light ticket gets the minimal review, a standard one the prove-it review with its tier in the spawn file', (t) => {
  const h = world(t);
  h.change['#1'] = { lines: 10 }; // a few lines of code: light
  h.policy.review = (a) => (a.tickets[0] === '#2' && a.meta.mode === 'initial' ? { outcome: 'fix', findings: 'F1' } : 'pass');
  assert.equal(h.untilDone().then, 'done');
  const judged = {};
  for (const id of ['#1', '#2']) {
    const all = tierJudges(h, id);
    assert.equal(all.length, 1, `${id}: the tier is judged once; the recheck keeps it`);
    const [j] = all;
    assert.equal(j.kind, 'exec');
    assert.deepEqual(j.argv.slice(1, 6).map((x, i) => (i ? x : basename(x))), ['tier.mjs', 'judge', '--base', LINE, '--head']);
    assert.match(j.argv[6], /^r1\//, 'the head is the ticket branch');
    assert.equal(resolve(j.cwd), resolve(h.repo), 'run in the repo');
    judged[id] = j;
  }
  assert.equal(JSON.parse(readFileSync(judged['#1'].stdout, 'utf8')).tier, 'light');
  assert.equal(JSON.parse(readFileSync(judged['#2'].stdout, 'utf8')).tier, 'standard');

  // light: the minimal review, its report file and its --kind minimal record, no review host
  const light = reviewsOf(h, '#1');
  assert.deepEqual(light.map((a) => [a.meta.kind, a.meta.mode]), [['minimal', 'initial']]);
  assert.ok(readFileSync(briefOf(light[0]), 'utf8').startsWith('# Review #1'), 'the minimal reviewer brief');
  assert.equal(reportOf(light[0]).replace(/\\/g, '/'), `${h.W.replace(/\\/g, '/')}/tick/review/1-1.report.md`);
  assert.ok(!h.log.some((a) => a.step === 'brief' && a.tickets[0] === '#1' && a.argv[2] === 'review'), 'no brief.mjs review for a light ticket');
  assert.deepEqual(recorded(h, '#1'), [['minimal', 'light', 'initial', 'pass']]);

  // standard: the prove-it review, its tier and the judge output in the spawn file, at the initial review and the recheck
  const standard = reviewsOf(h, '#2');
  assert.deepEqual(standard.map((a) => [a.meta.kind, a.meta.mode]), [['full', 'initial'], ['full', 'recheck']]);
  for (const a of standard) {
    const file = readFileSync(briefOf(a), 'utf8');
    assert.ok(file.startsWith('你是審查主持 agent：'), 'the review host spawn file');
    const line = `- review tier: standard (tier.mjs judge output: ${resolve(judged['#2'].stdout)})\n`;
    assert.ok(file.includes(line), `${JSON.stringify(line)} in\n${file.slice(file.lastIndexOf('\n---\n'))}`);
  }
  assert.deepEqual(recorded(h, '#2'), [['full', 'standard', 'initial', 'fix'], ['full', 'standard', 'recheck', 'pass']]);
});

test('#139: a full ticket (a sensitive path) gets the prove-it review with tier full in its spawn file', (t) => {
  const h = world(t);
  h.change['#1'] = { path: '.github/workflows/ci.yml', lines: 2 };
  assert.equal(h.untilDone().then, 'done');
  const [a] = reviewsOf(h, '#1');
  assert.equal(a.meta.kind, 'full');
  assert.match(readFileSync(briefOf(a), 'utf8'), /^- review tier: full \(tier\.mjs judge output: .+\)$/m);
  assert.deepEqual(recorded(h, '#1'), [['full', 'full', 'initial', 'pass']]);
});

test('#139: under review: minimal every ticket gets the minimal review, whatever its tier; no tier is judged', (t) => {
  const h = world(t, { profile: { review: 'minimal' } });
  h.change['#1'] = { lines: 10 };
  assert.equal(h.untilDone().then, 'done');
  assert.deepEqual(h.log.filter((a) => a.step === 'tier'), []);
  for (const id of ['#1', '#2']) {
    assert.deepEqual(reviewsOf(h, id).map((a) => a.meta.kind), ['minimal'], id);
    assert.deepEqual(recorded(h, id), [['minimal', null, 'initial', 'pass']], id);
  }
});
