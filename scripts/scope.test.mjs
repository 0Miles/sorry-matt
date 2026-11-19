// node --test scripts/scope.test.mjs
// Real git repositories in temp dirs. Expected scopes come from proposal 7 of issue #80 (full suite when CI does not
// cover the line's integration branch or there is no origin; affected scope otherwise); expected commands and test
// candidates come from the contract text and the test files each fixture writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main, defaultDeps } from '../src/skills/prove-it/scripts/scope.mjs';

const SCRIPT = fileURLToPath(new URL('../src/skills/prove-it/scripts/scope.mjs', import.meta.url));

const tempDir = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'scope-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const gitIn = (dir) => (...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...args], { cwd: dir, encoding: 'utf8' });
const put = (dir, files) => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
};

function repo(t, base, change) {
  const dir = tempDir(t);
  const git = gitIn(dir);
  git('init', '-q', '-b', 'main');
  put(dir, { 'README.md': 'readme\n', ...base });
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  git('checkout', '-q', '-b', 'ticket');
  put(dir, change);
  git('add', '-A');
  git('commit', '-q', '--allow-empty', '-m', 'ticket');
  return { dir, git };
}

const scope = (r, ...extra) => {
  const out = main(['--base', 'main', ...extra], defaultDeps(r.dir));
  assert.equal(out.code, 0, out.err);
  return JSON.parse(out.out);
};

const CONTRACT = [
  '# Commands',
  '',
  '## Full checks',
  '',
  'Run them in order:',
  '',
  '```bash',
  '# unit tests',
  'npm test',
  '',
  'npm run lint',
  '```',
  '',
  '## Targeted checks',
  '',
  '- one file: `npx vitest run <file>`',
  '',
  '## Coverage',
  '',
  'none',
  '',
].join('\n');

test('a line CI does not cover runs the full suite, with the commands of the contract', (t) => {
  const r = repo(t, { 'docs/agents/commands.md': CONTRACT, 'src/a.js': 'a\n' }, { 'src/a.js': 'b\n' });
  const out = scope(r, '--ci', 'uncovered');
  assert.equal(out.format, 'sorry-matt/live-scope@1');
  assert.equal(out.ci, 'uncovered');
  assert.equal(out.ciSource, 'caller');
  assert.equal(out.scope, 'full');
  assert.equal(out.source, 'commands.md');
  assert.deepEqual(out.commands, ['npm test', 'npm run lint']);
  assert.equal(out.targeted, null);
});

test('a line without origin and without a contract runs the full suite, self-found', (t) => {
  const r = repo(t, { 'src/a.js': 'a\n' }, { 'src/a.js': 'b\n' });
  const out = scope(r, '--ci', 'no-origin');
  assert.equal(out.scope, 'full');
  assert.equal(out.source, 'self-found');
  assert.equal(out.commands, null);
});

test('a line CI covers runs the affected scope, from the Targeted checks of the contract', (t) => {
  const r = repo(t, { 'docs/agents/commands.md': CONTRACT, 'src/a.js': 'a\n' }, { 'src/a.js': 'b\n' });
  const out = scope(r, '--ci', 'covered');
  assert.equal(out.scope, 'affected');
  assert.equal(out.source, 'commands.md');
  assert.equal(out.targeted, '- one file: `npx vitest run <file>`');
  assert.equal(out.commands, null);
  assert.deepEqual(out.changed, ['src/a.js']);
});

test('Targeted checks that are none, or no contract, leave the affected scope to the reviewer (self-found)', (t) => {
  const none = CONTRACT.replace('- one file: `npx vitest run <file>`', 'none');
  const r = repo(t, { 'docs/agents/commands.md': none, 'src/a.js': 'a\n' }, { 'src/a.js': 'b\n' });
  const out = scope(r, '--ci', 'covered');
  assert.equal(out.scope, 'affected');
  assert.equal(out.source, 'self-found');
  assert.equal(out.targeted, null);
  const bare = repo(t, { 'src/a.js': 'a\n' }, { 'src/a.js': 'b\n' });
  assert.equal(scope(bare, '--ci', 'covered').source, 'self-found');
});

test('the contract is read on head: a ticket that adds it is read with it', (t) => {
  const r = repo(t, { 'src/a.js': 'a\n' }, { 'docs/agents/commands.md': CONTRACT });
  assert.deepEqual(scope(r, '--ci', 'uncovered').commands, ['npm test', 'npm run lint']);
});

test('without --ci, a repository without origin is no-origin and one with origin is covered', (t) => {
  const r = repo(t, { 'src/a.js': 'a\n' }, { 'src/a.js': 'b\n' });
  const without = scope(r);
  assert.equal(without.ci, 'no-origin');
  assert.equal(without.ciSource, 'origin-check');
  assert.equal(without.scope, 'full');
  r.git('remote', 'add', 'origin', 'https://example.invalid/repo.git');
  const withOrigin = scope(r);
  assert.equal(withOrigin.ci, 'covered');
  assert.equal(withOrigin.scope, 'affected');
});

test('test candidates: changed test files, and test files that name a changed source file', (t) => {
  const r = repo(
    t,
    {
      'src/lib/tier.js': 'export const a = 1;\n',
      'src/lib/other.js': 'export const o = 1;\n',
      'src/b.test.js': 'test("b", () => {});\n',
      'scripts/tier.test.mjs': "import { a } from '../src/lib/tier.js';\n",
      'test/import-stem.js': "const t = require('../src/lib/tier');\n",
      'tests/test_tier.py': 'from lib.tier import a\n',
      'pkg/TierTest.java': 'class TierTest { /* tier.js */ }\n',
      'test/unrelated.test.js': "import { o } from '../src/lib/other.js';\n",
      'test/frontier.test.js': "import { f } from './frontier.js'; // tierless\n",
      'docs/test/notes.md': 'tier.js is documented here\n',
    },
    { 'src/lib/tier.js': 'export const a = 2;\n', 'src/b.test.js': 'test("b2", () => {});\n', 'docs/guide.md': 'other.js\n' },
  );
  const out = scope(r, '--ci', 'covered');
  assert.deepEqual(out.tests, [
    { path: 'pkg/TierTest.java', reason: 'references', via: ['src/lib/tier.js'] },
    { path: 'scripts/tier.test.mjs', reason: 'references', via: ['src/lib/tier.js'] },
    { path: 'src/b.test.js', reason: 'changed', via: [] },
    { path: 'test/import-stem.js', reason: 'references', via: ['src/lib/tier.js'] },
    { path: 'tests/test_tier.py', reason: 'references', via: ['src/lib/tier.js'] },
  ]);
});

test('usage errors exit 2, an unresolvable ref exits 1, and the command line prints the same JSON', (t) => {
  const r = repo(t, { 'src/a.js': 'a\n' }, { 'src/a.js': 'b\n' });
  assert.equal(main(['--ci', 'covered'], defaultDeps(r.dir)).code, 2);
  assert.equal(main(['--base', 'main', '--ci', 'maybe'], defaultDeps(r.dir)).code, 2);
  assert.equal(main(['--base', 'main', '--scope', 'x'], defaultDeps(r.dir)).code, 2);
  assert.equal(main(['--base', 'no-such-ref'], defaultDeps(r.dir)).code, 1);
  const res = spawnSync(process.execPath, [SCRIPT, '--base', 'main', '--ci', 'uncovered'], { cwd: r.dir, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(JSON.parse(res.stdout).scope, 'full');
});
