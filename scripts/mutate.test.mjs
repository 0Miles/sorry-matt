// node --test scripts/mutate.test.mjs
// `lines` runs against a real git repository in a temp dir; `run` mutates real files and runs real `node` commands,
// except where a fake seam stands in for what cannot be produced reliably (a timeout, a failed restore).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { changedLines, applyMutant, validatePlan, runPlan, main, defaultDeps } from '../src/skills/prove-it/scripts/mutate.mjs';

const tempDir = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mutate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('changedLines: new-file numbers of added lines; deleted files, pure deletions and blank lines are left out', () => {
  const diff = [
    'diff --git a/src/a.js b/src/a.js',
    '--- a/src/a.js',
    '+++ b/src/a.js',
    '@@ -3 +3,2 @@ function f() {',
    '-  return 1;',
    '+  return 2;',
    '+',
    '@@ -10,2 +11,0 @@',
    '-gone();',
    '-gone();',
    '@@ -20,0 +20 @@',
    '+added();',
    'diff --git a/old.js b/old.js',
    '--- a/old.js',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-x',
    'diff --git "a/sp ace\\"q.js" "b/sp ace\\"q.js"',
    '--- "a/sp ace\\"q.js"',
    '+++ "b/sp ace\\"q.js"',
    '@@ -0,0 +1 @@',
    '+y();',
    '\\ No newline at end of file',
  ].join('\n');
  assert.deepEqual(changedLines(diff), [
    { path: 'src/a.js', lines: [{ line: 3, text: '  return 2;' }, { line: 20, text: 'added();' }] },
    { path: 'sp ace"q.js', lines: [{ line: 1, text: 'y();' }] },
  ]);
});

test('lines: diff against the fixed point, with coverage from an lcov file (relative or absolute SF)', (t) => {
  const dir = tempDir(t);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...args], { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'a.js'), 'one\ntwo\nthree\n');
  writeFileSync(join(dir, 'b.js'), 'keep\n');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  git('checkout', '-q', '-b', 'ticket');
  writeFileSync(join(dir, 'a.js'), 'one\nTWO\nthree\nfour\n');
  writeFileSync(join(dir, 'b.js'), 'keep\nnew\n');
  git('commit', '-q', '-am', 'change');

  const plain = JSON.parse(main(['lines', '--base', 'main'], defaultDeps(dir)).out);
  assert.equal(plain.format, 'sorry-matt/mutate-lines@1');
  assert.equal(plain.coverage, null);
  assert.deepEqual(plain.files, [
    { path: 'a.js', lines: [{ line: 2, text: 'TWO', covered: null }, { line: 4, text: 'four', covered: null }] },
    { path: 'b.js', lines: [{ line: 2, text: 'new', covered: null }] },
  ]);

  writeFileSync(join(dir, 'lcov.info'), ['SF:a.js', 'DA:1,3', 'DA:2,1', 'DA:4,0', 'end_of_record', `SF:${join(dir, 'b.js')}`, 'DA:2,5', 'end_of_record'].join('\n'));
  const out = main(['lines', '--base', 'main', '--lcov', 'lcov.info'], defaultDeps(dir));
  assert.equal(out.code, 0, out.err);
  const covered = JSON.parse(out.out);
  assert.equal(covered.coverage, 'lcov');
  assert.deepEqual(covered.files.map((f) => f.lines.map((l) => [l.line, l.covered])), [[[2, true], [4, false]], [[2, true]]]);
});

test('applyMutant keeps the file\'s own line endings and touches only that line', () => {
  assert.equal(applyMutant('a\r\nb\r\nc', 2, 'B'), 'a\r\nB\r\nc');
  assert.equal(applyMutant('a\nb\n', 1, ''), '\nb\n');
});

// A tiny project: lib.js (CRLF) and a test that pins max() but not the exact message of label().
function project(t) {
  const dir = tempDir(t);
  const lib = ['exports.max = (a, b) => {', '  if (a > b) return a;', '  return b;', '};', "exports.label = (n) => 'n=' + n;", ''].join('\r\n');
  writeFileSync(join(dir, 'lib.js'), lib);
  writeFileSync(join(dir, 'check.js'), "const l = require('./lib'); if (l.max(3, 1) !== 3 || l.max(1, 3) !== 3) process.exit(1); l.label(1);\n");
  return { dir, lib };
}

const writePlan = (dir, mutants) => writeFileSync(join(dir, 'plan.json'), JSON.stringify({ mutants }));

