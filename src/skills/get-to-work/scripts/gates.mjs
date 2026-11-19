// gates: the stage-exit assertions behind `node state.mjs check <state> <gate>`. Not a command itself; state.mjs loads
// the state, computes the effective profile and calls `runGate`. Each gate checks the state file against the real git
// state (and, for `ledger`, the run ledger) and lists every assertion it applied and every one that failed. It never
// writes: the state is the same after a failed gate as before it. No dependencies: runs on a bare Node 20+.
//
// Gates (one per stage exit; `--repo <path>` is the repository the integration branches live in, default the
// current directory; a branch is the `<run>/<line-slug>` name, a ticket the state's id)
//   freeze     --base <ref>     The freeze is done, before the first dispatch.
//     tickets            the state has at least one ticket.
//     not-dispatched     every ticket is still candidate.
//     line-branch        every integration branch exists as a local branch.
//     line-base          <ref> is an ancestor of (or is) every integration branch's tip: all were cut from one base.
//     line-worktree      every integration branch is checked out in a worktree.
//     commands-contract  every integration branch's tip has docs/agents/commands.md.
//   ci         [<branch>...]   CI was read for every line that reads it (default: every line).
//     ci-latest          a line that reads CI (profile ci: read, an `origin` remote, not settled as CI not covering
//                        it) has a CI verdict recorded for its local tip. A line `origin` does not have yet (never
//                        pushed: the first push is at close-out step 6) is not read and passes; an unreadable origin
//                        fails.
//     local-record       a line on local verification (no `origin`, or settled as CI not covering it) has a per-SHA
//                        local verification record for its local tip.
//   dispatch                   A dispatch point is done.
//     snapshot           every ticket at implementing through delivered has its acceptance snapshot's sha256.
//     assignment         every ticket at expanding, implementing or fixing has an assignment in flight (a deadline)
//                        with its agent id.
//     one-integrating    no line has more than one ticket at integrating.
//   review     [<ticket>...]   A review was recorded and the ticket moved on (default: every ticket with a review that
//                              is not stuck or awaiting-ruling).
//     one-initial        since the ticket last entered implementing, exactly one initial review that reviewed
//                        (pass or fix; a `stuck` before reviewing does not count) — exactly one is also the most.
//                        Not applied to a ticket in in-review with no review yet.
//     recheck-per-fix    (profile recheck: true) one recheck per fix round finished since it last entered
//                        implementing: a round is finished once the ticket is back in in-review and has a review
//                        there or has moved on (a round still in fixing, or awaiting its recheck, has none yet).
//     fix-rounds         at most the profile's fix rounds.
//     queued-review      a ticket at queued, integrating or delivered satisfies the queued guard (state.mjs Stages:
//                        a passing review as the latest since it last entered in-review, or what the profile relaxes).
//   merged     <ticket>...     The ticket's merge is done and recorded (close-out step 4), before push and clean-up.
//     stage              the ticket is integrating or delivered.
//     branch-recorded    its ticket branch is recorded (`set --branch`).
//     one-merge          exactly one recorded merge SHA whose message names the ticket branch (a red-light fix's
//                        `-ci` merges name another branch and are not counted).
//     no-ff              every recorded merge SHA is a commit with two parents and git's default subject
//                        `Merge branch '<branch>'` (with ` into <branch>` or without).
//     on-line            every recorded merge SHA is an ancestor of (or is) the line's local tip.
//     not-rewritten      when the ticket branch still exists, its tip is its merge's second parent.
//     tip-recorded       the state's tip for the line is the line's local tip.
//     one-integrating    (as in dispatch, for the ticket's line)
//   integrated <ticket>...     The close-out is done (steps 4–7): merged, delivered, pushed, cleaned up.
//     stage              the ticket is delivered.
//     branch-recorded, one-merge, no-ff, on-line, tip-recorded   (as in merged)
//     pushed             with an `origin` remote, `origin`'s branch is the line's local tip (`git ls-remote`).
//     cleaned            the ticket branch is gone locally and no worktree is on it or at its recorded worktree.
//   wake-end                   A wake-up is done.
//     pushed             (as in integrated, for every line with a recorded merge or already on `origin`: a line
//                        is first pushed at its first integration)
//     assignment         (as in dispatch)
//     fallback-wake      while any assignment is in flight, a background sleep task is recorded (`usage
//                        --sleep-task`).
//   stopped                    The run stopped on a limit and the undispatched tickets were set aside.
//     stop-recorded      the state has a stop with the limits that stopped it.
//     no-dispatch-after-stop  no ticket entered expanding or implementing at or after the stop.
//     undispatched-set-aside  no ticket is at candidate or expanding.
//     stop-reason        every ticket that entered awaiting-ruling at or after the stop has a reason naming one of
//                        the limits that stopped the run.
//   finish                     The finish is done.
//     end-state          every ticket is delivered, stuck or awaiting-ruling.
//     end-reason         every stuck or awaiting-ruling ticket has a reason.
//     delivered-merge    every delivered ticket has a merge SHA.
//     base-sync          every line with a delivered ticket has its base sync recorded; when synced, the base SHA is
//                        an ancestor of the line's local tip.
//     full-verification  every line with a delivered ticket has a final result recorded for its local tip: a CI
//                        verdict green or red, or a per-SHA local verification record.
//     tip-recorded       (as in merged, for every line with a delivered ticket)
//     pushed             (as in integrated, for every line with a delivered ticket)
//     cleaned            (as in integrated, for every ticket with a recorded branch)
//   ledger     --ledger <path> [--ended]   The run ledger has its shape (ASKING.md section 7).
//     marker             the first line (a BOM aside) is `<!-- sorry-matt:run active -->`, or with --ended
//                        `<!-- sorry-matt:run ended -->`, with nothing before it.
//     fields             the ten fields `## 1.` … `## 10.` appear once each, in order, each with content.
//     budget-limits      field 9 has `budget: spawns|rounds|hours|no-progress <integer>`.
//     stage-limits       field 9 has `budget: timeout-implement|timeout-fix|timeout-expand|timeout-merge <integer>`.
//     session            when CLAUDE_CODE_SESSION_ID is set, the ledger's first `session:` line is that id.
//     rule-files         field 10 has at least one `rule: <path>` line; every one is an absolute path to a file.
//   Ledger lines take hooks/runs.mjs's line shape: an optional list bullet, optional backticks.
//
// Which `Done when` item each assertion replaces, and which items stay text, is the table in
// docs/orchestration-plan.md section 6.
import { existsSync, statSync } from 'node:fs';
import { posix, resolve, win32 } from 'node:path';
import { canonical } from './cli.mjs';

