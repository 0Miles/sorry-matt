// node --test scripts/freeze.test.mjs
// Drives freeze.mjs through main() with real plan, frontier and list files in a temp dir and a real git repository;
// gh is a stub, so no test needs a network or a login.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { main } from '../src/skills/get-to-work/scripts/freeze.mjs';

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sorry-matt-freeze-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// A repository on branch main with one commit and a GitHub-looking remote.
function repoIn(dir, { remote = 'https://github.com/acme/widgets.git' } = {}) {
  const repo = join(dir, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'test');
  git(repo, 'config', 'core.autocrlf', 'false');
  mkdirSync(join(repo, 'src'));
  for (const f of ['src/a.md', 'src/b.md', 'docs.md']) writeFileSync(join(repo, f), `${f}\n`);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  if (remote) git(repo, 'remote', 'add', 'origin', remote);
  return repo;
}

// A frontier@1 document. spec: [id, { state, blockers: [ids in the set] }] in the frontier's sort order.
function frontierOf(spec, { tracker = 'github', source = 'acme/widgets' } = {}) {
  const tickets = spec.map(([id, { state = 'open', blockers = [], stalled = null } = {}]) => ({ id, state, blockers, stalled }));
  const stateOf = new Map(tickets.map((t) => [t.id, t.state]));
  const full = tickets.map((t) => ({
    id: t.id,
    title: t.id,
    state: t.state,
    trackerState: t.state === 'done' ? 'closed' : 'open',
    blockedBy: t.blockers.map((b) => ({ id: b, state: stateOf.get(b), inSet: true })),
    line: null,
    ready: t.state === 'open' && t.blockers.every((b) => stateOf.get(b) === 'done'),
    stalled: t.stalled,
  }));
  return { format: 'sorry-matt/frontier@1', tracker, source, tickets: full, lines: [], frontier: full.filter((t) => t.ready).map((t) => t.id), warnings: [] };
}

const BASE_SHA = 'b'.repeat(40);
const ghRun = (id, conclusion, status = 'completed') => ({ databaseId: id, workflowName: 'check', status, conclusion });

// gh with a logged-in account, the given open PRs, and the base branch's latest SHA whose runs are `baseRuns`.
// `calls` collects every gh argument list.
const ghOk = (prs = [], { baseRuns = [ghRun(1, 'success')], calls = [] } = {}) => (args) => {
  calls.push(args);
  if (args[0] === 'auth') return 'Logged in\n';
  if (args[0] === 'pr') return JSON.stringify(prs);
  if (args[0] === 'api') return `${BASE_SHA}\n`;
  if (args[0] === 'run') return JSON.stringify(baseRuns);
  throw new Error(`unexpected gh ${args.join(' ')}`);
};

// files: { ticketId: "list text" }; writes lists, the frontier file and the plan, then runs main.
function run(dir, { repo, frontier, files = {}, extra = {}, gh = ghOk(), git: gitDep } = {}) {
  const map = {};
  Object.entries(files).forEach(([id, text], i) => {
    writeFileSync(join(dir, `list${i}.txt`), text);
    map[id] = `list${i}.txt`;
  });
  writeFileSync(join(dir, 'frontier.json'), JSON.stringify(frontier));
  writeFileSync(join(dir, 'plan.json'), JSON.stringify({ repo, frontier: 'frontier.json', files: map, base: 'main', ...extra }));
  const r = main([join(dir, 'plan.json')], { gh, ...(gitDep ? { git: gitDep } : {}) });
  return { ...r, json: r.code === 0 ? JSON.parse(r.out) : null };
}

// One preflight check of a run's output, by name.
const checkOf = (r, name) => r.json.preflight.checks.find((c) => c.name === name);

// ---------- joining lines ----------

test('chained overlap (A-B, B-C) joins three lines into one even though A and C do not overlap', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir);
  const r = run(dir, {
    repo,
    frontier: frontierOf([['#1'], ['#2'], ['#3']]),
    files: { '#1': 'src/a.md\n', '#2': 'src/a.md\nsrc/b.md\n', '#3': 'src/b.md\n' },
  });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.preflight.ok, true, JSON.stringify(r.json.preflight));
  assert.deepEqual(r.json.lines.map((l) => [l.id, l.members, l.tickets]), [['#1', ['#1', '#2', '#3'], ['#1', '#2', '#3']]]);
  assert.deepEqual(r.json.lines[0].files, ['src/a.md', 'src/b.md']);
  assert.deepEqual(r.json.lines[0].joins, [
    { tickets: ['#1', '#2'], paths: ['src/a.md'] },
    { tickets: ['#2', '#3'], paths: ['src/b.md'] },
  ]);
});

test('a directory covers the files under it, but not a sibling that only shares the prefix', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir);
  const r = run(dir, {
    repo,
    frontier: frontierOf([['#1'], ['#2'], ['#3']]),
    files: { '#1': 'src/skills/get-to-work/\n', '#2': 'src/skills/get-to-work/SKILL.md\n', '#3': 'src/skills/get-to-work-extra.md\n' },
  });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.lines.map((l) => [l.id, l.tickets]), [['#1', ['#1', '#2']], ['#3', ['#3']]]);
  assert.deepEqual(r.json.lines[0].joins, [{ tickets: ['#1', '#2'], paths: ['src/skills/get-to-work', 'src/skills/get-to-work/SKILL.md'] }]);
});

