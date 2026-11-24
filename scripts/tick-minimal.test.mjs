// node --test scripts/tick-minimal.test.mjs
// Replays of get-to-work's wake-ups through tick.mjs: the ticket face in the spawn files (#137), expand: skip (#128 D3, #130), the minimal review and its rounds (#128 D4, #130, #145).
// The world they play in and the host's stand-in are in tick-world.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { main as tick } from '../src/skills/get-to-work/scripts/tick.mjs';
import { root, git, write, localTicket, world, distinct, stage, briefOf, reportOf } from './tick-world.mjs';
/** The full ticket text a spawn file of IMPLEMENTER.md carries: from its `票面全文` item to the expansion block's. */
const fullTextOf = (brief) => brief.slice(brief.indexOf('- 票面全文：'), brief.indexOf('- 展開區塊：'));
const inOrder = (text, parts) => {
  const at = parts.map((p) => text.indexOf(p));
  return at.every((i, k) => i >= 0 && (k === 0 || i > at[k - 1]));
};

test('#137: on GitHub the ticket face holds the title, body and comments, then the expansion block; the expansion and implementation spawn files embed it', (t) => {
  const h = world(t);
  h.acceptance['#1'] = { items: [], expansions: [] }; // #1 goes to expansion first
  h.comments['#1'] = [{ author: { login: 'maintainer' }, body: 'A comment on #1.', createdAt: '2026-04-30T09:00:00Z' }];
  const expand = distinct(h.actions(h.wake())).find((a) => a.kind === 'spawn' && a.spawn.description === 'expand #1');
  assert.ok(expand, '#1 goes to an expansion agent');
  const expansionBrief = readFileSync(briefOf(expand), 'utf8');
  assert.ok(inOrder(expansionBrief, ['First thing', 'The ticket text of #1.', 'A comment on #1.']), `the title, body and comment of #1 in\n${expansionBrief}`);
  assert.ok(!expansionBrief.includes('<!-- sorry-matt:expansion -->'), 'no expansion block before the expansion');

  const implement = distinct(h.actions(h.wake())).find((a) => a.kind === 'spawn' && a.spawn.description === 'implement #1');
  assert.ok(implement, '#1 is dispatched after its expansion');
  const face = readFileSync(join(h.W, 'tick', 'body', '1.md'), 'utf8');
  assert.ok(inOrder(face, ['First thing', 'The ticket text of #1.', 'A comment on #1.', '<!-- sorry-matt:expansion -->', 'expanded criterion of #1']), `title, body, comment, then the expansion block:\n${face}`);
  assert.equal(face.split('<!-- sorry-matt:expansion -->').length, 2, 'the expansion block once');
  const fullText = fullTextOf(readFileSync(briefOf(implement), 'utf8'));
  for (const text of ['First thing', 'The ticket text of #1.', 'A comment on #1.', 'expanded criterion of #1']) assert.ok(fullText.includes(text), `${JSON.stringify(text)} in the full ticket text:\n${fullText}`);
  // every fetch asks gh for the JSON of the title, body and comments
  const fetches = distinct(h.log).filter((a) => a.step === 'body');
  assert.ok(fetches.length >= 2, 'fetched for the expansion and again for the implementation');
  for (const a of fetches) assert.deepEqual(a.argv.slice(-2), ['--json', 'title,body,comments'], a.command);
});

test('#137: on Local Markdown the ticket face is the ticket file, as before: no gh fetch, the spawn file embeds the file', (t) => {
  const h = world(t, { tracker: 'local' });
  const [id] = h.ids;
  const implement = distinct(h.actions(h.wake())).find((a) => a.kind === 'spawn' && a.spawn.description === `implement ${id}`);
  assert.ok(implement, `${id} is dispatched`);
  assert.ok(!h.log.some((a) => a.step === 'body' || (a.kind === 'exec' && a.argv[0] === 'gh' && a.argv[1] === 'issue')), 'no ticket fetch');
  const fullText = fullTextOf(readFileSync(briefOf(implement), 'utf8'));
  for (const line of localTicket(id, 'First thing').split('\n').filter(Boolean)) assert.ok(fullText.includes(line), `${JSON.stringify(line)} in the full ticket text:\n${fullText}`);
});

