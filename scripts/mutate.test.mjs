// node --test scripts/mutate.test.mjs
// Real git repositories in temp dirs and real `node` commands; a fake seam stands in only for what cannot be produced
// reliably (a timeout, a write that throws, a restore that does not match).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { changedLines, applyMutant, validatePlan, runPlan, pathKey, main, defaultDeps } from '../src/skills/prove-it/scripts/mutate.mjs';
import { shortPath } from './lib.mjs';

const tempDir = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mutate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const gitIn = (dir) => (...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...args], { cwd: dir, encoding: 'utf8' });

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
    'diff --git a/a b.js b/a b.js',
    '--- a/a b.js\t',
    '+++ b/a b.js\t',
    '@@ -0,0 +1 @@',
    '+z();',
  ].join('\n');
  assert.deepEqual(changedLines(diff), [
    { path: 'src/a.js', lines: [{ line: 3, text: '  return 2;' }, { line: 20, text: 'added();' }] },
    { path: 'sp ace"q.js', lines: [{ line: 1, text: 'y();' }] },
    { path: 'a b.js', lines: [{ line: 1, text: 'z();' }] },
  ]);
});

test('pathKey folds ./ and a/../, and folds case on Windows only', () => {
  assert.equal(pathKey('./lib.js', 'linux'), 'lib.js');
  assert.equal(pathKey('src/../lib.js', 'linux'), 'lib.js');
  assert.equal(pathKey('src\\lib.js', 'win32'), 'src/lib.js');
  assert.equal(pathKey('Lib.JS', 'win32'), pathKey('lib.js', 'win32'));
  assert.notEqual(pathKey('Lib.JS', 'linux'), pathKey('lib.js', 'linux'));
});

test('lines: diff against the fixed point, with coverage from an lcov file (relative or absolute SF)', (t) => {
  const dir = tempDir(t);
  const git = gitIn(dir);
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

// A tiny project on a `ticket` branch: lib.js (CRLF) where the ticket changed lines 2 and 5, and a test that pins
// max() but not the text of label(). Line 3 is unchanged since `main`.
const LINE2 = '  if (a > b) return a;';
const LINE3 = '  return b;';
const LINE5 = "exports.label = (n) => 'n=' + n;";
function project(t) {
  const dir = tempDir(t);
  const git = gitIn(dir);
  const libOf = (l2, l5) => ['exports.max = (a, b) => {', l2, LINE3, '};', l5, ''].join('\r\n');
  git('init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'lib.js'), libOf('  if (b < a) return a;', "exports.label = (n) => '' + n;"));
  writeFileSync(join(dir, 'check.js'), "const l = require('./lib'); if (l.max(3, 1) !== 3 || l.max(1, 3) !== 3) process.exit(1); l.label(1);\n");
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  git('checkout', '-q', '-b', 'ticket');
  const lib = libOf(LINE2, LINE5);
  writeFileSync(join(dir, 'lib.js'), lib);
  git('commit', '-q', '-am', 'ticket');
  return { dir, lib };
}

const NEGATE2 = { file: 'lib.js', line: 2, operator: 'negate', original: LINE2, mutant: '  if (!(a > b)) return a;' };
const RETURN5 = { file: 'lib.js', line: 5, operator: 'return', original: LINE5, mutant: "exports.label = (n) => '';" };
const writePlan = (dir, mutants) => writeFileSync(join(dir, 'plan.json'), JSON.stringify({ mutants }));
const run = (dir, ...extra) =>
  main(['run', '--base', 'main', '--plan', 'plan.json', '--ledger', 'ledger.json', '--cmd', 'node check.js', ...extra], defaultDeps(dir));

test('run: killed and survived mutants are reported, the ledger records them, and files are restored byte for byte', (t) => {
  const { dir, lib } = project(t);
  writePlan(dir, [NEGATE2, RETURN5]);
  const { code, out, err } = run(dir);
  assert.equal(code, 0, err);
  const report = JSON.parse(out);
  assert.equal(report.format, 'sorry-matt/mutate-run@1');
  assert.equal(report.baseline, 'green');
  assert.deepEqual(report.results.map((r) => [r.line, r.operator, r.outcome]), [[2, 'negate', 'killed'], [5, 'return', 'survived']]);
  assert.equal(report.survived, 1);
  assert.equal(report.restored, true);
  assert.equal(readFileSync(join(dir, 'lib.js'), 'utf8'), lib);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'ledger.json'), 'utf8')), {
    format: 'sorry-matt/mutate-ledger@1',
    mutants: [{ file: 'lib.js', line: 2, outcome: 'killed' }, { file: 'lib.js', line: 5, outcome: 'survived' }],
  });
});

