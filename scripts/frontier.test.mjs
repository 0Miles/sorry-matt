// node --test scripts/frontier.test.mjs
// GitHub cases drive the script through its `gh` seam with fixtures; nothing calls the real GitHub.
// Local Markdown cases use in-memory files, plus one real git repository in a temp dir for --ref.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { githubFrontier, localFrontier, main, defaultDeps } from '../src/skills/get-to-work/scripts/frontier.mjs';

const REPO = 'acme/app';
const API = `https://api.github.com/repos/${REPO}`;

// `issues` maps a number to { state, title, blockedBy: [{ number, state, repo? }] }.
function fakeGh(issues) {
  const calls = [];
  const gh = (path) => {
    calls.push(path);
    const dep = /^repos\/acme\/app\/issues\/(\d+)\/dependencies\/blocked_by\?per_page=100$/.exec(path);
    const one = /^repos\/acme\/app\/issues\/(\d+)$/.exec(path);
    const n = Number((dep || one || [])[1]);
    if (!issues[n]) throw new Error(`unexpected gh api ${path}`);
    if (one) return { number: n, state: issues[n].state, title: issues[n].title, repository_url: API };
    return issues[n].blockedBy.map((b) => ({
      number: b.number,
      state: b.state,
      title: `blocker ${b.number}`,
      repository_url: `https://api.github.com/repos/${b.repo || REPO}`,
    }));
  };
  return { gh, calls };
}

const ISSUES = {
  5: { state: 'closed', title: 'Five', blockedBy: [] },
  6: { state: 'open', title: 'Six', blockedBy: [{ number: 5, state: 'closed' }] },
  7: { state: 'open', title: 'Seven', blockedBy: [{ number: 6, state: 'open' }, { number: 9, state: 'closed' }] },
  8: { state: 'open', title: 'Eight', blockedBy: [{ number: 30, state: 'open', repo: 'acme/lib' }] },
  10: { state: 'open', title: 'Ten', blockedBy: [] },
};

test('github: blockers come from native dependencies; frontier is open tickets whose blockers are all done', () => {
  const { gh, calls } = fakeGh(ISSUES);
  const out = githubFrontier({ repo: REPO, numbers: ['7', '#5', `https://github.com/${REPO}/issues/6`, '8', '10'], gh });
  assert.deepEqual(out, {
    format: 'sorry-matt/frontier@1',
    tracker: 'github',
    source: REPO,
    tickets: [
      { id: '#5', title: 'Five', state: 'done', trackerState: 'closed', blockedBy: [], line: '#5', ready: false },
      {
        id: '#6',
        title: 'Six',
        state: 'open',
        trackerState: 'open',
        blockedBy: [{ id: '#5', state: 'done', inSet: true }],
        line: '#5',
        ready: true,
      },
      {
        id: '#7',
        title: 'Seven',
        state: 'open',
        trackerState: 'open',
        blockedBy: [
          { id: '#6', state: 'open', inSet: true },
          { id: '#9', state: 'done', inSet: false },
        ],
        line: '#5',
        ready: false,
      },
      {
        id: '#8',
        title: 'Eight',
        state: 'open',
        trackerState: 'open',
        blockedBy: [{ id: 'acme/lib#30', state: 'open', inSet: false }],
        line: '#8',
        ready: false,
      },
      { id: '#10', title: 'Ten', state: 'open', trackerState: 'open', blockedBy: [], line: '#10', ready: true },
    ],
    lines: [['#5', '#6', '#7'], ['#8'], ['#10']],
    frontier: ['#6', '#10'],
  });
  assert.ok(calls.every((c) => c.startsWith(`repos/${REPO}/issues/`)));
});

test('github: --done clears a ticket integrated this run; --stuck keeps it and its downstream blocked', () => {
  const issues = {
    6: { state: 'open', title: 'Six', blockedBy: [] },
    7: { state: 'open', title: 'Seven', blockedBy: [{ number: 6, state: 'open' }] },
    8: { state: 'open', title: 'Eight', blockedBy: [{ number: 7, state: 'open' }] },
  };
  const { gh } = fakeGh(issues);
  const cleared = githubFrontier({ repo: REPO, numbers: ['6', '7', '8'], done: ['6'], gh });
  assert.deepEqual(cleared.frontier, ['#7']);
  assert.equal(cleared.tickets[0].state, 'done');
  assert.equal(cleared.tickets[0].trackerState, 'open');

  const stuck = githubFrontier({ repo: REPO, numbers: ['6', '7', '8'], done: ['6'], stuck: ['7'], gh });
  assert.deepEqual(stuck.frontier, []);
  assert.deepEqual(
    stuck.tickets.map((t) => [t.id, t.state, t.ready]),
    [
      ['#6', 'done', false],
      ['#7', 'stuck', false],
      ['#8', 'open', false],
    ],
  );
  assert.deepEqual(stuck.tickets[2].blockedBy, [{ id: '#7', state: 'stuck', inSet: true }]);
});