test('#128 D3: under expand: skip the spawn file says the ticket text is the acceptance; under agent, the criteria', (t) => {
  for (const [profile, line] of [
    [{ expand: 'skip' }, '- 驗收來源：票面文字就是驗收\n'],
    [null, '- 驗收來源：驗收項與展開區塊\n'],
  ]) {
    const h = world(t, { profile });
    if (profile) h.acceptance['#1'] = { items: [], expansions: [] }; // no criteria: under skip it goes on with its text
    const spawn = h.actions(h.wake()).find((a) => a.kind === 'spawn' && a.tickets[0] === '#1');
    assert.ok(spawn, `#1 is dispatched under ${profile ? 'skip' : 'agent'}`);
    for (const file of [briefOf(spawn), briefOf({ spawn: spawn.spawn.fallback })]) assert.ok(readFileSync(file, 'utf8').includes(line), `${file} has ${JSON.stringify(line)}`);
  }
});

test('#130: under expand: skip a ticket whose snapshot has criteria (a previous run expanded it) gets criteria, not ticket-text', (t) => {
  const EXPANDED = '<!-- sorry-matt:expansion -->\nby: expansion-agent\nrun: r0\nround: 1\n\nacceptance:\n- [ ] it works';
  for (const [spec, acceptance, line, expansion] of [
    [{ items: [{ from: 'expansion', by: 'expansion-agent', run: 'r0', round: '1', text: 'it works' }], expansions: [{ by: 'expansion-agent', run: 'r0', round: '1', at: 'u', text: EXPANDED }] }, 'criteria', '- 驗收來源：驗收項與展開區塊\n', `- 展開區塊：${EXPANDED.replace(/\n(?=.)/g, '\n  ')}\n`],
    [{ items: [{ from: 'original', text: 'criterion of #1' }], expansions: [] }, 'criteria', '- 驗收來源：驗收項與展開區塊\n', '- 展開區塊：none\n'],
    [{ items: [], expansions: [] }, 'ticket-text', '- 驗收來源：票面文字就是驗收\n', '- 展開區塊：none\n'],
  ]) {
    const h = world(t, { profile: { expand: 'skip' } });
    h.acceptance['#1'] = spec;
    const spawn = h.actions(h.wake()).find((a) => a.kind === 'spawn' && a.tickets[0] === '#1');
    assert.ok(spawn, `#1 is dispatched with ${spec.items.length} criteria`);
    const values = JSON.parse(readFileSync(join(h.W, 'tick', 'brief', '1-1.values.json'), 'utf8'));
    assert.equal(values.acceptance, acceptance, `${spec.items.length} criteria: acceptance ${acceptance}`);
    const brief = readFileSync(briefOf(spawn), 'utf8');
    assert.ok(brief.includes(line), `${JSON.stringify(line)} in\n${brief}`);
    assert.ok(brief.includes(expansion), `${JSON.stringify(expansion)} in\n${brief}`);
  }
});