test('run: an invalid plan is refused before anything runs', (t) => {
  const { dir, lib } = project(t);
  writePlan(dir, [
    NEGATE2,
    { ...NEGATE2, file: './lib.js', mutant: '  if (a >= b) return a;' },
    { ...RETURN5, original: 'stale text' },
  ]);
  const { code, err } = run(dir, '--cap', '2');
  assert.equal(code, 2);
  assert.match(err, /over the cap of 2/);
  assert.match(err, /\.\/lib\.js:2 already has a mutant/);
  assert.match(err, /lib\.js:5 is .*not the plan's original "stale text"/);
  assert.equal(readFileSync(join(dir, 'lib.js'), 'utf8'), lib);
  assert.equal(existsSync(join(dir, 'ledger.json')), false);
});

test('run: only changed lines of the ticket diff, and not lines lcov reports uncovered', (t) => {
  const { dir } = project(t);
  writePlan(dir, [{ file: 'lib.js', line: 3, original: LINE3, mutant: '  return a;' }]);
  assert.match(run(dir).err, /lib\.js:3 is not a changed line of this ticket's diff/);

  writeFileSync(join(dir, 'lcov.info'), ['SF:lib.js', 'DA:2,4', 'DA:5,0', 'end_of_record'].join('\n'));
  writePlan(dir, [NEGATE2, RETURN5]);
  const { code, err } = run(dir, '--lcov', 'lcov.info');
  assert.equal(code, 2);
  assert.match(err, /lib\.js:5 is not covered by any test/);
  assert.doesNotMatch(err, /lib\.js:2/);
});

test('run: a plan exactly at the cap runs; --cap cannot raise the default of 10', (t) => {
  const { dir } = project(t);
  writePlan(dir, [NEGATE2, RETURN5]);
  assert.equal(run(dir, '--cap', '2').code, 0);
  const raised = run(dir, '--cap', '11');
  assert.equal(raised.code, 2);
  assert.match(raised.err, /--cap can only lower the cap of 10/);
});

test('run: the ledger carries the cap and one-per-line across runs of a round', (t) => {
  const { dir } = project(t);
  writePlan(dir, [NEGATE2]);
  assert.equal(run(dir, '--cap', '2').code, 0);

  writePlan(dir, [{ ...NEGATE2, mutant: '  if (a >= b) return a;' }]);
  assert.match(run(dir, '--cap', '2').err, /lib\.js:2 already has a mutant/);

  writePlan(dir, [RETURN5]);
  assert.equal(run(dir, '--cap', '1').code, 2);
  assert.equal(run(dir, '--cap', '2').code, 0);
  assert.equal(JSON.parse(readFileSync(join(dir, 'ledger.json'), 'utf8')).mutants.length, 2);
});

test('validatePlan: the default cap is 10, and a case-only duplicate is one line on Windows', () => {
  const plan = { mutants: Array.from({ length: 11 }, (_, i) => ({ file: 'lib.js', line: i + 1, original: 'x', mutant: 'y' })) };
  assert.match(validatePlan(plan, { cap: 10, read: () => Buffer.from('') }).join('\n'), /11 mutants and the ledger 0, over the cap of 10/);
  assert.doesNotMatch(validatePlan({ mutants: plan.mutants.slice(0, 10) }, { cap: 10, read: () => Buffer.from('') }).join('\n'), /cap/);
  const twice = { mutants: [{ file: 'Lib.js', line: 1, original: 'x', mutant: 'y' }, { file: 'lib.js', line: 1, original: 'x', mutant: 'z' }] };
  const problems = validatePlan(twice, { cap: 10, read: () => Buffer.from('x') }).join('\n');
  if (process.platform === 'win32') assert.match(problems, /lib\.js:1 already has a mutant/);
  else assert.doesNotMatch(problems, /already has a mutant/);
});

test('run: a red baseline mutates nothing', (t) => {
  const { dir, lib } = project(t);
  writePlan(dir, [NEGATE2]);
  const { code, out } = main(['run', '--base', 'main', '--plan', 'plan.json', '--ledger', 'ledger.json', '--cmd', 'node -e "process.exit(1)"'], defaultDeps(dir));
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
  const { code, report } = runPlan({ plan: { mutants: [NEGATE2] }, cmd: 'x', cap: 10, timeoutMs: 1, deps });
  assert.equal(code, 0);
  assert.equal(report.results[0].outcome, 'timeout');
  assert.equal(report.survived, 0);
});

test('run: a command that throws mid-mutant still restores the file and returns the report', (t) => {
  const { dir, lib } = project(t);
  const deps = defaultDeps(dir);
  let calls = 0;
  deps.exec = () => {
    if (calls++ === 0) return { status: 0, timedOut: false, output: '' };
    throw Object.assign(new Error('spawn failed'), { code: 'ENOENT' });
  };
  const { code, report } = runPlan({ plan: { mutants: [NEGATE2, RETURN5] }, cmd: 'x', cap: 10, timeoutMs: 1000, deps });
  assert.equal(code, 1);
  assert.equal(report.restored, true);
  assert.match(report.error, /lib\.js:2: ENOENT: spawn failed/);
  assert.equal(readFileSync(join(dir, 'lib.js'), 'utf8'), lib);
});

test('run: a restore that does not match byte for byte stops with exit 3', (t) => {
  const { dir } = project(t);
  const deps = defaultDeps(dir);
  const write = deps.write;
  let writes = 0;
  deps.write = (file, buf) => write(file, writes++ === 1 ? Buffer.concat([buf, Buffer.from('!')]) : buf);
  const { code, report } = runPlan({ plan: { mutants: [NEGATE2, RETURN5] }, cmd: 'node check.js', cap: 10, timeoutMs: 60000, deps });
  assert.equal(code, 3);
  assert.equal(report.restored, false);
  assert.deepEqual(report.restoreFailed, { file: 'lib.js', line: 2 });
  assert.deepEqual(report.results, []);
});

test('run: a restore write that throws (EBUSY) stops with exit 3 and is recorded in the ledger', (t) => {
  const { dir } = project(t);
  const deps = defaultDeps(dir);
  const write = deps.write;
  let writes = 0;
  deps.write = (file, buf) => {
    if (file === 'lib.js' && writes++ === 1) throw Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' });
    return write(file, buf);
  };
  writePlan(dir, [NEGATE2, RETURN5]);
  const { code, out, err } = main(['run', '--base', 'main', '--plan', 'plan.json', '--ledger', 'ledger.json', '--cmd', 'node check.js'], deps);
  assert.equal(code, 3);
  const report = JSON.parse(out);
  assert.equal(report.restored, false);
  assert.match(report.error, /restore lib\.js:2: EBUSY/);
  assert.match(err, /discard the review worktree/);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'ledger.json'), 'utf8')).mutants, [{ file: 'lib.js', line: 2, outcome: 'restore-failed' }]);
});