const ISSUE_DIR = '.scratch/feat/issues';
const FILES = {
  [`${ISSUE_DIR}/01-schema.md`]: [
    '# 01: Schema',
    '',
    '**Blocked by:** None (can start immediately)',
    '',
    '**Status:** ready-for-human',
    '',
    '- [x] Tables exist',
    '',
    '## sorry-matt completion',
    '',
    '- implementation commit: abc1234',
    '',
  ].join('\n'),
  [`${ISSUE_DIR}/02-api.md`]: [
    '# 02: API',
    '',
    '**Blocked by:** 01',
    '',
    '**Status:** ready-for-human',
    '',
    '- [x] Endpoint answers',
    '',
  ].join('\n'),
  [`${ISSUE_DIR}/03-ui.md`]: '# 03: UI\r\n\r\nBlocked by: 02-api, #1 (Schema)\r\nStatus: ready-for-agent\r\n\r\n- [ ] Screen\r\n',
  [`${ISSUE_DIR}/04-docs.md`]: [
    '# 04: Docs',
    '',
    '## Blocked by',
    '',
    '- None (can start immediately)',
    '',
    '## Comments',
    '',
    '- [ ] a checkbox in a comment does not count',
    '',
  ].join('\n'),
  [`${ISSUE_DIR}/05-half.md`]: [
    '# 05: Half done',
    '',
    '**Blocked by:** .scratch/feat/issues/01-schema.md',
    '',
    '- [x] One',
    '- [ ] Two',
    '',
    '## sorry-matt completion',
    '',
    '- implementation commit: def5678',
    '',
  ].join('\n'),
  [`${ISSUE_DIR}/06-stuck.md`]: '# 06: Stuck\n\n**Blocked by:** None\n\n- [ ] One\n\n## sorry-matt blocker\n\nreason: conflict\n',
  [`${ISSUE_DIR}/07-after-stuck.md`]: '# 07: After stuck\n\n**Blocked by:** 06\n',
  [`${ISSUE_DIR}/08-dangling.md`]: '# 08: Dangling\n\n**Blocked by:** 99, Some title\n',
};

const memory = (files) => ({
  read: (p) => (p in files ? files[p] : null),
  list: (dir) => Object.keys(files).filter((p) => dirname(p) === dir).map((p) => p.slice(dir.length + 1)),
});

test('local: Blocked by and sorry-matt completion decide state and frontier; Status alone does not', () => {
  const paths = Object.keys(FILES).filter((p) => !p.endsWith('01-schema.md') && !p.endsWith('06-stuck.md'));
  const out = localFrontier({ paths, ...memory(FILES), source: 'run/line' });
  const by = Object.fromEntries(out.tickets.map((t) => [t.id.slice(ISSUE_DIR.length + 1), t]));

  assert.equal(out.format, 'sorry-matt/frontier@1');
  assert.equal(out.tracker, 'local');
  assert.equal(out.source, 'run/line');
  assert.deepEqual(by['02-api.md'], {
    id: `${ISSUE_DIR}/02-api.md`,
    title: '02: API',
    state: 'open',
    trackerState: 'ready-for-human',
    blockedBy: [{ id: `${ISSUE_DIR}/01-schema.md`, state: 'done', inSet: false }],
    line: `${ISSUE_DIR}/02-api.md`,
    ready: true,
  });
  assert.deepEqual(by['03-ui.md'].blockedBy, [
    { id: `${ISSUE_DIR}/01-schema.md`, state: 'done', inSet: false },
    { id: `${ISSUE_DIR}/02-api.md`, state: 'open', inSet: true },
  ]);
  assert.equal(by['03-ui.md'].trackerState, 'ready-for-agent');
  assert.equal(by['03-ui.md'].ready, false);
  assert.deepEqual([by['04-docs.md'].blockedBy, by['04-docs.md'].ready], [[], true]);
  assert.deepEqual([by['05-half.md'].state, by['05-half.md'].ready], ['open', true]);
  assert.deepEqual(by['07-after-stuck.md'].blockedBy, [{ id: `${ISSUE_DIR}/06-stuck.md`, state: 'stuck', inSet: false }]);
  assert.deepEqual(by['08-dangling.md'].blockedBy, [
    { id: '99', state: 'missing', inSet: false },
    { id: 'Some title', state: 'missing', inSet: false },
  ]);
  assert.deepEqual(out.frontier, [`${ISSUE_DIR}/02-api.md`, `${ISSUE_DIR}/04-docs.md`, `${ISSUE_DIR}/05-half.md`]);
  assert.deepEqual(out.lines, [
    [`${ISSUE_DIR}/02-api.md`, `${ISSUE_DIR}/03-ui.md`],
    [`${ISSUE_DIR}/04-docs.md`],
    [`${ISSUE_DIR}/05-half.md`],
    [`${ISSUE_DIR}/07-after-stuck.md`],
    [`${ISSUE_DIR}/08-dangling.md`],
  ]);
});