test('#128 D4: the minimal reviewer writes its report to a file; record fix is refused until the file holds it', (t) => {
  const h = world(t, { profile: { review: 'minimal' } });
  const spawn = h.spawn;
  let refused = 0;
  h.spawn = (a) => {
    if (a.step !== 'review' || a.tickets[0] !== '#1' || a.meta.mode !== 'initial') return spawn(a);
    const report = reportOf(a);
    const W = h.W.replace(/\\/g, '/');
    assert.equal(report.replace(/\\/g, '/'), `${W}/tick/review/1-1.report.md`);
    const brief = readFileSync(briefOf(a), 'utf8');
    assert.ok(brief.includes(report), 'the brief names the report file');
    assert.match(brief, /write your full report/i);
    const fix = () => h.tick('record', h.path, a.id, '--agent', 'rv1', '--outcome', 'fix', '--findings', 'F1');
    assert.equal(existsSync(report), false);
    assert.equal(fix().code, 3, 'no report file: refused');
    write(report, '  \n');
    assert.equal(fix().code, 3, 'an empty report file: refused');
    h.writeReport(report, 'verdict: fix\nF1: a.txt:1 wrong (evidence)\n');
    refused += 1;
    return ['--agent', 'rv1', '--outcome', 'fix', '--findings', 'F1'];
  };
  h.untilDone();
  assert.equal(refused, 1);
  assert.equal(h.state().tickets['#1'].reviews[0].verdict, 'fix', 'the same record is taken once the file holds the report');
  // the fix round reads its findings from that file, not from the status record
  const send = h.log.find((a) => a.step === 'send' && a.tickets[0] === '#1');
  assert.ok(send.do.includes(join(h.W, 'tick', 'review', '1-1.report.md')), send.do);
  assert.doesNotMatch(send.do, /status record/);
  // #130: the batched fix the send points to says that under review: minimal the report file is what is handed over
  const ref = send.reference.find((r) => r.path.endsWith('SKILL.md') && r.part === 'section 2, Batched fix');
  assert.ok(ref, 'the send points to SKILL.md section 2, Batched fix');
  for (const [skill, heading, line] of [
    [ref.path, '### 集中修正', /`review: minimal` 時.*交回原 agent 的是 reviewer 報告檔.*的路徑，不是審查區塊的位置/],
    [join(root, 'skills', 'get-to-work', 'SKILL.md'), '### Batched fix', /Under `review: minimal`.*hand the original agent the path of the reviewer's report file.*not a review block's location/],
  ]) {
    const text = readFileSync(skill, 'utf8').replace(/\r\n/g, '\n');
    const section = text.slice(text.indexOf(heading), text.indexOf('\n### ', text.indexOf(heading) + 1));
    assert.match(section.replace(/\n/g, ' '), line, `${skill}: ${heading}`);
  }
  assert.equal(h.wakes.at(-1).at(-1).then, 'done');
});

/** A minimal review of #1 at its initial review, played by `play(a)` (the reviewer's flags for its record). */
function minimalReview(t, play, profile = {}) {
  const h = world(t, { profile: { review: 'minimal', ...profile } });
  const spawn = h.spawn;
  const seen = [];
  h.spawn = (a) => {
    if (a.step !== 'review' || a.tickets[0] !== '#1' || a.meta.mode !== 'initial') return spawn(a);
    seen.push(a);
    return play(a, h);
  };
  return { h, seen };
}
const recordReview = (h, a, outcome) => h.tick('record', h.path, a.id, '--agent', 'rv1', '--outcome', outcome, ...(outcome === 'fix' ? ['--findings', 'F1'] : []));

test('#130: minimal record review is refused (3) when the report says another verdict: fix recorded on a pass report', (t) => {
  const { h, seen } = minimalReview(t, (a, h) => {
    h.writeReport(reportOf(a), 'verdict: pass\n');
    const r = recordReview(h, a, 'fix');
    assert.equal(r.code, 3, 'fix on a report that says pass');
    assert.match(r.err, /verdict/);
    return ['--agent', 'rv1', '--outcome', 'pass'];
  });
  assert.equal(h.untilDone().then, 'done');
  assert.equal(seen.length, 1);
  assert.equal(h.state().tickets['#1'].reviews[0].verdict, 'pass', 'the verdict the report holds is taken');
});