const END = ['delivered', 'stuck', 'awaiting-ruling'];
const AGENT_STAGES = ['expanding', 'implementing', 'fixing'];
const SNAPSHOT_STAGES = ['implementing', 'in-review', 'fixing', 'queued', 'integrating', 'delivered'];
const QUEUED_ON = ['queued', 'integrating', 'delivered'];
const LIMITS = ['spawns', 'rounds', 'hours', 'no-progress'];
const STAGE_LIMITS = ['timeout-implement', 'timeout-fix', 'timeout-expand', 'timeout-merge'];
const MERGE_SUBJECT = /^Merge branch '([^']+)'(?: into \S.*)?$/;
const MARKER = { active: '<!-- sorry-matt:run active -->', ended: '<!-- sorry-matt:run ended -->' };

export const GATES = ['freeze', 'ci', 'dispatch', 'review', 'merged', 'integrated', 'wake-end', 'stopped', 'finish', 'ledger'];
/** Which gates take targets (tickets or branches) and which require them. */
export const TARGETS = { ci: 'branch', review: 'ticket', merged: 'ticket!', integrated: 'ticket!' };

// hooks/runs.mjs's ledger line shape, copied: a skill script cannot reach the plugin's hooks by one relative path
// in both the src and the dist tree.
const ledgerLine = (key, value) =>
  new RegExp(`^\\s*(?:[-*+]\\s+)?(?:\`\\s*)?${key}:\\s*(?:\`\\s*)?(?!\\s)${value.source}(?<!\\s)\\s*(?:\`\\s*)?$`);
const BUDGET = ledgerLine('budget', /([a-z][a-z-]*)\s+(\d+)/);
const SESSION = ledgerLine('session', /([^`\s]+)/);
const RULE = ledgerLine('rule', /([^`]+?)/);

