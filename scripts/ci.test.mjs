// node --test scripts/ci.test.mjs
// Drives ci.mjs through main(). Every GitHub answer comes from a fixture behind the `gh` seam; nothing calls the
// real GitHub. `earliest-red` walks real git repositories in a temp dir, built the way get-to-work builds a line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { main, defaultDeps } from '../src/skills/get-to-work/scripts/ci.mjs';

const SHA = 'a'.repeat(40);

// --- verdict ---------------------------------------------------------------------------------------------------

let nextId = 100;
const ghRun = (status, conclusion, workflow = 'check') => ({ databaseId: (nextId += 1), workflowName: workflow, status, conclusion });
const done = (conclusion, workflow) => ghRun('completed', conclusion, workflow);
const inProgress = () => ghRun('in_progress', '');

const ghFailure = (stderr) => () => {
  const e = new Error('Command failed: gh run list');
  e.status = 1;
  e.stderr = stderr;
  throw e;
};

// Runs `verdict` on a fixture run list (or a function standing in for `gh`), recording what `gh` was asked.
function verdictOf(rows, argv = ['line', SHA]) {
  const calls = [];
  const gh = (args, cwd) => {
    calls.push(args);
    return typeof rows === 'function' ? rows(args, cwd) : JSON.stringify(rows);
  };
  const r = main(['verdict', ...argv], { ...defaultDeps(), gh });
  return { ...r, json: r.out ? JSON.parse(r.out) : null, calls };
}

test('verdict: the output carries the format, the branch, the SHA and every run', () => {
  const rows = [done('success', 'check'), done('skipped', 'deploy')];
  const r = verdictOf(rows);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json, {
    format: 'sorry-matt/ci@1',
    command: 'verdict',
    branch: 'line',
    sha: SHA,
    verdict: 'green',
    reason: null,
    error: null,
    runs: [
      { id: rows[0].databaseId, workflow: 'check', status: 'completed', conclusion: 'success' },
      { id: rows[1].databaseId, workflow: 'deploy', status: 'completed', conclusion: 'skipped' },
    ],
    rerun: [],
  });
  assert.deepEqual(r.calls, [
    ['run', 'list', '--branch', 'line', '--commit', SHA, '--limit', '100', '--json', 'databaseId,workflowName,status,conclusion'],
  ]);
});

test('verdict: --repo is passed on to gh', () => {
  const r = verdictOf([done('success')], ['--repo', 'acme/app', 'line', SHA]);
  assert.deepEqual(r.calls[0].slice(-2), ['--repo', 'acme/app']);
  assert.equal(r.json.verdict, 'green');
});

test('verdict: query-failed when gh exits non-zero, with its message, and the script still exits 0', () => {
  const r = verdictOf(ghFailure('HTTP 502: Bad Gateway (https://api.github.com/)\n'));
  assert.equal(r.code, 0);
  assert.equal(r.json.verdict, 'query-failed');
  assert.equal(r.json.error, 'HTTP 502: Bad Gateway (https://api.github.com/)');
  assert.deepEqual(r.json.runs, []);
});

test('verdict: no-run with reason empty when the list is empty', () => {
  const r = verdictOf([]);
  assert.equal(r.code, 0);
  assert.equal(r.json.verdict, 'no-run');
  assert.equal(r.json.reason, 'empty');
});

test('verdict: red for each of the five failing conclusions', () => {
  for (const conclusion of ['failure', 'timed_out', 'startup_failure', 'action_required', 'stale']) {
    const r = verdictOf([done('success'), done(conclusion)]);
    assert.equal(r.json.verdict, 'red', conclusion);
    assert.equal(r.json.reason, null);
  }
});

test('verdict: running when a run has not completed', () => {
  assert.equal(verdictOf([done('success'), inProgress()]).json.verdict, 'running');
  assert.equal(verdictOf([ghRun('queued', '')]).json.verdict, 'running');
});

