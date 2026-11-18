// node --test scripts/deploy-on-merge.test.mjs
// hooks/deploy-on-merge.mjs: whether a merge deploys to production right away, read from workflow text
// fixtures and stubbed commands (no network, no real repository).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeWorkflows, matchesBranch, mergeDeploys, parseYaml } from '../hooks/deploy-on-merge.mjs';

const wf = (name, text) => ({ name, text });

const PAGES = `
name: Pages
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/deploy-pages@v4
`;

const ENVIRONMENT = `
on:
  push:
    branches:
      - main
      - 'release/**'
jobs:
  ship:
    environment:
      name: production
      url: https://example.com
    runs-on: ubuntu-latest
    steps:
      - run: ./ship.sh
`;

const RELEASE_PLEASE = `
on:
  push:
    branches: [main]
jobs:
  release-please:
    runs-on: ubuntu-latest
    outputs:
      release_created: \${{ steps.release.outputs.release_created }}
    steps:
      - uses: googleapis/release-please-action@v4
        id: release
  publish:
    needs: release-please
    if: \${{ needs.release-please.outputs.release_created }}
    environment: production
    runs-on: ubuntu-latest
    steps:
      - run: npm publish
  inline:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@v4
        id: rp
      - if: \${{ steps.rp.outputs.release_created }}
        run: |
          npm ci
          npm publish --provenance
`;

const CHANGESETS = `
on:
  push:
    branches: [main]
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: changesets/action@v1
        id: changesets
        with:
          publish: pnpm release
      - name: Tag docker image
        if: steps.changesets.outputs.published == 'true'
        run: gh release create v1
`;

const CI_ONLY = `
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm test # npm publish appears only in this comment
`;

test('a minimal YAML reader covers the shapes workflows use', () => {
  const doc = parseYaml(`
"on":
  push: { branches: [main, "dev"] }
jobs:
  a:
    steps:
      - name: x
        run: >-
          echo "a: b"
          # not a comment
      -
        uses: x/y@v1
`);
  assert.deepEqual(doc.on, { push: { branches: ['main', 'dev'] } });
  assert.equal(doc.jobs.a.steps[0].name, 'x');
  assert.match(doc.jobs.a.steps[0].run, /echo "a: b"\n# not a comment/);
  assert.equal(doc.jobs.a.steps[1].uses, 'x/y@v1');
});

test('branch filters follow GitHub glob rules', () => {
  assert.ok(matchesBranch(['main'], 'main'));
  assert.ok(matchesBranch(['release/**'], 'release/a/b'));
  assert.ok(!matchesBranch(['release/*'], 'release/a/b'));
  assert.ok(!matchesBranch(['**', '!main'], 'main'));
  assert.ok(matchesBranch(['**', '!main', 'main'], 'main'));
});

test('known deploy actions and production environments are found', () => {
  const pages = analyzeWorkflows([wf('pages.yml', PAGES)], 'main');
  assert.equal(pages.deploys, true);
  assert.match(pages.findings[0], /pages\.yml 的 job deploy（uses: actions\/deploy-pages）/);
  assert.equal(analyzeWorkflows([wf('pages.yml', PAGES)], 'develop').deploys, false, 'not triggered on another branch');
  const env = analyzeWorkflows([wf('ship.yml', ENVIRONMENT)], 'release/2025/1');
  assert.equal(env.deploys, true);
  assert.match(env.findings[0], /environment: production/);
});

test('run signals: vercel --prod, fly deploy, publish, kubectl with prod', () => {
  const run = (script, on = 'push') => analyzeWorkflows([wf('w.yml', `on: ${on}\njobs:\n  j:\n    steps:\n      - run: ${script}\n`)], 'main').deploys;
  assert.equal(run('vercel deploy --prod --token x'), true);
  assert.equal(run('vercel deploy'), false);
  assert.equal(run('flyctl deploy --remote-only'), true);
  assert.equal(run('cargo publish'), true);
  assert.equal(run('gh release create v1'), true);
  assert.equal(run('kubectl apply -f k8s/ --context prod'), true);
  assert.equal(run('kubectl apply -f k8s/ --context staging'), false);
  assert.equal(run('npm publish', '[pull_request]'), false);
  assert.equal(run('npm publish', '\n  push:\n    tags: ["v*"]'), false, 'a tag-only push trigger');
  assert.equal(run('npm publish', '\n  push:\n    branches-ignore: [main]'), false);
});

test('release-please and changesets gating means no immediate deploy', () => {
  const rp = analyzeWorkflows([wf('release.yml', RELEASE_PLEASE)], 'main');
  assert.equal(rp.deploys, false);
  assert.equal(rp.gated.length, 3, rp.gated.join('\n'));
  const cs = analyzeWorkflows([wf('release.yml', CHANGESETS)], 'main');
  assert.equal(cs.deploys, false);
  assert.equal(cs.gated.length, 1);
  assert.equal(analyzeWorkflows([wf('ci.yml', CI_ONLY)], 'main').deploys, false);
  // A tag condition is not an ordinary merge either.
  const tagged = `on: push\njobs:\n  j:\n    if: startsWith(github.ref, 'refs/tags/')\n    steps:\n      - run: npm publish\n`;
  assert.equal(analyzeWorkflows([wf('t.yml', tagged)], 'main').deploys, false);
});

// A stub for `run`: commands keyed by their joined argv, anything else fails.
function stub(responses) {
  const calls = [];
  const run = (cmd, args) => {
    const key = [cmd, ...args.filter((a, k) => !(args[k - 1] === '-C' || a === '-C'))].join(' ');
    calls.push(key);
    const hit = Object.entries(responses).find(([pattern]) => key.startsWith(pattern));
    return hit ? { ok: hit[1] !== false, stdout: hit[1] === false ? '' : hit[1] } : { ok: false, stdout: '' };
  };
  return { run, calls };
}
const noFs = { exists: () => false, list: () => [], read: () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); } };
const repo = (files, extra = {}) =>
  stub({
    'git rev-parse --show-toplevel': '/repo\n',
    'git remote get-url origin': 'https://github.com/o/r.git\n',
    'gh pr view': 'main\n',
    'git rev-parse --verify -q origin/main^{commit}': 'abc\n',
    'git ls-tree --name-only origin/main .github/workflows/': files.map((f) => `.github/workflows/${f.name}`).join('\n') + '\n',
    ...Object.fromEntries(files.map((f) => [`git show origin/main:.github/workflows/${f.name}`, f.text])),
    ...extra,
  });

