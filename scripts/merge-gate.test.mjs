// node --test scripts/merge-gate.test.mjs
// Drives merge-gate.mjs through main(). Every GitHub answer is a fixture behind the `gh` seam, shaped like GitHub's
// documented responses (GraphQL `repository.mergeQueue`, the rules and branch protection REST endpoints after gh's
// `--jq`); nothing calls the real GitHub. `git grep` runs for real against a temp repository whose
// `refs/remotes/origin/main` holds the workflows.
import './git-env.mjs'; // first: the git processes below skip automatic maintenance
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { main, defaultDeps } from '../src/skills/get-to-work/scripts/merge-gate.mjs';

/** A repo whose origin/main has the given workflow files ({ name: text }); no origin/main when `workflows` is null. */
function repo(t, workflows) {
  const dir = mkdtempSync(join(tmpdir(), 'sorry-matt-merge-gate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'test');
  writeFileSync(join(dir, 'README.md'), 'x\n');
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
  for (const [f, text] of Object.entries(workflows ?? {})) writeFileSync(join(dir, '.github', 'workflows', f), text);
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  if (workflows !== null) git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  // The working tree differs from origin/main, so a grep of the working tree would answer differently.
  writeFileSync(join(dir, '.github', 'workflows', 'local-only.yml'), 'on: merge_group\n');
  return dir;
}

const fail = (stderr) => {
  const e = new Error('Command failed: gh');
  e.status = 1;
  e.stderr = stderr;
  throw e;
};

const QUEUE_ON = JSON.stringify({ data: { repository: { mergeQueue: { url: 'https://github.com/o/r/queue/main' } } } });
const QUEUE_OFF = JSON.stringify({ data: { repository: { mergeQueue: null } } });

/**
 * Runs the gate with `answers` standing in for gh: { graphql, rules, protection }, each a string to print or a
 * function that throws. Records every gh call.
 */
function gateOf(dir, answers, argv = ['--repo', 'o/r', '--base', 'main']) {
  const calls = [];
  const gh = (args, cwd) => {
    calls.push({ args, cwd });
    const key = args[1] === 'graphql' ? 'graphql' : args[1].includes('/rules/') ? 'rules' : 'protection';
    const a = answers[key];
    if (a === undefined) throw new Error(`unexpected gh call: ${args.join(' ')}`);
    return typeof a === 'function' ? a() : a;
  };
  const r = main(argv, { ...defaultDeps(), cwd: dir, gh });
  return { ...r, json: r.out ? JSON.parse(r.out) : null, calls };
}

test('no merge queue: decision merge, nothing else is queried', (t) => {
  const dir = repo(t, {});
  const r = gateOf(dir, { graphql: QUEUE_OFF });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.format, 'sorry-matt/merge-gate@1');
  assert.equal(r.json.decision, 'merge');
  assert.equal(r.json.reason, 'no-queue');
  assert.deepEqual(r.json.queue, { enabled: false, url: null });
  assert.equal(r.json.workflows, null);
  assert.equal(r.json.failed, null);
  assert.equal(r.calls.length, 1);
  // The query is the documented one, with owner, name and branch as variables.
  const args = r.calls[0].args;
  assert.deepEqual(args.slice(0, 2), ['api', 'graphql']);
  assert.ok(args.includes('owner=o') && args.includes('name=r') && args.includes('branch=main'));
  assert.ok(args.some((a) => a.startsWith('query=') && a.includes('mergeQueue(branch:$branch){url}')));
});

test('queue on and a workflow on origin/<base> names merge_group: decision queue, no rules queried', (t) => {
  const dir = repo(t, { 'ci.yml': 'on:\n  pull_request:\n  merge_group:\n', 'other.yml': 'on: push\n' });
  const r = gateOf(dir, { graphql: QUEUE_ON });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.decision, 'queue');
  assert.equal(r.json.reason, 'merge-group-trigger');
  assert.deepEqual(r.json.queue, { enabled: true, url: 'https://github.com/o/r/queue/main' });
  assert.deepEqual(r.json.workflows, ['.github/workflows/ci.yml']);
  assert.equal(r.calls.length, 1);
});

test('queue on, no merge_group workflow, no required checks (rules [] and protection null): decision queue', (t) => {
  const dir = repo(t, { 'ci.yml': 'on: pull_request\n' });
  const r = gateOf(dir, { graphql: QUEUE_ON, rules: '[]\n', protection: 'null\n' });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.decision, 'queue');
  assert.equal(r.json.reason, 'no-required-checks');
  assert.deepEqual(r.json.workflows, []);
  assert.deepEqual(r.json.requiredChecks, []);
  const rules = r.calls.find((c) => c.args[1].includes('/rules/')).args;
  assert.deepEqual(rules.slice(0, 2), ['api', 'repos/o/r/rules/branches/main']);
  const protection = r.calls.find((c) => c.args[1] === 'repos/o/r/branches/main').args;
  assert.equal(protection[protection.indexOf('--jq') + 1], '.protection.required_status_checks.contexts');
});