test('verdict: cancelled lists the cancelled runs to rerun, and the script reruns nothing itself', () => {
  const rows = [done('cancelled'), done('success'), done('cancelled')];
  const r = verdictOf(rows);
  assert.equal(r.json.verdict, 'cancelled');
  assert.deepEqual(r.json.rerun, [rows[0].databaseId, rows[2].databaseId]);
  assert.equal(r.calls.length, 1);
  assert.deepEqual(r.calls[0].slice(0, 2), ['run', 'list']);
});

test('verdict: green needs a success; skipped and neutral runs beside it do not change that', () => {
  assert.equal(verdictOf([done('success')]).json.verdict, 'green');
  assert.equal(verdictOf([done('success'), done('skipped')]).json.verdict, 'green');
  assert.equal(verdictOf([done('neutral'), done('success')]).json.verdict, 'green');
});

test('verdict: no-run with reason no-success when every run completed and none succeeded', () => {
  const cases = {
    'all skipped': [done('skipped'), done('skipped')],
    'all neutral': [done('neutral')],
    'skipped and neutral': [done('skipped'), done('neutral')],
  };
  for (const [name, rows] of Object.entries(cases)) {
    const r = verdictOf(rows);
    assert.equal(r.json.verdict, 'no-run', name);
    assert.equal(r.json.reason, 'no-success', name);
    assert.equal(r.json.runs.length, rows.length, name);
  }
});

test('verdict: with mixed runs the earlier rule wins — red, then running, then cancelled, then green', () => {
  assert.equal(verdictOf([inProgress(), done('failure')]).json.verdict, 'red');
  assert.equal(verdictOf([done('cancelled'), done('timed_out')]).json.verdict, 'red');
  assert.equal(verdictOf([done('cancelled'), inProgress()]).json.verdict, 'running');
  assert.equal(verdictOf([done('success'), done('cancelled')]).json.verdict, 'cancelled');
  // Only a cancelled verdict asks for a rerun.
  assert.deepEqual(verdictOf([done('cancelled'), inProgress()]).json.rerun, []);
  assert.deepEqual(verdictOf([done('cancelled'), done('failure')]).json.rerun, []);
});

test('verdict: output that is not a run list is a failed query too', () => {
  const r = verdictOf(() => 'not json');
  assert.equal(r.code, 0);
  assert.equal(r.json.verdict, 'query-failed');
  assert.ok(r.json.error);
});

test('bad arguments exit 2', () => {
  const deps = { ...defaultDeps(), gh: () => assert.fail('gh must not be called') };
  for (const argv of [[], ['nope'], ['verdict'], ['verdict', 'line'], ['verdict', 'line', SHA, 'extra'], ['verdict', '--bogus', 'line', SHA], ['verdict', 'line', SHA, '--repo'], ['earliest-red'], ['earliest-red', 'a.json', 'b.json']]) {
    const r = main(argv, deps);
    assert.equal(r.code, 2, JSON.stringify(argv));
    assert.match(r.err, /^ci: .*\nusage: see the header of ci\.mjs\n$/);
  }
});

// --- earliest-red ----------------------------------------------------------------------------------------------

// A repository with `main` and an integration branch `line` cut from it. `ticket` merges a one-commit branch with
// `--no-ff`, `host` commits straight onto the line; both return the line's new SHA.
function buildRepo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sorry-matt-ci-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo');
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  let n = 0;
  const commit = (msg) => {
    writeFileSync(join(repo, `f${(n += 1)}.md`), `${msg}\n`);
    git('add', '-A');
    git('commit', '-q', '-m', msg);
    return git('rev-parse', 'HEAD');
  };
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'test');
  git('config', 'core.autocrlf', 'false');
  const base = commit('base');
  git('switch', '-q', '-c', 'line');
  return {
    dir,
    repo,
    git,
    base,
    host: commit,
    ticket(branch, message) {
      git('switch', '-q', '-c', branch, 'line');
      commit(`work on ${branch}`);
      git('switch', '-q', 'line');
      git('merge', '-q', '--no-ff', ...(message ? ['-m', message] : ['--no-edit']), branch);
      return git('rev-parse', 'HEAD');
    },
    // What a push does to the remote-tracking ref; a line with CI is walked from there.
    push: () => git('update-ref', 'refs/remotes/origin/line', 'line'),
  };
}