test('a joined line takes the id of its first member in frontier order (#9 before #10, not string order)', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir);
  // Lines {#9, #12} (#12 blocked by #9) and {#10}; #10 and #12 share a file.
  const r = run(dir, {
    repo,
    frontier: frontierOf([['#9'], ['#10'], ['#12', { blockers: ['#9'] }]]),
    files: { '#9': 'a\n', '#10': 'shared\n', '#12': 'shared/x\n' },
  });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.lines.map((l) => [l.id, l.members, l.tickets]), [['#9', ['#9', '#10'], ['#9', '#10', '#12']]]);
  assert.deepEqual(r.json.candidates.map((c) => c.line), ['#9', '#9']);
});

test('lines that do not overlap stay apart; "/" overlaps everything', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir);
  const apart = run(dir, { repo, frontier: frontierOf([['#1'], ['#2']]), files: { '#1': 'a\n', '#2': 'b\n' } });
  assert.equal(apart.code, 0, apart.err);
  assert.deepEqual(apart.json.lines.map((l) => l.id), ['#1', '#2']);
  const all = run(dir, { repo, frontier: frontierOf([['#1'], ['#2']]), files: { '#1': '/\n', '#2': 'b\n' } });
  assert.deepEqual(all.json.lines.map((l) => [l.id, l.files]), [['#1', ['/', 'b']]]);
});

test('path#symbol: same-path tickets with disjoint symbols stay on their own lines; the same symbol joins them', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir);
  const r = run(dir, {
    repo,
    frontier: frontierOf([['#1'], ['#2'], ['#3'], ['#4']]),
    files: {
      '#1': 'src/tick.mjs#nextActions\n',
      '#2': 'src/tick.mjs#record\n',
      '#3': 'SKILL.md#2. 判斷#預計檔案\n',
      '#4': 'SKILL.md#2. 判斷\n', // the parent section covers the subsection #3 names
    },
  });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.lines.map((l) => [l.id, l.tickets, l.files]), [
    ['#1', ['#1'], ['src/tick.mjs#nextActions']],
    ['#2', ['#2'], ['src/tick.mjs#record']],
    ['#3', ['#3', '#4'], ['SKILL.md#2. 判斷', 'SKILL.md#2. 判斷#預計檔案']],
  ]);
  assert.deepEqual(r.json.lines[2].joins, [{ tickets: ['#3', '#4'], paths: ['SKILL.md#2. 判斷', 'SKILL.md#2. 判斷#預計檔案'] }]);
  assert.deepEqual(r.json.candidates.map((c) => c.id), ['#1', '#2', '#3', '#4']);
});

test('path#symbol: a ticket that writes only the path joins every ticket naming a symbol in it', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir);
  const r = run(dir, {
    repo,
    frontier: frontierOf([['#1'], ['#2'], ['#3']]),
    files: { '#1': 'src/tick.mjs#nextActions\n', '#2': 'src/tick.mjs\n', '#3': 'src/tick.mjs#record\n' },
  });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.lines.map((l) => [l.id, l.tickets]), [['#1', ['#1', '#2', '#3']]]);
  assert.deepEqual(r.json.lines[0].joins, [
    { tickets: ['#1', '#2'], paths: ['src/tick.mjs', 'src/tick.mjs#nextActions'] },
    { tickets: ['#2', '#3'], paths: ['src/tick.mjs', 'src/tick.mjs#record'] },
  ]);
});

test('path#symbol: a held file excludes every symbol in it; a host-held symbol excludes only that symbol', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir);
  git(repo, 'checkout', '-q', '-b', 'run/line-x');
  writeFileSync(join(repo, 'src/a.md'), 'theirs\n');
  git(repo, 'commit', '-q', '-am', 'line x');
  git(repo, 'checkout', '-q', 'main');
  writeFileSync(join(dir, 'session.txt'), 'docs.md#Usage\n');
  const r = run(dir, {
    repo,
    frontier: frontierOf([['#1'], ['#2'], ['#3']]),
    files: { '#1': 'src/a.md#Intro\n', '#2': 'docs.md#Usage\n', '#3': 'docs.md#Install\n' },
    extra: { held: [{ id: 'session B', files: 'session.txt', release: 'session B finishes' }] },
  });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.held.map((h) => [h.source, h.id, h.files]), [
    ['branch', 'run/line-x', ['src/a.md']],
    ['host', 'session B', ['docs.md#Usage']],
  ]);
  assert.deepEqual(r.json.excluded.map((e) => [e.id, e.overlaps.map((o) => [o.with, o.paths])]), [
    ['#1', [['run/line-x', ['src/a.md#Intro']]]],
    ['#2', [['session B', ['docs.md#Usage']]]],
  ]);
  assert.deepEqual(r.json.candidates.map((c) => c.id), ['#3']);
});

// ---------- candidate order ----------

test('candidates that unlock more open tickets come first', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir);
  const r = run(dir, {
    repo,
    frontier: frontierOf([['#1'], ['#2'], ['#3'], ['#4', { blockers: ['#3'] }], ['#5', { blockers: ['#3', '#2'] }]]),
    files: { '#1': 'a\n', '#2': 'b\n', '#3': 'c\n', '#4': 'd\n', '#5': 'e\n' },
  });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.candidates.map((c) => [c.id, c.unlocks]), [['#3', 2], ['#2', 1], ['#1', 0]]);
});