// ---- git -----------------------------------------------------------------------------------------------------------

/** Read-only git queries over `git(args)`, which returns stdout or throws with `status` on a non-zero exit. */
function gitView(git) {
  const cache = new Map();
  const memo = (key, fn) => {
    if (!cache.has(key)) cache.set(key, fn());
    return cache.get(key);
  };
  const tryGit = (args) => {
    try {
      return git(args);
    } catch {
      return null;
    }
  };
  const commit = (rev) =>
    memo(`commit ${rev}`, () => {
      const out = tryGit(['show', '-s', '--format=%H%x00%P%x00%s', `${rev}^{commit}`, '--']);
      if (out === null) return null;
      const [sha, parents, subject] = out.replace(/\r?\n$/, '').split('\0');
      return { sha, parents: parents ? parents.split(' ') : [], subject };
    });
  return {
    head: (branch) => memo(`head ${branch}`, () => tryGit(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])?.trim() || null),
    commit,
    full: (rev) => commit(rev)?.sha ?? null,
    hasFile: (rev, path) => tryGit(['cat-file', '-e', `${rev}:${path}`]) !== null,
    isAncestor(a, b) {
      try {
        git(['merge-base', '--is-ancestor', a, b]);
        return true;
      } catch (error) {
        if (error.status === 1) return false;
        throw error;
      }
    },
    hasOrigin: () => memo('origin', () => tryGit(['remote', 'get-url', 'origin']) !== null),
    /** origin's tip of a branch: { sha } (null when origin has no such branch), or { error }. */
    originHead: (branch) =>
      memo(`origin ${branch}`, () => {
        try {
          const out = git(['ls-remote', 'origin', `refs/heads/${branch}`]);
          return { sha: out.split(/\s+/)[0] || null };
        } catch (error) {
          return { error: String(error.stderr || error.message).trim().split(/\r?\n/)[0] };
        }
      }),
    worktrees: () =>
      memo('worktrees', () => {
        const list = [];
        for (const row of (tryGit(['worktree', 'list', '--porcelain']) ?? '').split(/\r?\n/)) {
          if (row.startsWith('worktree ')) list.push({ path: row.slice(9), branch: null });
          else if (row.startsWith('branch refs/heads/') && list.length) list.at(-1).branch = row.slice(18);
        }
        return list;
      }),
  };
}

const samePath = (a, b) => {
  const norm = (p) => (process.platform === 'win32' ? canonical(p).toLowerCase() : canonical(p));
  return norm(a) === norm(b);
};
const shaMatches = (full, recorded) => typeof full === 'string' && typeof recorded === 'string' && recorded.length >= 7 && full.startsWith(recorded);

// ---- assertions ----------------------------------------------------------------------------------------------------

function recorder() {
  const checked = [];
  const failures = [];
  return {
    checked,
    failures,
    /** Registers `id` as applied and returns fail(subject, message). */
    check(id) {
      if (!checked.includes(id)) checked.push(id);
      return (subject, message) => failures.push({ assertion: id, subject, message });
    },
  };
}

const lastEntry = (t, stage) => t.history.findLastIndex((h) => h.to === stage);
const sinceImplementing = (t, list) => list.filter((r) => r.after > lastEntry(t, 'implementing'));
const ticketsOn = (state, branch) => Object.entries(state.tickets).filter(([, t]) => t.line === branch);
const deliveredLines = (state) => [...new Set(Object.values(state.tickets).filter((t) => t.stage === 'delivered').map((t) => t.line))];

function oneIntegrating(r, state, branches) {
  const fail = r.check('one-integrating');
  for (const branch of branches) {
    const at = ticketsOn(state, branch).filter(([, t]) => t.stage === 'integrating').map(([id]) => id);
    if (at.length > 1) fail(branch, `${at.length} tickets are integrating at once (${at.join(', ')}); a line integrates one at a time`);
  }
}

function assignments(r, state) {
  const fail = r.check('assignment');
  for (const [id, t] of Object.entries(state.tickets)) {
    if (!AGENT_STAGES.includes(t.stage)) continue;
    const a = t.assignment;
    if (!a || a.deadline === null) fail(id, `${t.stage} with no assignment in flight (deadline.mjs record, then assign)`);
    else if (a.agentId === null) fail(id, `${t.stage}: the assignment has no agent id (record it with agent after the spawn)`);
  }
}