// `runs` maps a SHA to the conclusions of its completed runs, or to "running".
function fakeCi(runs) {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    const rows = [];
    for (const [headSha, conclusions] of Object.entries(runs)) {
      for (const c of conclusions === 'running' ? [null] : conclusions) {
        rows.push({ headSha, ...(c === null ? inProgress() : done(c)) });
      }
    }
    return JSON.stringify(rows);
  };
  return { gh, calls };
}

function earliestRed(r, plan, gh) {
  writeFileSync(join(r.dir, 'plan.json'), JSON.stringify({ worktree: r.repo, line: 'line', base: 'main', ci: true, tickets: [], ...plan }));
  const res = main(['earliest-red', join(r.dir, 'plan.json')], { ...defaultDeps(), gh });
  return { ...res, json: res.out ? JSON.parse(res.out) : null };
}

const T11 = { id: '#11', branch: 'run/11-a' };
const T13 = { id: '#13', branch: 'run/13-c' };
const T14 = { id: '#14', branch: 'run/14-d' };
const T15 = { id: '#15', branch: 'run/15-e' };

test('earliest-red: a red SHA right after a green one maps to the one ticket merged between them', (t) => {
  const r = buildRepo(t);
  const m11 = r.ticket('run/11-a');
  const m13 = r.ticket('run/13-c');
  r.push();
  const ci = fakeCi({ [m11]: ['success'], [m13]: ['failure', 'success'] });
  const res = earliestRed(r, { tickets: [T11, T13] }, ci.gh);
  assert.equal(res.code, 0, res.err);
  const j = res.json;
  assert.equal(j.format, 'sorry-matt/ci@1');
  assert.equal(j.command, 'earliest-red');
  assert.deepEqual(j.line, { ref: 'origin/line', sha: m13 });
  assert.equal(j.ci, 'read');
  assert.equal(j.error, null);
  assert.equal(j.earliestRed, m13);
  assert.deepEqual(j.lowerBound, { sha: m11, kind: 'green' });
  assert.deepEqual(j.tickets, ['#13']);
  assert.equal(j.unmatched, false);
  assert.deepEqual(j.merges, [{ sha: m13, subject: "Merge branch 'run/13-c' into line", tickets: ['#13'], matchedBy: 'branch' }]);
  assert.deepEqual(j.verdicts, [
    { sha: m13, verdict: 'red', source: 'ci' },
    { sha: m11, verdict: 'green', source: 'ci' },
  ]);
  assert.deepEqual(ci.calls, [
    ['run', 'list', '--branch', 'line', '--limit', '200', '--json', 'headSha,databaseId,workflowName,status,conclusion'],
  ]);
});

test('earliest-red: pushes without a verdict between the green and the red put every ticket of the stretch on the list, oldest first', (t) => {
  const r = buildRepo(t);
  const m11 = r.ticket('run/11-a');
  const m13 = r.ticket('run/13-c'); // no run at all
  r.host('docs: completion record'); // a host commit in between owns nothing
  const m14 = r.ticket('run/14-d'); // still running
  const m15 = r.ticket('run/15-e'); // cancelled
  const m16 = r.ticket('run/16-f'); // the earliest red
  const m17 = r.ticket('run/17-g'); // red as well, but newer
  r.push();
  const ci = fakeCi({ [m11]: ['success'], [m14]: 'running', [m15]: ['cancelled'], [m16]: ['failure'], [m17]: ['failure'] });
  const tickets = [{ id: '#17', branch: 'run/17-g' }, { id: '#16', branch: 'run/16-f' }, T15, T14, T13, T11];
  const j = earliestRed(r, { tickets }, ci.gh).json;
  assert.equal(j.earliestRed, m16);
  assert.deepEqual(j.lowerBound, { sha: m11, kind: 'green' });
  assert.deepEqual(j.tickets, ['#13', '#14', '#15', '#16']);
  assert.deepEqual(j.merges.map((m) => m.sha), [m13, m14, m15, m16]);
  assert.equal(j.unmatched, false);
});

