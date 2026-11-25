// node --test scripts/tier.test.mjs
// Real git repositories in temp dirs; expected tiers come from the table the script replaced in prove-it/SKILL.md
// section 1 (prose only → light; sensitive path or more than 400 changed lines → full; at most 50 → light; else
// standard), and the line counts from how each fixture is built.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main, defaultDeps, patternRegex, parseSensitive, batchItems, sensitiveEntry, symbolRanges, splitEntry } from '../src/skills/prove-it/scripts/tier.mjs';
import { splitEntry as overlapSplitEntry } from '../src/skills/get-to-work/scripts/overlap.mjs';

const SCRIPT = fileURLToPath(new URL('../src/skills/prove-it/scripts/tier.mjs', import.meta.url));

const tempDir = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tier-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const gitIn = (dir) => (...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...args], { cwd: dir, encoding: 'utf8' });

const put = (dir, files) => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    if (text === null) rmSync(join(dir, path));
    else writeFileSync(join(dir, path), text);
  }
};

// A repo with `base` committed on main and `change` committed on the ticket branch (checked out).
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
  return dir;
}

const lines = (n, prefix = 'x') => Array.from({ length: n }, (_, i) => `${prefix}${i};`).join('\n') + '\n';
const judge = (dir, ...extra) => {
  const r = main(['judge', '--base', 'main', ...extra], defaultDeps(dir));
  assert.equal(r.code, 0, r.err);
  return JSON.parse(r.out);
};

const CONTRACT = (list) => `# Commands\n\n## Full checks\n\nnone\n\n## Sensitive paths\n\n${list}\n\n来源 note.\n`;

test('a prose-only diff is light with no mutation cap, however long', (t) => {
  const dir = repo(t, {}, { 'docs/guide.md': lines(200, 'line ') });
  const out = judge(dir);
  assert.equal(out.format, 'sorry-matt/tier@1');
  assert.equal(out.tier, 'light');
  assert.deepEqual(out.reasons, ['docs-only']);
  assert.equal(out.signals.changedLines, 200);
  assert.equal(out.signals.docsOnly, true);
  assert.equal(out.mutationCap, null);
  assert.equal(out.finders.length, 1);
  assert.deepEqual(out.verifiers, { max: 1 });
  assert.equal(out.fixVerifiers, 'one');
});

test('changed lines: 50 is light, 51 is standard (only the line count differs)', (t) => {
  const at50 = judge(repo(t, {}, { 'src/a.js': lines(50) }));
  assert.equal(at50.signals.changedLines, 50);
  assert.equal(at50.tier, 'light');
  assert.deepEqual(at50.reasons, ['few-lines']);
  assert.equal(at50.mutationCap, 3);
  assert.equal(at50.finders.length, 1);

  const at51 = judge(repo(t, {}, { 'src/a.js': lines(51) }));
  assert.equal(at51.tier, 'standard');
  assert.deepEqual(at51.reasons, ['default']);
  assert.equal(at51.mutationCap, 5);
  assert.equal(at51.finders.length, 2);
  assert.deepEqual(at51.verifiers, { max: 3 });
  assert.equal(at51.fixVerifiers, 'one');
});

test('changed lines count additions plus deletions: 400 is standard, 401 is full', (t) => {
  const base = { 'src/a.js': lines(200, 'old') };
  const at400 = judge(repo(t, base, { 'src/a.js': lines(200, 'new') }));
  assert.equal(at400.signals.added, 200);
  assert.equal(at400.signals.deleted, 200);
  assert.equal(at400.tier, 'standard');

  const at401 = judge(repo(t, base, { 'src/a.js': lines(201, 'new') }));
  assert.equal(at401.signals.changedLines, 401);
  assert.equal(at401.tier, 'full');
  assert.deepEqual(at401.reasons, ['over-lines']);
  assert.equal(at401.mutationCap, 10);
  assert.deepEqual(at401.verifiers, { max: null });
  assert.equal(at401.fixVerifiers, 'per-file');
});

