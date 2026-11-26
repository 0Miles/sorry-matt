// node --test scripts/tick-finish.test.mjs
// Replays of get-to-work's wake-ups through tick.mjs: the simplify pass (#153), the review tier (#139, #156) and absolute brief paths.
// The world they play in and the host's stand-in are in tick-world.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { main as tick } from '../src/skills/get-to-work/scripts/tick.mjs';
import { LINE, git, Crash, world, distinct, briefOf, reportOf } from './tick-world.mjs';
// #153: the finish's simplify pass is a spawn; the simplify agent judges first and reports applied, none or skipped.
test('#153: the finish spawns the simplify agent in the foreground on the line, with the criteria in its brief', (t) => {
  const h = world(t);
  h.wake();
  const w2 = h.wake();
  const spawns = distinct(h.actions(w2)).filter((a) => a.step === 'simplify');
  assert.equal(spawns.length, 1);
  const [a] = spawns;
  assert.equal(a.kind, 'spawn');
  assert.equal(a.id, `simplify:${LINE}`);
  assert.equal(a.line, LINE);
  assert.deepEqual(a.outcomes, ['applied', 'none', 'skipped']);
  assert.deepEqual(a.spawn, { subagent_type: 'general-purpose', description: `simplify ${LINE}`, prompt: a.spawn.prompt, background: false });
  assert.match(a.record, /--agent <agent id> --outcome applied\|none\|skipped --value <one-line reason>/);
  const brief = readFileSync(briefOf(a), 'utf8');
  // the worktree, the diff to judge, the criteria, the Skill tool call, the commit and the reply
  assert.ok(brief.includes(`Worktree: ${git(h.intWt, 'rev-parse', '--show-toplevel')} (branch ${LINE})`), 'the integration worktree, as git names it');
  assert.ok(brief.includes(`git diff origin/main...${LINE}`), 'the whole line against the base');
  for (const rule of [
    'only documentation',
    'only deletions',
    'only configuration or data files',
    'no new logic',
    'duplicate implementation',
    'reusable function',
    'a branch or a layer of indirection',
    'When unsure, simplify',
    'There is no line-count threshold',
    'call the Skill tool with `simplify`',
    `refactor: simplify ${LINE}`,
    'outcome: applied | none | skipped',
  ])
    assert.ok(brief.includes(rule), `the brief says: ${rule}`);
  // the line was verified and delivered after it; the agent is on the books as a simplify agent
  assert.equal(w2.at(-1).then, 'done');
  const st = h.state();
  assert.equal(st.tick.done[a.id].outcome, 'none');
  assert.equal(st.tick.done[a.id].value, 'looked at the line: nothing to reuse or remove');
  const agent = st.tick.done[a.id].agent;
  assert.deepEqual([st.tick.agents[agent].role, st.tick.agents[agent].tickets], ['simplify', []]);
  assert.ok(!git(h.intWt, 'log', '--format=%s', `main..${LINE}`).includes('refactor: simplify'), 'none: no commit');
  const wrap = h.actions(w2).find((x) => x.step === 'wrap-up');
  assert.equal(wrap.meta, undefined, 'no line skipped the simplify pass');
});

test('#153: record simplify takes applied, none or skipped with a one-line reason, nothing else', (t) => {
  const h = world(t);
  h.wake();
  h.policy.simplify = () => {
    throw new Crash('stop at the simplify spawn');
  };
  assert.throws(() => h.wake(), Crash);
  const id = `simplify:${LINE}`;
  assert.ok(h.state().tick.issued[id], 'the simplify spawn was handed out');
  const rec = (...flags) => h.tick('record', h.path, id, ...flags);
  assert.equal(rec('--agent', 'a9', '--outcome', 'done', '--value', 'x').code, 2, 'done is no longer an outcome');
  assert.equal(rec('--agent', 'a9', '--outcome', 'skipped').code, 2, 'a reason is required');
  assert.equal(rec('--agent', 'a9', '--outcome', 'none', '--value', 'two\nlines').code, 2, 'the reason is one line');
  assert.equal(rec('--outcome', 'none', '--value', 'x').code, 2, 'the agent id is required');
  assert.equal(rec('--agent', 'a9', '--outcome', 'none', '--value', 'nothing to reuse').code, 0);
  assert.equal(rec('--agent', 'a9', '--outcome', 'applied', '--value', 'nothing to reuse').code, 3, 'a different result is not taken');
});