test('earliest-red: a SHA whose runs were all skipped or neutral has no verdict — neither green nor red', (t) => {
  const r = buildRepo(t);
  const m11 = r.ticket('run/11-a');
  const m13 = r.ticket('run/13-c');
  const m14 = r.ticket('run/14-d');
  r.push();
  const ci = fakeCi({ [m11]: ['success'], [m13]: ['skipped', 'neutral'], [m14]: ['failure'] });
  const j = earliestRed(r, { tickets: [T11, T13, T14] }, ci.gh).json;
  assert.equal(j.earliestRed, m14);
  assert.deepEqual(j.lowerBound, { sha: m11, kind: 'green' });
  assert.deepEqual(j.tickets, ['#13', '#14']);
});

test('earliest-red: a red that came from a host commit and a base sync maps to no ticket', (t) => {
  const r = buildRepo(t);
  const m11 = r.ticket('run/11-a');
  const simplify = r.host('refactor: simplify run/line');
  r.git('switch', '-q', 'main');
  r.host('main moves');
  r.git('switch', '-q', 'line');
  r.git('merge', '-q', '--no-edit', 'main');
  const sync = r.git('rev-parse', 'HEAD');
  r.push();
  const ci = fakeCi({ [m11]: ['success'], [simplify]: ['failure'], [sync]: ['failure'] });
  const j = earliestRed(r, { tickets: [T11] }, ci.gh).json;
  assert.equal(j.earliestRed, simplify);
  assert.deepEqual(j.lowerBound, { sha: m11, kind: 'green' });
  assert.deepEqual(j.tickets, []);
  assert.equal(j.unmatched, true);
  assert.deepEqual(j.merges, []);

  // The base sync is a merge, but not a ticket's: with the red on it, still no ticket.
  const later = earliestRed(r, { tickets: [T11] }, fakeCi({ [simplify]: ['success'], [sync]: ['failure'] }).gh).json;
  assert.equal(later.earliestRed, sync);
  assert.deepEqual(later.tickets, []);
  assert.equal(later.unmatched, true);
  assert.deepEqual(later.merges, [{ sha: sync, subject: "Merge branch 'main' into line", tickets: [], matchedBy: null }]);
});

test("earliest-red: a `-ci` merge maps to the ticket whose branch it fixes", (t) => {
  const r = buildRepo(t);
  const m11 = r.ticket('run/11-a');
  const fix = r.ticket('run/11-a-ci');
  r.push();
  const j = earliestRed(r, { tickets: [T11] }, fakeCi({ [m11]: ['success'], [fix]: ['failure'] }).gh).json;
  assert.equal(j.earliestRed, fix);
  assert.deepEqual(j.tickets, ['#11']);
  assert.deepEqual(j.merges, [{ sha: fix, subject: "Merge branch 'run/11-a-ci' into line", tickets: ['#11'], matchedBy: 'branch' }]);
});