test('a renamed file counts only the lines it changed, as plain git diff --numstat reports them', (t) => {
  const base = { 'src/a.js': lines(300) };
  const pure = judge(repo(t, base, { 'src/a.js': null, 'lib/a.js': lines(300) }));
  assert.equal(pure.signals.changedLines, 0);
  assert.equal(pure.signals.deleted, 0);
  assert.equal(pure.tier, 'light');
  assert.deepEqual(pure.reasons, ['few-lines']);

  const edited = judge(repo(t, base, { 'src/a.js': null, 'lib/a.js': `${lines(300)}extra();\n` }));
  assert.equal(edited.signals.added, 1);
  assert.equal(edited.signals.deleted, 0);
  assert.equal(edited.tier, 'light');
  assert.deepEqual(edited.signals.sensitive, []);
});

test('a sensitive path from the contract makes a two-line diff full; the same diff elsewhere is light', (t) => {
  const contract = { 'docs/agents/commands.md': CONTRACT('```text\nguard/\nconfig/deploy.json\n```') };
  const hit = judge(repo(t, contract, { 'guard/check.js': 'a();\nb();\n' }));
  assert.equal(hit.tier, 'full');
  assert.deepEqual(hit.reasons, ['sensitive']);
  assert.deepEqual(hit.signals.sensitive, ['guard/check.js']);
  assert.equal(hit.signals.sensitiveSource, 'commands.md');

  const exact = judge(repo(t, contract, { 'config/deploy.json': '{}\n' }));
  assert.deepEqual(exact.signals.sensitive, ['config/deploy.json']);

  const miss = judge(repo(t, contract, { 'src/guard/check.js': 'a();\nb();\n', 'config/deploy.json.bak': '{}\n' }));
  assert.equal(miss.tier, 'light');
  assert.deepEqual(miss.signals.sensitive, []);
});

test('no contract, or a contract whose Sensitive paths is none: the default patterns apply', (t) => {
  const ci = { '.github/workflows/ci.yml': 'on: push\n' };
  const none = judge(repo(t, {}, ci));
  assert.equal(none.tier, 'full');
  assert.equal(none.signals.sensitiveSource, 'default');

  const declared = judge(repo(t, { 'docs/agents/commands.md': CONTRACT('none') }, { 'db/migrations/001.sql': 'create table t();\n' }));
  assert.equal(declared.signals.sensitiveSource, 'default');
  assert.deepEqual(declared.signals.sensitive, ['db/migrations/001.sql']);
  assert.equal(declared.tier, 'full');

  assert.equal(judge(repo(t, {}, { 'src/a.js': 'a();\n' })).tier, 'light');
});

test('a ticket cannot lower its own tier by editing the contract; a deleted or renamed file matches by its old path', (t) => {
  const base = { 'docs/agents/commands.md': CONTRACT('```text\nguard/\n```'), 'guard/a.js': 'a();\n' };
  const edited = judge(repo(t, base, { 'docs/agents/commands.md': CONTRACT('none'), 'guard/a.js': 'b();\n' }));
  assert.equal(edited.tier, 'full');

  const moved = judge(repo(t, base, { 'guard/a.js': null, 'lib/a.js': 'a();\n' }));
  assert.deepEqual(moved.signals.sensitive, ['guard/a.js']);
  assert.equal(moved.tier, 'full');
});