test('queue on, no merge_group workflow, required checks: decision human with the union of both sources', (t) => {
  const dir = repo(t, {});
  const r = gateOf(dir, { graphql: QUEUE_ON, rules: '["build","lint"]', protection: '["lint","external/ci"]' });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.decision, 'human');
  assert.equal(r.json.reason, 'required-checks-without-trigger');
  assert.deepEqual(r.json.requiredChecks, ['build', 'lint', 'external/ci']);
  assert.equal(r.json.failed, null);
});

test('required checks from either source alone are enough to stop it', (t) => {
  const dir = repo(t, {});
  assert.equal(gateOf(dir, { graphql: QUEUE_ON, rules: '["build"]', protection: 'null' }).json.decision, 'human');
  assert.equal(gateOf(dir, { graphql: QUEUE_ON, rules: '[]', protection: '["build"]' }).json.decision, 'human');
});

test('a failed merge queue query decides human: gh non-zero, GraphQL errors, not JSON, no repository', (t) => {
  const dir = repo(t, {});
  const cases = [
    [() => fail('HTTP 401: Bad credentials'), /Bad credentials/],
    [JSON.stringify({ data: { repository: null }, errors: [{ type: 'NOT_FOUND', message: "Could not resolve to a Repository with the name 'o/r'." }] }), /Could not resolve/],
    ['<html>', /not JSON/],
    [JSON.stringify({ data: { repository: null } }), /no data\.repository/],
  ];
  for (const [answer, re] of cases) {
    const r = gateOf(dir, { graphql: answer });
    assert.equal(r.code, 0, r.err);
    assert.equal(r.json.decision, 'human');
    assert.equal(r.json.reason, 'query-failed');
    assert.equal(r.json.queue, null);
    assert.equal(r.json.failed.query, 'merge-queue');
    assert.match(r.json.failed.error, re);
    assert.equal(r.calls.length, 1, 'stops at the failed query');
  }
});

test('a failed git grep (exit above 1: origin/<base> missing) decides human', (t) => {
  const dir = repo(t, null);
  const r = gateOf(dir, { graphql: QUEUE_ON });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.decision, 'human');
  assert.equal(r.json.failed.query, 'workflows');
  assert.deepEqual(r.json.queue, { enabled: true, url: 'https://github.com/o/r/queue/main' });
  assert.equal(r.json.workflows, null);
});

test('a failed rules or protection query decides human, whatever the other says', (t) => {
  const dir = repo(t, {});
  const rulesFail = gateOf(dir, { graphql: QUEUE_ON, rules: () => fail('HTTP 404: Not Found'), protection: '[]' });
  assert.equal(rulesFail.json.decision, 'human');
  assert.deepEqual(rulesFail.json.failed, { query: 'rules', error: 'HTTP 404: Not Found' });
  assert.equal(rulesFail.json.requiredChecks, null);
  const protectionFail = gateOf(dir, { graphql: QUEUE_ON, rules: '[]', protection: () => fail('HTTP 403: Forbidden') });
  assert.deepEqual(protectionFail.json.failed, { query: 'protection', error: 'HTTP 403: Forbidden' });
  const garbage = gateOf(dir, { graphql: QUEUE_ON, rules: '[]', protection: '{"contexts":[]}' });
  assert.equal(garbage.json.failed.query, 'protection');
  const numbers = gateOf(dir, { graphql: QUEUE_ON, rules: '[1]', protection: '[]' });
  assert.equal(numbers.json.failed.query, 'rules');
});

test('--worktree is where git and gh run; bad arguments exit 2 with nothing on stdout', (t) => {
  const dir = repo(t, { 'ci.yml': 'on: [merge_group]\n' });
  const r = gateOf(process.cwd(), { graphql: QUEUE_ON }, ['--repo', 'o/r', '--base', 'main', '--worktree', dir]);
  assert.equal(r.json.decision, 'queue');
  assert.equal(r.calls[0].cwd, dir);
  for (const argv of [[], ['--repo', 'o/r'], ['--base', 'main'], ['--repo', 'nope', '--base', 'main'], ['--repo', 'o/r', '--base'], ['--repo', 'o/r', '--base', 'main', 'extra']]) {
    const bad = main(argv, { ...defaultDeps(), gh: () => fail('never called') });
    assert.equal(bad.code, 2, `${argv.join(' ')}: ${bad.err}`);
    assert.equal(bad.out, '');
  }
});