test('#130: minimal record review is refused (3) when the report says another verdict: pass recorded on a fix report', (t) => {
  const { h, seen } = minimalReview(t, (a, h) => {
    h.writeReport(reportOf(a), 'verdict: fix\nF1: a.txt:1 wrong (evidence)\n');
    const r = recordReview(h, a, 'pass');
    assert.equal(r.code, 3, 'pass on a report that says fix');
    assert.match(r.err, /verdict/);
    h.writeReport(reportOf(a), 'F1: a.txt:1 wrong (evidence)\n');
    assert.equal(recordReview(h, a, 'fix').code, 3, 'a report with no verdict line');
    h.writeReport(reportOf(a), 'verdict: fix\nF1: a.txt:1 wrong (evidence)\n');
    return ['--agent', 'rv1', '--outcome', 'fix', '--findings', 'F1'];
  });
  assert.equal(h.untilDone().then, 'done');
  assert.equal(seen.length, 1);
  assert.equal(h.state().tickets['#1'].reviews[0].verdict, 'fix');
});

test("#130: minimal record review is refused (3) when the report was written before the round's review spawn was first issued", (t) => {
  const { h, seen } = minimalReview(t, (a, h) => {
    const issued = h.state().tick.issued[a.id].at;
    assert.equal(issued, h.iso(), 'tick keeps when it issued the review spawn');
    // an interrupted round left this report behind: written a minute before the spawn was issued again
    for (const outcome of ['fix', 'pass']) {
      h.writeReport(reportOf(a), `verdict: ${outcome}\n`, Date.parse(issued) - 60_000);
      const r = recordReview(h, a, outcome);
      assert.equal(r.code, 3, `an old report: ${outcome} refused`);
      assert.match(r.err, /before/);
    }
    h.writeReport(reportOf(a), 'verdict: fix\nF1: a.txt:1 wrong (evidence)\n');
    return ['--agent', 'rv1', '--outcome', 'fix', '--findings', 'F1'];
  });
  assert.equal(h.untilDone().then, 'done');
  assert.equal(seen.length, 1);
  assert.equal(h.state().tickets['#1'].reviews[0].verdict, 'fix', 'the report this round wrote is taken');
});

test('#130: minimal record review accepts the report this round wrote with the verdict it records', (t) => {
  const { h, seen } = minimalReview(t, (a, h) => {
    h.writeReport(reportOf(a), 'verdict: fix\nF1: a.txt:1 wrong (evidence)\n');
    return ['--agent', 'rv1', '--outcome', 'fix', '--findings', 'F1']; // h.record asserts exit 0
  });
  assert.equal(h.untilDone().then, 'done');
  assert.equal(seen.length, 1);
  assert.equal(h.state().tickets['#1'].reviews[0].verdict, 'fix');
  assert.equal(h.state().tickets['#1'].reviews.at(-1).verdict, 'pass', 'the recheck passes');
});

/** The host runs `next` once more before it records the review spawn `a`: the list hands the same spawn out again. */
const nextAgain = (h, a) => {
  const r = h.tick('next', h.path);
  assert.equal(r.code, 0, r.err);
  assert.ok(JSON.parse(r.out).actions.some((x) => x.id === a.id), `${a.id} is handed out again, not recorded yet`);
};

test('#145: a report written before one more `next` is accepted: issuing the same round again keeps its issue time', (t) => {
  const { h, seen } = minimalReview(t, (a, h) => {
    const first = h.state().tick.issued[a.id].at;
    assert.equal(first, h.iso(), 'the round was first issued now');
    h.now += 60_000;
    h.writeReport(reportOf(a), 'verdict: fix\nF1: a.txt:1 wrong (evidence)\n');
    h.now += 60_000;
    nextAgain(h, a);
    assert.equal(h.state().tick.issued[a.id].at, first, "the issue time is still the round's first");
    return ['--agent', 'rv1', '--outcome', 'fix', '--findings', 'F1']; // h.record asserts exit 0
  });
  assert.equal(h.untilDone().then, 'done');
  assert.equal(seen.length, 1);
  assert.equal(h.state().tickets['#1'].reviews[0].verdict, 'fix', 'the report written before the extra next is taken');
});