test('equal unlock counts keep the frontier order; done dependents do not count', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir);
  const r = run(dir, {
    repo,
    frontier: frontierOf([
      ['#1'],
      ['#2'],
      ['#3'],
      ['#4', { blockers: ['#3'] }],
      ['#5', { blockers: ['#1'] }],
      ['#6', { state: 'done', blockers: ['#2'] }],
      ['#7', { state: 'done', blockers: ['#2'] }],
    ]),
    files: { '#1': 'a\n', '#2': 'b\n', '#3': 'c\n', '#4': 'd\n', '#5': 'e\n' },
  });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.candidates.map((c) => [c.id, c.unlocks]), [['#1', 1], ['#3', 1], ['#2', 0]]);
});

// ---------- preflight ----------

test('preflight passes on a clean repository whose remote is the frontier source', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir, { remote: 'git@github.com:Acme/Widgets.git' });
  const r = run(dir, { repo, frontier: frontierOf([['#1']]), files: { '#1': 'a\n' } });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.preflight.checks.map((c) => [c.name, c.ok]), [
    ['git-repo', true],
    ['clean', true],
    ['gh-auth', true],
    ['repo-match', true],
    ['base-ci', true],
  ]);
  assert.equal(r.json.preflight.ok, true);
});

// ---------- base CI ----------

test('base-ci: a green base latest SHA passes without a warning, read from the frontier source', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir);
  const calls = [];
  const r = run(dir, { repo, frontier: frontierOf([['#1']]), files: { '#1': 'a\n' }, gh: ghOk([], { calls }) });
  assert.equal(r.code, 0, r.err);
  const base = checkOf(r, 'base-ci');
  assert.deepEqual([base.ok, base.warning, base.ci.branch, base.ci.sha, base.ci.verdict], [true, false, 'main', BASE_SHA, 'green']);
  assert.equal(r.json.preflight.ok, true);
  assert.deepEqual(calls.find((a) => a[0] === 'api'), ['api', 'repos/acme/widgets/commits/main', '--jq', '.sha']);
  assert.deepEqual(calls.find((a) => a[0] === 'run'), [
    'run', 'list', '--branch', 'main', '--commit', BASE_SHA, '--limit', '100', '--json', 'databaseId,workflowName,event,status,conclusion', '--repo', 'acme/widgets',
  ]);
});

test('base-ci: a red base is a warning that does not block the freeze', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir);
  const gh = ghOk([], { baseRuns: [ghRun(7, 'failure'), ghRun(8, 'success')] });
  const r = run(dir, { repo, frontier: frontierOf([['#1'], ['#2']]), files: { '#1': 'a\n', '#2': 'b\n' }, extra: { base: 'origin/main' }, gh });
  assert.equal(r.code, 0, r.err);
  const base = checkOf(r, 'base-ci');
  assert.deepEqual([base.ok, base.warning, base.ci.branch, base.ci.verdict, base.ci.failed], [true, true, 'main', 'red', [7]]);
  assert.match(base.detail, /main .*red/);
  assert.equal(r.json.preflight.ok, true);
  assert.deepEqual(r.json.lines.map((l) => l.id), ['#1', '#2']);
  assert.deepEqual(r.json.candidates.map((c) => c.id), ['#1', '#2']);
});

test('base-ci: a failed query is a warning that does not block the freeze, with gh\'s message', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir);
  const ok = ghOk();
  const gh = (args) => {
    if (args[0] === 'api') {
      const e = new Error('Command failed: gh api');
      e.stderr = 'HTTP 502: Bad Gateway';
      throw e;
    }
    return ok(args);
  };
  const r = run(dir, { repo, frontier: frontierOf([['#1']]), files: { '#1': 'a\n' }, gh });
  assert.equal(r.code, 0, r.err);
  const base = checkOf(r, 'base-ci');
  assert.deepEqual([base.ok, base.warning, base.ci.sha, base.ci.verdict], [true, true, null, 'query-failed']);
  assert.match(base.detail, /HTTP 502/);
  assert.equal(r.json.preflight.ok, true);
  assert.deepEqual(r.json.candidates.map((c) => c.id), ['#1']);
});

test('base-ci: a base still running or with no run is neither blocking nor a warning', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir);
  for (const [baseRuns, verdict] of [[[ghRun(3, '', 'in_progress')], 'running'], [[], 'no-run']]) {
    const r = run(dir, { repo, frontier: frontierOf([['#1']]), files: { '#1': 'a\n' }, gh: ghOk([], { baseRuns }) });
    assert.equal(r.code, 0, r.err);
    const base = checkOf(r, 'base-ci');
    assert.deepEqual([base.ok, base.warning, base.ci.verdict], [true, false, verdict]);
  }
});

test('base-ci: every plan needs base, whichever the tracker', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir, { remote: null });
  for (const frontier of [frontierOf([['#1']]), frontierOf([['#1']], { tracker: 'local', source: 'worktree' })]) {
    const r = run(dir, { repo, frontier, files: { '#1': 'a\n' }, extra: { base: undefined }, gh: () => assert.fail('gh is not called') });
    assert.equal(r.code, 2, frontier.tracker);
    assert.match(r.err, /base/);
  }
});

