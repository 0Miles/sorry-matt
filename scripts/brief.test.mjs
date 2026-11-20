// node --test scripts/brief.test.mjs
// Drives get-to-work's brief.mjs through main() — the src copy, which fills the Traditional Chinese templates and
// reads the Traditional Chinese agent definitions in src/agents, and the dist copy, which fills the English ones and
// reads agents/ — and, once, as a process. Values files, ticket texts and acceptance snapshots are written to a temp
// dir. The expected lines are copied by hand from the templates' and the definitions' text; the role and ticket a
// description stands for are read back with spawns.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { main, choose } from '../src/skills/get-to-work/scripts/brief.mjs';
import { main as distMain } from '../skills/get-to-work/scripts/brief.mjs';
import { category, ticketOf, main as spawnsMain } from '../src/skills/get-to-work/scripts/spawns.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'src/skills/get-to-work/scripts/brief.mjs');

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sorry-matt-brief-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const put = (dir, name, content) => {
  const path = join(dir, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
  return path;
};
const parse = (r) => ({ ...r, json: r.code === 0 ? JSON.parse(r.out) : null });
const LEFTOVER = /\{[^{}]*\}/;

// A GitHub snapshot as acceptance.mjs writes it, with one expansion block.
const EXPANSION = '<!-- sorry-matt:expansion -->\nby: expansion-agent\nrun: r1\nround: 2\n\nacceptance:\n- [ ] prints ok';
const githubSnapshot = {
  format: 'sorry-matt/acceptance@1',
  tracker: 'github',
  source: 'acme/widgets',
  id: '#72',
  title: 'Widgets',
  items: [{ from: 'expansion', by: 'expansion-agent', run: 'r1', round: '2', text: 'prints ok' }],
  expansions: [{ by: 'expansion-agent', run: 'r1', round: '2', at: 'https://example.invalid/c/1', text: EXPANSION }],
  needsExpansion: false,
  sha256: '0'.repeat(64),
};

function implementValues(dir, overrides = {}) {
  const worktree = join(dir, 'wt');
  mkdirSync(worktree, { recursive: true });
  return {
    out: join(dir, 'briefs', '72.md'),
    snapshot: put(dir, 'snap.json', githubSnapshot),
    worktree,
    branch: 'r1/72-widgets',
    integration: 'r1/line-a',
    bodyFile: put(dir, 'body.md', '﻿Widgets body\r\n## Scope\r\nmake it\r\n'),
    sendBackFile: null,
    acceptance: 'criteria',
    ...overrides,
  };
}
const runImplement = (t, overrides, entry = main) => {
  const dir = scratch(t);
  const values = implementValues(dir, overrides);
  const r = parse(entry(['implement', put(dir, 'values.json', values)]));
  return { ...r, dir, values, ...written(r) };
};
// The spawn file and its general-purpose fallback a successful run wrote.
const written = (r) => ({
  brief: r.code === 0 ? readFileSync(r.json.brief, 'utf8') : null,
  fallback: r.code === 0 ? readFileSync(r.json.fallback, 'utf8') : null,
});

function expandValues(dir, overrides = {}) {
  return {
    out: join(dir, 'briefs', 'expand-3.md'),
    run: 'r1',
    round: 3,
    tracker: 'github',
    repo: 'acme/widgets',
    lines: [
      { branch: 'r1/line-a', worktree: join(dir, 'int-a') },
      { branch: 'r1/line-b', worktree: join(dir, 'int-b') },
    ],
    spec: null,
    tickets: [
      { id: '#75', line: 'r1/line-a', bodyFile: put(dir, 't75.md', 'Body 75\nsecond line') },
      { id: '#83', line: 'r1/line-b', bodyFile: put(dir, 't83.md', 'Body 83') },
    ],
    ...overrides,
  };
}
const runExpand = (t, overrides, entry = main) => {
  const dir = scratch(t);
  const values = expandValues(dir, typeof overrides === 'function' ? overrides(dir) : overrides);
  const r = parse(entry(['expand', put(dir, 'values.json', values)]));
  return { ...r, dir, values, ...written(r) };
};

test('implement fills every IMPLEMENTER.md placeholder and prints the brief path and the description', (t) => {
  const r = runImplement(t);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.format, 'sorry-matt/brief@1');
  assert.equal(r.json.kind, 'implement');
  assert.equal(r.json.role, 'implement');
  assert.equal(r.json.description, 'implement #72');
  assert.equal(r.json.brief, r.values.out);
  assert.equal(r.json.prompt, `Read ${r.values.out} in full and follow it.`);
  assert.doesNotMatch(r.brief, LEFTOVER, 'no placeholder is left');
  assert.ok(r.brief.startsWith('派工內容：這張票的值。'), 'the brief is the text below the rule, without the host header');
  assert.doesNotMatch(r.brief, /brief\.mjs` 填好/);
  assert.doesNotMatch(r.brief, /\r/, 'LF line ends');
  const values = [
    '- 票：#72（tracker：GitHub (acme/widgets)）',
    `- ticket worktree：${r.values.worktree}（分支 r1/72-widgets）`,
    '- 整合分支：r1/line-a',
    '- 票面全文：Widgets body\n  ## Scope\n  make it\n',
    '- 展開區塊：<!-- sorry-matt:expansion -->\n  by: expansion-agent\n  run: r1\n  round: 2\n\n  acceptance:\n  - [ ] prints ok\n',
    '- 專案指令契約：none\n',
    '- 退回紀錄：none\n',
    '- 驗收來源：驗收項與展開區塊\n',
  ];
  for (const line of values) assert.ok(r.brief.includes(line), `has ${JSON.stringify(line)}`);
  // #126: the fixed rules are in the agent definition, not in the spawn file; the fallback carries both
  for (const rule of ['## 1. 開工', '完成判準：成果已 commit 到 ticket 分支'])
    assert.ok(!r.brief.includes(rule) && r.fallback.includes(rule), `${JSON.stringify(rule)} only in the fallback`);
  for (const line of values) assert.ok(r.fallback.includes(line), `the fallback has ${JSON.stringify(line)}`);
});

test('implement names the agent type and writes the general-purpose fallback: the definition body, then the values', (t) => {
  const r = runImplement(t);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.agentType, 'sorry-matt:implementer');
  assert.equal(r.json.fallback, join(r.dir, 'briefs', '72.general-purpose.md'));
  assert.equal(r.json.fallbackPrompt, `Read ${r.json.fallback} in full and follow it.`);
  assert.ok(r.fallback.startsWith('# 實作 agent\n\n你是 sorry-matt `get-to-work` 的實作 agent，負責一張票。'), 'the body, no frontmatter');
  assert.doesNotMatch(r.fallback, /^name: implementer$/m);
  assert.ok(r.fallback.endsWith(`\n\n---\n\n${r.brief}`), 'the body is followed by the spawn file itself');
  assert.doesNotMatch(r.fallback, /\r|[ \t]$/m, 'LF line ends, no trailing whitespace');
});

test('implement points at the worktree command contract when it exists, and fills a send-back record', (t) => {
  const dir = scratch(t);
  const worktree = join(dir, 'wt');
  const contract = put(worktree, 'docs/agents/commands.md', '# Commands\n');
  const values = implementValues(dir, { sendBackFile: put(dir, 'sendback.md', 'ref refs/x abc\nfiles: a.js') });
  const r = parse(main(['implement', put(dir, 'values.json', values)]));
  assert.equal(r.code, 0, r.err);
  const brief = readFileSync(r.json.brief, 'utf8');
  assert.ok(brief.includes(`- 專案指令契約：${contract}\n`));
  assert.ok(brief.includes('- 退回紀錄：ref refs/x abc\n  files: a.js\n'));
});

test('implement takes the fix and ci-fix roles; a Local Markdown ticket is named by its file name', (t) => {
  const local = { ...githubSnapshot, tracker: 'local', source: 'r1/line-a', id: '.scratch/feat/issues/03-add-login.md', expansions: [] };
  for (const role of ['fix', 'ci-fix']) {
    const dir = scratch(t);
    const values = implementValues(dir, { role, snapshot: put(dir, 'local-snap.json', local) });
    const r = parse(main(['implement', put(dir, 'values.json', values)]));
    assert.equal(r.code, 0, r.err);
    assert.equal(r.json.role, role);
    assert.equal(r.json.description, `${role} 03-add-login.md`);
    const brief = readFileSync(r.json.brief, 'utf8');
    assert.ok(brief.includes('- 票：.scratch/feat/issues/03-add-login.md（tracker：Local Markdown）'));
    assert.ok(brief.includes('- 展開區塊：none\n'));
  }
});

test('the dist copy fills the English IMPLEMENTER.md the same way', (t) => {
  const r = runImplement(t, {}, distMain);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.description, 'implement #72');
  assert.equal(r.json.agentType, 'sorry-matt:implementer');
  assert.doesNotMatch(r.brief, LEFTOVER);
  assert.ok(r.brief.startsWith("Spawn file: this ticket's values."));
  assert.ok(r.fallback.startsWith('# Implementation agent\n\nYou are the implementation agent of the sorry-matt `get-to-work` skill, for one ticket.'));
  assert.ok(r.fallback.includes('## 1. Start') && !r.brief.includes('## 1. Start'));
  assert.ok(r.fallback.endsWith(`\n\n---\n\n${r.brief}`));
  for (const line of [
    '- Ticket: #72 (tracker: GitHub (acme/widgets))',
    `- Ticket worktree: ${r.values.worktree} (branch r1/72-widgets)`,
    '- Integration branch: r1/line-a',
    '- Ticket text: Widgets body\n  ## Scope\n  make it\n',
    '- Project command contract: none\n',
    '- Send-back record: none\n',
    '- Acceptance source: the acceptance criteria and the expansion block\n',
  ])
    assert.ok(r.brief.includes(line), `has ${JSON.stringify(line)}`);
});

test('#128 D3: acceptance ticket-text writes that the ticket text is the acceptance, in the spawn file and its fallback', (t) => {
  for (const [entry, textLine, criteriaLine] of [
    [main, '- 驗收來源：票面文字就是驗收\n', '- 驗收來源：驗收項與展開區塊\n'],
    [distMain, '- Acceptance source: the ticket text is the acceptance\n', '- Acceptance source: the acceptance criteria and the expansion block\n'],
  ]) {
    const r = runImplement(t, { acceptance: 'ticket-text' }, entry);
    assert.equal(r.code, 0, r.err);
    const c = runImplement(t, { acceptance: 'criteria' }, entry);
    assert.equal(c.code, 0, c.err);
    for (const text of [r.brief, r.fallback]) assert.ok(text.includes(textLine) && !text.includes(criteriaLine), `ticket-text: ${JSON.stringify(textLine)}`);
    for (const text of [c.brief, c.fallback]) assert.ok(text.includes(criteriaLine) && !text.includes(textLine), `criteria: ${JSON.stringify(criteriaLine)}`);
  }
});

test('#130: a ci-fix spawn for a ticket whose snapshot has no criteria, with acceptance ticket-text, says the ticket text is the acceptance', (t) => {
  for (const [entry, textLine] of [
    [main, '- 驗收來源：票面文字就是驗收\n'],
    [distMain, '- Acceptance source: the ticket text is the acceptance\n'],
  ]) {
    const dir = scratch(t);
    const bare = { ...githubSnapshot, items: [], expansions: [], needsExpansion: true };
    const values = implementValues(dir, {
      role: 'ci-fix',
      snapshot: put(dir, 'bare-snap.json', bare),
      branch: 'r1/72-widgets-ci',
      bodyFile: put(dir, 'body-ci.md', 'Widgets body\n\nCI failure: test x failed'),
      sendBackFile: null,
      acceptance: 'ticket-text',
    });
    const r = parse(entry(['implement', put(dir, 'values.json', values)]));
    assert.equal(r.code, 0, r.err);
    assert.equal(r.json.description, 'ci-fix #72');
    const { brief, fallback } = written(r);
    for (const text of [brief, fallback]) {
      assert.ok(text.includes(textLine), `${JSON.stringify(textLine)} in\n${text}`);
      assert.ok(text.includes('CI failure: test x failed'), 'the failure summary is in the ticket text');
    }
    assert.ok(brief.includes(entry === main ? '- 展開區塊：none\n' : '- Expansion block: none\n'));
  }
});

test('#130: the sentence section 1 point 3 of each implementer definition quotes is the ticket-text= text of its IMPLEMENTER.md', () => {
  for (const [definition, template, quote] of [
    ['agents/implementer.md', 'skills/get-to-work/IMPLEMENTER.md', /"([^"]+)"/],
    ['src/agents/implementer.md', 'src/skills/get-to-work/IMPLEMENTER.md', /「([^」]+)」/],
  ]) {
    const def = readFileSync(join(root, definition), 'utf8').replace(/\r\n/g, '\n');
    const section = def.slice(def.indexOf('\n## 1. '), def.indexOf('\n## 2. '));
    const point = section.slice(section.indexOf('\n3. '), section.indexOf('\n4. '));
    assert.ok(point.length > 4, `${definition} has section 1 point 3`);
    const quoted = quote.exec(point)?.[1];
    assert.ok(quoted, `${definition} section 1 point 3 quotes a sentence`);
    const path = join(root, template);
    const tpl = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
    const placeholder = tpl.slice(tpl.search(/^---$/m)).match(/\{[^{}]*ticket-text=[^{}]*\}/)?.[0];
    assert.ok(placeholder, `${template} has the acceptance choice placeholder`);
    assert.equal(quoted, choose('ticket-text')(placeholder, path), `${definition} quotes what ${template} writes for ticket-text`);
  }
});

test('expand fills every EXPANDER.md placeholder with each line and each ticket', (t) => {
  const r = runExpand(t, {});
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.kind, 'expand');
  assert.equal(r.json.role, 'expand');
  assert.equal(r.json.description, 'expand #75 #83');
  assert.equal(r.json.agentType, 'sorry-matt:expander');
  assert.equal(r.json.fallback, join(r.dir, 'briefs', 'expand-3.general-purpose.md'));
  assert.equal(r.json.fallbackPrompt, `Read ${r.json.fallback} in full and follow it.`);
  assert.doesNotMatch(r.brief, LEFTOVER);
  assert.ok(r.brief.startsWith('派工內容：這次展開的值。'));
  assert.ok(r.fallback.startsWith('# 展開 agent\n\n你是 sorry-matt `get-to-work` 的展開 agent'));
  assert.ok(r.fallback.endsWith(`\n\n---\n\n${r.brief}`));
  const [a, b] = r.values.lines.map((l) => l.worktree);
  for (const line of [
    '- run：r1；派票點：3\n',
    '- tracker：GitHub (acme/widgets)\n',
    `- 整合 worktree：\n  - r1/line-a: ${a}\n  - r1/line-b: ${b}\n`,
    '- spec：none\n',
    '- 待展開的票：\n  - #75 [r1/line-a]\n    Body 75\n    second line\n  - #83 [r1/line-b]\n    Body 83\n',
  ])
    assert.ok(r.brief.includes(line), `has ${JSON.stringify(line)}`);
  assert.ok(r.fallback.includes('## 1. 查證') && !r.brief.includes('## 1. 查證'), 'the rules only in the fallback');
});

test('the dist copy fills the English EXPANDER.md; a Local Markdown run names the spec', (t) => {
  const r = runExpand(t, (dir) => ({ tracker: 'local', repo: undefined, spec: 'docs/spec.md', tickets: [{ id: '.scratch/f/issues/03-a.md', line: 'r1/line-a', bodyFile: put(dir, 'a.md', 'A') }] }), distMain);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.description, 'expand 03-a.md');
  assert.doesNotMatch(r.brief, LEFTOVER);
  assert.ok(r.fallback.startsWith('# Expansion agent\n\n'));
  assert.ok(r.fallback.includes('## 1. Establish the facts') && !r.brief.includes('## 1. Establish the facts'));
  for (const line of ['- Run: r1; dispatch point: 3\n', '- Tracker: Local Markdown\n', '- Spec: docs/spec.md\n', '- Tickets to expand:\n  - .scratch/f/issues/03-a.md [r1/line-a]\n    A\n'])
    assert.ok(r.brief.includes(line), `has ${JSON.stringify(line)}`);
});

// #138: the review host agent's values, as tick writes them for a prove-it review.
const REPORT = 'ticket: #72\ncommit: 0a1b2c3 (branch r1/72-widgets)\ntargeted checks: source=commands.md; node --test scripts/a.test.mjs → green\nstatus record: https://example.invalid/c/9\n';
function reviewValues(dir, overrides = {}) {
  return {
    out: join(dir, 'review', '72-1.md'),
    mode: 'initial',
    root: join(dir, 'repo'),
    tracker: 'github',
    repo: 'acme/widgets',
    ticket: '#72',
    bodyFile: put(dir, 'body.md', '# Widgets\n\nbody'),
    statusRecord: 'the comment on acme/widgets#72 whose first line is `<!-- sorry-matt:status -->`',
    snapshot: put(dir, 'snap.json', githubSnapshot),
    against: put(dir, 'against.json', { ...githubSnapshot, check: { changed: false } }),
    fixedPoint: 'r1/line-a',
    branch: 'r1/72-widgets',
    checksReport: put(dir, 'report.md', REPORT),
    ci: 'covered',
    previous: false,
    reviewer: 'primary',
    scratchpad: join(dir, 'scratch', '72'),
    ...overrides,
  };
}
const runReview = (t, overrides, entry = main) => {
  const dir = scratch(t);
  const values = reviewValues(dir, typeof overrides === 'function' ? overrides(dir) : overrides);
  const r = parse(entry(['review', put(dir, 'values.json', values)]));
  return { ...r, dir, values, brief: r.code === 0 ? readFileSync(r.json.brief, 'utf8') : null };
};
/** The value lines of a review spawn file: every one filled, none left to the host (#138). */
const reviewLines = (v, { mode = 'initial', previous = 'none' } = {}) => [
  `- mode: ${mode}\n`,
  `- repo: ${v.root}\n`,
  '- tracker: GitHub (acme/widgets)\n',
  `- ticket: #72; ticket face (the ticket text with its expansion blocks): ${v.bodyFile}\n`,
  '- status record: the comment on acme/widgets#72 whose first line is `<!-- sorry-matt:status -->`\n',
  `- acceptance snapshot: ${v.snapshot}; comparison: ${v.against}\n`,
  '- fixed point: r1/line-a\n',
  '- ticket branch: r1/72-widgets\n',
  `- targeted checks: source=commands.md; node --test scripts/a.test.mjs → green (commit 0a1b2c3 (branch r1/72-widgets); the agent's report: ${v.checksReport})\n`,
  '- CI coverage: covered\n',
  `- previous review block: ${previous}\n`,
  '- reviewer: primary\n',
  `- scratchpad: ${v.scratchpad}\n`,
];

test('#138: review writes the review host spawn file: REVIEWER.md fixed rules, then every value of this review', (t) => {
  const r = runReview(t);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(
    { kind: r.json.kind, role: r.json.role, description: r.json.description, agentType: r.json.agentType, brief: r.json.brief },
    { kind: 'review', role: 'review', description: 'review #72', agentType: 'general-purpose', brief: r.values.out },
  );
  assert.equal(r.json.prompt, `Read ${r.values.out} in full and follow it.`);
  assert.equal(r.json.fallback, null, 'the review host is a general-purpose agent: no fallback');
  // the fixed rules first (REVIEWER.md below its rule, without the maintainer header), then the values
  assert.ok(r.brief.startsWith('你是審查主持 agent：替一張票主持一次獨立審查。'), r.brief.slice(0, 80));
  assert.doesNotMatch(r.brief, /brief\.mjs review` 把/);
  assert.ok(r.brief.includes('## 1. 主持審查') && r.brief.includes('<!-- sorry-matt:review-report -->'));
  const values = r.brief.slice(r.brief.lastIndexOf('\n---\n'));
  for (const line of reviewLines(r.values)) assert.ok(values.includes(line), `has ${JSON.stringify(line)} in\n${values}`);
  assert.doesNotMatch(r.brief, LEFTOVER, 'no placeholder is left');
  assert.doesNotMatch(r.brief, /\r|[ \t]$/m, 'LF line ends, no trailing whitespace');
});

test('#138: a recheck names the previous review block; Local Markdown names its tracker', (t) => {
  const r = runReview(t, { mode: 'recheck', previous: true });
  assert.equal(r.code, 0, r.err);
  for (const line of reviewLines(r.values, { mode: 'recheck', previous: 'in the status record' })) assert.ok(r.brief.includes(line), `has ${JSON.stringify(line)}`);
  // an initial review resuming after a mid-review stuck also has it
  const resumed = runReview(t, { previous: true });
  assert.ok(resumed.brief.includes('- mode: initial\n') && resumed.brief.includes('- previous review block: in the status record\n'));
  const local = runReview(t, (dir) => ({ tracker: 'local', repo: undefined, ticket: '.scratch/f/issues/03-a.md', statusRecord: join(dir, 'repo', '.scratch/f/issues/03-a.md') }));
  assert.equal(local.code, 0, local.err);
  assert.equal(local.json.description, 'review 03-a.md');
  assert.ok(local.brief.includes('- tracker: Local Markdown\n'));
  assert.ok(local.brief.includes(`- status record: ${local.values.statusRecord}\n`));
});

test('#138: the dist copy writes the English REVIEWER.md rules with the same values', (t) => {
  const r = runReview(t, { mode: 'recheck', previous: true }, distMain);
  assert.equal(r.code, 0, r.err);
  assert.ok(r.brief.startsWith('You are the review host agent: you host one independent review of one ticket.'), r.brief.slice(0, 80));
  assert.ok(r.brief.includes('## 1. Host the review'));
  for (const line of reviewLines(r.values, { mode: 'recheck', previous: 'in the status record' })) assert.ok(r.brief.includes(line), `has ${JSON.stringify(line)}`);
});

test('#138: review refuses missing or malformed values (2) and a checks report with no targeted checks line (1)', (t) => {
  for (const key of ['out', 'mode', 'root', 'tracker', 'repo', 'ticket', 'bodyFile', 'statusRecord', 'snapshot', 'against', 'fixedPoint', 'branch', 'checksReport', 'ci', 'previous', 'reviewer', 'scratchpad']) {
    const dir = scratch(t);
    const values = reviewValues(dir);
    delete values[key];
    const r = main(['review', put(dir, 'values.json', values)]);
    assert.equal(r.code, 2, `review without ${key}`);
    assert.match(r.err, new RegExp(`missing ${key}`));
    assert.equal(existsSync(values.out), false);
  }
  for (const overrides of [{ mode: 'final' }, { root: 'relative' }, { scratchpad: 'relative' }, { ci: 'maybe' }, { previous: 'yes' }, { mode: 'recheck', previous: false }, { tracker: 'jira' }, { ticket: 'my ticket.md' }, { reviewer: '' }])
    assert.equal(runReview(t, overrides).code, 2, JSON.stringify(overrides));
  for (const overrides of [(dir) => ({ checksReport: put(dir, 'r.md', 'ticket: #72\ncommit: abc\n') }), { bodyFile: '/no/such/body.md' }, { against: '/no/such/against.json' }, { checksReport: '/no/such/report.md' }]) {
    const r = runReview(t, overrides);
    assert.equal(r.code, 1, typeof overrides === 'function' ? 'a report without a targeted checks line' : JSON.stringify(overrides));
    assert.equal(existsSync(r.values.out), false);
  }
});

test('a missing required value exits 2 and writes nothing', (t) => {
  for (const key of ['out', 'snapshot', 'worktree', 'branch', 'integration', 'bodyFile', 'sendBackFile', 'acceptance']) {
    const dir = scratch(t);
    const values = implementValues(dir);
    delete values[key];
    const r = main(['implement', put(dir, 'values.json', values)]);
    assert.equal(r.code, 2, `implement without ${key}`);
    assert.match(r.err, new RegExp(`missing ${key}`));
    assert.equal(r.out, '');
    assert.equal(existsSync(join(dir, 'briefs', '72.md')), false);
    assert.equal(existsSync(join(dir, 'briefs', '72.general-purpose.md')), false);
  }
  for (const key of ['out', 'run', 'round', 'tracker', 'repo', 'lines', 'spec', 'tickets']) {
    const dir = scratch(t);
    const values = expandValues(dir);
    delete values[key];
    const r = main(['expand', put(dir, 'values.json', values)]);
    assert.equal(r.code, 2, `expand without ${key}`);
    assert.match(r.err, new RegExp(`missing ${key}`));
  }
  const dir = scratch(t);
  const values = expandValues(dir);
  delete values.tickets[1].bodyFile;
  assert.equal(main(['expand', put(dir, 'values.json', values)]).code, 2, 'a ticket without bodyFile');
});

test('malformed values exit 2', (t) => {
  const cases = [
    ['implement', { worktree: 'relative/wt' }],
    ['implement', { role: 'merge' }],
    ['implement', { branch: '  ' }],
    ['implement', { acceptance: 'none' }],
    ['implement', { acceptance: null }],
    ['expand', { round: 0 }],
    ['expand', { round: '3' }],
    ['expand', { tracker: 'jira' }],
    ['expand', { lines: [] }],
    ['expand', { tickets: [{ id: '#75', line: 'r1/line-z', bodyFile: 'x' }] }],
    ['expand', { tickets: [{ id: 'my ticket.md', line: 'r1/line-a', bodyFile: 'x' }] }],
  ];
  for (const [kind, overrides] of cases) {
    const dir = scratch(t);
    const values = kind === 'implement' ? implementValues(dir, overrides) : expandValues(dir, overrides);
    assert.equal(main([kind, put(dir, 'values.json', values)]).code, 2, `${kind} ${JSON.stringify(overrides)}`);
  }
  assert.equal(main([]).code, 2);
  assert.equal(main(['review']).code, 2);
  assert.equal(main(['implement']).code, 2);
});

test('an unreadable file or a wrong snapshot exits 1', (t) => {
  assert.equal(runImplement(t, { bodyFile: '/no/such/body.md' }).code, 1);
  assert.equal(runImplement(t, { snapshot: '/no/such/snap.json' }).code, 1);
  const dir = scratch(t);
  assert.equal(runImplement(t, { snapshot: put(dir, 's.json', { format: 'sorry-matt/spawns@1', id: '#72' }) }).code, 1);
  assert.equal(runImplement(t, { snapshot: put(dir, 'bad.json', 'not json') }).code, 1);
});

test('description builds every role word, and spawns.mjs reads back the role and the ticket', (t) => {
  const cases = [
    [['expand', '#75', '#83'], 'expand #75 #83', '#75'],
    [['implement', '#72'], 'implement #72', '#72'],
    [['implement', '.scratch/feat/issues/03-add-login.md'], 'implement 03-add-login.md', '03-add-login.md'],
    [['fix', '03-v1.2-notes.md'], 'fix 03-v1.2-notes.md', '03-v1.2-notes.md'],
    [['ci-fix', '#72'], 'ci-fix #72', '#72'],
    [['ci-fix', 'r1/line-a'], 'ci-fix r1/line-a', null],
    [['merge', '#72'], 'merge #72', '#72'],
    [['merge', 'r1/line-a'], 'merge r1/line-a', null],
    [['review', '#72'], 'review #72', '#72'],
    [['review', '03-add-login.md'], 'review 03-add-login.md', '03-add-login.md'],
  ];
  for (const [args, expected, ticket] of cases) {
    const r = parse(main(['description', ...args]));
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.json, { format: 'sorry-matt/brief@1', kind: 'description', role: args[0], description: expected });
    assert.equal(category({ type: 'general-purpose', description: expected }), args[0]);
    assert.equal(ticketOf(expected), ticket);
  }
  for (const args of [[], ['finder', '#72'], ['implement'], ['implement', '#72', '#73'], ['implement', 'r1/line-a'], ['fix', 'my notes.md'], ['merge', 'two words'], ['review', 'r1/line-a'], ['review', '#72', '#73']])
    assert.equal(main(['description', ...args]).code, 2, JSON.stringify(args));
});

test('descriptions from implement and expand tally under their role and ticket in spawns.mjs', (t) => {
  const descriptions = [
    runImplement(t).json.description,
    runImplement(t, {}, distMain).json.description,
    runExpand(t, {}).json.description,
    parse(main(['description', 'merge', '#72'])).json.description,
  ];
  const dir = scratch(t);
  const log = descriptions.map((description, id) => ({ id, type: 'general-purpose', description, at: '2026-11-20T10:00:00.000Z' }));
  const r = parse(spawnsMain([put(dir, 'r.counters.json', { spawns: log.length, log })]));
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.byType, { implement: 2, expand: 1, merge: 1 });
  assert.deepEqual(r.json.byTicket, { '#72': { implement: 2, merge: 1 }, '#75': { expand: 1 } });
});

test('a template whose placeholders changed apart from the script exits 1 and writes nothing', async (t) => {
  // A copy of the script beside a template with one placeholder too many.
  const dir = scratch(t);
  const skill = join(dir, 'skill');
  for (const name of ['brief.mjs', 'cli.mjs', 'spawns.mjs'])
    put(skill, `scripts/${name}`, readFileSync(join(root, 'src/skills/get-to-work/scripts', name), 'utf8'));
  put(skill, 'EXPANDER.md', readFileSync(join(root, 'src/skills/get-to-work/EXPANDER.md'), 'utf8') + '\n- extra: {new placeholder}\n');
  const copy = await import(pathToFileURL(join(skill, 'scripts/brief.mjs')).href);
  const values = expandValues(dir);
  const r = copy.main(['expand', put(dir, 'values.json', values)]);
  assert.equal(r.code, 1);
  assert.match(r.err, /changed apart/);
  assert.equal(existsSync(values.out), false);
  // #138: REVIEWER.md holds fixed rules only; a placeholder there is one the host would have to fill
  put(skill, 'REVIEWER.md', readFileSync(join(root, 'src/skills/get-to-work/REVIEWER.md'), 'utf8') + '\n- scratchpad: {absolute path}\n');
  const rv = reviewValues(dir);
  const r2 = copy.main(['review', put(dir, 'review-values.json', rv)]);
  assert.equal(r2.code, 1, r2.err);
  assert.match(r2.err, /changed apart/);
  assert.equal(existsSync(rv.out), false);
});

// A copy of the plugin's layout: the scripts under skills/get-to-work/scripts, the src templates beside them, and
// agents/ holding the given definitions.
async function pluginCopy(dir, definitions) {
  const skill = join(dir, 'plugin', 'skills', 'get-to-work');
  for (const name of ['brief.mjs', 'cli.mjs', 'spawns.mjs'])
    put(skill, `scripts/${name}`, readFileSync(join(root, 'src/skills/get-to-work/scripts', name), 'utf8'));
  for (const name of ['IMPLEMENTER.md', 'EXPANDER.md']) put(skill, name, readFileSync(join(root, 'src/skills/get-to-work', name), 'utf8'));
  for (const [name, text] of Object.entries(definitions)) put(join(dir, 'plugin', 'agents'), name, text);
  return import(pathToFileURL(join(skill, 'scripts/brief.mjs')).href);
}

test('the fallback replaces ${CLAUDE_PLUGIN_ROOT} in the definition body with the plugin directory', async (t) => {
  const dir = scratch(t);
  const copy = await pluginCopy(dir, { 'implementer.md': '---\r\nname: implementer\r\ndescription: d\r\n---\r\n\r\nRead ${CLAUDE_PLUGIN_ROOT}/agents/x.md.  \r\n' });
  const r = parse(copy.main(['implement', put(dir, 'values.json', implementValues(dir))]));
  assert.equal(r.code, 0, r.err);
  assert.ok(readFileSync(r.json.fallback, 'utf8').startsWith(`Read ${join(dir, 'plugin')}/agents/x.md.\n\n---\n\n派工內容：`));
});

test('a missing definition file, or one without frontmatter, exits 1 and writes nothing', async (t) => {
  for (const definitions of [{}, { 'expander.md': 'no frontmatter\n' }]) {
    const dir = scratch(t);
    const copy = await pluginCopy(dir, definitions);
    const values = expandValues(dir);
    const r = copy.main(['expand', put(dir, 'values.json', values)]);
    assert.equal(r.code, 1, JSON.stringify(definitions));
    assert.equal(r.out, '');
    assert.equal(existsSync(values.out), false);
    assert.equal(existsSync(join(dir, 'briefs', 'expand-3.general-purpose.md')), false);
  }
});

test('as a process it prints the JSON and exits 0', (t) => {
  const dir = scratch(t);
  const values = implementValues(dir);
  const p = spawnSync(process.execPath, [script, 'implement', put(dir, 'values.json', values)], { encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr);
  assert.equal(JSON.parse(p.stdout).description, 'implement #72');
  const bad = spawnSync(process.execPath, [script, 'description', 'finder', '#72'], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /usage: see the header of brief\.mjs/);
});
