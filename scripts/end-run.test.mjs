// node --test scripts/end-run.test.mjs
// hooks/end-run.mjs ends a run that stopped without its handoff: it changes the first line of a ledger in the
// repo's shared directory from the active marker to the ended marker, and refuses, changing nothing, for any
// other file or a ledger that is not active. The budget hook's deny names it.
import './git-env.mjs'; // first: the git processes below skip automatic maintenance
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from '../hooks/budget.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'hooks/end-run.mjs');

/** A real repo with a linked worktree and an empty runs directory in its shared directory. */
const repo = () => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'sorry-matt-end-run-')));
  const main = join(dir, 'main');
  mkdirSync(main);
  const git = (...args) => spawnSync('git', ['-C', main, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
  const tree = join(dir, 'wt');
  git('worktree', 'add', '-q', tree);
  const runs = join(main, '.git', 'sorry-matt', 'runs');
  mkdirSync(runs, { recursive: true });
  return { dir, main, tree, runs, done: () => rmSync(dir, { recursive: true, force: true }) };
};
const run = (cwd, ...args) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
const LEDGER = '<!-- sorry-matt:run active -->\n# run\n\n9. budget\n- budget: spawns 1\n- session: host-1\n';

test('ends an active ledger from any worktree: only the first line changes', () => {
  const r = repo();
  try {
    const ledger = join(r.runs, 'r.md');
    writeFileSync(ledger, LEDGER);
    const out = run(r.tree, ledger);
    assert.equal(out.status, 0, out.stderr);
    assert.equal(out.stdout, `ended: ${ledger}\n`);
    assert.equal(readFileSync(ledger, 'utf8'), LEDGER.replace('run active', 'run ended'));
  } finally {
    r.done();
  }
});

test('keeps a BOM and CRLF line endings, and takes a path relative to the current directory', () => {
  const r = repo();
  try {
    const ledger = join(r.runs, 'crlf.md');
    const text = '﻿<!-- sorry-matt:run active -->\r\n# run\r\n- budget: spawns 3\r\n';
    writeFileSync(ledger, text);
    const out = run(r.main, join('.git', 'sorry-matt', 'runs', 'crlf.md'));
    assert.equal(out.status, 0, out.stderr);
    assert.equal(readFileSync(ledger, 'utf8'), '﻿<!-- sorry-matt:run ended -->\r\n# run\r\n- budget: spawns 3\r\n');
  } finally {
    r.done();
  }
});

test('a ledger whose first line is not the active marker is left unchanged, with the reason', () => {
  const r = repo();
  try {
    const cases = {
      'ended.md': '<!-- sorry-matt:run ended -->\n# run\n',
      'blank.md': '\n<!-- sorry-matt:run active -->\n# run\n',
      'prose.md': '# notes\n<!-- sorry-matt:run active -->\n',
      'empty.md': '',
    };
    for (const [name, text] of Object.entries(cases)) {
      const ledger = join(r.runs, name);
      writeFileSync(ledger, text);
      const out = run(r.tree, ledger);
      assert.equal(out.status, 1, name);
      assert.equal(out.stdout, '', name);
      assert.match(out.stderr, /first line .* is not `<!-- sorry-matt:run active -->`/, name);
      assert.match(out.stderr, /nothing was changed/, name);
      assert.equal(readFileSync(ledger, 'utf8'), text, `${name} is unchanged`);
    }
  } finally {
    r.done();
  }
});

test('a file outside the shared runs directory is left unchanged, with the reason', () => {
  const r = repo();
  const other = repo();
  try {
    const places = [
      join(r.dir, 'loose.md'),
      join(r.tree, 'r.md'),
      join(r.main, '.git', 'sorry-matt', 'r.md'),
      join(other.runs, 'r.md'),
    ];
    mkdirSync(join(r.runs, 'nested'));
    places.push(join(r.runs, 'nested', 'r.md'));
    for (const place of places) {
      writeFileSync(place, LEDGER);
      const out = run(r.tree, place);
      assert.equal(out.status, 1, place);
      assert.match(out.stderr, /is not a run ledger of this repository/, place);
      assert.ok(out.stderr.includes(join(r.main, '.git', 'sorry-matt', 'runs')), `names where ledgers live: ${out.stderr}`);
      assert.equal(readFileSync(place, 'utf8'), LEDGER, `${place} is unchanged`);
    }
    const text = join(r.runs, 'notes.txt');
    writeFileSync(text, LEDGER);
    assert.equal(run(r.tree, text).status, 1, 'only .md files are ledgers');
    assert.equal(readFileSync(text, 'utf8'), LEDGER);
  } finally {
    r.done();
    other.done();
  }
});

test('a missing ledger, a directory outside any repo, and wrong arguments change nothing', () => {
  const r = repo();
  const bare = realpathSync.native(mkdtempSync(join(tmpdir(), 'sorry-matt-end-run-norepo-')));
  try {
    const missing = run(r.tree, join(r.runs, 'nope.md'));
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /does not exist/);

    const ledger = join(r.runs, 'r.md');
    writeFileSync(ledger, LEDGER);
    const outside = run(bare, ledger);
    assert.equal(outside.status, 1);
    assert.match(outside.stderr, /not inside a git repository/);
    assert.equal(readFileSync(ledger, 'utf8'), LEDGER);

    for (const args of [[], [ledger, ledger]]) {
      const out = run(r.tree, ...args);
      assert.equal(out.status, 2);
      assert.match(out.stderr, /usage: node hooks\/end-run\.mjs <ledger>/);
    }
    assert.equal(readFileSync(ledger, 'utf8'), LEDGER);
  } finally {
    r.done();
    rmSync(bare, { recursive: true, force: true });
  }
});

test('the budget deny names this command for its ledger, and running it lifts the block', () => {
  const r = repo();
  try {
    const ledger = join(r.runs, 'r.md');
    writeFileSync(ledger, '<!-- sorry-matt:run active -->\n# run\n- budget: spawns 0\n');
    const call = { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { prompt: 'x' }, cwd: r.tree };
    const deps = { env: {} };
    const reason = handle(JSON.stringify(call), deps).decision.hookSpecificOutput.permissionDecisionReason;
    const command = /`node "([^"]+)" "([^"]+)"`/.exec(reason);
    assert.ok(command, `the deny names a command: ${reason}`);
    assert.equal(command[1], script);
    assert.equal(command[2], ledger);
    assert.match(reason, /never end a run that is still running/);

    const out = run(r.tree, command[2]);
    assert.equal(out.status, 0, out.stderr);
    assert.equal(handle(JSON.stringify(call), deps).decision, null, 'an ended run blocks nothing');
  } finally {
    r.done();
  }
});
