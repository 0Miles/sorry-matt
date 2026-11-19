// node --test scripts/reread.test.mjs
// The SessionStart(compact) hook in hooks/: a run in progress gets a plain-text reminder naming its
// ledger and rule files; no git, no ledger, or only ended ledgers print nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { parseLedger, activeLedgers, reminder, respond, ledgerLine } from '../hooks/runs.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const fixture = () => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'sorry-matt-reread-')));
  const runs = join(dir, 'sorry-matt', 'runs');
  mkdirSync(runs, { recursive: true });
  return { dir, runs, done: () => rmSync(dir, { recursive: true, force: true }) };
};
const gitAt = (dir) => () => ({ status: 0, stdout: `${dir}\n` });
const event = (cwd = '.') => JSON.stringify({ hook_event_name: 'SessionStart', source: 'compact', cwd, session_id: 's' });

test('parseLedger: only a ledger whose first line is the active marker is in progress', () => {
  assert.deepEqual(parseLedger('<!-- sorry-matt:run active -->\n# run\n'), { rules: [] });
  assert.deepEqual(parseLedger('\uFEFF<!--  sorry-matt:run  active  --> \r\n# run\r\n'), { rules: [] });
  assert.equal(parseLedger('\n<!-- sorry-matt:run active -->\n'), null);
  assert.equal(parseLedger('<!-- sorry-matt:run ended -->\nrule: /a/SKILL.md\n'), null);
  assert.equal(parseLedger('# run\n<!-- sorry-matt:run active -->\n'), null);
  assert.equal(parseLedger(''), null);
});

test('parseLedger: rule lines with absolute paths, bullets and backticks allowed, duplicates dropped', () => {
  const text = [
    '<!-- sorry-matt:run active -->',
    '## 10. Rule files',
    '- rule: `/plugins/sorry-matt/skills/have-it-all-done/SKILL.md`',
    '* rule: C:\\plugins\\sorry-matt\\skills\\have-it-all-done\\ASKING.md',
    'rule: /plugins/sorry-matt/skills/get-to-work/SKILL.md',
    'rule: /plugins/sorry-matt/skills/get-to-work/SKILL.md',
    'rule: relative/SKILL.md',
    'the rule: is not a rule line /x',
  ].join('\n');
  assert.deepEqual(parseLedger(text).rules, [
    '/plugins/sorry-matt/skills/have-it-all-done/SKILL.md',
    'C:\\plugins\\sorry-matt\\skills\\have-it-all-done\\ASKING.md',
    '/plugins/sorry-matt/skills/get-to-work/SKILL.md',
  ]);
});

test('parseLedger: a rule line wrapped whole in backticks counts, with or without a bullet', () => {
  const ledger = (line) => `<!-- sorry-matt:run active -->\n## 10. Rule files\n${line}\n`;
  assert.deepEqual(parseLedger(ledger('`rule: /abs/x.md`')).rules, ['/abs/x.md']);
  assert.deepEqual(parseLedger(ledger('- `rule: /abs/x.md`')).rules, ['/abs/x.md']);
  assert.deepEqual(parseLedger(ledger('* `rule: C:\\abs\\x.md`')).rules, ['C:\\abs\\x.md']);
});

test('parseLedger: trailing spaces or tabs after a rule path are not part of the path', () => {
  assert.deepEqual(parseLedger('<!-- sorry-matt:run active -->\nrule: /a/b.md  \nrule: /a/b.md\t\n').rules, ['/a/b.md']);
});

test('ledgerLine: one line shape for any key, bullets and backticks around the value or the whole line', () => {
  const line = ledgerLine('size', /(\d+)/);
  for (const ok of ['size: 7', '  - size: 7  ', '* size: `7`', '+ `size: 7`', '`size: 7`']) assert.equal(line.exec(ok)?.[1], '7', ok);
  for (const no of ['the size: 7', 'size: seven', '-size: 7', 'sizes: 7']) assert.equal(line.exec(no), null, no);
});

test('activeLedgers: skips ended ledgers, non-markdown files and run directories', () => {
  const f = fixture();
  try {
    const rule = join(f.dir, 'SKILL.md');
    writeFileSync(rule, 'x');
    writeFileSync(join(f.runs, 'a.md'), `<!-- sorry-matt:run active -->\nrule: ${rule}\nrule: ${join(f.dir, 'gone.md')}\n`);
    writeFileSync(join(f.runs, 'b.md'), '<!-- sorry-matt:run ended -->\n');
    writeFileSync(join(f.runs, 'c.json'), '<!-- sorry-matt:run active -->\n');
    mkdirSync(join(f.runs, 'a', 'acceptance'), { recursive: true });
    mkdirSync(join(f.runs, 'd.md'));
    assert.deepEqual(activeLedgers(f.dir), [
      {
        ledger: join(f.runs, 'a.md'),
        rules: [
          { path: rule, exists: true },
          { path: join(f.dir, 'gone.md'), exists: false },
        ],
      },
    ]);
  } finally {
    f.done();
  }
});