test('earliest-red: a ticket with recorded merge SHAs is matched by SHA only, never by a subject', (t) => {
  const r = buildRepo(t);
  const m11 = r.ticket('run/11-a');
  const fix = r.ticket('run/11-a-ci');
  const m13 = r.ticket('run/13-c', 'Integrate c');
  r.push();
  const ci = () => fakeCi({ [m11]: ['success'], [fix]: ['failure'], [m13]: ['failure'] }).gh;

  // #11 recorded only its first merge: the -ci merge's subject no longer claims it.
  const recorded = earliestRed(r, { tickets: [{ ...T11, merges: [m11] }] }, ci()).json;
  assert.equal(recorded.earliestRed, fix);
  assert.deepEqual(recorded.tickets, []);
  assert.equal(recorded.unmatched, true);
  assert.deepEqual(recorded.merges.map((m) => [m.sha, m.matchedBy]), [[fix, null]]);

  // A recorded SHA needs no subject: `Integrate c` is #13's because the ledger says so (abbreviated SHAs resolve).
  const bySha = earliestRed(r, { tickets: [{ id: '#13', merges: [m13.slice(0, 12)] }] }, fakeCi({ [fix]: ['success'], [m13]: ['failure'] }).gh).json;
  assert.deepEqual(bySha.tickets, ['#13']);
  assert.deepEqual(bySha.merges, [{ sha: m13, subject: 'Integrate c', tickets: ['#13'], matchedBy: 'sha' }]);
});

test('earliest-red: with no earlier green on a line with CI, the lower bound is the merge base', (t) => {
  const r = buildRepo(t);
  const m11 = r.ticket('run/11-a');
  const m13 = r.ticket('run/13-c');
  r.push();
  const j = earliestRed(r, { tickets: [T11, T13] }, fakeCi({ [m11]: ['failure'], [m13]: ['failure'] }).gh).json;
  assert.equal(j.earliestRed, m11);
  assert.deepEqual(j.lowerBound, { sha: r.git('merge-base', 'origin/line', 'main'), kind: 'merge-base' });
  assert.equal(j.lowerBound.sha, r.base);
  assert.deepEqual(j.tickets, ['#11']);
});

test('earliest-red: a line on local verification uses only the ledger records, walks the local branch and never calls gh', (t) => {
  const r = buildRepo(t);
  const m11 = r.ticket('run/11-a');
  const m13 = r.ticket('run/13-c');
  const m14 = r.ticket('run/14-d');
  // No r.push(): there is no origin/line at all.
  // The script treats a throwing `gh` as a failed query, so a sentinel that throws proves nothing: count the calls.
  const ghCalls = [];
  const noGh = (args) => {
    ghCalls.push(args);
    return '[]';
  };
  const tickets = [T11, T13, T14];

  const local = [`local: line ${m11} green no-origin`, `local: line ${m14} red no-origin`, `local: other-line ${m13} red no-origin`];
  const res = earliestRed(r, { ci: false, tickets, local }, noGh);
  assert.equal(res.code, 0, res.err);
  const j = res.json;
  assert.deepEqual(j.line, { ref: 'line', sha: m14 });
  assert.equal(j.ci, 'not-read');
  assert.equal(j.earliestRed, m14);
  assert.deepEqual(j.lowerBound, { sha: m11, kind: 'green' });
  assert.deepEqual(j.tickets, ['#13', '#14']);
  assert.deepEqual(j.verdicts, [
    { sha: m14, verdict: 'red', source: 'local' },
    { sha: m11, verdict: 'green', source: 'local' },
  ]);

  // No earlier green record: the lower bound is the merge base.
  const bare = earliestRed(r, { ci: false, tickets, local: [`local: line ${m13} red ci-not-covering`] }, noGh).json;
  assert.equal(bare.earliestRed, m13);
  assert.deepEqual(bare.lowerBound, { sha: r.git('merge-base', 'line', 'main'), kind: 'merge-base' });
  assert.deepEqual(bare.tickets, ['#11', '#13']);
  assert.deepEqual(ghCalls, [], 'gh is never called on a line on local verification');
});