test('run: killed and survived mutants are reported, and every file is restored byte for byte', (t) => {
  const { dir, lib } = project(t);
  writePlan(dir, [
    { file: 'lib.js', line: 2, operator: 'negate', original: '  if (a > b) return a;', mutant: '  if (!(a > b)) return a;' },
    { file: 'lib.js', line: 5, operator: 'return', original: "exports.label = (n) => 'n=' + n;", mutant: "exports.label = (n) => '';" },
  ]);
  const { code, out, err } = main(['run', '--plan', 'plan.json', '--cmd', 'node check.js'], defaultDeps(dir));
  assert.equal(code, 0, err);
  const report = JSON.parse(out);
  assert.equal(report.format, 'sorry-matt/mutate-run@1');
  assert.equal(report.baseline, 'green');
  assert.deepEqual(report.results.map((r) => [r.line, r.operator, r.outcome]), [[2, 'negate', 'killed'], [5, 'return', 'survived']]);
  assert.equal(report.survived, 1);
  assert.equal(report.restored, true);
  assert.equal(readFileSync(join(dir, 'lib.js'), 'utf8'), lib);
});

test('run: an invalid plan is refused before anything runs (cap, one per line, original must match)', (t) => {
  const { dir, lib } = project(t);
  const m = { file: 'lib.js', line: 3, original: '  return b;', mutant: '  return a;' };
  writePlan(dir, [m, { ...m, mutant: '  return 0;' }, { ...m, line: 2, original: 'stale text' }]);
  const { code, err } = main(['run', '--plan', 'plan.json', '--cmd', 'node check.js', '--cap', '2'], defaultDeps(dir));
  assert.equal(code, 2);
  assert.match(err, /over the cap of 2/);
  assert.match(err, /lib\.js:3 already has a mutant/);
  assert.match(err, /lib\.js:2 is .*not the plan's original "stale text"/);
  assert.equal(readFileSync(join(dir, 'lib.js'), 'utf8'), lib);
});

test('run: the default cap is 10', (t) => {
  const { dir } = project(t);
  const plan = { mutants: Array.from({ length: 11 }, (_, i) => ({ file: 'lib.js', line: i + 1, original: 'x', mutant: 'y' })) };
  assert.match(validatePlan(plan, { cap: 10, read: () => Buffer.from('') }).join('\n'), /11 mutants, over the cap of 10/);
  writePlan(dir, plan.mutants);
  assert.match(main(['run', '--plan', 'plan.json', '--cmd', 'node check.js'], defaultDeps(dir)).err, /over the cap of 10/);
});

test('run: a red baseline mutates nothing', (t) => {
  const { dir, lib } = project(t);
  writePlan(dir, [{ file: 'lib.js', line: 3, original: '  return b;', mutant: '  return a;' }]);
  const { code, out } = main(['run', '--plan', 'plan.json', '--cmd', 'node -e "process.exit(1)"'], defaultDeps(dir));
  assert.equal(code, 1);
  const report = JSON.parse(out);
  assert.equal(report.baseline, 'red');
  assert.deepEqual(report.results, []);
  assert.equal(readFileSync(join(dir, 'lib.js'), 'utf8'), lib);
});

test('run: a timeout counts as killed and is reported as such', (t) => {
  const { dir } = project(t);
  const deps = defaultDeps(dir);
  let calls = 0;
  deps.exec = () => (calls++ === 0 ? { status: 0, timedOut: false, output: '' } : { status: null, timedOut: true, output: '' });
  const plan = { mutants: [{ file: 'lib.js', line: 3, original: '  return b;', mutant: '  while (true);' }] };
  const { code, report } = runPlan({ plan, cmd: 'x', cap: 10, timeoutMs: 1, deps });
  assert.equal(code, 0);
  assert.equal(report.results[0].outcome, 'timeout');
  assert.equal(report.survived, 0);
});

test('run: a restore that does not match byte for byte stops with exit 3', (t) => {
  const { dir } = project(t);
  const deps = defaultDeps(dir);
  const write = deps.write;
  let writes = 0;
  deps.write = (file, buf) => write(file, writes++ === 1 ? Buffer.concat([buf, Buffer.from('!')]) : buf);
  const plan = { mutants: [
    { file: 'lib.js', line: 3, original: '  return b;', mutant: '  return a;' },
    { file: 'lib.js', line: 2, original: '  if (a > b) return a;', mutant: '' },
  ] };
  const { code, report } = runPlan({ plan, cmd: 'node check.js', cap: 10, timeoutMs: 60000, deps });
  assert.equal(code, 3);
  assert.equal(report.restored, false);
  assert.equal(report.restoreFailed, 'lib.js:3');
  assert.deepEqual(report.results, []);
});

test('usage errors exit 2', () => {
  assert.equal(main(['nope']).code, 2);
  assert.equal(main(['lines']).code, 2);
  assert.equal(main(['run', '--plan', 'p.json']).code, 2);
  assert.equal(main(['run', '--plan', 'p.json', '--cmd', 'x', '--cap', '0']).code, 2);
});
