// The harness of the tick replays, scripts/tick.test.mjs and scripts/tick-*.test.mjs: the world a replay plays in,
// the host's stand-in, and the helpers the replays share. No tests here.
// The replays are of get-to-work's wake-ups through tick.mjs. Each test builds a real git repository with a bare origin and
// an integration worktree, a real state file (state.mjs), and plays the host: it runs every action tick hands out
// and records each result. Scripts run for real (state, deadline, brief, overlap, integrate, verify, git); only the network is canned
// (ci.mjs verdicts, frontier.mjs github, acceptance.mjs github, gh). The expected values are the pipeline's rules
// as SKILL.md states them, written here by hand.
//
// #160: the replays are split over several test files, which node --test runs in parallel. A replay starts a few
// hundred git processes; on Windows each costs over ten times what it does on Linux, and the tests of one file run one
// after another, so in one file they took past 600 s there.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, utimesSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main as tick, defaultDeps, bashUsable } from '../src/skills/get-to-work/scripts/tick.mjs';
import { FINDING_COUNTS, main as stateMain } from '../src/skills/get-to-work/scripts/state.mjs';
import { main as deadlineMain } from '../src/skills/get-to-work/scripts/deadline.mjs';
import { main as briefMain } from '../src/skills/get-to-work/scripts/brief.mjs';
import { main as overlapMain } from '../src/skills/get-to-work/scripts/overlap.mjs';
import { main as integrateMain } from '../src/skills/get-to-work/scripts/integrate.mjs';
import { main as verifyMain } from '../src/skills/get-to-work/scripts/verify.mjs';
import { main as ciMain } from '../src/skills/get-to-work/scripts/ci.mjs';
import { itemsHash } from '../src/skills/get-to-work/scripts/acceptance.mjs';
import { main as tierMain, defaultDeps as tierDeps } from '../src/skills/prove-it/scripts/tier.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const REPO = 'o/r';
export const LINE = 'r1/line-1';
export const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
export const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: ENV }).trim();
export const write = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
export const numOf = (id) => String(id).replace(/^#/, '');

export class Crash extends Error {}

/**
 * A bash that runs tick's commands as the host's does: any on POSIX, Git Bash / MSYS / Cygwin on win32 (not WSL). The
 * judgement is tick.mjs's own, the one bashExecutor makes (#130); when it says no, `NO_BASH` is why, `uname -s` in it.
 */
export const BASH_CHECK = bashUsable();
export const BASH = BASH_CHECK.ok;
export const NO_BASH = BASH ? null : `no bash that runs tick's commands: ${BASH_CHECK.why}`;

/** The ticket files a Local Markdown run's tickets live in (`--tickets-dir`). */
export const TICKETS_DIR = '.scratch/issues';
export const localTicket = (id, title) => `# ${title}\n\nThe ticket text of ${id}.\n\n## Acceptance criteria\n\n- [ ] criterion of ${id}\n`;

/**
 * A run with two tickets on one line, set up as the freeze leaves it: #1 and #2 on GitHub, or (`tracker: 'local'`)
 * two ticket files under TICKETS_DIR. `h.ids` holds the two ids. `check` is the contract's Full checks.
 */
export function world(t, { profile = null, tracker = 'github', check = 'node -e "process.exit(0)"' } = {}) {
  const local = tracker === 'local';
  // #195: under integrate: ticket-pr the line has no integration branch and no worktree (#193): every ticket is its
  // own pull request, cut from origin/<base>. The world then makes neither, records the line with no tip, and seeds
  // the state's tracker (state.mjs refuses the profile without a GitHub run).
  const ticketPr = profile?.integrate === 'ticket-pr';
  const [ID1, ID2] = local ? ['01-first.md', '02-second.md'] : ['#1', '#2'];
  // the long form: on a Windows runner tmpdir() is an 8.3 short path (RUNNER~1), git prints the long one
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'sorry-matt-tick-')));
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
  if (!ticketPr) {
    git(repo, 'worktree', 'add', '-q', '-b', LINE, intWt, 'main');
    git(intWt, 'push', '-q', '-u', 'origin', LINE);
  }
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
    issueState: {}, // #196: ticket id → the issue's state for `gh issue view --json state` (default CLOSED: `Closes` fired)
    blockers: {},
    acceptance: {},
    ci: () => 'green',
    agentOf: {}, // agent id → { tickets, role }
    silent: new Set(), // agents that do no work and never report
    crashAfter: null, // (action) => true to stop right after running it, before recording
    reviewBackground: false, // #143: the prove-it review host's spawn comes back without its report
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

  h.S('init', '--run', 'r1', ...(ticketPr ? ['--tracker', 'github'] : []));
  h.S('add', ID1, ID2, '--line', h.line);
  if (!ticketPr) h.S('line', h.line, '--tip', git(intWt, 'rev-parse', 'HEAD'));
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
    // #197: `failed` holds the red runs' ids, as ci.mjs verdict reports them for `gh run view <id> --log-failed`
    return { format: 'sorry-matt/ci@1', command: 'verdict', branch, sha, verdict, reason: verdict === 'no-run' ? 'empty' : null, error: null, runs, rerun: [], failed: verdict === 'red' ? [7] : [] };
  };
  /** #197: `ci.mjs base <branch>` — origin's tip of the base branch, judged by h.ci as a verdict is. */
  h.base = (args) => {
    const branch = args.filter((x, k, all) => x !== 'base' && x !== '--repo' && all[k - 1] !== '--repo').at(-1);
    const sha = git(h.repo, 'rev-parse', `origin/${branch}`);
    const v = h.verdict(['verdict', branch, sha]);
    return { ...v, command: 'base' };
  };
  /** #197: the run list the real `ci.mjs earliest-red` reads — one row per first-parent SHA of the branch, from h.ci. */
  h.ghRuns = (args) => {
    if (args[0] !== 'run' || args[1] !== 'list') throw new Error(`no gh stub for earliest-red: gh ${args.join(' ')}`);
    const branch = args[args.indexOf('--branch') + 1];
    const commit = args.includes('--commit') ? args[args.indexOf('--commit') + 1] : null;
    const shas = commit ? [commit] : git(h.repo, 'log', '--first-parent', '--format=%H', `origin/${branch}`).split('\n').filter(Boolean);
    const rows = [];
    for (const sha of shas) {
      const v = h.ci(branch, sha);
      if (v === 'no-run') continue;
      rows.push({ headSha: sha, databaseId: 7, workflowName: 'check', event: 'push', status: v === 'running' ? 'in_progress' : 'completed', conclusion: v === 'red' ? 'failure' : v === 'green' ? 'success' : v === 'running' ? null : v });
    }
    return JSON.stringify(rows);
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

  // #195: the `gh` seam of integrate.mjs (pr-open, pr-push, gh stack): the canned pull requests, head branch → PR.
  // Every call is logged in h.ghCalls, so a replay can assert what was sent (`gh pr create --draft …`).
  h.prs = {};
  h.prNext = 11;
  h.ghCalls = [];
  h.gh = (args, cwd) => {
    h.ghCalls.push(args);
    // #198: `gh stack`, run by integrate.mjs in the ticket worktree (cwd): init and add record the stack; submit --auto
    // pushes and opens the stacked draft PR on the parent ticket's branch (idempotent); push pushes; sync is h.stackSync
    if (args[0] === 'stack') {
      const branch = cwd ? git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD') : null;
      // #199 live run: as gh stack does — view fails off a stack, init adopts, add creates the branch and checks it out
      h.stacked ??= new Set();
      if (args[1] === 'view') {
        if (!h.stacked.has(branch)) throw new Error(`current branch "${branch}" is not part of a stack`);
        return '';
      }
      if (args[1] === 'init') {
        for (const b of args.slice(2)) h.stacked.add(b);
        return '';
      }
      if (args[1] === 'add') {
        git(cwd, 'checkout', '-q', '-b', args[2]);
        h.stacked.add(args[2]);
        return '';
      }
      if (args[1] === 'push' || args[1] === 'submit') git(cwd, 'push', '-q', '-f', '-u', 'origin', branch); // gh stack pushes with --force-with-lease
      if (args[1] === 'submit' && !h.prs[branch]) {
        const st = h.state();
        const t = Object.values(st.tickets).find((x) => x.branch === branch);
        const base = t?.stackParent ? st.tickets[t.stackParent].branch : 'main';
        h.prs[branch] = { number: h.prNext++, base, title: null, body: null, draft: true, stacked: true };
      }
      if (args[1] === 'sync') {
        // #199: the merged layers below are dropped and the branch rebased onto origin's main (h.stackSync to change it)
        if (h.stackSync) return h.stackSync(cwd, branch);
        git(cwd, 'fetch', '-q', 'origin');
        git(cwd, 'rebase', '-q', 'origin/main');
        h.syncs = (h.syncs ?? 0) + 1;
        return '';
      }
      return '';
    }
    if (args[0] === 'pr' && args[1] === 'list') {
      const pr = h.prs[args[args.indexOf('--head') + 1]];
      return JSON.stringify(pr ? [{ number: pr.number }] : []);
    }
    if (args[0] === 'pr' && args[1] === 'create') {
      const head = args[args.indexOf('--head') + 1];
      const number = h.prNext++;
      h.prs[head] = { number, base: args[args.indexOf('--base') + 1], title: args[args.indexOf('--title') + 1], body: args[args.indexOf('--body') + 1], draft: args.includes('--draft') };
      return `https://github.com/${REPO}/pull/${number}\n`;
    }
    if (args[0] === 'pr' && args[1] === 'edit') return '';
    // #196: the pr-merge seam — ready, the merge-gate queries, and the merged PR's view
    if (args[0] === 'pr' && args[1] === 'ready') {
      const pr = Object.values(h.prs).find((x) => x.number === Number(args[2]));
      if (pr) pr.draft = false;
      return '';
    }
    if (args[0] === 'pr' && args[1] === 'view') {
      const pr = Object.values(h.prs).find((x) => x.number === Number(args[2]));
      return JSON.stringify({ mergeCommit: pr?.merged ? { oid: pr.mergeOid } : null, state: pr?.merged ? 'MERGED' : 'OPEN' });
    }
    if (args[0] === 'repo' && args[1] === 'view') return JSON.stringify({ nameWithOwner: REPO });
    if (args[0] === 'api' && args[1] === 'graphql') return JSON.stringify(h.mergeQueue ?? { data: { repository: { mergeQueue: null } } });
    throw new Error(`no gh stub for: gh ${args.join(' ')}`);
  };
  /**
   * #196: GitHub merges a ticket's PR — origin's main takes the branch, and `gh pr view` reports MERGED. #197: as
   * GitHub's "Create a merge commit" does, always a merge commit whose first parent is main, never a fast-forward:
   * the base's first-parent history is then the merges, which the base-red attribution walks.
   */
  h.mergeBranch = (branch) => {
    const wt = join(h.dir, `merge-${(h.mergeN = (h.mergeN ?? 0) + 1)}`);
    git(h.repo, 'fetch', '-q', 'origin');
    git(h.repo, 'worktree', 'add', '-q', '--detach', wt, 'origin/main');
    git(wt, 'merge', '-q', '--no-ff', '-m', `Merge pull request #${h.prs[branch]?.number ?? 0} from ${branch}`, branch);
    git(wt, 'push', '-q', 'origin', 'HEAD:main');
    git(h.repo, 'worktree', 'remove', '--force', wt);
    git(h.repo, 'fetch', '-q', 'origin');
  };
  h.mergePr = (tid) => {
    const branch = h.state().tickets[tid].branch;
    h.mergeBranch(branch);
    const pr = h.prs[branch];
    pr.merged = true;
    pr.mergeOid = git(h.repo, 'rev-parse', 'origin/main');
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
      else if (script === 'integrate.mjs') r = integrateMain([...rest, '--now', h.iso()], { gh: h.gh });
      else if (script === 'verify.mjs') r = verifyMain([...rest, '--now', h.iso()]);
      else if (script === 'deadline.mjs') r = deadlineMain(rest[0] === 'record' ? [...rest, '--now', h.iso()] : rest);
      else if (script === 'brief.mjs') r = briefMain(rest);
      else if (script === 'overlap.mjs') r = overlapMain(rest);
      else if (script === 'tier.mjs') r = tierMain(rest, tierDeps(a.cwd ?? process.cwd())); // #139: run for real, on the repo
      else if (script === 'ci.mjs' && rest[0] === 'base') r = { code: 0, out: JSON.stringify(h.base(rest)) };
      else if (script === 'ci.mjs' && rest[0] === 'earliest-red') {
        // #197: run for real on the repo, the network canned (gh run list rows built from h.ci per SHA)
        r = ciMain(rest, {
          read: (p) => readFileSync(p, 'utf8'),
          git: (cwd, args2) => execFileSync('git', ['-C', cwd, ...args2], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: ENV }),
          gh: h.ghRuns,
          cwd: process.cwd(),
        });
      } else if (script === 'ci.mjs') r = { code: 0, out: JSON.stringify(h.verdict(rest)) };
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
        if (args[1] === 'close') h.issueState[id] = 'CLOSED'; // #196: the idempotent close after the merge
        if (args.includes('--json')) {
          const fields = args[args.indexOf('--json') + 1].split(',');
          const all = { title: h.titles[id], body: `The ticket text of ${id}.`, comments, state: h.issueState[id] ?? 'CLOSED' };
          out = `${JSON.stringify(Object.fromEntries(fields.map((f) => [f, all[f]])))}\n`;
        } else if (args.includes('--comments')) out = comments.map((x) => `author:\t${x.author.login}\n--\n${x.body}\n--\n`).join('');
        else out = `title:\t${h.titles[id]}\n--\nThe ticket text of ${id}.\n`;
      }
      else if (args[0] === 'run' && args[1] === 'list') out = '[]';
      else if (args[0] === 'run' && args[1] === 'view') out = `log of run ${args[2]}\n`; // #197: gh run view <id> --log-failed
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
    collect: (a) =>
      a.meta.stage === 'in-review'
        ? (h.policy.review ?? DEFAULTS.review)(a) // #143: the report of a review host that went to the background
        : ({ implementing: 'green', expanding: 'reported', fixing: 'fixed', integrating: 'resolved', 'ci-fix': 'fixed' })[a.meta.stage] ?? 'logged',
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
    observations: () => ({ outcome: 'filed', value: '#90' }),
    'observations-final': () => 'checked',
    'verify-local': () => 'green',
    'deliver-ticket': () => 'done',
    'deliver-line': () => 'done',
    simplify: () => ({ outcome: 'none', value: 'looked at the line: nothing to reuse or remove' }),
    // #196: the host holds merge authorization by default: it sends the merge and GitHub merges at once
    'pr-send': (a) => {
      h.mergePr(a.tickets[0]);
      return 'sent';
    },
    'gh-stack-missing': () => 'listed', // #198
    'pr-polish': () => 'polished', // #200
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
    // #142 × #143: the report of a review host that went to the background carries its `counts:` line, as at the spawn
    if (a.step === 'collect' && a.meta.stage === 'in-review' && r.outcome !== 'incomplete') flags.push('--observations', String(r.observations ?? 0), '--pre-existing', String(r.preExisting ?? 0), ...findingCountFlags(r));
    return flags;
  };
  /** The implementation (or fix) agent's report as agents/implementer.md section 5 has it. */
  h.agentReport = (a) =>
    `ticket: ${a.tickets[0]}\ncommit: c-${a.meta.agent} (branch ${h.state().tickets[a.tickets[0]].branch})\ntargeted checks: source=commands.md; node --test by ${a.meta.agent} → green\nstatus record: none\n`;

  h.spawn = (a) => {
    const agent = `a${++h.agents}`;
    const role = a.spawn.description.split(' ')[0];
    h.agentOf[agent] = { tickets: a.tickets, role };
    // #143: the Agent tool put the review host in the background: the host records the agent alone, its report comes later
    if (a.step === 'review' && a.meta.kind === 'full' && h.reviewBackground) return { agent, flags: ['--agent', agent] };
    if (a.step === 'review') {
      const r = (h.policy.review ?? DEFAULTS.review)(a);
      const v = typeof r === 'string' ? { outcome: r } : r;
      // the minimal reviewer writes its report to the file its brief names (#128); the review host writes a block
      if (a.meta.kind === 'minimal') h.writeReport(reportOf(a), `verdict: ${v.outcome}\n${(v.findings ?? '').split(',').filter(Boolean).map((f) => `${f}: a.txt:1 wrong (evidence)\n`).join('')}`);
      // #142: a prove-it review's report line `counts:` gives the observations and pre-existing counts
      const counts = a.meta.kind === 'minimal' ? [] : ['--observations', String(v.observations ?? 0), '--pre-existing', String(v.preExisting ?? 0), ...findingCountFlags(v), ...(v.covered !== undefined ? ['--covered', String(v.covered)] : [])];
      return ['--agent', agent, '--outcome', v.outcome, ...(v.findings ? ['--findings', v.findings] : []), ...counts];
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
    // h.batchRecords: the batch's results recorded with one `record … + …` call at the end, as SKILL.md step 3 has it
    const held = [];
    const record = h.batchRecords ? (...args) => held.push(args) : h.record;
    h.runBatch(actions, record);
    if (held.length) {
      const r = h.tick('record', path, ...held.flatMap((g, i) => (i ? ['+', ...g] : g)));
      assert.equal(r.code, 0, r.err);
      (h.batchedRecords ??= []).push(held.length);
    }
  };
  h.runBatch = (actions, record) => {
    for (const a of actions.filter((x) => x.batch === 1)) {
      h.log.push({ ...a, wakeup: h.wakes.length });
      if (a.kind === 'exec') {
        const code = h.exec(a);
        if (h.crashAfter?.(a)) throw new Crash(a.id);
        record(a.id, '--exit', String(code));
      } else if (a.kind === 'spawn') {
        const r = h.spawn(a);
        if (h.crashAfter?.(a)) throw new Crash(a.id);
        if (Array.isArray(r)) record(a.id, ...r);
        else {
          record(a.id, ...r.flags);
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
          else if (r.agent && h.agentOf[r.agent].role === 'review') {
            if (!h.silent.has(r.agent)) h.reportsNext.push(r.agent); // a review host commits nothing (#143)
          }
          else if (r.agent) h.work(r.agent, a.tickets[0]);
        }
      } else {
        record(a.id, ...h.judge(a));
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

export const ids = (actions) => actions.map((a) => a.id);
/** Each action once: a later batch is listed again by the lists after it until it is run (#128). */
export const distinct = (actions) => [...new Map(actions.map((a) => [a.id, a])).values()];
/** #156: the four finding counts of a review report's `counts:` line, as the host records them. */
export function findingCountFlags(v) {
  return v.findingCounts ? FINDING_COUNTS.flatMap((k) => [`--${k}`, String(v.findingCounts[k])]) : [];
}
export const stage = (h, id) => h.state().tickets[id].stage;
/** The file a spawn's prompt tells the agent to read. */
export const briefOf = (a) => a.spawn.prompt.match(/^Read (.+) in full and follow it\.$/)[1];
/** The report file of a minimal reviewer: beside its brief, `.report.md` (#128). */
export const reportOf = (a) => briefOf(a).replace(/\.md$/, '.report.md');

/** A red light at the line's first SHA that the host finds maps to no ticket: it writes the failing lines, records unmatched (#144). */
export function unmatchedRed(h) {
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
export const ciFixSpawns = (h) => distinct(h.log).filter((a) => a.kind === 'spawn' && a.spawn.description.startsWith('ci-fix'));