// #139: this repo's own contract. The sensitive paths are the permission boundary, CI, the plugin manifest and the
// state format: a change to an agent definition is full however small; a change to any other script of the two
// skills is judged by its line count (the state script's schema symbols: #152 below).
const OWN_CONTRACT = readFileSync(fileURLToPath(new URL('../docs/agents/commands.md', import.meta.url)), 'utf8');
const OWN_STATE = readFileSync(fileURLToPath(new URL('../src/skills/get-to-work/scripts/state.mjs', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
test("#139: this repo's contract: agent definitions are full; other skill scripts go by line count", (t) => {
  const own = { 'docs/agents/commands.md': OWN_CONTRACT };
  for (const path of [
    'src/agents/finder.md',
    'agents/implementer.md',
    'hooks/guard.mjs',
    '.github/workflows/check.yml',
    '.claude-plugin/plugin.json',
    'scripts/check-structure.mjs',
    'scripts/check-vendored.mjs',
  ]) {
    const out = judge(repo(t, own, { [path]: 'a();\nb();\n' }));
    assert.deepEqual([out.tier, out.reasons, out.signals.sensitive], ['full', ['sensitive'], [path]], path);
  }
  for (const path of ['src/skills/get-to-work/scripts/tick.mjs', 'skills/get-to-work/scripts/brief.mjs', 'src/skills/prove-it/scripts/tier.mjs', 'skills/prove-it/scripts/mutate.mjs']) {
    const small = judge(repo(t, own, { [path]: lines(50) }));
    assert.deepEqual([small.tier, small.reasons, small.signals.sensitive], ['light', ['few-lines'], []], `${path}, 50 lines`);
    const larger = judge(repo(t, own, { [path]: lines(51) }));
    assert.deepEqual([larger.tier, larger.reasons], ['standard', ['default']], `${path}, 51 lines`);
  }
});

// #152: this repo's contract names the state script's schema by symbol: the constants, the shape and the stage
// rules. A change there is full however small; a change to the rest of the file (commands, IO, argument parsing)
// goes by its line count. Both the src and the dist copy.
test("#152: this repo's contract: the state script's schema symbols are full; the rest of it goes by line count", (t) => {
  for (const path of ['src/skills/get-to-work/scripts/state.mjs', 'skills/get-to-work/scripts/state.mjs']) {
    const own = { 'docs/agents/commands.md': OWN_CONTRACT, [path]: OWN_STATE };
    for (const [what, from, to] of [
      ['check', "need(isText(state.run), 'run', 'is not a run name');", "need(typeof state.run === 'string', 'run', 'is not a run name');"],
      ['queueFromReview', "if (r.verdict === 'pass') return null;", "if (r.verdict !== 'stuck') return null;"],
      ['EDGES', "delivered: ['stuck'],", "delivered: ['stuck', 'candidate'],"],
      ['newTicket', '  sendBacks: 0,\n  fixRounds: 0,\n  reviews: [],', '  sendBacks: 0,\n  fixRounds: 1,\n  reviews: [],'],
    ]) {
      const out = judge(repo(t, own, { [path]: swap(OWN_STATE, from, to) }));
      assert.deepEqual([out.tier, out.reasons, out.signals.sensitive], ['full', ['sensitive'], [path]], `${path}: ${what}`);
    }
    const marker = 'function parseArgs(argv, spec) {';
    const small = judge(repo(t, own, { [path]: swap(OWN_STATE, marker, `${marker}\n  void 0;`) }));
    assert.deepEqual([small.tier, small.reasons, small.signals.sensitive], ['light', ['few-lines'], []], `${path}: parseArgs, 1 line`);
    const larger = judge(repo(t, own, { [path]: swap(OWN_STATE, marker, `${marker}\n${lines(51, '  void ')}`.trimEnd()) }));
    assert.deepEqual([larger.tier, larger.reasons, larger.signals.sensitive], ['standard', ['default'], []], `${path}: parseArgs, 51 lines`);
  }
});

test('#152: every state.mjs symbol the contract names resolves in the state script, src and dist alike', () => {
  const entries = parseSensitive(OWN_CONTRACT).map(sensitiveEntry).filter((e) => e.symbol.length);
  const dist = readFileSync(fileURLToPath(new URL('../skills/get-to-work/scripts/state.mjs', import.meta.url)), 'utf8');
  for (const [path, text] of [['src/skills/get-to-work/scripts/state.mjs', OWN_STATE], ['skills/get-to-work/scripts/state.mjs', dist]]) {
    const named = entries.filter((e) => e.re.test(path));
    assert.ok(named.length >= 27, `${path}: ${named.length} symbols named`);
    for (const e of named) assert.ok(symbolRanges(text, path, e.symbol), `${path}#${e.symbol.join('#')} does not resolve`);
  }
});

test("#152: tier.mjs's own splitEntry splits as overlap.mjs's does", () => {
  for (const text of ['a/b.mjs', 'a/b.mjs#f', 'a/b.mjs # f ', 'a.md#Outer#Inner', 'a.mjs#', 'a.mjs##x', '#x', '']) {
    assert.deepEqual(splitEntry(text), overlapSplitEntry(text), JSON.stringify(text));
  }
});

// #152: a sensitive entry can name a symbol, `path#symbol` as in a predicted-files list (overlap.mjs): only a change
// that touches the symbol is sensitive; a change elsewhere in the file goes by its line count.
const STATE = [
  "export const FORMAT = 'demo/state@1';",
  '',
  'export function schema(state) {',
  '  if (state.format !== FORMAT) return false;',
  '  return Array.isArray(state.tickets);',
  '}',
  '',
  'function add(state, id) {',
  '  state.tickets.push(id);',
  '  return state;',
  '}',
  '',
].join('\n');
const swap = (text, from, to) => {
  assert.ok(text.includes(from), from);
  return text.replace(from, to);
};

test('#152: a sensitive path#symbol is full when the diff touches the symbol; the rest of the file goes by line count', (t) => {
  const base = { 'docs/agents/commands.md': CONTRACT('```text\nsrc/state.mjs#schema\n```'), 'src/state.mjs': STATE };

  const inSchema = judge(repo(t, base, { 'src/state.mjs': swap(STATE, 'Array.isArray(state.tickets)', 'Array.isArray(state.tickets) && state.run') }));
  assert.deepEqual([inSchema.tier, inSchema.reasons, inSchema.signals.sensitive], ['full', ['sensitive'], ['src/state.mjs']]);

  const elsewhere = judge(repo(t, base, { 'src/state.mjs': swap(STATE, 'state.tickets.push(id);', 'state.tickets.push(String(id));') }));
  assert.deepEqual([elsewhere.tier, elsewhere.reasons, elsewhere.signals.sensitive], ['light', ['few-lines'], []]);

  const larger = judge(repo(t, base, { 'src/state.mjs': `${STATE}${lines(51)}` }));
  assert.deepEqual([larger.tier, larger.reasons, larger.signals.sensitive], ['standard', ['default'], []]);
});

test('#152: a symbol that does not resolve fails safe: renamed, removed, never there, or the file deleted are full', (t) => {
  const base = { 'docs/agents/commands.md': CONTRACT('```text\nsrc/state.mjs#schema\n```'), 'src/state.mjs': STATE };
  const cases = {
    renamed: swap(STATE, 'function schema(', 'function shape('),
    removed: STATE.split('\n').filter((_, i) => i < 2 || i > 6).join('\n'),
    deleted: null,
  };
  for (const [name, text] of Object.entries(cases)) {
    const out = judge(repo(t, base, { 'src/state.mjs': text }));
    assert.deepEqual([out.tier, out.signals.sensitive], ['full', ['src/state.mjs']], name);
  }
  const stale = { 'docs/agents/commands.md': CONTRACT('```text\nsrc/state.mjs#nowhere\n```'), 'src/state.mjs': STATE };
  const never = judge(repo(t, stale, { 'src/state.mjs': swap(STATE, 'state.tickets.push(id);', 'state.tickets.push(String(id));') }));
  assert.deepEqual([never.tier, never.signals.sensitive], ['full', ['src/state.mjs']]);
});

test('#152: a markdown heading, a nested symbol and a declaration over several lines', (t) => {
  const doc = '# Guide\n\n## Setup\n\nstep one\n\n### Keys\n\nkey a\n\n## Usage\n\nuse it\n';
  const docs = { 'docs/agents/commands.md': CONTRACT('```text\ndocs/guide.md#Guide#Setup\n```'), 'docs/guide.md': doc };
  const inSetup = judge(repo(t, docs, { 'docs/guide.md': swap(doc, 'key a', 'key b') }));
  assert.deepEqual([inSetup.tier, inSetup.signals.sensitive], ['full', ['docs/guide.md']], 'a subsection is part of its section');
  const inUsage = judge(repo(t, docs, { 'docs/guide.md': swap(doc, 'use it', 'use it well') }));
  assert.deepEqual([inUsage.tier, inUsage.reasons, inUsage.signals.sensitive], ['light', ['docs-only'], []]);

  const code = [
    'export class Store {',
    '  constructor() {',
    '    this.items = [];',
    '  }',
    '',
    '  validate(',
    '    item,',
    '  ) {',
    '    return item != null;',
    '  }',
    '}',
    '',
  ].join('\n');
  const nested = { 'docs/agents/commands.md': CONTRACT('```text\nsrc/store.mjs # Store # validate\n```'), 'src/store.mjs': code };
  const inBody = judge(repo(t, nested, { 'src/store.mjs': swap(code, 'item != null', 'item !== undefined') }));
  assert.deepEqual([inBody.tier, inBody.signals.sensitive], ['full', ['src/store.mjs']], 'the body past a multi-line signature');
  const inConstructor = judge(repo(t, nested, { 'src/store.mjs': swap(code, 'this.items = [];', 'this.items = new Set();') }));
  assert.deepEqual([inConstructor.tier, inConstructor.signals.sensitive], ['light', []]);
});

test('thresholds are configurable and reported; bad values exit 2', (t) => {
  const dir = repo(t, {}, { 'src/a.js': lines(51) });
  const raised = judge(dir, '--light-max-lines', '60', '--light-cap', '2');
  assert.equal(raised.tier, 'light');
  assert.equal(raised.thresholds.lightMaxLines, 60);
  assert.equal(raised.mutationCap, 2);
  assert.equal(raised.thresholds.fullOverLines, 400);
  assert.equal(judge(dir, '--full-over-lines', '50').tier, 'full');
  assert.deepEqual(judge(dir, '--standard-max-verifiers', '2').verifiers, { max: 2 });

  for (const bad of [['--light-max-lines', '0'], ['--full-over-lines', '1.5'], ['--standard-cap', 'x'], ['--full-cap', '11']]) {
    const r = main(['judge', '--base', 'main', ...bad], defaultDeps(dir));
    assert.equal(r.code, 2, bad.join(' '));
    assert.equal(r.out, '');
  }
});

test('lens pruning: no deleted lines drops deleted-behaviour; a deletion keeps it', (t) => {
  const added = judge(repo(t, { 'AGENTS.md': 'rules\n', 'src/a.js': 'a();\n' }, { 'src/a.js': 'a();\nb();\n' }));
  assert.equal(added.signals.deleted, 0);
  assert.ok(added.finders.flat().every((l) => l !== 'deleted-behaviour'));
  assert.ok(added.pruned.some((p) => p.lens === 'deleted-behaviour'));

  const removed = judge(repo(t, { 'AGENTS.md': 'rules\n', 'src/a.js': 'a();\nb();\n' }, { 'src/a.js': 'a();\n' }));
  assert.ok(removed.finders.flat().includes('deleted-behaviour'));
});

test('lens pruning: conventions only when a rule file sits at the root or above a changed file', (t) => {
  const bare = judge(repo(t, { 'pkg/CLAUDE.md': 'rules\n' }, { 'src/a.js': 'a();\n' }));
  assert.deepEqual(bare.signals.ruleFiles, []);
  assert.ok(!bare.finders.flat().includes('conventions'));

  const nested = judge(repo(t, { 'pkg/CLAUDE.md': 'rules\n' }, { 'pkg/a.js': 'a();\n' }));
  assert.deepEqual(nested.signals.ruleFiles, ['pkg/CLAUDE.md']);
  assert.ok(nested.finders.flat().includes('conventions'));

  const root = judge(repo(t, { 'CONTRIBUTING.md': 'rules\n' }, { 'src/a.js': 'a();\n' }));
  assert.deepEqual(root.signals.ruleFiles, ['CONTRIBUTING.md']);
});

test('lens pruning: a changed export signature keeps cross-file; a body-only edit folds it into line-by-line', (t) => {
  const base = { 'src/a.js': 'export function f(a) {\n  return a + 1;\n}\nexport const x = 1;\n' };
  const signature = judge(repo(t, base, { 'src/a.js': 'export function f(a, b) {\n  return a + 1;\n}\nexport const x = 1;\n' }));
  assert.equal(signature.signals.signatureChanged, true);
  assert.ok(signature.finders.flat().includes('cross-file'));

  const removedExport = judge(repo(t, base, { 'src/a.js': 'export function f(a) {\n  return a + 1;\n}\n' }));
  assert.equal(removedExport.signals.signatureChanged, true);

  const body = judge(repo(t, base, { 'src/a.js': 'export function f(a) {\n  return a + 2;\n}\nexport const x = 1;\n' }));
  assert.equal(body.signals.signatureChanged, false);
  assert.ok(!body.finders.flat().includes('cross-file'));
  assert.ok(body.finders[0].includes('line-by-line'));
  assert.match(body.pruned.find((p) => p.lens === 'cross-file').reason, /folded into line-by-line/);
});

test('finders: light is one finder, standard two, full the three unpruned groups; line-by-line and acceptance always present', (t) => {
  const small = judge(repo(t, { 'src/a.js': 'a();\n' }, { 'src/a.js': 'b();\n' }));
  assert.deepEqual(small.finders, [['line-by-line', 'deleted-behaviour', 'acceptance']]);

  const medium = judge(repo(t, { 'src/a.js': 'a();\n' }, { 'src/a.js': lines(60) }));
  assert.deepEqual(medium.finders, [['line-by-line', 'deleted-behaviour'], ['acceptance']]);

  const large = judge(repo(t, {}, { 'src/a.js': lines(401) }));
  assert.deepEqual(large.finders, [['line-by-line', 'deleted-behaviour'], ['cross-file'], ['acceptance', 'conventions']]);
  assert.deepEqual(large.pruned, []);
});

// #105 (#82 proposal 4): the architecture specialist reviewer runs only on the high-risk tier, full, whichever
// condition made it full; every other tier has the primary Finders alone.
test('reviewers: full adds architecture, by sensitive path or by line count; light and standard are primary only', (t) => {
  const docs = judge(repo(t, {}, { 'docs/guide.md': lines(500, 'line ') }));
  assert.equal(docs.tier, 'light');
  assert.deepEqual(docs.reviewers, ['primary']);

  const small = judge(repo(t, {}, { 'src/a.js': lines(50) }));
  assert.equal(small.tier, 'light');
  assert.deepEqual(small.reviewers, ['primary']);

  const medium = judge(repo(t, {}, { 'src/a.js': lines(400) }));
  assert.equal(medium.tier, 'standard');
  assert.deepEqual(medium.reviewers, ['primary']);

  const large = judge(repo(t, {}, { 'src/a.js': lines(401) }));
  assert.deepEqual(large.reasons, ['over-lines']);
  assert.deepEqual(large.reviewers, ['primary', 'architecture']);

  const sensitive = judge(repo(t, {}, { 'hooks/guard.mjs': 'a();\n' }));
  assert.equal(sensitive.tier, 'full');
  assert.deepEqual(sensitive.reasons, ['sensitive']);
  assert.deepEqual(sensitive.reviewers, ['primary', 'architecture']);

  const raised = judge(repo(t, {}, { 'src/a.js': lines(60) }), '--full-over-lines', '59');
  assert.equal(raised.tier, 'full');
  assert.deepEqual(raised.reviewers, ['primary', 'architecture'], 'a tier made full by a threshold flag adds it too');
});

test('errors: not a repository or an unknown base exit 1; usage mistakes exit 2; nothing on stdout', (t) => {
  const plain = tempDir(t);
  const notRepo = main(['judge', '--base', 'main'], defaultDeps(plain));
  assert.equal(notRepo.code, 1);
  assert.equal(notRepo.out, '');

  const dir = repo(t, {}, { 'src/a.js': 'a();\n' });
  const unknown = main(['judge', '--base', 'nope'], defaultDeps(dir));
  assert.equal(unknown.code, 1);
  assert.match(unknown.err, /nope/);

  for (const argv of [['judge'], ['judge', '--base', 'main', 'extra'], ['judge', '--base', 'main', '--base', 'main'], ['lines', '--base', 'main'], []]) {
    const r = main(argv, defaultDeps(dir));
    assert.equal(r.code, 2, argv.join(' '));
    assert.equal(r.out, '');
  }

  const cli = spawnSync(process.execPath, [SCRIPT, 'judge', '--base', 'main'], { cwd: dir, encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).tier, 'light');
});

test('patternRegex: directory prefixes, exact paths and globs', () => {
  assert.ok(patternRegex('hooks/').test('hooks/a.mjs'));
  assert.ok(!patternRegex('hooks/').test('src/hooks/a.mjs'));
  assert.ok(!patternRegex('hooks/').test('hooks.md'));
  assert.ok(patternRegex('**/migrations/').test('db/migrations/1.sql'));
  assert.ok(patternRegex('**/migrations/').test('migrations/1.sql'));
  assert.ok(patternRegex('docker-compose*.y*ml').test('docker-compose.prod.yaml'));
  assert.ok(!patternRegex('a.json').test('a.json.bak'));
  assert.ok(!patternRegex('a.json').test('axjson'));
});

test('parseSensitive: fenced block, list items, none, and no section', () => {
  assert.deepEqual(parseSensitive(CONTRACT('```text\nhooks/\n.github/workflows/\n```')), ['hooks/', '.github/workflows/']);
  assert.deepEqual(parseSensitive(CONTRACT('- `hooks/`\n- ci.yml')), ['hooks/', 'ci.yml']);
  assert.deepEqual(parseSensitive(CONTRACT('none')), []);
  assert.deepEqual(parseSensitive(CONTRACT('`none`')), []);
  assert.equal(parseSensitive('# Commands\n\n## Full checks\n\nnone\n'), null);
  assert.equal(parseSensitive(null), null);
});

const C = (id, file, suspected = 'none') => ({ id, file, suspected });

test('batch verify: light is one verifier; suspected candidates form their own short-path batch', () => {
  const items = [C('C1', 'a.js'), C('C2', 'b.js', 'spec'), C('C3', 'c.js')];
  assert.deepEqual(batchItems({ tier: 'light', items }), [{ files: ['b.js', 'a.js', 'c.js'], short: ['C2'], normal: ['C1', 'C3'] }]);
  assert.deepEqual(batchItems({ tier: 'full', items }), [
    { files: ['b.js'], short: ['C2'], normal: [] },
    { files: ['a.js'], short: [], normal: ['C1'] },
    { files: ['c.js'], short: [], normal: ['C3'] },
  ]);
  assert.deepEqual(batchItems({ tier: 'standard', items: [] }), []);
});

test('batch verify: a candidate another open ticket covers (#205) goes on the short path', () => {
  const items = [C('C1', 'a.js', 'covered'), C('C2', 'b.js')];
  assert.deepEqual(batchItems({ tier: 'full', items }), [
    { files: ['a.js'], short: ['C1'], normal: [] },
    { files: ['b.js'], short: [], normal: ['C2'] },
  ]);
});

test('batch verify: standard folds the file groups with the fewest candidates so the total stays at the max', () => {
  const items = [C('C1', 'a.js'), C('C2', 'a.js'), C('C3', 'b.js'), C('C4', 'c.js'), C('C5', 'c.js'), C('C6', 'c.js'), C('C7', 'd.js', 'pre-existing')];
  const batches = batchItems({ tier: 'standard', items });
  assert.equal(batches.length, 3);
  assert.deepEqual(batches, [
    { files: ['d.js'], short: ['C7'], normal: [] },
    { files: ['a.js', 'b.js'], short: [], normal: ['C1', 'C2', 'C3'] },
    { files: ['c.js'], short: [], normal: ['C4', 'C5', 'C6'] },
  ]);
  const ids = batches.flatMap((b) => [...b.short, ...b.normal]).sort();
  assert.deepEqual(ids, items.map((i) => i.id).sort());
});

test('batch fix: one Fix Verifier for light and standard, one per file for full', (t) => {
  const items = [C('F1', 'a.js'), C('F2', 'b.js'), C('F3', 'a.js')];
  assert.deepEqual(batchItems({ tier: 'standard', stage: 'fix', items }), [{ files: ['a.js', 'b.js'], ids: ['F1', 'F2', 'F3'] }]);
  assert.deepEqual(batchItems({ tier: 'full', stage: 'fix', items }), [
    { files: ['a.js'], ids: ['F1', 'F3'] },
    { files: ['b.js'], ids: ['F2'] },
  ]);

  const dir = tempDir(t);
  writeFileSync(join(dir, 'items.json'), JSON.stringify({ items }));
  writeFileSync(join(dir, 'tier.json'), JSON.stringify({ format: 'sorry-matt/tier@1', tier: 'standard', verifiers: { max: 1 } }));
  const viaFile = main(['batch', '--tier-file', 'tier.json', '--items', 'items.json'], defaultDeps(dir));
  assert.equal(viaFile.code, 0, viaFile.err);
  assert.equal(JSON.parse(viaFile.out).batches.length, 1);
  const fix = JSON.parse(main(['batch', '--tier', 'full', '--stage', 'fix', '--items', 'items.json'], defaultDeps(dir)).out);
  assert.equal(fix.format, 'sorry-matt/tier-batch@1');
  assert.equal(fix.batches.length, 2);

  writeFileSync(join(dir, 'dup.json'), JSON.stringify([C('F1', 'a.js'), C('F1', 'b.js')]));
  assert.equal(main(['batch', '--tier', 'full', '--items', 'dup.json'], defaultDeps(dir)).code, 2);
  assert.equal(main(['batch', '--tier', 'huge', '--items', 'items.json'], defaultDeps(dir)).code, 2);
  assert.equal(main(['batch', '--tier', 'full', '--tier-file', 'tier.json', '--items', 'items.json'], defaultDeps(dir)).code, 2);
  assert.equal(main(['batch', '--tier', 'full', '--items', 'missing.json'], defaultDeps(dir)).code, 1);
});