test('#153: applied is one commit on the line, verified with the line; skipped is listed at the wrap-up for the self-answer log', (t) => {
  const applied = world(t);
  applied.policy.simplify = () => ({ outcome: 'applied', value: 'folded the two copies of the parser into one' });
  applied.wake();
  const w = applied.wake();
  assert.equal(w.at(-1).then, 'done');
  const subjects = git(applied.intWt, 'log', '--first-parent', '--format=%s', `main..${LINE}`).split('\n');
  assert.ok(subjects.includes(`refactor: simplify ${LINE}`), 'the applied fixes are one commit on the line');
  const tip = git(applied.intWt, 'rev-parse', 'HEAD');
  assert.equal(applied.state().lines[LINE].ci.sha, tip, 'the full verification is of the tip after the simplify commit');
  assert.equal(applied.actions(w).find((x) => x.step === 'wrap-up').meta, undefined);

  const skipped = world(t);
  skipped.policy.simplify = () => ({ outcome: 'skipped', value: 'only documentation changed' });
  skipped.wake();
  const w2 = skipped.wake();
  assert.equal(w2.at(-1).then, 'done');
  assert.ok(!git(skipped.intWt, 'log', '--format=%s', `main..${LINE}`).includes('refactor: simplify'), 'skipped: no commit');
  const wrap = skipped.actions(w2).find((x) => x.step === 'wrap-up');
  assert.deepEqual(wrap.meta, { simplifySkipped: [{ line: LINE, reason: 'only documentation changed' }] });
  assert.ok(wrap.do.includes(`${LINE}: only documentation changed`), 'the wrap-up names the line and its reason');
  assert.match(wrap.do, /self-answer log/);
  assert.match(wrap.do, /closing summary/);
});

test('#153: simplify: false sends no simplify agent and lists no skipped line', (t) => {
  const h = world(t, { profile: { simplify: false } });
  h.policy.simplify = () => {
    throw new Error('no simplify agent under simplify: false');
  };
  h.wake();
  const w2 = h.wake();
  assert.equal(w2.at(-1).then, 'done');
  assert.ok(!h.log.some((a) => a.step === 'simplify'));
  assert.ok(!Object.keys(h.state().tick.issued).some((x) => x.startsWith('simplify:')));
  assert.equal(h.actions(w2).find((x) => x.step === 'wrap-up').meta, undefined);
});

// ---- #139: tick judges the review tier first, then picks the review -------------------------------------------------

/** The tier judgements tick handed out for `id`, each once. */
const tierJudges = (h, id) => distinct(h.log).filter((a) => a.step === 'tier' && a.tickets[0] === id);
const reviewsOf = (h, id) => h.log.filter((a) => a.step === 'review' && a.tickets[0] === id);
const recorded = (h, id) => h.state().tickets[id].reviews.map((r) => [r.kind, r.tier ?? null, r.mode, r.verdict]);

