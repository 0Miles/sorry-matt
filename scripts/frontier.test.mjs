// node --test scripts/frontier.test.mjs
// GitHub cases drive the script through its `gh` seam with fixtures; nothing calls the real GitHub.
// Local Markdown cases use in-memory files, plus one real git repository in a temp dir for --ref.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { githubFrontier, localFrontier, parseTicket, main, defaultDeps } from '../src/skills/get-to-work/scripts/frontier.mjs';
import { shortPath } from './lib.mjs';

const REPO = 'acme/app';
const API = `https://api.github.com/repos/${REPO}`;

// `issues` maps a number to { state, title, body?, blockedBy: [{ number, state, repo? }] };
// `others` maps "owner/repo#n" to the state of an issue that is only fetched on its own.
function fakeGh(issues, others = {}) {
  const calls = [];
  const gh = (path) => {
    calls.push(path);
    const other = /^repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/.exec(path);
    if (other && other[1] !== REPO) {
      const key = `${other[1]}#${other[2]}`;
      if (!(key in others)) {
        const e = new Error('Command failed: gh api');
        e.stderr = 'gh: Not Found (HTTP 404)';
        throw e;
      }
      return { number: Number(other[2]), state: others[key], title: key };
    }
    const dep = /^repos\/acme\/app\/issues\/(\d+)\/dependencies\/blocked_by\?per_page=100$/.exec(path);
    const one = /^repos\/acme\/app\/issues\/(\d+)$/.exec(path);
    const n = Number((dep || one || [])[1]);
    if (!issues[n]) {
      const e = new Error('Command failed: gh api');
      e.stderr = 'gh: Not Found (HTTP 404)';
      throw e;
    }
    if (one) return { number: n, state: issues[n].state, title: issues[n].title, body: issues[n].body ?? null, repository_url: API };
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
      { id: '#5', title: 'Five', state: 'done', trackerState: 'closed', blockedBy: [], line: '#5', ready: false, stalled: null },
      {
        id: '#6',
        title: 'Six',
        state: 'open',
        trackerState: 'open',
        blockedBy: [{ id: '#5', state: 'done', inSet: true }],
        line: '#5',
        ready: true,
        stalled: null,
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
        stalled: null,
      },
      {
        id: '#8',
        title: 'Eight',
        state: 'open',
        trackerState: 'open',
        blockedBy: [{ id: 'acme/lib#30', state: 'open', inSet: false }],
        line: '#8',
        ready: false,
        stalled: 'blocked-external',
      },
      { id: '#10', title: 'Ten', state: 'open', trackerState: 'open', blockedBy: [], line: '#10', ready: true, stalled: null },
    ],
    lines: [['#5', '#6', '#7'], ['#8'], ['#10']],
    frontier: ['#6', '#10'],
    warnings: [],
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

test('github: a body Blocked by line is the fallback edge, unioned with native ones and warned when they differ', () => {
  const issues = {
    6: { state: 'open', title: 'Six', blockedBy: [] },
    7: { state: 'open', title: 'Seven', body: 'Blocked by: #6, acme/lib#3\n\n## What to build\n', blockedBy: [] },
    8: { state: 'open', title: 'Eight', body: '## Blocked by\n\n- #6\n- #40 (gone)\n', blockedBy: [{ number: 5, state: 'closed' }] },
    9: { state: 'open', title: 'Nine', body: '## Blocked by\n\n- None (can start immediately)\n', blockedBy: [{ number: 5, state: 'closed' }] },
    10: { state: 'open', title: 'Ten', body: 'Blocked by: #5\n', blockedBy: [{ number: 5, state: 'closed' }] },
  };
  const out = githubFrontier({ repo: REPO, numbers: ['6', '7', '8', '9', '10'], gh: fakeGh(issues, { 'acme/lib#3': 'closed' }).gh });
  const by = Object.fromEntries(out.tickets.map((t) => [t.id, t]));
  assert.deepEqual(by['#7'].blockedBy, [
    { id: '#6', state: 'open', inSet: true },
    { id: 'acme/lib#3', state: 'done', inSet: false },
  ]);
  assert.deepEqual(by['#8'].blockedBy, [
    { id: '#5', state: 'done', inSet: false },
    { id: '#6', state: 'open', inSet: true },
    { id: '#40', state: 'missing', inSet: false },
  ]);
  assert.equal(by['#8'].stalled, 'missing');
  assert.deepEqual(out.frontier, ['#6', '#9', '#10']);
  assert.deepEqual(out.lines, [['#6', '#7', '#8'], ['#9'], ['#10']]);
  assert.deepEqual(out.warnings, ['#8: body Blocked by (#6, #40) differs from native dependencies (#5); using both']);
});

test('github: an issue URL from another repository is refused', () => {
  const r = main(['github', '--repo', REPO, 'https://github.com/acme/other/issues/6'], { gh: () => assert.fail('gh called') });
  assert.equal(r.code, 2);
  assert.match(r.err, /is not in --repo acme\/app/);
  assert.equal(githubFrontier({ repo: REPO, numbers: ['https://github.com/ACME/App/issues/6'], gh: fakeGh(ISSUES).gh }).tickets[0].id, '#6');
});

test('github: cycles, open blockers outside the set and stalled upstreams are marked stalled', () => {
  const issues = {
    20: { state: 'open', title: 'A', blockedBy: [{ number: 21, state: 'open' }] },
    21: { state: 'open', title: 'B', blockedBy: [{ number: 20, state: 'open' }] },
    22: { state: 'open', title: 'C', blockedBy: [{ number: 21, state: 'open' }] },
    23: { state: 'open', title: 'D', blockedBy: [{ number: 99, state: 'open' }] },
    24: { state: 'open', title: 'E', blockedBy: [{ number: 23, state: 'open' }] },
    25: { state: 'open', title: 'F', blockedBy: [{ number: 98, state: 'closed' }] },
  };
  const out = githubFrontier({ repo: REPO, numbers: ['20', '21', '22', '23', '24', '25'], gh: fakeGh(issues).gh });
  assert.deepEqual(
    out.tickets.map((t) => [t.id, t.ready, t.stalled]),
    [
      ['#20', false, 'cycle'],
      ['#21', false, 'cycle'],
      ['#22', false, 'blocked-upstream'],
      ['#23', false, 'blocked-external'],
      ['#24', false, 'blocked-upstream'],
      ['#25', true, null],
    ],
  );
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
    stalled: null,
  });
  assert.deepEqual(by['03-ui.md'].blockedBy, [
    { id: `${ISSUE_DIR}/01-schema.md`, state: 'done', inSet: false },
    { id: `${ISSUE_DIR}/02-api.md`, state: 'open', inSet: true },
  ]);
  assert.equal(by['03-ui.md'].trackerState, 'ready-for-agent');
  assert.deepEqual([by['03-ui.md'].ready, by['03-ui.md'].stalled], [false, null]);
  assert.deepEqual([by['04-docs.md'].blockedBy, by['04-docs.md'].ready], [[], true]);
  assert.deepEqual([by['05-half.md'].state, by['05-half.md'].ready], ['open', true]);
  assert.deepEqual(by['07-after-stuck.md'].blockedBy, [{ id: `${ISSUE_DIR}/06-stuck.md`, state: 'stuck', inSet: false }]);
  assert.equal(by['07-after-stuck.md'].stalled, 'blocked-external');
  assert.equal(by['08-dangling.md'].stalled, 'missing');
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

test('local: a blocker appended after the completion record makes the ticket stuck again', () => {
  // get-to-work reverts a merge whose CI stays red and appends a blocker; a completion record the revert missed must
  // not keep the ticket done. A completion after the blocker still means done.
  const files = {
    [`${ISSUE_DIR}/09-reverted.md`]:
      '# 09: Reverted\n\n**Blocked by:** None\n\n- [x] One\n\n## sorry-matt completion\n\ncommit abc\n\n## sorry-matt blocker\n\nreason: CI red, merge reverted\n',
    [`${ISSUE_DIR}/10-after-reverted.md`]: '# 10: After reverted\n\n**Blocked by:** 09\n',
    [`${ISSUE_DIR}/11-blocker-then-done.md`]:
      '# 11: Blocker then done\n\n**Blocked by:** None\n\n- [x] One\n\n## sorry-matt blocker\n\nreason: conflict\n\n## sorry-matt completion\n\ncommit def\n',
  };
  const out = localFrontier({ paths: Object.keys(files), ...memory(files) });
  assert.deepEqual(
    out.tickets.map((t) => [t.state, t.ready, t.stalled]),
    [
      ['stuck', false, null],
      ['open', false, 'blocked-upstream'],
      ['done', false, null],
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

// A delivered ticket: its own checkbox is ticked and the completion record is non-empty. `extra` goes after the
// acceptance list, `tail` after the completion record.
const delivered = (extra, tail = '') =>
  [
    '# 12: Delivered',
    '',
    '**Blocked by:** None',
    '',
    '## Acceptance criteria',
    '',
    '- [x] Real criterion',
    '',
    extra,
    '',
    '## sorry-matt completion',
    '',
    'commit abc',
    '',
    tail,
  ].join('\n');

test('local: a `- [ ]` inside fenced code does not keep a delivered ticket open', () => {
  assert.equal(parseTicket(delivered('```markdown\n- [ ] Example inside a backtick fence\n```')).state, 'done');
  assert.equal(parseTicket(delivered('~~~\n- [ ] Example inside a tilde fence\n~~~')).state, 'done');
  // A backtick fence ignores tilde lines inside it, and the other way round.
  assert.equal(parseTicket(delivered('```\n~~~\n- [ ] Inside the backtick fence\n```')).state, 'done');
});

test('local: a `- [ ]` in a Comments or sorry-matt section at any level does not keep a delivered ticket open', () => {
  assert.equal(parseTicket(delivered('### Comments\n\n- [ ] A checkbox in a comment')).state, 'done');
  assert.equal(parseTicket(delivered('### sorry-matt notes\n\n- [ ] A checkbox in a note')).state, 'done');
  assert.equal(parseTicket(delivered('#### Sorry-matt scratch\n\n- [ ] Deeper still')).state, 'done');
});

test('local: a skipped section ends at the next heading of the same or a higher level', () => {
  const ticket = delivered('### Comments\n\n- [x] A ticked comment\n\n## Acceptance criteria\n\n- [ ] Still open');
  assert.equal(parseTicket(ticket).state, 'open');
  // A deeper heading inside the skipped section does not end it.
  assert.equal(parseTicket(delivered('### Comments\n\n#### Reply\n\n- [ ] Still a comment')).state, 'done');
});

test('local: an unchecked item outside fences and skipped sections still keeps the ticket open', () => {
  assert.equal(parseTicket(delivered('- [ ] Not yet')).state, 'open');
  assert.equal(parseTicket(delivered('* [ ] Star bullet')).state, 'open');
  assert.equal(parseTicket(delivered('+ [ ] Plus bullet')).state, 'open');
  assert.equal(parseTicket(delivered('### Notes\n\n- [ ] Under an own subheading')).state, 'open');
  assert.equal(parseTicket(delivered('')).state, 'done');
});

test('local: completion, blocker and Blocked by headings count at any level', () => {
  const only = '# 13: Deep\n\n**Blocked by:** None\n\n- [x] One\n\n### sorry-matt completion\n\ncommit abc\n';
  assert.equal(parseTicket(only).state, 'done');
  assert.equal(parseTicket('# 13: Deep\n\n- [x] One\n\n### sorry-matt completion\n\n').state, 'open');
  assert.equal(parseTicket(`${only}\n### sorry-matt blocker\n\nreason: CI red, merge reverted\n`).state, 'stuck');
  assert.equal(parseTicket('# 13: Deep\n\n- [x] One\n\n### Sorry-matt blocker\n\nreason: conflict\n').state, 'stuck');
  assert.deepEqual(parseTicket('# 14: Listed\n\n### Blocked by\n\n- 01\n- #2\n\n### What to build\n\n- [ ] x\n').refs, ['01', '#2']);
});

test('local: Blocked by and completion inside fenced code do not count', () => {
  const fencedBlocker = '# 15: Fenced\n\n```\nBlocked by: 01\n```\n\n- [ ] One\n';
  assert.deepEqual(parseTicket(fencedBlocker).refs, []);
  const fencedList = '# 15: Fenced\n\n~~~\n## Blocked by\n\n- 01\n~~~\n';
  assert.deepEqual(parseTicket(fencedList).refs, []);
  const fencedCompletion = '# 16: Fenced\n\n- [x] One\n\n```markdown\n## Sorry-matt completion\n\ncommit abc\n```\n';
  assert.equal(parseTicket(fencedCompletion).state, 'open');
  const fencedBlockerHeading = `${delivered('')}\n\`\`\`\n## sorry-matt blocker\n\nreason: example\n\`\`\`\n`;
  assert.equal(parseTicket(fencedBlockerHeading).state, 'done');

  const files = {
    [`${ISSUE_DIR}/01-schema.md`]: FILES[`${ISSUE_DIR}/01-schema.md`],
    [`${ISSUE_DIR}/15-fenced.md`]: fencedBlocker,
  };
  const out = localFrontier({ paths: [`${ISSUE_DIR}/15-fenced.md`], ...memory(files) });
  assert.deepEqual(out.tickets[0].blockedBy, []);
});

test('github: a Blocked by line inside fenced code in the issue body is not a body blocker', () => {
  const issues = {
    3: { state: 'open', title: 'Three', blockedBy: [] },
    4: { state: 'open', title: 'Four', body: 'Example:\n\n```\nBlocked by: #3\n```\n', blockedBy: [] },
    5: { state: 'open', title: 'Five', body: '~~~\n## Blocked by\n\n- #3\n~~~\n\n### Blocked by\n\n- #4\n', blockedBy: [] },
  };
  const out = githubFrontier({ repo: REPO, numbers: ['3', '4', '5'], gh: fakeGh(issues).gh });
  const by = Object.fromEntries(out.tickets.map((t) => [t.id, t]));
  assert.deepEqual(by['#4'].blockedBy, []);
  assert.deepEqual(by['#5'].blockedBy, [{ id: '#4', state: 'open', inSet: true }]);
  assert.deepEqual(out.frontier, ['#3', '#4']);
});

test('local: a delivered ticket once misread as open is done, off the frontier, and unblocks its downstream', () => {
  const files = {
    [`${ISSUE_DIR}/20-fenced.md`]: delivered('```\n- [ ] Example inside a fence\n```'),
    [`${ISSUE_DIR}/21-commented.md`]: delivered('### Comments\n\n- [ ] A checkbox in a comment'),
    [`${ISSUE_DIR}/22-downstream.md`]: '# 22: Downstream\n\n**Blocked by:** 20, 21\n\n- [ ] Build on both\n',
  };
  const out = localFrontier({ paths: Object.keys(files), ...memory(files) });
  assert.deepEqual(
    out.tickets.map((t) => [t.id.slice(ISSUE_DIR.length + 1), t.state, t.ready]),
    [
      ['20-fenced.md', 'done', false],
      ['21-commented.md', 'done', false],
      ['22-downstream.md', 'open', true],
    ],
  );
  assert.deepEqual(out.frontier, [`${ISSUE_DIR}/22-downstream.md`]);
});

test('local: the ticket title never opens a skipped section, whatever it says', () => {
  const files = {
    [`${ISSUE_DIR}/01-first.md`]: '# 01: First\n\n**Blocked by:** None\n\n- [ ] a\n',
    [`${ISSUE_DIR}/02-comments.md`]: '# Comments vanish on reload\n\n**Blocked by:** 01\n\n- [ ] b\n',
  };
  const out = localFrontier({ paths: Object.keys(files), ...memory(files) });
  const by = Object.fromEntries(out.tickets.map((t) => [t.id.slice(ISSUE_DIR.length + 1), t]));
  assert.deepEqual(by['02-comments.md'].blockedBy, [{ id: `${ISSUE_DIR}/01-first.md`, state: 'open', inSet: true }]);
  assert.deepEqual(out.frontier, [`${ISSUE_DIR}/01-first.md`]);

  const titled = (title) => `# ${title}\n\n**Blocked by:** 01\n**Status:** ready-for-agent\n\n- [ ] b\n\n## sorry-matt completion\n\ncommit abc\n`;
  for (const title of ['Comments vanish on reload', 'Comments', 'sorry-matt: wire the parser']) {
    assert.deepEqual(parseTicket(titled(title)), { title, status: 'ready-for-agent', refs: ['01'], state: 'open' });
  }
});

test('local: only a section titled exactly Comments is skipped', () => {
  assert.equal(parseTicket(delivered('## Comments API\n\n- [ ] endpoint returns 200')).state, 'open');
  assert.equal(parseTicket(delivered('### comments\n\n- [ ] in a comment')).state, 'done');
});

test('local: a skipped section ends at the next heading of the same level', () => {
  assert.equal(parseTicket(delivered('## Comments\n\nlooks good\n\n## Acceptance criteria\n\n- [ ] Still open')).state, 'open');
});

test('local: a heading with a closing run of # still names its section', () => {
  assert.equal(parseTicket('# 01: x\n\n- [x] a\n\n## sorry-matt completion ##\n\nmerged abc\n').state, 'done');
  assert.equal(parseTicket('# 01: x\n\n- [x] a\n\n## sorry-matt completion\n\nmerged abc\n\n### sorry-matt blocker ###\n\nreverted\n').state, 'stuck');
});

test('local: inline code that starts with three backticks does not open a fence', () => {
  const t = parseTicket('# 01: x\n\n```npm test``` runs first.\n\n**Blocked by:** 01\n\n- [x] a\n\n## sorry-matt completion\n\ncommit abc\n');
  assert.deepEqual([t.refs, t.state], [['01'], 'done']);
  // A real fence still opens on a line with an info string and no further backtick.
  assert.equal(parseTicket(delivered('```js title="x"\n- [ ] fenced\n```')).state, 'done');
});

test('github: a body Blocked by line inside a Comments or sorry-matt section is not a body blocker', () => {
  const issues = {
    3: { state: 'open', title: 'Three', blockedBy: [] },
    4: { state: 'open', title: 'Four', body: '## Comments\n\nBlocked by: #3\n', blockedBy: [] },
    5: { state: 'open', title: 'Five', body: '### sorry-matt notes\n\nBlocked by: #3\n', blockedBy: [] },
  };
  const out = githubFrontier({ repo: REPO, numbers: ['3', '4', '5'], gh: fakeGh(issues).gh });
  const by = Object.fromEntries(out.tickets.map((t) => [t.id, t]));
  assert.deepEqual([by['#4'].blockedBy, by['#5'].blockedBy], [[], []]);
  assert.deepEqual(out.frontier, ['#3', '#4', '#5']);
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

test('cli: local reads the working tree by default, a commit with --ref, and one line with --line', () => {
  const root = mkdtempSync(join(tmpdir(), 'sorry-matt-frontier-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const write = (p, text) => {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), text);
  };
  const ticket = (nn, title, blockedBy) => `# ${nn}: ${title}\n\n**Blocked by:** ${blockedBy}\n\n- [ ] Works\n`;
  const deliver = (nn, slug, title, blockedBy) =>
    write(`${ISSUE_DIR}/${nn}-${slug}.md`, `${ticket(nn, title, blockedBy).replace('- [ ]', '- [x]')}\n## sorry-matt completion\n\n- commit: 1\n`);
  const at = (p) => `${ISSUE_DIR}/${p}`;
  try {
    git('init', '-q', '-b', 'base');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'test');
    git('config', 'core.autocrlf', 'false');
    // Two lines: 01 -> 02 and 03 -> 04. Each line's integration branch delivers its own first ticket.
    write(at('01-schema.md'), ticket('01', 'Schema', 'None'));
    write(at('02-api.md'), ticket('02', 'API', '01'));
    write(at('03-docs.md'), ticket('03', 'Docs', 'None'));
    write(at('04-guide.md'), ticket('04', 'Guide', '#3'));
    git('add', '-A');
    git('commit', '-q', '-m', 'tickets');
    git('checkout', '-q', '-b', 'run/a');
    deliver('01', 'schema', 'Schema', 'None');
    git('commit', '-q', '-am', 'deliver 01');
    git('checkout', '-q', '-b', 'run/b', 'base');
    deliver('03', 'docs', 'Docs', 'None');
    git('commit', '-q', '-am', 'deliver 03');
    git('checkout', '-q', 'base');

    const all = ['01-schema.md', '02-api.md', '03-docs.md', '04-guide.md'];
    const json = (argv, cwd = root) => {
      const r = main(argv, defaultDeps(cwd));
      assert.equal(r.code, 0, r.err);
      return JSON.parse(r.out);
    };

    const base = json(['local', ...all.map(at).slice(0, 3), join(root, at('04-guide.md'))]);
    assert.equal(base.source, 'worktree');
    assert.deepEqual(base.frontier, [at('01-schema.md'), at('03-docs.md')]);
    assert.deepEqual(base.lines, [[at('01-schema.md'), at('02-api.md')], [at('03-docs.md'), at('04-guide.md')]]);

    // Without --line, line b's delivered 03 reads as open on run/a and would be dispatched again.
    assert.deepEqual(json(['local', '--ref', 'run/a', ...all.map(at)]).frontier, [at('02-api.md'), at('03-docs.md')]);

    // From a subdirectory, with relative paths: --ref still resolves the ticket directory from the repo root.
    const sub = join(root, '.scratch');
    const rel = all.map((f) => `feat/issues/${f}`);
    const a = json(['local', '--ref', 'run/a', '--line', at('01-schema.md'), ...rel], sub);
    const b = json(['local', '--ref', 'run/b', '--line', at('03-docs.md'), ...rel], sub);
    assert.deepEqual(a.tickets.map((t) => t.id), [at('01-schema.md'), at('02-api.md')]);
    assert.deepEqual([a.lines, a.frontier], [[[at('01-schema.md'), at('02-api.md')]], [at('02-api.md')]]);
    assert.deepEqual([b.lines, b.frontier], [[[at('03-docs.md'), at('04-guide.md')]], [at('04-guide.md')]]);
    assert.deepEqual(b.tickets[1].blockedBy, [{ id: at('03-docs.md'), state: 'done', inSet: true }]);

    const noLine = main(['local', '--line', at('02-api.md'), ...all.map(at)], defaultDeps(root));
    assert.deepEqual([noLine.code, /names no line/.test(noLine.err)], [1, true]);
    const missingRef = main(['local', '--ref', 'no-such-branch', at('01-schema.md')], defaultDeps(root));
    assert.equal(missingRef.code, 1);
    const missingFile = main(['local', at('09-nope.md')], defaultDeps(root));
    assert.deepEqual([missingFile.code, /cannot read ticket file/.test(missingFile.err)], [1, true]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cli: local from a Windows 8.3 short-path cwd or argument still reports repo-relative paths', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'sorry-matt-frontier-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const short = shortPath(root);
  if (!short) return t.skip('no 8.3 short path here (not Windows, or 8.3 names disabled)');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q', '-b', 'base');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'test');
  git('config', 'core.autocrlf', 'false');
  const file = `${ISSUE_DIR}/01-schema.md`;
  mkdirSync(join(root, ISSUE_DIR), { recursive: true });
  writeFileSync(join(root, file), '# 01: Schema\n\n**Blocked by:** None\n\n- [ ] Works\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'tickets');

  // git reports the long toplevel; the cwd and the argument are the short alias of the same directory.
  for (const [argv, cwd] of [
    [['local', file], short],
    [['local', '--ref', 'base', file], short],
    [['local', join(short, file)], root],
  ]) {
    const r = main(argv, defaultDeps(cwd));
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(JSON.parse(r.out).frontier, [file]);
  }
});

// ---------- #53: `+` list items, a Blocked by heading without a list, and the last completion ----------

test('local: a `+` item under a Blocked by heading is a blocker', () => {
  const files = {
    [`${ISSUE_DIR}/01-first.md`]: '# 01: First\n\n**Blocked by:** None\n\n- [ ] a\n',
    [`${ISSUE_DIR}/02-plus.md`]: '# 02: Plus\n\n## Blocked by\n\n+ 01\n\n## What to build\n\n- [ ] b\n',
  };
  assert.deepEqual(parseTicket(files[`${ISSUE_DIR}/02-plus.md`]).refs, ['01']);
  const out = localFrontier({ paths: Object.keys(files), ...memory(files) });
  assert.deepEqual(out.frontier, [`${ISSUE_DIR}/01-first.md`]);
  assert.deepEqual(out.tickets[1].blockedBy, [{ id: `${ISSUE_DIR}/01-first.md`, state: 'open', inSet: true }]);
});

test('github: a `+` item under a Blocked by heading in the issue body is a body blocker', () => {
  const issues = {
    5: { state: 'open', title: 'Five', blockedBy: [] },
    6: { state: 'open', title: 'Six', body: '## Blocked by\n\n+ #5\n', blockedBy: [] },
  };
  const out = githubFrontier({ repo: REPO, numbers: ['5', '6'], gh: fakeGh(issues).gh });
  assert.deepEqual(out.tickets[1].blockedBy, [{ id: '#5', state: 'open', inSet: true }]);
  assert.deepEqual(out.frontier, ['#5']);
});

test('local: a Blocked by heading with no list items leaves the inline Blocked by line in force', () => {
  const text = '# 02: Prose\n\nBlocked by: 01\n\n## Blocked by\n\nThe schema has to land first.\n\n## What to build\n\n- [ ] b\n';
  assert.deepEqual(parseTicket(text).refs, ['01']);
  const files = {
    [`${ISSUE_DIR}/01-first.md`]: '# 01: First\n\n**Blocked by:** None\n\n- [ ] a\n',
    [`${ISSUE_DIR}/02-prose.md`]: text,
  };
  const out = localFrontier({ paths: Object.keys(files), ...memory(files) });
  assert.deepEqual(out.tickets[1].blockedBy, [{ id: `${ISSUE_DIR}/01-first.md`, state: 'open', inSet: true }]);
  assert.deepEqual(out.frontier, [`${ISSUE_DIR}/01-first.md`]);
});

test('github: a Blocked by heading with no list items leaves the inline Blocked by line in force', () => {
  const issues = {
    5: { state: 'open', title: 'Five', blockedBy: [] },
    6: { state: 'open', title: 'Six', body: 'Blocked by: #5\n\n## Blocked by\n\nThe schema has to land first.\n', blockedBy: [] },
  };
  const out = githubFrontier({ repo: REPO, numbers: ['5', '6'], gh: fakeGh(issues).gh });
  assert.deepEqual(out.tickets[1].blockedBy, [{ id: '#5', state: 'open', inSet: true }]);
  assert.deepEqual(out.frontier, ['#5']);
});

test('a Blocked by heading with list items still wins over the inline Blocked by line', () => {
  assert.deepEqual(parseTicket('# 03: Both\n\nBlocked by: 01\n\n## Blocked by\n\n- 02\n').refs, ['02']);
  // An explicit `- None` is a list item: no blockers, and the inline line is not read.
  assert.deepEqual(parseTicket('# 03: Both\n\nBlocked by: 01\n\n## Blocked by\n\n- None\n').refs, []);
  const issues = {
    5: { state: 'open', title: 'Five', blockedBy: [] },
    6: { state: 'open', title: 'Six', blockedBy: [] },
    7: { state: 'open', title: 'Seven', body: 'Blocked by: #5\n\n## Blocked by\n\n- #6\n', blockedBy: [] },
  };
  const out = githubFrontier({ repo: REPO, numbers: ['5', '6', '7'], gh: fakeGh(issues).gh });
  assert.deepEqual(out.tickets[2].blockedBy, [{ id: '#6', state: 'open', inSet: true }]);
});

const HISTORY = {
  completion: '## sorry-matt completion\n\ncommit abc\n',
  blocker: '## sorry-matt blocker\n\nreason: CI red, merge reverted\n',
};
const withHistory = (...sections) => `# 30: Redelivered\n\n**Blocked by:** None\n\n- [x] One\n\n${sections.map((s) => HISTORY[s]).join('\n')}`;

test('local: a ticket delivered again after a revert is done, off the frontier, and unblocks its downstream', () => {
  const text = withHistory('completion', 'blocker', 'completion');
  assert.equal(parseTicket(text).state, 'done');
  const files = {
    [`${ISSUE_DIR}/30-redelivered.md`]: text,
    [`${ISSUE_DIR}/31-downstream.md`]: '# 31: Downstream\n\n**Blocked by:** 30\n\n- [ ] Build on it\n',
  };
  const out = localFrontier({ paths: Object.keys(files), ...memory(files) });
  assert.deepEqual(
    out.tickets.map((t) => [t.state, t.ready]),
    [
      ['done', false],
      ['open', true],
    ],
  );
  assert.deepEqual(out.frontier, [`${ISSUE_DIR}/31-downstream.md`]);
});

test('local: a blocker after the last completion still makes the ticket stuck', () => {
  assert.equal(parseTicket(withHistory('completion', 'blocker')).state, 'stuck');
  assert.equal(parseTicket(withHistory('completion', 'blocker', 'completion', 'blocker')).state, 'stuck');
});

test('local: an empty last completion section is not a delivery', () => {
  assert.equal(parseTicket(`${withHistory('completion')}\n## sorry-matt completion\n`).state, 'open');
  assert.equal(parseTicket(`${withHistory('completion', 'blocker')}\n## sorry-matt completion\n`).state, 'stuck');
});