// The base's CI comes from the git remote and gh, not from where the tickets live: a Local Markdown run reads it
// too, through gh in the repository (gh finds the GitHub repository from its remotes), with no --repo.
test('base-ci: a local tracker in a repository with an origin reads the base CI through gh in that repository', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir);
  const calls = [];
  const cwds = [];
  const ok = ghOk([], { baseRuns: [ghRun(7, 'failure')], calls });
  const gh = (args, cwd) => {
    cwds.push(cwd);
    return ok(args);
  };
  const r = run(dir, { repo, frontier: frontierOf([['#1']], { tracker: 'local', source: 'worktree' }), files: { '#1': 'a\n' }, gh });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.preflight.checks.map((c) => c.name), ['git-repo', 'clean', 'base-ci']);
  const base = checkOf(r, 'base-ci');
  assert.deepEqual([base.ok, base.warning, base.ci.branch, base.ci.sha, base.ci.verdict, base.ci.failed], [true, true, 'main', BASE_SHA, 'red', [7]]);
  assert.equal(r.json.preflight.ok, true);
  // only the base's CI: no gh auth check and no pull requests for a local tracker
  assert.deepEqual(calls.map((a) => a[0]), ['api', 'run']);
  assert.deepEqual(calls[0], ['api', 'repos/{owner}/{repo}/commits/main', '--jq', '.sha']);
  assert.ok(!calls[1].includes('--repo'), calls[1].join(' '));
  assert.deepEqual(cwds, [r.json.repo, r.json.repo], 'gh runs in the repository');
});

test('base-ci: a local tracker whose origin gh cannot read is a warning (query-failed) that does not block the freeze', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir, { remote: 'https://gitlab.example.invalid/acme/widgets.git' });
  const gh = () => {
    const e = new Error('Command failed: gh api');
    e.stderr = 'none of the git remotes configured for this repository point to a known GitHub host';
    throw e;
  };
  const r = run(dir, { repo, frontier: frontierOf([['#1']], { tracker: 'local', source: 'worktree' }), files: { '#1': 'a\n' }, gh });
  assert.equal(r.code, 0, r.err);
  const base = checkOf(r, 'base-ci');
  assert.deepEqual([base.ok, base.warning, base.ci.sha, base.ci.verdict], [true, true, null, 'query-failed']);
  assert.match(base.detail, /known GitHub host/);
  assert.equal(r.json.preflight.ok, true);
});

test('preflight fails outside a git repository; the rest is null and gh is still checked', (t) => {
  const dir = scratch(t);
  const plain = join(dir, 'plain');
  mkdirSync(plain);
  const r = run(dir, { repo: plain, frontier: frontierOf([['#1']]), files: { '#1': 'a\n' } });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.preflight.ok, false);
  assert.deepEqual(r.json.preflight.checks.map((c) => [c.name, c.ok]), [['git-repo', false], ['gh-auth', true], ['base-ci', true]]);
  assert.equal(r.json.repo, null);
  for (const key of ['held', 'excluded', 'stalled', 'lines', 'candidates']) assert.equal(r.json[key], null, key);
});

test('preflight fails on a repository with no commit', (t) => {
  const dir = scratch(t);
  const repo = join(dir, 'empty');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  const r = run(dir, { repo, frontier: frontierOf([['#1']], { tracker: 'local', source: 'worktree' }), files: { '#1': 'a\n' } });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.preflight.checks.map((c) => [c.name, c.ok]), [['git-repo', false]]);
  assert.match(r.json.preflight.checks[0].detail, /no commit/);
});

test('preflight fails on a modified tracked file and on an untracked file', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir);
  writeFileSync(join(repo, 'src/a.md'), 'changed\n');
  const modified = run(dir, { repo, frontier: frontierOf([['#1']]), files: { '#1': 'a\n' } });
  assert.equal(modified.code, 0, modified.err);
  const clean = modified.json.preflight.checks.find((c) => c.name === 'clean');
  assert.equal(clean.ok, false);
  assert.match(clean.detail, /src\/a\.md/);
  assert.equal(modified.json.lines, null);
  git(repo, 'checkout', '--', 'src/a.md');
  writeFileSync(join(repo, 'new.md'), 'new\n');
  const untracked = run(dir, { repo, frontier: frontierOf([['#1']]), files: { '#1': 'a\n' } });
  assert.equal(untracked.json.preflight.ok, false);
  assert.match(untracked.json.preflight.checks.find((c) => c.name === 'clean').detail, /new\.md/);
});

test('preflight fails when gh is not logged in or not installed', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir);
  const loggedOut = () => {
    const e = new Error('Command failed: gh auth status');
    e.stderr = 'You are not logged into any GitHub hosts.';
    throw e;
  };
  const r = run(dir, { repo, frontier: frontierOf([['#1']]), files: { '#1': 'a\n' }, gh: loggedOut });
  assert.equal(r.code, 0, r.err);
  const auth = checkOf(r, 'gh-auth');
  assert.equal(auth.ok, false);
  assert.match(auth.detail, /not logged into/);
  assert.equal(r.json.held, null);
  const missing = run(dir, { repo, frontier: frontierOf([['#1']]), files: { '#1': 'a\n' }, gh: () => { throw new Error('spawnSync gh ENOENT'); } });
  assert.match(missing.json.preflight.checks.find((c) => c.name === 'gh-auth').detail, /ENOENT/);
});

test('preflight fails when no remote points at the frontier source (another repository of the workspace)', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir, { remote: 'https://github.com/acme/gadgets.git' });
  const r = run(dir, { repo, frontier: frontierOf([['#1']]), files: { '#1': 'a\n' } });
  assert.equal(r.code, 0, r.err);
  const match = checkOf(r, 'repo-match');
  assert.equal(match.ok, false);
  assert.match(match.detail, /acme\/widgets.*acme\/gadgets/);
  const none = repoIn(join(dir, 'x'), { remote: null });
  const r2 = run(dir, { repo: none, frontier: frontierOf([['#1']]), files: { '#1': 'a\n' } });
  assert.match(r2.json.preflight.checks.find((c) => c.name === 'repo-match').detail, /remotes: none/);
});