function tipRecorded(r, g, state, branches) {
  const fail = r.check('tip-recorded');
  for (const branch of branches) {
    const head = g.head(branch);
    const tip = state.lines[branch].tip;
    if (head === null) fail(branch, 'no local branch');
    else if (!shaMatches(head, tip)) fail(branch, `the state's tip is ${tip ?? 'not recorded'}, the local branch is at ${head} (record it with line --tip)`);
  }
}

function pushed(r, g, branches) {
  const fail = r.check('pushed');
  if (!g.hasOrigin()) return;
  for (const branch of branches) {
    const head = g.head(branch);
    const remote = g.originHead(branch);
    if (head === null) fail(branch, 'no local branch');
    else if (remote.error) fail(branch, `could not read origin (${remote.error})`);
    else if (remote.sha === null) fail(branch, `origin has no ${branch}; push it`);
    else if (remote.sha !== head) fail(branch, `origin is at ${remote.sha}, the local branch at ${head}; push it`);
  }
}

function cleaned(r, g, state, ids) {
  const fail = r.check('cleaned');
  for (const id of ids) {
    const t = state.tickets[id];
    if (t.branch === null) continue;
    if (g.head(t.branch) !== null) fail(id, `the local ticket branch ${t.branch} still exists; remove it`);
    for (const w of g.worktrees()) {
      if (w.branch === t.branch || (t.assignment?.worktree && samePath(w.path, t.assignment.worktree))) {
        fail(id, `a worktree is still there: ${w.path}; remove it`);
      }
    }
  }
}

/** The merge assertions shared by merged and integrated. */
function merges(r, g, state, ids) {
  const failBranch = r.check('branch-recorded');
  const failOne = r.check('one-merge');
  const failNoFf = r.check('no-ff');
  const failOnLine = r.check('on-line');
  for (const id of ids) {
    const t = state.tickets[id];
    const head = g.head(t.line);
    const own = [];
    for (const m of t.merges) {
      const c = g.commit(m.sha);
      if (c === null) {
        failNoFf(id, `merge SHA ${m.sha} is not a commit in this repository`);
        continue;
      }
      const subject = MERGE_SUBJECT.exec(c.subject);
      if (c.parents.length !== 2) failNoFf(id, `${m.sha} has ${c.parents.length} parent(s); an integration is a --no-ff merge commit`);
      if (!subject) failNoFf(id, `${m.sha}'s subject is ${JSON.stringify(c.subject)}, not git's default "Merge branch '<branch>'"`);
      else if (subject[1] === t.branch) own.push(c);
      if (head === null) failOnLine(id, `${t.line}: no local branch`);
      else if (!g.isAncestor(c.sha, head)) failOnLine(id, `${m.sha} is not on ${t.line} (its tip is ${head})`);
    }
    if (t.branch === null) {
      failBranch(id, 'no ticket branch recorded (set --branch)');
      continue;
    }
    if (own.length !== 1) failOne(id, `${own.length} recorded merge SHAs of ${t.branch}; an integration records exactly one`);
  }
}

// ---- the gates -----------------------------------------------------------------------------------------------------