test('earliest-red: the first local record of a SHA wins; a later one does not overwrite it', (t) => {
  const r = buildRepo(t);
  const m11 = r.ticket('run/11-a');
  const local = [`local: line ${m11} red no-origin`, `local: line ${m11} green no-origin`];
  const j = earliestRed(r, { ci: false, tickets: [T11], local }, () => '[]').json;
  assert.equal(j.earliestRed, m11);
  assert.equal(j.verdicts[0].verdict, 'red');
  assert.deepEqual(j.verdicts, [{ sha: m11, verdict: 'red', source: 'local' }]);
});

test('earliest-red: a CI verdict stands over a local record of the same SHA', (t) => {
  const r = buildRepo(t);
  const m11 = r.ticket('run/11-a');
  const m13 = r.ticket('run/13-c');
  r.push();
  const ci = fakeCi({ [m11]: ['success'], [m13]: ['failure'] });
  const j = earliestRed(r, { tickets: [T11, T13], local: [`local: line ${m13} green no-verdict`] }, ci.gh).json;
  assert.equal(j.earliestRed, m13);
  assert.deepEqual(j.verdicts[0], { sha: m13, verdict: 'red', source: 'ci' });
  assert.deepEqual(j.lowerBound, { sha: m11, kind: 'green' });
});

test('earliest-red: after a base sync, the merge-base lower bound is the synced base tip, not where the line was cut', (t) => {
  const r = buildRepo(t);
  const m11 = r.ticket('run/11-a');
  r.git('switch', '-q', 'main');
  const moved = r.host('main moves');
  r.git('switch', '-q', 'line');
  r.git('merge', '-q', '--no-edit', 'main');
  const m13 = r.ticket('run/13-c');
  r.push();
  const j = earliestRed(r, { tickets: [T11, T13] }, fakeCi({ [m11]: ['failure'], [m13]: ['failure'] }).gh).json;
  assert.equal(j.earliestRed, m11);
  assert.deepEqual(j.lowerBound, { sha: moved, kind: 'merge-base' });
  assert.notEqual(j.lowerBound.sha, r.base);
  assert.deepEqual(j.tickets, ['#11']);
});

test('earliest-red: on a line with CI, a local record stands in for a SHA that has no CI verdict', (t) => {
  const r = buildRepo(t);
  const m11 = r.ticket('run/11-a');
  const m13 = r.ticket('run/13-c'); // CI never gave a verdict; verified locally: red
  const m14 = r.ticket('run/14-d');
  r.push();
  const ci = fakeCi({ [m11]: ['success'], [m14]: ['failure'] });
  const j = earliestRed(r, { tickets: [T11, T13, T14], local: [`local: line ${m13} red no-verdict`] }, ci.gh).json;
  assert.equal(j.earliestRed, m13);
  assert.deepEqual(j.lowerBound, { sha: m11, kind: 'green' });
  assert.deepEqual(j.tickets, ['#13']);
  assert.deepEqual(j.verdicts, [
    { sha: m14, verdict: 'red', source: 'ci' },
    { sha: m13, verdict: 'red', source: 'local' },
    { sha: m11, verdict: 'green', source: 'ci' },
  ]);

  // A local green record is a lower bound just like a CI green.
  const green = earliestRed(r, { tickets: [T11, T13, T14], local: [`local: line ${m13} green no-verdict`] }, fakeCi({ [m14]: ['failure'] }).gh).json;
  assert.equal(green.earliestRed, m14);
  assert.deepEqual(green.lowerBound, { sha: m13, kind: 'green' });
  assert.deepEqual(green.tickets, ['#14']);
});