test('local tracker: no gh check, no remote needed, no pull requests read', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir, { remote: null });
  const gh = () => assert.fail('gh must not be called for a local tracker without an origin');
  const r = run(dir, {
    repo,
    frontier: frontierOf([['.scratch/f/issues/01-a.md']], { tracker: 'local', source: 'worktree' }),
    files: { '.scratch/f/issues/01-a.md': 'src/a.md\n' },
    gh,
  });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.preflight.checks.map((c) => c.name), ['git-repo', 'clean', 'base-ci']);
  // no origin: no CI to read (its lines go on local verification, as tick has it), and no warning
  const base = checkOf(r, 'base-ci');
  assert.deepEqual([base.ok, base.warning, base.ci], [true, false, null]);
  assert.match(base.detail, /no origin/);
  assert.deepEqual(r.json.candidates, [{ id: '.scratch/f/issues/01-a.md', line: '.scratch/f/issues/01-a.md', unlocks: 0 }]);
});

// ---------- integrate ----------

const ISSUE_PR = ['git-repo', 'clean', 'gh-auth', 'repo-match', 'base-ci'];
const STACK_VERSION = 'gh stack version 0.3.0';

// gh for an `integrate: ticket-pr` run: the repository's default branch is `defaultBranch` (a function of the
// arguments that throws stands for a failed query), and `gh stack --version` prints `stack` (null: not installed).
// `envs` collects the environment gh stack ran with.
const ghTicketPr = ({ defaultBranch = 'main', stack = STACK_VERSION, calls = [], envs = [] } = {}) => {
  const ok = ghOk([], { calls });
  return (args, cwd, env) => {
    if (args[0] === 'repo') {
      calls.push(args);
      return `${typeof defaultBranch === 'function' ? defaultBranch(args) : defaultBranch}\n`;
    }
    if (args[0] === 'stack') {
      calls.push(args);
      envs.push(env);
      if (stack === null) {
        const e = new Error('Command failed: gh stack --version');
        e.stderr = 'unknown command "stack" for "gh"';
        throw e;
      }
      return `${stack}\n`;
    }
    return ok(args, cwd);
  };
};

// A one-ticket `integrate: ticket-pr` run with `gh`.
const ticketPr = (dir, repo, gh, extra = {}) =>
  run(dir, { repo, frontier: frontierOf([['#1']]), files: { '#1': 'a\n' }, extra: { integrate: 'ticket-pr', ...extra }, gh });

test('integrate: omitted, aggregate-pr and direct run the same checks and never ask for the default branch or gh stack', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir);
  for (const integrate of [undefined, 'aggregate-pr', 'direct']) {
    const calls = [];
    const r = run(dir, { repo, frontier: frontierOf([['#1']]), files: { '#1': 'a\n' }, extra: { integrate }, gh: ghTicketPr({ calls }) });
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.json.preflight.checks.map((c) => c.name), ISSUE_PR, String(integrate));
    assert.equal(r.json.preflight.ok, true);
    assert.deepEqual(calls.filter((a) => a[0] === 'repo' || a[0] === 'stack'), [], String(integrate));
  }
  const local = run(dir, {
    repo,
    frontier: frontierOf([['#1']], { tracker: 'local', source: 'worktree' }),
    files: { '#1': 'a\n' },
    gh: ghTicketPr(),
  });
  assert.deepEqual(local.json.preflight.checks.map((c) => c.name), ['git-repo', 'clean', 'base-ci']);
});

test('integrate: any other value exits 2', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir);
  for (const integrate of ['ticket', 'Ticket-PR', '', 3, null]) {
    const r = run(dir, { repo, frontier: frontierOf([['#1']]), files: { '#1': 'a\n' }, extra: { integrate }, gh: () => assert.fail('gh is not called') });
    assert.equal(r.code, 2, `${JSON.stringify(integrate)}: ${r.err}`);
    assert.match(r.err, /integrate/);
  }
});

test('ticket-pr: the base is the repository default branch, read from the frontier source', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir);
  for (const base of ['main', 'origin/main']) {
    const calls = [];
    const r = ticketPr(dir, repo, ghTicketPr({ calls }), { base });
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.json.preflight.checks.map((c) => [c.name, c.ok]), [...ISSUE_PR.map((n) => [n, true]), ['default-branch', true], ['gh-stack', true]]);
    assert.equal(r.json.preflight.ok, true);
    assert.deepEqual(calls.find((a) => a[0] === 'repo'), ['repo', 'view', 'acme/widgets', '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name']);
  }
});

test('ticket-pr: a base that is not the default branch fails the preflight and points at aggregate-pr', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir);
  const r = ticketPr(dir, repo, ghTicketPr({ defaultBranch: 'trunk' }));
  assert.equal(r.code, 0, r.err);
  const check = checkOf(r, 'default-branch');
  assert.equal(check.ok, false);
  assert.match(check.detail, /\bmain\b/);
  assert.match(check.detail, /\btrunk\b/);
  assert.match(check.detail, /aggregate-pr/);
  assert.equal(r.json.preflight.ok, false);
  assert.equal(r.json.lines, null);
});

