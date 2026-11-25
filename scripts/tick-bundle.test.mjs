// node --test scripts/tick-bundle.test.mjs
// Replays of get-to-work's wake-ups through tick.mjs: bundles, the sibling scope of a review, and one observation
// ticket per line (#205). The world they play in and the host's stand-in are in tick-world.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { world, distinct, stage, briefOf } from './tick-world.mjs';

const spawnsOf = (h, role) => distinct(h.log).filter((a) => a.kind === 'spawn' && a.spawn.description.startsWith(`${role} `));
const valuesOf = (a) => JSON.parse(readFileSync(briefOf(a).replace(/\.md$/, '.values.json'), 'utf8'));

test('#205: a bundle is one implementation, one review and one merge for both tickets', (t) => {
  const h = world(t);
  h.blockers['#2'] = ['#1']; // the member waits on the lead: inside the bundle, so it does not hold it up
  h.S('bundle', '#1', '#2');
  assert.equal(h.untilDone().then, 'done');
  const st = h.state();
  assert.deepEqual(Object.keys(st.tickets), ['#1']);
  assert.deepEqual(st.tickets['#1'].members, ['#2']);
  assert.equal(stage(h, '#1'), 'delivered');
  assert.equal(st.tickets['#1'].merges.length, 1);
  const implement = spawnsOf(h, 'implement');
  assert.deepEqual(implement.map((a) => a.spawn.description), ['implement #1 #2']);
  const reviews = spawnsOf(h, 'review');
  assert.deepEqual(reviews.map((a) => a.spawn.description), ['review #1 #2']);
  // the frontier is read for both tickets
  const fr = h.log.find((a) => a.step === 'frontier');
  assert.ok(fr.argv.includes('#1') && fr.argv.includes('#2'), fr.argv.join(' '));
  // each ticket's own snapshot, and the bundle's with each item naming its ticket
  const snap = JSON.parse(readFileSync(join(h.W, 'acceptance', '1.bundle.json'), 'utf8'));
  assert.deepEqual(snap.bundle, ['#1', '#2']);
  assert.deepEqual(snap.items.map((x) => [x.ticket, x.text]), [['#1', 'criterion of #1'], ['#2', 'criterion of #2']]);
  assert.ok(existsSync(join(h.W, 'acceptance', '2.json')));
  // the implementer reads the bundle's face and snapshot
  const iv = JSON.parse(readFileSync(join(h.W, 'tick', 'brief', '1-1.values.json'), 'utf8'));
  assert.equal(iv.snapshot, join(h.W, 'acceptance', '1.bundle.json'));
  const face = readFileSync(iv.bodyFile, 'utf8');
  assert.match(face, /^# Bundle #1, #2/);
  assert.match(face, /## Bundle ticket #1[\s\S]*The ticket text of #1[\s\S]*## Bundle ticket #2[\s\S]*The ticket text of #2/);
  // the review host: the bundle's values, a comparison over both tickets
  const rv = valuesOf(reviews[0]);
  assert.deepEqual(rv.bundle, ['#1', '#2']);
  assert.equal(rv.snapshot, join(h.W, 'acceptance', '1.bundle.json'));
  const cmp = JSON.parse(readFileSync(rv.against, 'utf8'));
  assert.deepEqual(Object.keys(cmp.tickets), ['#1', '#2']);
  assert.equal(cmp.check.changed, false);
  assert.match(readFileSync(briefOf(reviews[0]), 'utf8'), /- bundle: #1, #2 \(one review/);
});

test('#205: a bundle waits while a member is blocked by a ticket outside it', (t) => {
  const h = world(t);
  h.blockers['#2'] = ['#9']; // never done, outside the set
  h.S('bundle', '#1', '#2');
  h.wake();
  assert.equal(spawnsOf(h, 'implement').length, 0, 'nothing is dispatched');
  assert.equal(stage(h, '#1'), 'candidate');
});

test('#205: a review names the run\'s other open tickets as its sibling scope, and records the covered count', (t) => {
  const h = world(t);
  h.policy.review = (a) => (a.tickets[0] === '#1' ? { outcome: 'pass', covered: 2 } : 'pass');
  assert.equal(h.untilDone().then, 'done');
  const r1 = spawnsOf(h, 'review').find((a) => a.tickets[0] === '#1');
  const v = valuesOf(r1);
  // both tickets are dispatched together (their files differ), so #2 is still open when #1 is reviewed
  assert.ok(v.siblings, 'the review of #1 has a sibling scope');
  const text = readFileSync(v.siblings, 'utf8');
  assert.match(text, /^- #2 — Second thing \(/m);
  assert.match(text, /predicted files: b\.txt/);
  assert.match(text, /gh issue view 2 --repo o\/r/);
  assert.doesNotMatch(text, /^- #1/m);
  assert.match(readFileSync(briefOf(r1), 'utf8'), /- sibling scope: .*siblings\.md/);
  assert.equal(h.state().tickets['#1'].reviews[0].covered, 2);
  assert.equal(h.state().tickets['#2'].reviews[0].covered, undefined);
});

test('#205: observations of a line go to one raw ticket, one judge at a time, checked against the tip at the finish', (t) => {
  const h = world(t);
  h.policy.review = () => ({ outcome: 'pass', observations: 1, preExisting: 0 });
  const filed = [];
  h.policy.observations = (a) => {
    filed.push(a);
    if (filed.length === 2) {
      const other = h.tick('record', h.path, a.id, '--outcome', 'filed', '--value', '#91');
      assert.equal(other.code, 3, 'another issue id is refused for the line');
      assert.match(other.err, /line r1\/line-1 go to #90/);
    }
    return { outcome: 'filed', value: '#90' };
  };
  const finals = [];
  h.policy['observations-final'] = (a) => {
    finals.push(a);
    return 'checked';
  };
  assert.equal(h.untilDone().then, 'done');
  assert.equal(filed.length, 2);
  assert.match(filed[0].do, /file one raw ticket for line r1\/line-1/);
  assert.match(filed[1].do, /add its items to #90, the raw ticket of line r1\/line-1/);
  assert.match(filed[1].do, /not added again/);
  // never two at once on one line
  for (const out of h.wakes.flat()) assert.ok(out.actions.filter((a) => a.step === 'observations').length <= 1);
  assert.deepEqual(finals.map((a) => a.id), ['observations-final:r1/line-1']);
  assert.match(finals[0].do, /#90 holds the observations/);
  const steps = h.log.map((a) => a.step);
  assert.ok(steps.indexOf('observations-final') < steps.indexOf('wrap-up'));
});