test('local: a stuck ticket is not ready, and a done ticket is not ready again', () => {
  const out = localFrontier({ paths: [`${ISSUE_DIR}/01-schema.md`, `${ISSUE_DIR}/06-stuck.md`], ...memory(FILES) });
  assert.deepEqual(
    out.tickets.map((t) => [t.state, t.ready]),
    [
      ['done', false],
      ['stuck', false],
    ],
  );
  assert.deepEqual(out.frontier, []);
});

test('both trackers emit the same shape', () => {
  const keys = (o) => [Object.keys(o), Object.keys(o.tickets[0]), Object.keys(o.tickets[0].blockedBy[0])];
  const gh = githubFrontier({ repo: REPO, numbers: ['6'], gh: fakeGh(ISSUES).gh });
  const local = localFrontier({ paths: [`${ISSUE_DIR}/02-api.md`], ...memory(FILES) });
  assert.deepEqual(keys(gh), keys(local));
});

test('cli: bad arguments exit 2 without calling the tracker', () => {
  const deps = { gh: () => assert.fail('gh called'), git: () => assert.fail('git called') };
  for (const argv of [
    [],
    ['jira', '1'],
    ['github', '5'],
    ['github', '--repo', REPO],
    ['github', '--repo', REPO, '--done', '6', '5'],
    ['github', '--repo', REPO, '--ref', 'main', '5'],
    ['github', '--repo', REPO, 'five'],
    ['local', '--done', '1', 'a.md'],
    ['local', '--bogus', 'a.md'],
  ]) {
    const r = main(argv, deps);
    assert.equal(r.code, 2, argv.join(' '));
    assert.equal(r.out, '');
    assert.match(r.err, /^frontier: /);
  }
});

test('cli: github writes the JSON to out; a gh failure exits 1', () => {
  const ok = main(['github', '--repo', REPO, '6', '10'], { gh: fakeGh(ISSUES).gh });
  assert.equal(ok.code, 0);
  assert.deepEqual(JSON.parse(ok.out).frontier, ['#6', '#10']);

  const failing = main(['github', '--repo', REPO, '6'], {
    gh: () => {
      const e = new Error('Command failed');
      e.stderr = 'gh: Not Found (HTTP 404)';
      throw e;
    },
  });
  assert.deepEqual([failing.code, failing.err], [1, 'frontier: gh: Not Found (HTTP 404)\n']);
});

test('cli: local reads the working tree by default and the given commit with --ref', () => {
  const root = mkdtempSync(join(tmpdir(), 'sorry-matt-frontier-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const write = (p, text) => {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), text);
  };
  try {
    git('init', '-q', '-b', 'base');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'test');
    git('config', 'core.autocrlf', 'false');
    write(`${ISSUE_DIR}/01-schema.md`, '# 01: Schema\n\n**Blocked by:** None\n\n- [ ] Tables\n');
    write(`${ISSUE_DIR}/02-api.md`, '# 02: API\n\n**Blocked by:** 01\n\n- [ ] Endpoint\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'tickets');
    git('checkout', '-q', '-b', 'run/line');
    write(`${ISSUE_DIR}/01-schema.md`, '# 01: Schema\n\n**Blocked by:** None\n\n- [x] Tables\n\n## sorry-matt completion\n\n- commit: 1\n');
    git('commit', '-q', '-am', 'deliver 01');
    git('checkout', '-q', 'base');

    const argv = ['local', `${ISSUE_DIR}/01-schema.md`, join(root, ISSUE_DIR, '02-api.md')];
    const base = main(argv, defaultDeps(root));
    assert.equal(base.code, 0, base.err);
    assert.deepEqual(JSON.parse(base.out).frontier, [`${ISSUE_DIR}/01-schema.md`]);
    assert.equal(JSON.parse(base.out).source, 'worktree');

    const line = main(['local', '--ref', 'run/line', ...argv.slice(1)], defaultDeps(root));
    assert.equal(line.code, 0, line.err);
    assert.deepEqual(JSON.parse(line.out).frontier, [`${ISSUE_DIR}/02-api.md`]);
    assert.deepEqual(JSON.parse(line.out).lines, [[`${ISSUE_DIR}/01-schema.md`, `${ISSUE_DIR}/02-api.md`]]);

    const missingRef = main(['local', '--ref', 'no-such-branch', `${ISSUE_DIR}/01-schema.md`], defaultDeps(root));
    assert.equal(missingRef.code, 1);
    const missingFile = main(['local', `${ISSUE_DIR}/09-nope.md`], defaultDeps(root));
    assert.deepEqual([missingFile.code, /cannot read ticket file/.test(missingFile.err)], [1, true]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