test('ticket-pr: a failed default-branch query fails the preflight with gh\'s message', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir);
  const defaultBranch = () => {
    const e = new Error('Command failed: gh repo view');
    e.stderr = 'HTTP 404: Not Found';
    throw e;
  };
  const r = ticketPr(dir, repo, ghTicketPr({ defaultBranch }));
  assert.equal(r.code, 0, r.err);
  const check = checkOf(r, 'default-branch');
  assert.equal(check.ok, false);
  assert.match(check.detail, /HTTP 404: Not Found/);
  assert.equal(r.json.preflight.ok, false);
});

test('ticket-pr: a Local Markdown tracker fails the preflight and points at aggregate-pr', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir, { remote: null });
  const r = run(dir, {
    repo,
    frontier: frontierOf([['#1']], { tracker: 'local', source: 'worktree' }),
    files: { '#1': 'a\n' },
    extra: { integrate: 'ticket-pr' },
    gh: ghTicketPr(),
  });
  assert.equal(r.code, 0, r.err);
  const check = checkOf(r, 'tracker');
  assert.equal(check.ok, false);
  assert.match(check.detail, /local/i);
  assert.match(check.detail, /aggregate-pr/);
  assert.equal(r.json.preflight.ok, false);
  assert.equal(r.json.candidates, null);
});

test('ticket-pr: gh-stack reports the installed version, run without the update notifier', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir);
  const calls = [];
  const envs = [];
  const r = ticketPr(dir, repo, ghTicketPr({ calls, envs }));
  assert.equal(r.code, 0, r.err);
  const check = checkOf(r, 'gh-stack');
  assert.deepEqual([check.ok, check.stack, check.version], [true, true, STACK_VERSION]);
  assert.deepEqual(calls.filter((a) => a[0] === 'stack'), [['stack', '--version']]);
  assert.equal(envs[0]?.GH_STACK_NO_UPDATE_NOTIFIER, '1');
});

test('ticket-pr: gh stack not installed never fails the preflight and names the install command', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir);
  const r = ticketPr(dir, repo, ghTicketPr({ stack: null }));
  assert.equal(r.code, 0, r.err);
  const check = checkOf(r, 'gh-stack');
  assert.deepEqual([check.ok, check.stack, check.version], [true, false, null]);
  assert.match(check.detail, /gh extension install github\/gh-stack/);
  assert.equal(r.json.preflight.ok, true);
  assert.deepEqual(r.json.candidates.map((c) => c.id), ['#1']);
});

// gh 2.91 without the extension: `gh stack --version` exits 0, prints nothing on stdout and the install hint on
// stderr (measured). A hint on stdout is not a version either.
test('ticket-pr: gh stack exiting 0 without a version is not installed', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir);
  for (const stack of ['', 'gh stack is available as an official extension.\nTo install it, run:\n  gh extension install github/gh-stack']) {
    const r = ticketPr(dir, repo, ghTicketPr({ stack }));
    assert.equal(r.code, 0, r.err);
    const check = checkOf(r, 'gh-stack');
    assert.deepEqual([check.ok, check.stack, check.version], [true, false, null], JSON.stringify(stack));
    assert.match(check.detail, /gh extension install github\/gh-stack/);
    assert.equal(r.json.preflight.ok, true);
  }
});

// ---------- held files and exclusion ----------

test('another worktree, an unmerged branch and an open PR hold files; overlapping tickets are excluded', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir);
  // A worktree with a committed edit, an unstaged edit and an untracked file.
  const wt = join(dir, 'wt');
  git(repo, 'worktree', 'add', '-q', '-b', 'other-session', wt);
  writeFileSync(join(wt, 'src/a.md'), 'theirs\n');
  git(wt, 'commit', '-q', '-am', 'their work');
  writeFileSync(join(wt, 'docs.md'), 'unstaged\n');
  writeFileSync(join(wt, 'scratch.md'), 'untracked\n');
  // An unmerged branch, and a merged one that holds nothing.
  git(repo, 'checkout', '-q', '-b', 'run/line-x');
  mkdirSync(join(repo, 'lib'));
  writeFileSync(join(repo, 'lib/x.mjs'), 'x\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'line x');
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'branch', 'merged-already');
  // Main moves on after the worktree branched: that is not the worktree's work.
  writeFileSync(join(repo, 'src/b.md'), 'main moved\n');
  git(repo, 'commit', '-q', '-am', 'main moves');
  const prs = [
    { number: 40, headRefName: 'feature/pr', files: [{ path: 'README.md' }] },
    { number: 41, headRefName: 'main', files: [{ path: 'src/b.md' }] }, // the current branch's own PR
  ];
  const r = run(dir, {
    repo,
    frontier: frontierOf([['#1'], ['#2'], ['#3'], ['#4'], ['#5'], ['#6']]),
    files: { '#1': 'src/\n', '#2': 'lib\n', '#3': 'README.md\n', '#4': 'src/b.md\n', '#5': 'scratch.md\n', '#6': 'other\n' },
    gh: ghOk(prs),
  });
  assert.equal(r.code, 0, r.err);
  const real = (p) => realpathSync.native(p); // the temp dir may be an 8.3 short name; git prints the long one
  const held = r.json.held.map((h) => [h.source, h.source === 'worktree' ? real(h.id) : h.id, h.files]);
  assert.deepEqual(held, [
    ['worktree', real(wt), ['docs.md', 'scratch.md', 'src/a.md']],
    ['branch', 'run/line-x', ['lib/x.mjs']],
    ['pr', '#40', ['README.md']],
  ]);
  assert.deepEqual(r.json.excluded.map((e) => [e.id, e.overlaps.map((o) => [o.source, o.paths])]), [
    ['#1', [['worktree', ['src']]]],
    ['#2', [['branch', ['lib']]]],
    ['#3', [['pr', ['README.md']]]],
    ['#5', [['worktree', ['scratch.md']]]],
  ]);
  assert.match(r.json.excluded[2].overlaps[0].release, /PR #40 is merged or closed/);
  assert.match(r.json.excluded[1].overlaps[0].release, /run\/line-x is merged into main or deleted/);
  assert.deepEqual(r.json.candidates.map((c) => c.id), ['#4', '#6']);
});