test('#145: a report from before the round was first issued is still refused after one more `next`', (t) => {
  const { h, seen } = minimalReview(t, (a, h) => {
    const first = h.state().tick.issued[a.id].at;
    h.writeReport(reportOf(a), 'verdict: fix\nF1: a.txt:1 wrong (evidence)\n', Date.parse(first) - 60_000);
    h.now += 60_000;
    nextAgain(h, a);
    const r = recordReview(h, a, 'fix');
    assert.equal(r.code, 3, "an older round's report: refused");
    assert.match(r.err, /before/);
    assert.ok(r.err.includes(first), r.err);
    h.writeReport(reportOf(a), 'verdict: fix\nF1: a.txt:1 wrong (evidence)\n');
    return ['--agent', 'rv1', '--outcome', 'fix', '--findings', 'F1'];
  });
  assert.equal(h.untilDone().then, 'done');
  assert.equal(seen.length, 1);
  assert.equal(h.state().tickets['#1'].reviews[0].verdict, 'fix', 'the report this round wrote is taken');
});

test('#145: the initial review and each recheck are rounds of their own, each with the time it was first issued', (t) => {
  const h = world(t, { profile: { review: 'minimal', fixRounds: 2 } });
  const spawn = h.spawn;
  const rounds = [];
  h.spawn = (a) => {
    if (a.step !== 'review' || a.tickets[0] !== '#1') return spawn(a);
    const first = h.state().tick.issued[a.id].at;
    rounds.push({ id: a.id, mode: a.meta.mode, first, now: h.iso() });
    h.now += 60_000;
    nextAgain(h, a); // the same round issued again: its time stays
    assert.equal(h.state().tick.issued[a.id].at, first, `${a.id}: the round's first issue time`);
    const outcome = rounds.length < 3 ? 'fix' : 'pass';
    h.writeReport(reportOf(a), `verdict: ${outcome}\n${outcome === 'fix' ? 'F1: a.txt:1 wrong (evidence)\n' : ''}`);
    return ['--agent', `rv${rounds.length}`, '--outcome', outcome, ...(outcome === 'fix' ? ['--findings', 'F1'] : [])];
  };
  assert.equal(h.untilDone().then, 'done');
  assert.deepEqual(
    rounds.map((r) => r.mode),
    ['initial', 'recheck', 'recheck'],
  );
  assert.equal(new Set(rounds.map((r) => r.id)).size, 3, 'each round is its own action');
  for (const r of rounds) assert.equal(r.first, r.now, `${r.id}: written when the round was first issued`);
  assert.ok(rounds.every((r, k) => k === 0 || Date.parse(r.first) > Date.parse(rounds[k - 1].first)), 'each round a new, later time');
});

test('#130: with onUnfixed: stuck the mark-stuck judge names the report file (minimal) or the review block (full)', (t) => {
  for (const profile of [{ review: 'minimal' }, null]) {
    const h = world(t, { profile });
    h.policy.review = (a) => (a.tickets[0] === '#1' ? { outcome: 'fix', findings: 'F1' } : 'pass');
    h.policy['mark-stuck'] = (a) => {
      // as SEND-BACK.md has it: the ticket's worktree and branch are removed
      const branch = h.state().tickets[a.tickets[0]].branch;
      const blocks = git(h.repo, 'worktree', 'list', '--porcelain').split(/\n\s*\n/);
      const wt = blocks.find((b) => b.includes(`branch refs/heads/${branch}`))?.match(/^worktree (.+)$/m)?.[1];
      if (wt) git(h.repo, 'worktree', 'remove', '--force', wt);
      git(h.repo, 'branch', '-D', branch);
      return { outcome: 'stuck', value: 'findings still open' };
    };
    assert.equal(h.untilDone().then, 'done', `the run under ${profile ? 'minimal' : 'full'} finished`);
    assert.equal(stage(h, '#1'), 'stuck');
    const mark = h.log.find((a) => a.step === 'mark-stuck' && a.tickets[0] === '#1');
    assert.ok(mark, 'a mark-stuck judge');
    if (profile) {
      const last = h.log.filter((a) => a.step === 'review' && a.tickets[0] === '#1').at(-1);
      assert.ok(mark.do.includes(`the open findings are in ${reportOf(last)}, the reviewer's report`), mark.do);
      assert.doesNotMatch(mark.do, /review block/);
    } else {
      assert.match(mark.do, /the open findings are in the latest review block of its status record/);
      assert.ok(!mark.do.includes('.report.md'), mark.do);
    }
  }
});