test('earliest-red: when gh fails, the output says so and only the local records are judged', (t) => {
  const r = buildRepo(t);
  const m11 = r.ticket('run/11-a');
  const m13 = r.ticket('run/13-c');
  r.push();
  const down = ghFailure('error connecting to api.github.com\n');

  const withRecords = earliestRed(r, { tickets: [T11, T13], local: [`local: line ${m13} red no-verdict`] }, down);
  assert.equal(withRecords.code, 0);
  assert.equal(withRecords.json.ci, 'query-failed');
  assert.equal(withRecords.json.error, 'error connecting to api.github.com');
  assert.equal(withRecords.json.earliestRed, m13);
  assert.deepEqual(withRecords.json.lowerBound, { sha: r.base, kind: 'merge-base' });
  assert.deepEqual(withRecords.json.tickets, ['#11', '#13']);

  const without = earliestRed(r, { tickets: [T11, T13] }, down);
  assert.equal(without.code, 0);
  assert.equal(without.json.ci, 'query-failed');
  assert.equal(without.json.earliestRed, null);
  assert.equal(without.json.lowerBound, null);
  assert.deepEqual(without.json.tickets, []);
  assert.equal(without.json.unmatched, false);
});

test('earliest-red: null when the newest SHA with a verdict is green, or when no SHA has one', (t) => {
  const r = buildRepo(t);
  const m11 = r.ticket('run/11-a');
  const m13 = r.ticket('run/13-c');
  const m14 = r.ticket('run/14-d');
  r.push();
  const empty = { earliestRed: null, lowerBound: null, tickets: [], unmatched: false, merges: [] };
  const pick = (j) => ({ earliestRed: j.earliestRed, lowerBound: j.lowerBound, tickets: j.tickets, unmatched: j.unmatched, merges: j.merges });

  // An older red was fixed: the newest verdict is green, the SHA after it is still running.
  const fixed = earliestRed(r, { tickets: [T11, T13, T14] }, fakeCi({ [m11]: ['failure'], [m13]: ['success'], [m14]: 'running' }).gh).json;
  assert.deepEqual(pick(fixed), empty);

  const none = earliestRed(r, { tickets: [T11, T13, T14] }, fakeCi({ [m13]: ['cancelled'], [m14]: 'running' }).gh).json;
  assert.deepEqual(pick(none), empty);
  assert.deepEqual(none.verdicts.map((v) => v.verdict), ['running', 'cancelled']);

  assert.deepEqual(pick(earliestRed(r, { tickets: [T11] }, fakeCi({}).gh).json), empty);
});

test('earliest-red: bad plans exit 2; an unknown ref exits 1', (t) => {
  const r = buildRepo(t);
  r.push();
  const gh = fakeCi({}).gh;
  const cases = [
    [{ worktree: '' }, /worktree is a non-empty string/],
    [{ line: 7 }, /line is a non-empty string/],
    [{ base: undefined }, /base is a non-empty string/],
    [{ ci: 'yes' }, /ci is true or false/],
    [{ repo: '' }, /repo is a non-empty string/],
    [{ local: 'local: line' }, /local is an array of ledger lines/],
    [{ local: ['local: line abc red no-origin'] }, /local\[0\] is not "local: /],
    [{ local: [`local: line ${SHA} amber no-origin`] }, /local\[0\] is not "local: /],
    [{ tickets: {} }, /tickets is an array/],
    [{ tickets: [{ branch: 'b' }] }, /has no id/],
    [{ tickets: [{ id: '#1' }, { id: '#1' }] }, /#1 listed twice/],
    [{ tickets: [{ id: '#1', branch: '' }] }, /#1\): branch is a non-empty string/],
    [{ tickets: [{ id: '#1', merges: 'abc' }] }, /merges is an array of SHAs/],
  ];
  for (const [plan, message] of cases) {
    const res = earliestRed(r, plan, gh);
    assert.equal(res.code, 2, JSON.stringify(plan));
    assert.match(res.err, message);
  }
  writeFileSync(join(r.dir, 'bad.json'), '{');
  assert.equal(main(['earliest-red', join(r.dir, 'bad.json')], { ...defaultDeps(), gh }).code, 2);

  const res = earliestRed(r, { base: 'no-such-ref' }, gh);
  assert.equal(res.code, 1);
  assert.match(res.err, /^ci: /);
  assert.equal(earliestRed(r, { ci: false, line: 'no-such-branch' }, gh).code, 1);
});