test('#139: on one line a light ticket gets the minimal review, a standard one the prove-it review with its tier in the spawn file', (t) => {
  const h = world(t);
  h.change['#1'] = { lines: 10 }; // a few lines of code: light
  h.policy.review = (a) => (a.tickets[0] === '#2' && a.meta.mode === 'initial' ? { outcome: 'fix', findings: 'F1' } : 'pass');
  assert.equal(h.untilDone().then, 'done');
  const judged = {};
  for (const id of ['#1', '#2']) {
    const all = tierJudges(h, id);
    assert.equal(all.length, 1, `${id}: the tier is judged once; the recheck keeps it`);
    const [j] = all;
    assert.equal(j.kind, 'exec');
    assert.deepEqual(j.argv.slice(1, 6).map((x, i) => (i ? x : basename(x))), ['tier.mjs', 'judge', '--base', LINE, '--head']);
    assert.match(j.argv[6], /^r1\//, 'the head is the ticket branch');
    assert.equal(resolve(j.cwd), resolve(h.repo), 'run in the repo');
    judged[id] = j;
  }
  assert.equal(JSON.parse(readFileSync(judged['#1'].stdout, 'utf8')).tier, 'light');
  assert.equal(JSON.parse(readFileSync(judged['#2'].stdout, 'utf8')).tier, 'standard');

  // light: the minimal review, its report file and its --kind minimal record, no review host
  const light = reviewsOf(h, '#1');
  assert.deepEqual(light.map((a) => [a.meta.kind, a.meta.mode]), [['minimal', 'initial']]);
  assert.ok(readFileSync(briefOf(light[0]), 'utf8').startsWith('# Review #1'), 'the minimal reviewer brief');
  assert.equal(reportOf(light[0]).replace(/\\/g, '/'), `${h.W.replace(/\\/g, '/')}/tick/review/1-1.report.md`);
  assert.ok(!h.log.some((a) => a.step === 'brief' && a.tickets[0] === '#1' && a.argv[2] === 'review'), 'no brief.mjs review for a light ticket');
  assert.deepEqual(recorded(h, '#1'), [['minimal', 'light', 'initial', 'pass']]);

  // standard: the prove-it review, its tier and the judge output in the spawn file, at the initial review and the recheck
  const standard = reviewsOf(h, '#2');
  assert.deepEqual(standard.map((a) => [a.meta.kind, a.meta.mode]), [['full', 'initial'], ['full', 'recheck']]);
  for (const a of standard) {
    const file = readFileSync(briefOf(a), 'utf8');
    assert.ok(file.startsWith('你是審查主持 agent：'), 'the review host spawn file');
    const line = `- review tier: standard (tier.mjs judge output: ${resolve(judged['#2'].stdout)})\n`;
    assert.ok(file.includes(line), `${JSON.stringify(line)} in\n${file.slice(file.lastIndexOf('\n---\n'))}`);
  }
  assert.deepEqual(recorded(h, '#2'), [['full', 'standard', 'initial', 'fix'], ['full', 'standard', 'recheck', 'pass']]);
});

test('#139: a full ticket (a sensitive path) gets the prove-it review with tier full in its spawn file', (t) => {
  const h = world(t);
  h.change['#1'] = { path: '.github/workflows/ci.yml', lines: 2 };
  assert.equal(h.untilDone().then, 'done');
  const [a] = reviewsOf(h, '#1');
  assert.equal(a.meta.kind, 'full');
  assert.match(readFileSync(briefOf(a), 'utf8'), /^- review tier: full \(tier\.mjs judge output: .+\)$/m);
  assert.deepEqual(recorded(h, '#1'), [['full', 'full', 'initial', 'pass']]);
});

test('#139: under review: minimal every ticket gets the minimal review, whatever its tier; no tier is judged', (t) => {
  const h = world(t, { profile: { review: 'minimal' } });
  h.change['#1'] = { lines: 10 };
  assert.equal(h.untilDone().then, 'done');
  assert.deepEqual(h.log.filter((a) => a.step === 'tier'), []);
  for (const id of ['#1', '#2']) {
    assert.deepEqual(reviewsOf(h, id).map((a) => a.meta.kind), ['minimal'], id);
    assert.deepEqual(recorded(h, id), [['minimal', null, 'initial', 'pass']], id);
  }
});

// ---- #139 × #142 × #143: the review tier picks the review; the counts and the assignment record go with it -------------

test('#156: the review is recorded with its tier.mjs reasons and its four finding counts, in the foreground and from the background', (t) => {
  for (const background of [false, true]) {
    const h = world(t);
    h.reviewBackground = background;
    h.change['#1'] = { lines: 10 }; // light: the minimal review, which takes no finding counts
    let refused = 0;
    h.policy.review = (a) => {
      if (a.tickets[0] === '#1' && !refused++) {
        const r = h.tick('record', h.path, a.id, '--agent', 'x', '--outcome', 'pass', '--candidates', '1', '--confirmed', '0', '--invalid', '1', '--blocking', '0');
        assert.equal(r.code, 2, 'a minimal review takes no finding counts');
        assert.match(r.err, /minimal/);
      }
      return a.tickets[0] === '#2' ? { outcome: 'pass', findingCounts: { candidates: 4, confirmed: 1, invalid: 3, blocking: 0 } } : 'pass';
    };
    assert.equal(h.untilDone().then, 'done');
    const reviews = (id) => h.state().tickets[id].reviews.map((r) => [r.kind, r.tier, r.tierReasons, r.findingCounts]);
    assert.deepEqual(reviews('#1'), [['minimal', 'light', ['few-lines'], null]], `background ${background}`);
    assert.deepEqual(reviews('#2'), [['full', 'standard', ['default'], { candidates: 4, confirmed: 1, invalid: 3, blocking: 0 }]], `background ${background}`);
  }
});

test('#173: tier.mjs reasons with a space or a comma are recorded whole, one entry each, in the foreground and from the background', (t) => {
  const REASONS = ['sensitive', 'src/x.mjs#a b', 'c,d'];
  for (const background of [false, true]) {
    const h = world(t);
    h.reviewBackground = background;
    h.change['#1'] = { lines: 10 }; // light: the minimal review; #2 standard: the prove-it review host
    // replay the judge's output with these reasons in place of its own
    const exec = h.exec;
    let replayed = 0;
    h.exec = (a) => {
      const code = exec(a);
      if (a.argv[0] === 'node' && basename(a.argv[1]) === 'tier.mjs' && a.stdout) {
        writeFileSync(a.stdout, JSON.stringify({ ...JSON.parse(readFileSync(a.stdout, 'utf8')), reasons: REASONS }));
        replayed += 1;
      }
      return code;
    };
    assert.equal(h.untilDone().then, 'done');
    assert.ok(replayed >= 2, `background ${background}: both tickets judged`);
    const reviews = (id) => h.state().tickets[id].reviews.map((r) => [r.kind, r.tier, r.tierReasons]);
    assert.deepEqual(reviews('#1'), [['minimal', 'light', REASONS]], `background ${background}`);
    assert.deepEqual(reviews('#2'), [['full', 'standard', REASONS]], `background ${background}`);
  }
});

test('#156: the four finding counts go together', (t) => {
  const h = world(t);
  let checked = 0;
  h.policy.review = (a) => {
    if (a.meta.kind === 'full' && !checked++) {
      const r = h.tick('record', h.path, a.id, '--agent', 'x', '--outcome', 'pass', '--observations', '0', '--pre-existing', '0', '--candidates', '2', '--confirmed', '1');
      assert.equal(r.code, 2);
      assert.match(r.err, /--candidates, --confirmed, --invalid and --blocking go together/);
    }
    return 'pass';
  };
  assert.equal(h.untilDone().then, 'done');
  assert.ok(checked > 0);
});

test("#139 × #142 × #143: a light ticket's minimal review takes no counts and has no assignment record; a standard ticket's review host in the background is recorded by its collect, with its tier and counts", (t) => {
  const h = world(t);
  h.reviewBackground = true;
  h.change['#1'] = { lines: 10 }; // a few lines of code: light
  let checked = 0;
  h.policy.review = (a) => {
    if (a.tickets[0] === '#1' && !checked++) {
      assert.equal(a.meta.kind, 'minimal');
      assert.doesNotMatch(a.record, /--observations/);
      const r = h.tick('record', h.path, a.id, '--agent', 'x', '--outcome', 'pass', '--observations', '1', '--pre-existing', '0');
      assert.equal(r.code, 2, 'a minimal review takes no counts');
      assert.match(r.err, /minimal/);
    }
    return a.tickets[0] === '#2' ? { outcome: 'pass', observations: 1, preExisting: 0 } : 'pass';
  };
  assert.equal(h.untilDone().then, 'done');
  assert.equal(checked, 1);
  // #1, light: the minimal review in the foreground, no assignment record or time limit, no counts
  assert.ok(!h.log.some((a) => /^(rec|assign):review:#1:/.test(a.id)), 'no assignment record for the minimal review');
  assert.ok(!h.log.some((a) => a.step === 'collect' && a.meta?.stage === 'in-review' && a.tickets[0] === '#1'));
  assert.deepEqual(h.state().tickets['#1'].reviews.map((r) => [r.kind, r.tier, r.observations, r.preExisting]), [['minimal', 'light', 0, 0]]);
  // #2, standard: the prove-it review with its assignment record; its host went to the background and its collect
  // recorded the review with the tier its spawn was chosen by, and the counts
  assert.ok(h.log.some((a) => a.id.startsWith('rec:review:#2:')) && h.log.some((a) => a.id.startsWith('assign:review:#2:')));
  const collect = h.log.find((a) => a.step === 'collect' && a.meta?.stage === 'in-review' && a.tickets[0] === '#2');
  assert.ok(collect, "#2's review host is collected");
  assert.equal(collect.meta.tier, 'standard');
  assert.deepEqual(h.state().tickets['#2'].reviews.map((r) => [r.kind, r.tier, r.observations, r.preExisting]), [['full', 'standard', 1, 0]]);
  assert.deepEqual(distinct(h.log).filter((a) => a.step === 'observations').map((a) => a.id), ['observations:#2:1']);
});

// AGENTS.md: a subagent is given the files it reads by absolute path. The host may hand tick a relative state path;
// each spawn's prompt still names its brief absolutely (implement, minimal and prove-it review, simplify).
test('with a relative state path every spawn prompt names its brief by an absolute path', (t) => {
  const h = world(t);
  h.change['#1'] = { lines: 10 }; // light: a minimal review; #2 is standard: a prove-it review
  const cwd = process.cwd();
  process.chdir(h.dir);
  try {
    const rel = relative(h.dir, h.path);
    assert.ok(!isAbsolute(rel));
    assert.equal(h.untilDone(() => h.wake({ via: (...args) => h.tick('next', rel, ...args) })).then, 'done');
  } finally {
    process.chdir(cwd);
  }
  const spawns = distinct(h.log).filter((a) => a.kind === 'spawn');
  const kinds = spawns.map((a) => `${a.step}${a.meta?.kind ? `:${a.meta.kind}` : ''}`);
  for (const k of ['spawn', 'review:minimal', 'review:full', 'simplify']) assert.ok(kinds.includes(k), `${k} in ${kinds}`);
  for (const a of spawns) {
    assert.ok(isAbsolute(briefOf(a)), `${a.id}: ${a.spawn.prompt}`);
    if (a.spawn.fallback) assert.ok(isAbsolute(briefOf({ spawn: a.spawn.fallback })), `${a.id} fallback: ${a.spawn.fallback.prompt}`);
  }
});

// ---- #200: the finish under integrate: ticket-pr -------------------------------------------------------------------

test('#200: the ticket-pr finish skips the line delivery, passes the finish gate, polishes only the PR left for a person, and reconciles every ticket with its PR', (t) => {
  const h = world(t, { profile: { integrate: 'ticket-pr' } });
  const [ID1, ID2] = h.ids;
  h.policy['pr-send'] = (a) => {
    if (a.tickets[0] === ID2) return 'left-for-human';
    h.mergePr(a.tickets[0]);
    return 'sent';
  };
  h.untilDone();
  assert.equal(h.wakes.at(-1).at(-1).then, 'done');
  const once = distinct(h.log);
  assert.ok(once.some((a) => a.id === 'gate:finish'), 'the finish gate runs under ticket-pr');
  for (const step of ['simplify', 'sync-base', 'verify-local', 'deliver-line']) assert.ok(!once.some((a) => a.step === step), `no ${step} under ticket-pr`);
  assert.ok(!once.some((a) => (a.argv ?? []).some((x) => String(x).endsWith('review-guide.mjs'))), 'no review-guide.mjs');
  const polish = once.filter((a) => a.step === 'pr-polish');
  assert.deepEqual(polish.map((a) => a.tickets[0]), [ID2], 'only the PR left for a person is polished');
  assert.match(polish[0].do, /Skill tool with `no-bullshit`/);
  const wrap = once.find((a) => a.id === 'wrap-up');
  assert.ok(h.log.findIndex((a) => a.id === 'wrap-up') > h.log.findIndex((a) => a.step === 'pr-polish'), 'polished before the wrap-up');
  const s = h.state();
  const rows = Object.fromEntries(wrap.meta.tickets.map((r) => [r.ticket, r]));
  assert.equal(rows[ID1].merge, 'merged');
  assert.equal(rows[ID1].mergeSha, s.tickets[ID1].merges[0].sha);
  assert.equal(rows[ID2].merge, 'left-for-human');
  assert.equal(rows[ID1].url, `https://github.com/o/r/pull/${s.tickets[ID1].pr}`);
  assert.deepEqual(rows[ID1].ci?.verdict, 'green', "the PR head's CI result");
  assert.equal(rows[ID1].stack, null);
  assert.equal(wrap.meta.humanWork.length, 1);
  assert.equal(wrap.meta.humanWork[0].ticket, ID2);
  assert.match(wrap.meta.humanWork[0].text, /merge-gate\.mjs: merge, no-queue/);
  assert.match(wrap.do, /no aggregate PR/);
});
