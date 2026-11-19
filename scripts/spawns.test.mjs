// node --test scripts/spawns.test.mjs
// Drives get-to-work's spawns.mjs through main() and, once, as a process, on counters files written to a temp
// dir. The expected tallies are counted by hand from each log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main } from '../src/skills/get-to-work/scripts/spawns.mjs';

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'src/skills/get-to-work/scripts/spawns.mjs');

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sorry-matt-spawns-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const entry = (type, description, id = null) => ({ id, type, description, at: '2026-11-19T10:00:00.000Z' });
const gp = (description) => entry('general-purpose', description);
const counters = (log, spawns = log.length) => ({ spawns, agents: [], log, pending: [], updated: '2026-11-19T10:00:00.000Z' });
function summarize(t, content) {
  const path = join(scratch(t), 'r.counters.json');
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
  const r = main([path]);
  return { ...r, json: r.code === 0 ? JSON.parse(r.out) : null };
}
const total = (byType) => Object.values(byType).reduce((a, b) => a + b, 0);

test('general-purpose spawns are tallied by the role word and by ticket', (t) => {
  const r = summarize(t, counters([gp('implement #72'), gp('finder #72'), gp('verifier #72'), gp('implement #73')]));
  assert.equal(r.code, 0);
  assert.equal(r.err, '');
  assert.deepEqual(r.json, {
    format: 'sorry-matt/spawns@1',
    spawns: 4,
    byType: { implement: 2, finder: 1, verifier: 1 },
    byTicket: { '#72': { implement: 1, finder: 1, verifier: 1 }, '#73': { implement: 1 } },
  });
});

test('a fallback to the general-purpose agent shows as its role, apart from the named agent type', (t) => {
  const r = summarize(t, counters([gp('expand #75 #83'), entry('sorry-matt:expander', 'expand #76')]));
  assert.deepEqual(r.json.byType, { expand: 1, 'sorry-matt:expander': 1 });
  assert.deepEqual(r.json.byTicket, { '#75': { expand: 1 }, '#76': { 'sorry-matt:expander': 1 } }, 'the first ticket marker is the ticket');
});

test('every role word is a category; the word is matched whole, first, in any case', (t) => {
  const roles = ['expand', 'implement', 'fix', 'ci-fix', 'merge', 'finder', 'verifier', 'fix-verifier'];
  const r = summarize(
    t,
    counters([
      ...roles.map((role) => gp(`${role} #1`)),
      gp('  Implement   #2'),
      gp('implementing #3'),
      gp('please implement #4'),
      gp('fix-verifiers #5'),
      gp(null),
      entry(null, 'merge #6'),
      entry(null, null),
      entry('Explore', 'implement #7'),
    ]),
  );
  assert.deepEqual(r.json.byType, {
    expand: 1,
    implement: 2,
    fix: 1,
    'ci-fix': 1,
    merge: 2,
    finder: 1,
    verifier: 1,
    'fix-verifier': 1,
    'general-purpose': 5,
    Explore: 1,
  });
  assert.equal(total(r.json.byType), 16);
  assert.equal(r.json.spawns, 16);
});

test('tickets: the first #N or NN-slug.md marker; a spawn without one is in no ticket', (t) => {
  const r = summarize(
    t,
    counters([
      gp('implement 03-add-login.md'),
      gp('finder 03-add-login.md'),
      gp('merge #12 into #9'),
      gp('fix 10-b.md #4'),
      gp('ci-fix the red line'),
      gp('implement notes.md'),
      gp(null),
    ]),
  );
  assert.deepEqual(r.json.byTicket, {
    '03-add-login.md': { implement: 1, finder: 1 },
    '#12': { merge: 1 },
    '10-b.md': { fix: 1 },
  });
  assert.equal(total(r.json.byType), 7);
});

test('the old counters format: every spawn is unknown', (t) => {
  const r = summarize(t, '{"spawns": 4, "agents": ["a","b"], "updated": "2026-11-18T00:00:00.000Z"}');
  assert.equal(r.code, 0);
  assert.deepEqual(r.json, { format: 'sorry-matt/spawns@1', spawns: 4, byType: { unknown: 4 }, byTicket: {} });
});

test('spawns counted before the log existed are unknown, next to the logged ones', (t) => {
  const r = summarize(t, counters([gp('implement #72')], 5));
  assert.deepEqual(r.json.byType, { implement: 1, unknown: 4 });
  assert.equal(total(r.json.byType), r.json.spawns);
  assert.deepEqual(r.json.byTicket, { '#72': { implement: 1 } });
});

test('an empty run sums to zero', (t) => {
  assert.deepEqual(summarize(t, counters([])).json, { format: 'sorry-matt/spawns@1', spawns: 0, byType: {}, byTicket: {} });
});

test('a missing file, a file that is not JSON, and one that is not a counters file: an error and no output', (t) => {
  const missing = main([join(scratch(t), 'nope.counters.json')]);
  assert.equal(missing.code, 1);
  assert.equal(missing.out, '');
  assert.match(missing.err, /^spawns: .*nope\.counters\.json/);

  const notJson = summarize(t, '{ half');
  assert.equal(notJson.code, 1);
  assert.equal(notJson.out, '');
  assert.match(notJson.err, /not JSON/);

  for (const bad of ['null', '[]', '{"agents": []}', '{"spawns": -1, "agents": []}', '{"spawns": 1.5}', '{"spawns": 2, "log": {}}', '{"spawns": 1, "log": [null]}']) {
    const r = summarize(t, bad);
    assert.equal(r.code, 1, bad);
    assert.equal(r.out, '', bad);
    assert.match(r.err, /not a sorry-matt counters file/, bad);
  }

  const longer = summarize(t, counters([gp('implement #1'), gp('implement #2')], 1));
  assert.equal(longer.code, 1);
  assert.equal(longer.out, '');
  assert.match(longer.err, /2 log entries but 1 spawns/);
});

test('bad arguments are a usage error', () => {
  for (const args of [[], ['a', 'b']]) {
    const r = main(args);
    assert.equal(r.code, 2);
    assert.equal(r.out, '');
    assert.match(r.err, /usage: see the header of spawns\.mjs/);
  }
});

test('as a command: JSON on stdout and exit code 0; an unreadable file exits non-zero with stderr only', (t) => {
  const dir = scratch(t);
  const path = join(dir, 'r.counters.json');
  writeFileSync(path, JSON.stringify(counters([gp('implement #72'), entry('sorry-matt:expander', null)])));
  const ok = spawnSync(process.execPath, [script, path], { encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.equal(ok.stderr, '');
  assert.deepEqual(JSON.parse(ok.stdout), {
    format: 'sorry-matt/spawns@1',
    spawns: 2,
    byType: { implement: 1, 'sorry-matt:expander': 1 },
    byTicket: { '#72': { implement: 1 } },
  });
  const bad = spawnSync(process.execPath, [script, join(dir, 'gone.json')], { encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
  assert.equal(bad.stdout, '');
  assert.notEqual(bad.stderr, '');
});