test('usage errors exit 2', () => {
  assert.equal(main(['nope']).code, 2);
  assert.equal(main(['lines']).code, 2);
  assert.equal(main(['run', '--base', 'main', '--plan', 'p.json', '--cmd', 'x']).code, 2);
  assert.equal(main(['run', '--base', 'main', '--plan', 'p.json', '--ledger', 'l.json', '--cmd', 'x', '--cap', '0']).code, 2);
});

test('lines: lcov SF paths match changed lines when the cwd is a Windows 8.3 short path and SF is long, or the reverse', (t) => {
  const dir = tempDir(t);
  const short = shortPath(dir);
  if (!short) return t.skip('no 8.3 short path here (not Windows, or 8.3 names disabled)');
  const git = gitIn(dir);
  git('init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'a.js'), 'one\n');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  git('checkout', '-q', '-b', 'ticket');
  writeFileSync(join(dir, 'a.js'), 'one\ntwo\n');
  git('commit', '-q', '-am', 'change');

  for (const [cwd, sf] of [[short, dir], [dir, short]]) {
    writeFileSync(join(dir, 'lcov.info'), [`SF:${join(sf, 'a.js')}`, 'DA:2,1', 'end_of_record'].join('\n'));
    const out = main(['lines', '--base', 'main', '--lcov', 'lcov.info'], defaultDeps(cwd));
    assert.equal(out.code, 0, out.err);
    assert.deepEqual(JSON.parse(out.out).files, [{ path: 'a.js', lines: [{ line: 2, text: 'two', covered: true }] }]);
  }
});