test('ignore leaves holders out; host-known holders exclude with their own release condition', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir);
  git(repo, 'checkout', '-q', '-b', 'stale');
  writeFileSync(join(repo, 'src/a.md'), 'stale\n');
  git(repo, 'commit', '-q', '-am', 'stale');
  git(repo, 'checkout', '-q', 'main');
  writeFileSync(join(dir, 'session.txt'), 'docs.md\n');
  const r = run(dir, {
    repo,
    frontier: frontierOf([['#1'], ['#2']]),
    files: { '#1': 'src/a.md\n', '#2': 'docs.md\n' },
    gh: ghOk([{ number: 7, headRefName: 'x', files: [{ path: 'src/a.md' }] }]),
    extra: { ignore: ['stale', '#7'], held: [{ id: 'session B', files: 'session.txt', release: 'session B finishes' }] },
  });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.held, [{ source: 'host', id: 'session B', branch: null, files: ['docs.md'], release: 'session B finishes' }]);
  assert.deepEqual(r.json.excluded, [{ id: '#2', overlaps: [{ with: 'session B', source: 'host', paths: ['docs.md'], release: 'session B finishes' }] }]);
  assert.deepEqual(r.json.candidates.map((c) => c.id), ['#1']);
});

test('an exclusion splits a line and stalls the tickets behind it', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir);
  writeFileSync(join(dir, 'session.txt'), 'held/\n');
  // #1 <- #2 <- #3 <- #4 is one line; excluding #2 leaves {#1} and {#3, #4}.
  const r = run(dir, {
    repo,
    frontier: frontierOf([['#1'], ['#2', { blockers: ['#1'] }], ['#3', { blockers: ['#2'] }], ['#4', { blockers: ['#3'] }]]),
    files: { '#1': 'a\n', '#2': 'held/x\n', '#3': 'c\n', '#4': 'd\n' },
    extra: { held: [{ id: 'session B', files: 'session.txt', release: 'session B finishes' }] },
  });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.excluded.map((e) => e.id), ['#2']);
  assert.deepEqual(r.json.lines.map((l) => [l.id, l.members, l.tickets]), [['#1', ['#1'], ['#1']], ['#3', ['#3'], ['#3', '#4']]]);
  assert.deepEqual(r.json.stalled, [
    { id: '#3', stalled: 'blocked-external', by: ['#2'] },
    { id: '#4', stalled: 'blocked-upstream', by: ['#3'] },
  ]);
  assert.deepEqual(r.json.candidates, [{ id: '#1', line: '#1', unlocks: 0 }]);
});

// ---------- errors ----------

test('bad plans exit 2: missing list for an open ticket, unknown ticket, wrong frontier format, held without release', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir);
  const frontier = frontierOf([['#1'], ['#2', { state: 'done' }]]);
  const cases = [
    [{ frontier, files: {} }, /open ticket #1 has no files list/],
    [{ frontier, files: { '#1': 'a\n', '#9': 'b\n' } }, /#9, which is not a ticket/],
    [{ frontier: { ...frontier, format: 'sorry-matt/overlap@1' }, files: { '#1': 'a\n' } }, /not sorry-matt\/frontier@1/],
    [{ frontier, files: { '#1': '# nothing\n' } }, /no path/],
    [{ frontier, files: { '#1': 'a\n' }, extra: { held: [{ id: 'x', files: 'plan.json' }] } }, /no release condition/],
    [{ frontier, files: { '#1': 'a\n' }, extra: { ignore: [''] } }, /ignore is an array/],
  ];
  for (const [c, message] of cases) {
    const r = run(dir, { repo, ...c });
    assert.equal(r.code, 2, `${message}: ${r.err}`);
    assert.match(r.err, message);
  }
  assert.equal(main([]).code, 2);
  writeFileSync(join(dir, 'bad.json'), '{');
  assert.equal(main([join(dir, 'bad.json')]).code, 2);
});

test('a list of a done ticket is ignored; a failing gh pr list after the preflight exits 1', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir);
  const frontier = frontierOf([['#1'], ['#2', { state: 'done' }]]);
  const ok = run(dir, { repo, frontier, files: { '#1': 'a\n', '#2': 'a\n' } });
  assert.equal(ok.code, 0, ok.err);
  assert.deepEqual(ok.json.lines.map((l) => [l.id, l.files]), [['#1', ['a']], ['#2', []]]);
  const gh = (args) => {
    if (args[0] === 'auth') return '';
    const e = new Error('gh pr list');
    e.stderr = 'HTTP 502';
    throw e;
  };
  const r = run(dir, { repo, frontier, files: { '#1': 'a\n' }, gh });
  assert.equal(r.code, 1);
  assert.match(r.err, /^freeze: HTTP 502/);
});

// ---------- bundle candidates (#205) ----------

