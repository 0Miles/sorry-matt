// node --test scripts/verify.test.mjs
// Drives verify.mjs through main() against a real git repository and a real state file in a temp dir. The state is
// created and read back with state.mjs's own main, so the record format is checked against the script that owns
// it, not against a copy written here. Checks are small `node -e` commands that leave marks in files outside the
// repository, so the tests can tell which checks ran.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { main as verify, fullChecks } from '../src/skills/get-to-work/scripts/verify.mjs';
import { main as state } from '../src/skills/get-to-work/scripts/state.mjs';

const NOW = '2026-03-10T12:00:00Z';
const LINE = 'run-1/line-a';

const fwd = (p) => p.replace(/\\/g, '/');
/** A check that appends `x` to `file`: the file's length counts how often it ran. */
const mark = (file) => `node -e "require('fs').appendFileSync('${fwd(file)}','x')"`;
const fail = (code) => `node -e "process.exit(${code})"`;
const say = (text) => `node -e "console.log('${text}')"`;
const contract = (full) => `# Commands\n\n## Full checks\n\n${full}\n\n## Targeted checks\n\n\`\`\`bash\n${fail(9)}\n\`\`\`\n\n## Coverage\n\nnone\n`;
const fenced = (...cmds) => `\`\`\`bash\n${cmds.join('\n')}\n\`\`\``;

/** A repo on branch LINE with `files` committed, a state with LINE, and helpers. */
function setup(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'sorry-matt-verify-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('checkout', '-q', '-b', LINE);
  const commit = (entries) => {
    for (const [name, body] of Object.entries(entries)) {
      mkdirSync(join(repo, name, '..'), { recursive: true });
      writeFileSync(join(repo, name), body);
    }
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', 'c');
    return git('rev-parse', 'HEAD');
  };
  const sha = commit({ 'README.md': 'r\n', ...files });
  mkdirSync(join(dir, 'runs'));
  const statePath = join(dir, 'runs', 'run-1.state.json');
  for (const argv of [['init', statePath, '--run', 'run-1'], ['line', statePath, LINE]]) {
    const r = state([...argv, '--now', NOW]);
    assert.equal(r.code, 0, r.err);
  }
  const run = (...args) => verify([statePath, LINE, '--worktree', repo, '--now', NOW, ...args]);
  const ok = (...args) => {
    const r = run(...args);
    assert.equal(r.code, 0, r.err);
    return JSON.parse(r.out);
  };
  const stateText = () => readFileSync(statePath, 'utf8');
  const records = () => JSON.parse(state(['resume', statePath]).out).lines[LINE].local;
  const counter = (name) => join(dir, name);
  const count = (name) => (existsSync(counter(name)) ? readFileSync(counter(name), 'utf8').length : 0);
  return { dir, repo, git, commit, sha, statePath, run, ok, stateText, records, counter, count };
}

test('green: every Full checks command exits 0; the record is written and the output is logged', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sorry-matt-verify-marks-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const a = join(dir, 'a');
  const r = setup(t, { 'docs/agents/commands.md': contract(fenced(say('hello-check'), '# a comment', '', mark(a))) });
  const out = r.ok('--reason', 'no-origin');
  assert.equal(out.format, 'sorry-matt/verify@1');
  assert.deepEqual([out.result, out.reason, out.reused, out.source, out.sha], ['green', 'no-origin', false, 'commands.md', r.sha]);
  assert.deepEqual(out.checks.map((c) => c.exit), [0, 0]);
  assert.deepEqual(out.skipped, []);
  assert.equal(readFileSync(a, 'utf8'), 'x', 'the second check ran once');
  assert.deepEqual(r.records(), [`local: ${LINE} ${r.sha} green no-origin`], 'state.mjs renders the record');
  assert.equal(out.line, r.records()[0]);
  assert.equal(out.log, join(r.dir, 'runs', 'run-1', 'verify', `line-a-${r.sha}.log`));
  const log = readFileSync(out.log, 'utf8');
  assert.match(log, /hello-check/);
  assert.match(log, /exit 0/);
});

test('red: the first failing check makes it red, the rest are skipped, and the failure output is logged', (t) => {
  const r = setup(t, {});
  r.commit({ 'docs/agents/commands.md': contract(fenced(say('before-fail'), fail(3), mark(join(r.dir, 'after')))) });
  const sha = r.git('rev-parse', 'HEAD');
  const out = r.ok('--reason', 'ci-not-covering');
  assert.deepEqual([out.result, out.sha], ['red', sha]);
  assert.deepEqual(out.checks.map((c) => c.exit), [0, 3]);
  assert.equal(out.skipped.length, 1);
  assert.equal(r.count('after'), 0, 'a check after the failure does not run');
  assert.deepEqual(r.records(), [`local: ${LINE} ${sha} red ci-not-covering`]);
  assert.match(readFileSync(out.log, 'utf8'), /before-fail[\s\S]*exit 3/);
});

test('same SHA: a recorded SHA is never run again, even with the worktree elsewhere', (t) => {
  const r = setup(t, {});
  r.commit({ 'docs/agents/commands.md': contract(fenced(mark(join(r.dir, 'runs-count')))) });
  const sha = r.git('rev-parse', 'HEAD');
  const first = r.ok('--reason', 'no-verdict');
  assert.equal(r.count('runs-count'), 1);
  const before = r.stateText();
  const again = r.ok('--reason', 'no-origin');
  assert.equal(r.count('runs-count'), 1, 'not run again');
  assert.deepEqual([again.reused, again.result, again.reason, again.line], [true, 'green', 'no-verdict', first.line], 'the first record is printed as it is');
  assert.equal(r.stateText(), before, 'the state is unchanged');
  r.commit({ 'other.txt': 'o\n' });
  const pinned = r.ok('--reason', 'no-verdict', '--sha', sha);
  assert.deepEqual([pinned.reused, pinned.sha], [true, sha], 'the worktree is not consulted for a recorded SHA');
  assert.equal(r.count('runs-count'), 1);
});