test('#130: the minimal reviewer brief names the ticket text file and the acceptance source; its spawn waits for the text', (t) => {
  for (const [profile, items, source] of [
    [{}, null, (h) => `- Acceptance: the \`items\` of the acceptance snapshot ${join(h.W, 'acceptance', '1.json')}.`],
    [{ expand: 'skip' }, [], () => '- Acceptance: the ticket text is the acceptance (expand: skip, and the snapshot has no criteria).'],
  ]) {
    const { h, seen } = minimalReview(
      t,
      (a, h) => {
        h.writeReport(reportOf(a), 'verdict: pass\n');
        return ['--agent', 'rv1', '--outcome', 'pass'];
      },
      profile,
    );
    if (items) h.acceptance['#1'] = { items, expansions: [] };
    assert.equal(h.untilDone().then, 'done');
    assert.equal(seen.length, 1);
    const brief = readFileSync(briefOf(seen[0]), 'utf8');
    const body = resolve(join(h.W, 'tick', 'body', '1.md'));
    assert.ok(brief.includes(`- Ticket text: ${body} (the full ticket text).`), brief);
    assert.ok(brief.includes(source(h)), `${JSON.stringify(source(h))} in\n${brief}`);
    assert.match(readFileSync(body, 'utf8'), /The ticket text of #1\./);
    const first = h.wakes.flat().flatMap((o) => o.actions).find((a) => a.id === seen[0].id);
    assert.ok(first.after.includes(`body:#1:review:1`), `the review spawn waits for the ticket text: ${first.after}`);
  }
});

test('#128 D4: a fix round given to a new agent names the findings source: the report file (minimal) or the status record (full)', (t) => {
  for (const profile of [{ review: 'minimal' }, null]) {
    const h = world(t, { profile });
    h.policy.review = (a) => (a.tickets[0] === '#1' && a.meta.mode === 'initial' ? { outcome: 'fix', findings: 'F1' } : 'pass');
    h.policy.send = () => 'gone'; // the implementer is gone: a new agent takes the fix round
    assert.equal(h.untilDone().then, 'done', `the run under ${profile ? 'minimal' : 'full'} finished`);
    const send = h.log.find((a) => a.step === 'send' && a.tickets[0] === '#1');
    const respawn = h.log.find((a) => a.kind === 'spawn' && a.step === 'spawn' && a.tickets[0] === '#1' && a.spawn.description === 'fix #1');
    assert.ok(send && respawn, 'a send, then a spawn of a fix agent');
    const brief = readFileSync(briefOf(respawn), 'utf8');
    const report = join(h.W, 'tick', 'review', '1-1.report.md');
    if (profile) {
      for (const text of [send.do, brief]) {
        assert.ok(text.includes(report), `names ${report}`);
        assert.doesNotMatch(text, /status record|狀態紀錄/);
      }
    } else {
      assert.match(send.do, /verbatim \(summary, evidence, fix\) from the status record/);
      assert.match(brief, /from the status record/);
      assert.ok(!send.do.includes('.report.md') && !brief.includes('.report.md'));
    }
  }
});