const gates = {
  freeze(state, r, g, { base }) {
    const ids = Object.keys(state.tickets);
    if (!ids.length) r.check('tickets')('state', 'no tickets: add the frozen ticket set');
    else r.check('tickets');
    const failMoved = r.check('not-dispatched');
    for (const [id, t] of Object.entries(state.tickets)) if (t.stage !== 'candidate') failMoved(id, `is ${t.stage}; the freeze ends before the first dispatch`);
    const baseSha = g.full(base);
    const failBranch = r.check('line-branch');
    const failBase = r.check('line-base');
    const failTree = r.check('line-worktree');
    const failContract = r.check('commands-contract');
    if (baseSha === null) failBase(base, 'is not a commit in this repository');
    for (const branch of Object.keys(state.lines)) {
      const head = g.head(branch);
      if (head === null) {
        failBranch(branch, 'no local branch: create it from the base tip');
        continue;
      }
      if (baseSha !== null && !g.isAncestor(baseSha, head)) failBase(branch, `was not cut from ${base} (${baseSha})`);
      if (!g.worktrees().some((w) => w.branch === branch)) failTree(branch, 'is not checked out in any worktree');
      if (!g.hasFile(head, 'docs/agents/commands.md')) failContract(branch, 'has no docs/agents/commands.md at its tip; generate and commit it before dispatching');
    }
  },

  ci(state, r, g, { targets }, profile) {
    const failCi = r.check('ci-latest');
    const failLocal = r.check('local-record');
    for (const branch of targets.length ? targets : Object.keys(state.lines)) {
      const l = state.lines[branch];
      const head = g.head(branch);
      if (head === null) {
        failCi(branch, 'no local branch');
        continue;
      }
      if (!g.hasOrigin() || l.ciNotCovering !== null) {
        if (!l.local.some((x) => x.sha === head)) failLocal(branch, `no local verification record for its tip ${head} (record it with local)`);
      } else if (profile.ci === 'read') {
        const remote = g.originHead(branch);
        if (remote.error) failCi(branch, `could not read origin (${remote.error})`);
        else if (remote.sha !== null && !(l.ci && shaMatches(head, l.ci.sha))) failCi(branch, `no CI verdict recorded for its tip ${head}${l.ci ? ` (the latest is for ${l.ci.sha})` : ''} (read it with ci.mjs, record it with ci)`);
      }
    }
  },

  dispatch(state, r) {
    const fail = r.check('snapshot');
    for (const [id, t] of Object.entries(state.tickets)) {
      if (SNAPSHOT_STAGES.includes(t.stage) && t.snapshotSha256 === null) fail(id, `${t.stage} without the acceptance snapshot's sha256 (set --snapshot)`);
    }
    assignments(r, state);
    oneIntegrating(r, state, Object.keys(state.lines));
  },

  review(state, r, g, { targets }, profile, queueGuard) {
    const ids = targets.length ? targets : Object.keys(state.tickets).filter((id) => state.tickets[id].reviews.length && !['stuck', 'awaiting-ruling'].includes(state.tickets[id].stage));
    const failInitial = r.check('one-initial');
    const failRecheck = profile.recheck ? r.check('recheck-per-fix') : null;
    const failRounds = r.check('fix-rounds');
    const failQueued = r.check('queued-review');
    for (const id of ids) {
      const t = state.tickets[id];
      const reviews = sinceImplementing(t, t.reviews);
      const initial = reviews.filter((x) => x.mode === 'initial' && x.verdict !== 'stuck').length;
      const entered = t.history.slice(lastEntry(t, 'implementing') + 1);
      const reviewed = reviews.length > 0 || QUEUED_ON.includes(t.stage);
      if (reviewed && initial !== 1) failInitial(id, `${initial} initial reviews since it last entered implementing; exactly one`);
      if (failRecheck) {
        // A round is finished when the ticket came back to in-review and its recheck is due: the ticket has a review
        // since then, or has moved on.
        const back = entered.filter((h) => h.from === 'fixing' && h.to === 'in-review').length;
        const last = t.history.at(-1);
        const due = t.stage === 'in-review' && last?.from === 'fixing' && !(t.reviews.at(-1)?.after > lastEntry(t, 'in-review'));
        const rounds = back - (due ? 1 : 0);
        const rechecks = reviews.filter((x) => x.mode === 'recheck').length;
        if (rechecks !== rounds) failRecheck(id, `${rechecks} rechecks for ${rounds} finished fix round(s); one recheck per round`);
      }
      if (t.fixRounds > profile.fixRounds) failRounds(id, `${t.fixRounds} fix rounds; the profile allows ${profile.fixRounds}`);
      if (QUEUED_ON.includes(t.stage)) {
        const why = queueGuard(id, t);
        if (why) failQueued(id, why);
      }
    }
  },

  merged(state, r, g, { targets }) {
    const fail = r.check('stage');
    for (const id of targets) {
      const t = state.tickets[id];
      if (t.stage !== 'integrating' && t.stage !== 'delivered') fail(id, `is ${t.stage}; a merge is recorded in integrating`);
    }
    merges(r, g, state, targets);
    const failRewritten = r.check('not-rewritten');
    for (const id of targets) {
      const t = state.tickets[id];
      if (t.branch === null) continue;
      const tip = g.head(t.branch);
      if (tip === null) continue;
      const own = t.merges.map((m) => g.commit(m.sha)).filter((c) => c && MERGE_SUBJECT.exec(c.subject)?.[1] === t.branch);
      if (own.length === 1 && own[0].parents[1] !== tip) failRewritten(id, `${t.branch} is at ${tip}, but its merge took ${own[0].parents[1]}: the ticket branch changed after the merge`);
    }
    const lines = [...new Set(targets.map((id) => state.tickets[id].line))];
    tipRecorded(r, g, state, lines);
    oneIntegrating(r, state, lines);
  },

  integrated(state, r, g, { targets }) {
    const fail = r.check('stage');
    for (const id of targets) if (state.tickets[id].stage !== 'delivered') fail(id, `is ${state.tickets[id].stage}, not delivered`);
    merges(r, g, state, targets);
    const lines = [...new Set(targets.map((id) => state.tickets[id].line))];
    tipRecorded(r, g, state, lines);
    pushed(r, g, lines);
    cleaned(r, g, state, targets);
  },

  'wake-end'(state, r, g) {
    const merged = (branch) => ticketsOn(state, branch).some(([, t]) => t.merges.length > 0);
    pushed(r, g, Object.keys(state.lines).filter((branch) => merged(branch) || (g.hasOrigin() && g.originHead(branch).sha)));
    assignments(r, state);
    const fail = r.check('fallback-wake');
    const inFlight = Object.entries(state.tickets).filter(([, t]) => t.assignment && t.assignment.deadline !== null).map(([id]) => id);
    if (inFlight.length && state.usage.sleepTask === null) fail('usage', `agents are in flight (${inFlight.join(', ')}) and no fallback wake-up is recorded (usage --sleep-task)`);
  },

  stopped(state, r) {
    const failStop = r.check('stop-recorded');
    const failAfter = r.check('no-dispatch-after-stop');
    const failLeft = r.check('undispatched-set-aside');
    const failReason = r.check('stop-reason');
    const stop = state.stop;
    if (!stop || !stop.stoppedBy.length) {
      failStop('stop', 'no stop is recorded (progress records it when deadline.mjs progress says stop)');
      return;
    }
    const after = (at) => Date.parse(at) >= Date.parse(stop.at);
    for (const [id, t] of Object.entries(state.tickets)) {
      const moved = t.history.find((h) => (h.to === 'expanding' || h.to === 'implementing') && after(h.at));
      if (moved) failAfter(id, `entered ${moved.to} at ${moved.at}, after the stop at ${stop.at}`);
      if (t.stage === 'candidate' || t.stage === 'expanding') failLeft(id, `is ${t.stage}; after a stop it is set to awaiting-ruling`);
      const set = t.history.findLast((h) => h.to === 'awaiting-ruling');
      if (t.stage === 'awaiting-ruling' && set && after(set.at) && !stop.stoppedBy.some((limit) => (t.reason ?? '').includes(limit))) {
        failReason(id, `its reason does not name the limit that stopped the run (${stop.stoppedBy.join(', ')})`);
      }
    }
  },

  finish(state, r, g) {
    const failEnd = r.check('end-state');
    const failReason = r.check('end-reason');
    const failMerge = r.check('delivered-merge');
    for (const [id, t] of Object.entries(state.tickets)) {
      if (!END.includes(t.stage)) failEnd(id, `is ${t.stage}; the finish reconciles every ticket to delivered, stuck or awaiting-ruling`);
      if ((t.stage === 'stuck' || t.stage === 'awaiting-ruling') && !t.reason) failReason(id, `is ${t.stage} with no reason`);
      if (t.stage === 'delivered' && !t.merges.length) failMerge(id, 'is delivered with no merge SHA');
    }
    const lines = deliveredLines(state);
    const failBase = r.check('base-sync');
    const failVerify = r.check('full-verification');
    for (const branch of lines) {
      const l = state.lines[branch];
      const head = g.head(branch);
      if (l.base === null) failBase(branch, 'no base sync recorded (line --base --synced)');
      else if (l.base.synced && head !== null && !g.isAncestor(l.base.sha, head)) failBase(branch, `synced with ${l.base.sha}, which is not on its tip ${head}`);
      if (head === null) continue;
      const ci = l.ci && shaMatches(head, l.ci.sha) && (l.ci.verdict === 'green' || l.ci.verdict === 'red');
      if (!ci && !l.local.some((x) => x.sha === head)) failVerify(branch, `no final CI verdict or local verification recorded for its tip ${head}`);
    }
    tipRecorded(r, g, state, lines);
    pushed(r, g, lines);
    cleaned(r, g, state, Object.keys(state.tickets));
  },

  ledger(state, r, g, { ledger, ended }, profile, queueGuard, io) {
    let text;
    try {
      text = io.read(resolve(ledger));
    } catch (error) {
      r.check('marker')(ledger, `could not read the ledger (${error.message})`);
      return;
    }
    const rows = text.replace(/^﻿/, '').split(/\r?\n/);
    const want = ended ? MARKER.ended : MARKER.active;
    if (rows[0] !== want) r.check('marker')(ledger, `the first line is ${JSON.stringify(rows[0])}, not ${want}`);
    else r.check('marker');
    const failFields = r.check('fields');
    const heads = rows.map((row, i) => [/^##\s+(\d+)\./.exec(row)?.[1], i]).filter(([n]) => n !== undefined);
    const fields = {};
    const order = heads.map(([n]) => Number(n));
    for (let n = 1; n <= 10; n += 1) {
      const at = heads.filter(([k]) => Number(k) === n);
      if (at.length !== 1) {
        failFields(`field ${n}`, at.length ? `appears ${at.length} times` : 'is missing (## <n>. heading)');
        continue;
      }
      const start = at[0][1];
      const next = rows.findIndex((row, i) => i > start && /^##\s/.test(row));
      fields[n] = rows.slice(start + 1, next === -1 ? rows.length : next);
      if (!fields[n].some((row) => row.trim())) failFields(`field ${n}`, 'is empty; write its content, or none');
    }
    if (order.join() !== [...order].sort((a, b) => a - b).join()) failFields('fields', `are out of order (${order.join(', ')})`);
    const nine = fields[9] ?? [];
    const limits = new Set(nine.map((row) => BUDGET.exec(row)?.[1]).filter(Boolean));
    const failLimits = r.check('budget-limits');
    for (const name of LIMITS) if (!limits.has(name)) failLimits('field 9', `no budget: ${name} <integer> line`);
    const failStage = r.check('stage-limits');
    for (const name of STAGE_LIMITS) if (!limits.has(name)) failStage('field 9', `no budget: ${name} <integer> line`);
    const failSession = r.check('session');
    const session = io.env.CLAUDE_CODE_SESSION_ID;
    if (session) {
      const line = rows.map((row) => SESSION.exec(row)?.[1]).find(Boolean);
      if (line !== session) failSession('field 9', `${line ? `session: ${line}` : 'no session: line'}, but this session is ${session}`);
    }
    const failRules = r.check('rule-files');
    const rules = (fields[10] ?? []).map((row) => RULE.exec(row)?.[1]).filter(Boolean);
    if (!rules.length) failRules('field 10', 'no rule: <absolute path> line');
    for (const path of rules) {
      if (!posix.isAbsolute(path) && !win32.isAbsolute(path)) failRules(path, 'is not an absolute path');
      else if (!io.isFile(path)) failRules(path, 'is not a file');
    }
  },
};

/**
 * Run gate `name` on a loaded state. `opts`: { targets, base, ledger, ended }. `ctx`: { profile (effective),
 * queueGuard(id, ticket) → why not | null, git(args) → stdout (throws with `status`), read(path), env }.
 * Returns { gate, ok, checked, failures: [{ assertion, subject, message }] }.
 */
export function runGate(name, state, opts, ctx) {
  const r = recorder();
  const io = { read: ctx.read, env: ctx.env ?? {}, isFile: ctx.isFile ?? ((p) => existsSync(p) && statSync(p).isFile()) };
  gates[name](state, r, gitView(ctx.git), { targets: [], ...opts }, ctx.profile, ctx.queueGuard, io);
  return { gate: name, ok: r.failures.length === 0, checked: r.checked, failures: r.failures };
}