test('bundle candidates: tickets of a line connected by overlapping entries, with their edges', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir);
  // #1 -> #2 (#2 blocked by #1), both on src/a.md; #3 shares src/b.md with #2; #4 touches only docs.md.
  const r = run(dir, {
    repo,
    frontier: frontierOf([['#1'], ['#2', { blockers: ['#1'] }], ['#3'], ['#4']]),
    files: { '#1': 'src/a.md\n', '#2': 'src/a.md\nsrc/b.md\n', '#3': 'src/b.md\n', '#4': 'docs.md\n' },
  });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(
    r.json.bundleCandidates.map((b) => [b.line, b.tickets, b.edges, b.through]),
    [['#1', ['#1', '#2', '#3'], [['#1', '#2']], []]],
  );
  assert.deepEqual(r.json.bundleCandidates[0].overlaps, [
    { tickets: ['#1', '#2'], paths: ['src/a.md'] },
    { tickets: ['#2', '#3'], paths: ['src/b.md'] },
  ]);
  assert.deepEqual(r.json.bundles, []);
  assert.equal(r.json.bundleCap, 3);
});

test('bundles from the plan: lead is the first in frontier order; invalid groups are refused', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir);
  const frontier = frontierOf([['#1'], ['#2', { blockers: ['#1'] }], ['#3'], ['#4'], ['#5', { blockers: ['#1'] }], ['#6', { blockers: ['#5'] }]]);
  const files = { '#1': 'src/a.md\n', '#2': 'src/a.md\n', '#3': 'src/b.md\n', '#4': 'docs.md\n', '#5': 'docs.md\n', '#6': 'src/a.md#x\n' };
  const ok = run(dir, { repo, frontier, files, extra: { bundles: [['#2', '#1']] } });
  assert.equal(ok.code, 0, ok.err);
  assert.deepEqual(ok.json.bundles, [{ lead: '#1', tickets: ['#1', '#2'], line: '#1' }]);
  // #1 and #6 overlap, but #6 waits on #5, which waits on #1: the path goes outside the bundle.
  const through = run(dir, { repo, frontier, files, extra: { bundles: [['#1', '#6']] } });
  assert.equal(through.code, 2);
  assert.match(through.err, /goes through #5/);
  const apart = run(dir, { repo, frontier, files, extra: { bundles: [['#1', '#3']] } });
  assert.equal(apart.code, 2);
  assert.match(apart.err, /different lines|not connected/);
  const big = run(dir, { repo, frontier, files, extra: { bundles: [['#1', '#2', '#6']], bundleCap: 2 } });
  assert.equal(big.code, 2);
  assert.match(big.err, /more than 2/);
  const twice = run(dir, { repo, frontier, files, extra: { bundles: [['#1', '#2'], ['#2', '#6']] } });
  assert.equal(twice.code, 2);
  assert.match(twice.err, /already in bundle/);
});

test('a stalled or excluded ticket cannot be bundled, and symbol-disjoint entries are no candidate', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir);
  const r = run(dir, {
    repo,
    frontier: frontierOf([['#1'], ['#2', { stalled: 'missing' }], ['#3']]),
    files: { '#1': 'SKILL.md#a\n', '#2': 'SKILL.md#a\n', '#3': 'SKILL.md#b\n' },
    extra: { bundles: [['#1', '#2']] },
  });
  assert.equal(r.code, 2);
  assert.match(r.err, /#2 is not an open ticket/);
  const none = run(dir, { repo, frontier: frontierOf([['#1'], ['#3']]), files: { '#1': 'SKILL.md#a\n', '#3': 'SKILL.md#b\n' } });
  assert.equal(none.code, 0, none.err);
  assert.deepEqual(none.json.bundleCandidates, []);
});

test('a connected group over the cap is cut in candidate order into parts of at most the cap', (t) => {
  const dir = scratch(t);
  const repo = repoIn(dir);
  // a chain of overlaps #1-#2-#3-#4-#5 on one line; #4 unlocks the most, so it leads the candidate order
  const r = run(dir, {
    repo,
    frontier: frontierOf([['#1'], ['#2'], ['#3'], ['#4'], ['#5'], ['#6', { blockers: ['#4'] }]]),
    files: { '#1': 'a\n', '#2': 'a\nb\n', '#3': 'b\nc\n', '#4': 'c\nd\n', '#5': 'd\n', '#6': 'z\n' },
    extra: { bundleCap: 2 },
  });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.bundleCandidates.map((b) => [b.tickets, b.cutFrom]), [
    [['#1', '#2'], ['#1', '#2', '#3', '#4', '#5']],
    [['#3', '#4'], ['#1', '#2', '#3', '#4', '#5']],
  ]);
  assert.deepEqual(r.json.bundleCandidates[1].overlaps, [{ tickets: ['#3', '#4'], paths: ['c'] }]);
  // with the default cap of 3: #4 first, then the next overlapping it or a part member in candidate order (#3, then
  // #2); #1 and #5 are left alone and are no candidate
  const three = run(dir, { repo, frontier: frontierOf([['#1'], ['#2'], ['#3'], ['#4'], ['#5'], ['#6', { blockers: ['#4'] }]]), files: { '#1': 'a\n', '#2': 'a\nb\n', '#3': 'b\nc\n', '#4': 'c\nd\n', '#5': 'd\n', '#6': 'z\n' } });
  assert.deepEqual(three.json.bundleCandidates.map((b) => b.tickets), [['#2', '#3', '#4']]);
  assert.ok(!('cutFrom' in run(dir, { repo, frontier: frontierOf([['#1'], ['#2']]), files: { '#1': 'a\n', '#2': 'a\n' } }).json.bundleCandidates[0]));
});