test('reminder: names the ledger first, then each rule file, and flags missing ones', () => {
  const text = reminder([{ ledger: '/r/sorry-matt/runs/x.md', rules: [{ path: '/p/SKILL.md', exists: true }, { path: '/p/ASKING.md', exists: false }] }]);
  assert.match(text, /re-read the run ledger, then every rule file it lists/);
  const ledgerAt = text.indexOf('- ledger: /r/sorry-matt/runs/x.md');
  const ruleAt = text.indexOf('  - rule: /p/SKILL.md\n');
  assert.ok(ledgerAt > 0 && ruleAt > ledgerAt);
  assert.match(text, /- rule: \/p\/ASKING\.md \(not found/);
  assert.doesNotMatch(text, /More than one run/);
  assert.match(reminder([{ ledger: 'a', rules: [] }, { ledger: 'b', rules: [] }]), /More than one run is in progress/);
  assert.match(reminder([{ ledger: 'a', rules: [] }]), /none listed/);
  assert.equal(reminder([]), null);
});

test('respond: silent without git, outside a repo, without runs, with only ended runs, or on bad input', () => {
  const f = fixture();
  try {
    assert.equal(respond(event(), { git: () => ({ error: new Error('ENOENT') }) }), null);
    assert.equal(respond(event(), { git: () => ({ status: 128, stdout: '' }) }), null);
    assert.equal(respond(event(), { git: gitAt(join(f.dir, 'nowhere')) }), null);
    writeFileSync(join(f.runs, 'old.md'), '<!-- sorry-matt:run ended -->\nrule: /x/SKILL.md\n');
    assert.equal(respond(event(), { git: gitAt(f.dir) }), null);
    assert.equal(respond('not json', { git: gitAt(f.dir) }), null);
    writeFileSync(join(f.runs, 'now.md'), '<!-- sorry-matt:run active -->\nrule: /x/SKILL.md\n');
    assert.match(respond(event(), { git: gitAt(f.dir) }), /- ledger: .*now\.md\n {2}- rule: \/x\/SKILL\.md/);
  } finally {
    f.done();
  }
});

test('respond: a field-10 rule line wrapped in backticks still reaches the reminder', () => {
  const f = fixture();
  try {
    const rule = join(f.dir, 'SKILL.md');
    writeFileSync(rule, 'x');
    writeFileSync(join(f.runs, 'now.md'), `<!-- sorry-matt:run active -->\n## 10. Rule files\n- \`rule: ${rule}\`\n`);
    const out = respond(event(), { git: gitAt(f.dir) });
    assert.ok(out.includes(`  - rule: ${rule}\n`), out);
    assert.ok(!out.includes('rule files: none listed'), out);
  } finally {
    f.done();
  }
});

test('respond: asks git for the common directory of the event cwd', () => {
  const calls = [];
  respond(event('/work/tree'), { git: (cmd, args) => (calls.push([cmd, ...args]), { status: 1 }) });
  assert.deepEqual(calls, [['git', '-C', '/work/tree', 'rev-parse', '--path-format=absolute', '--git-common-dir']]);
});

test('hooks.json registers reread.mjs on SessionStart with matcher compact', () => {
  const config = JSON.parse(readFileSync(join(root, 'hooks/hooks.json'), 'utf8'));
  const entry = config.hooks.SessionStart.find((e) => e.hooks.some((h) => h.command.includes('hooks/reread.mjs')));
  assert.equal(entry.matcher, 'compact');
  assert.equal(entry.hooks[0].type, 'command');
});

test('end to end: the entry prints plain text from a real repo worktree and nothing once the run ends', () => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'sorry-matt-reread-repo-')));
  try {
    const git = (...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
    git('init', '-q');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
    const tree = join(dir, 'wt');
    git('worktree', 'add', '-q', tree);
    const runs = join(dir, '.git', 'sorry-matt', 'runs');
    mkdirSync(runs, { recursive: true });
    const ledger = join(runs, 'r.md');
    const rule = join(root, 'skills', 'have-it-all-done', 'ASKING.md');
    writeFileSync(ledger, `<!-- sorry-matt:run active -->\n# r\n## 10\n- rule: ${rule}\n`);
    const run = () => spawnSync(process.execPath, [join(root, 'hooks/reread.mjs')], { input: event(tree), encoding: 'utf8' });

    const live = run();
    assert.equal(live.status, 0);
    assert.ok(!live.stdout.trimStart().startsWith('{'), 'plain text, not JSON');
    assert.ok(live.stdout.includes(`- ledger: ${ledger}`), live.stdout);
    assert.ok(live.stdout.includes(`  - rule: ${rule}\n`), live.stdout);

    writeFileSync(ledger, `<!-- sorry-matt:run ended -->\n- rule: ${rule}\n`);
    const ended = run();
    assert.equal(ended.status, 0);
    assert.equal(ended.stdout, '');

    const outside = spawnSync(process.execPath, [join(root, 'hooks/reread.mjs')], { input: event(tmpdir()), encoding: 'utf8' });
    assert.equal(outside.status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