test('mergeDeploys reads the PR base and the workflows on origin/<base>', () => {
  const { run, calls } = repo([wf('pages.yml', PAGES), wf('ci.yml', CI_ONLY)]);
  const result = mergeDeploys({ kind: 'pr', arg: '12', repo: '' }, { cwd: '/repo', env: {}, run, fs: noFs });
  assert.equal(result.deploys, true);
  assert.match(result.reason, /合併到 main 會觸發：pages\.yml/);
  assert.ok(calls.includes('gh pr view 12 --json baseRefName --jq .baseRefName'), calls.join('\n'));

  const quiet = repo([wf('release.yml', RELEASE_PLEASE)]);
  const gated = mergeDeploys({ kind: 'push', branch: 'main' }, { cwd: '/repo', env: {}, run: quiet.run, fs: noFs });
  assert.equal(gated.deploys, false);
  assert.match(gated.reason, /受 release 工具或 tag 控制/);
});

test('an explicit setting overrides detection', () => {
  const { run } = repo([wf('pages.yml', PAGES)]);
  assert.equal(mergeDeploys({ kind: 'pr', arg: '1' }, { env: { SORRY_MATT_MERGE_DEPLOYS: 'no' }, run, fs: noFs }).deploys, false);
  assert.equal(mergeDeploys({ kind: 'unknown' }, { env: { SORRY_MATT_MERGE_DEPLOYS: 'yes' }, run, fs: noFs }).deploys, true);
  const config = (value) => ({ ...noFs, read: () => JSON.stringify({ mergeDeploysProduction: value }) });
  const fromFile = mergeDeploys({ kind: 'pr', arg: '1' }, { env: {}, run, fs: config(false) });
  assert.deepEqual(fromFile, { deploys: false, reason: '依 .claude/sorry-matt.json 的設定' });
  assert.equal(mergeDeploys({ kind: 'push', branch: 'main' }, { env: {}, run: repo([]).run, fs: config(true) }).deploys, true);
  // The environment wins over the file.
  assert.equal(mergeDeploys({ kind: 'pr', arg: '1' }, { env: { SORRY_MATT_MERGE_DEPLOYS: 'yes' }, run, fs: config(false) }).deploys, true);
});

test('a failed or ambiguous lookup cannot tell, so the guard asks', () => {
  const failingGh = repo([wf('ci.yml', CI_ONLY)], { 'gh pr view': false });
  const result = mergeDeploys({ kind: 'pr', arg: '12' }, { env: {}, run: failingGh.run, fs: noFs });
  assert.equal(result.deploys, null);
  assert.match(result.reason, /查不到 PR 12 的目標分支/);
  assert.equal(mergeDeploys({ kind: 'unknown', why: 'GraphQL 合併呼叫看不出目標分支' }, { env: {}, run: failingGh.run, fs: noFs }).deploys, null);
  const otherRepo = mergeDeploys({ kind: 'pr', arg: '3', repo: 'x/y' }, { env: {}, run: repo([]).run, fs: noFs });
  assert.equal(otherRepo.deploys, null);
  const notRepo = mergeDeploys({ kind: 'push', branch: 'main' }, { env: {}, run: stub({}).run, fs: noFs });
  assert.equal(notRepo.deploys, null);
  const unreadable = repo([], { 'git ls-tree --name-only origin/main .github/workflows/': false });
  assert.equal(mergeDeploys({ kind: 'push', branch: 'main' }, { env: {}, run: unreadable.run, fs: noFs }).deploys, null);
});

test('without origin/<base> the working tree is read', () => {
  const { run } = stub({ 'git rev-parse --show-toplevel': '/repo\n' });
  const fs = { exists: () => true, list: () => ['pages.yaml', 'notes.md'], read: (p) => (p.endsWith('sorry-matt.json') ? '{}' : PAGES) };
  const result = mergeDeploys({ kind: 'push', branch: 'main' }, { env: {}, run, fs });
  assert.equal(result.deploys, true);
  assert.match(result.reason, /讀自 工作樹/);
  assert.equal(mergeDeploys({ kind: 'push', branch: 'main' }, { env: {}, run, fs: noFs }).deploys, false, 'no workflows at all');
});