test('contract missing: exit 4 asks the host to find the checks; --self-found then runs them', (t) => {
  const r = setup(t, {});
  const before = r.stateText();
  const res = r.run('--reason', 'no-origin');
  assert.equal(res.code, 4, res.err);
  assert.deepEqual(JSON.parse(res.out), { format: 'sorry-matt/verify@1', branch: LINE, sha: r.sha, verdict: 'self-find', why: 'missing' });
  assert.equal(r.stateText(), before, 'nothing recorded');
  const found = join(r.dir, 'found.txt');
  writeFileSync(found, `# from package.json\n\n${mark(join(r.dir, 'self'))}\n`);
  const out = r.ok('--reason', 'no-origin', '--self-found', found);
  assert.deepEqual([out.result, out.source], ['green', 'self-found']);
  assert.equal(r.count('self'), 1);
  assert.deepEqual(r.records(), [`local: ${LINE} ${r.sha} green no-origin`]);
  writeFileSync(found, '# nothing\n\n');
  assert.equal(r.run('--reason', 'no-origin', '--self-found', found).code, 2, 'an empty --self-found file is bad input');
});

test('Full checks is none: exit 4, never a green record', (t) => {
  for (const body of ['none', '`none`', '- none']) {
    const r = setup(t, { 'docs/agents/commands.md': contract(body) });
    const before = r.stateText();
    const res = r.run('--reason', 'no-origin');
    assert.equal(res.code, 4, `${body}: ${res.err}`);
    assert.equal(JSON.parse(res.out).why, 'none');
    assert.equal(r.stateText(), before);
  }
});

test('the contract is read from the tree of the SHA, not from the working tree', (t) => {
  const r = setup(t, { 'docs/agents/commands.md': contract('none') });
  writeFileSync(join(r.repo, 'docs', 'agents', 'commands.md'), contract(fenced(say('x'))));
  r.git('update-index', '--assume-unchanged', 'docs/agents/commands.md');
  const res = r.run('--reason', 'no-origin');
  assert.equal(res.code, 4);
  assert.equal(JSON.parse(res.out).why, 'none');
});

test('worktree not at the SHA: exit 5, nothing runs or is recorded', (t) => {
  const r = setup(t, {});
  r.commit({ 'docs/agents/commands.md': contract(fenced(mark(join(r.dir, 'n')))) });
  const tip = r.git('rev-parse', 'HEAD');
  r.git('checkout', '-q', '--detach', `${tip}~1`);
  const before = r.stateText();
  const res = r.run('--reason', 'no-origin');
  assert.equal(res.code, 5, res.err);
  assert.deepEqual(JSON.parse(res.out), { format: 'sorry-matt/verify@1', branch: LINE, sha: tip, verdict: 'not-at-sha', head: r.sha, dirty: false });
  r.git('checkout', '-q', LINE);
  writeFileSync(join(r.repo, 'README.md'), 'changed\n');
  const dirty = r.run('--reason', 'no-origin');
  assert.equal(dirty.code, 5);
  assert.equal(JSON.parse(dirty.out).dirty, true, 'tracked changes (a merge in progress) are not the SHA');
  assert.equal(r.count('n'), 0);
  assert.equal(r.stateText(), before);
});

test('bad input and refusals', (t) => {
  const r = setup(t, { 'docs/agents/commands.md': contract(fenced(say('x'))) });
  assert.equal(r.run('--reason', 'because').code, 2);
  assert.equal(r.run('--reason', 'no-origin', '--sha', 'abc1234').code, 2, 'a short SHA');
  assert.equal(verify([r.statePath, LINE, '--reason', 'no-origin']).code, 2, 'no --worktree');
  const unknown = verify([r.statePath, 'run-1/nope', '--worktree', r.repo, '--reason', 'no-origin']);
  assert.equal(unknown.code, 3);
  assert.match(unknown.err, /not an integration branch/);
  assert.equal(verify([join(r.dir, 'missing.json'), LINE, '--worktree', r.repo, '--reason', 'no-origin']).code, 1);
});

test('fullChecks: fences, inline code, joined lines, non-shell blocks', () => {
  assert.deepEqual(fullChecks(contract(fenced('$ npm test', 'npm run \\', '  lint'))).commands, ['npm test', 'npm run lint']);
  assert.deepEqual(fullChecks('## Full checks\n\n- `npm test`\n- `npm run lint`\n\nSource: CI.\n').commands, ['npm test', 'npm run lint']);
  assert.deepEqual(fullChecks('## Full checks\n\n```text\nnot a command\n```\n\n```sh\nmake check\n```\n').commands, ['make check']);
  assert.deepEqual(fullChecks('## Full checks\n\nRun the suite.\n'), { why: 'no-commands' });
  assert.deepEqual(fullChecks('## Targeted checks\n\n`npm test`\n'), { why: 'no-section' });
  assert.deepEqual(fullChecks('## Full checks\r\n\r\n```bash\r\nnpm test\r\n```\r\n## Coverage\r\n`npm run cov`\r\n').commands, ['npm test'], 'CRLF, and the section ends at the next heading');
});
