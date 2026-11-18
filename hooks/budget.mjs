// The run's spawn budget, enforced by hooks. Ledgers and their fields are defined in
// skills/have-it-all-done/ASKING.md section 7; this module reads two things from them:
//   - in progress: the first line is `<!-- sorry-matt:run active -->` (runs.mjs)
//   - field 9, limits: one line per limit, `budget: <name> <integer>` (a list bullet and backticks allowed);
//     the hook enforces only `budget: spawns <N>`, the others are for the host
// The spawn count lives next to the ledger in `<run>.counters.json`, written only by the hook:
//   { "spawns": <int>, "agents": [<agent_id>, ...], "updated": "<ISO time>" }
// SubagentStart adds one per new agent_id (it also fires when a subagent is resumed, so a seen id is not
// counted again); PreToolUse on Agent denies the spawn once the count has reached the limit.
// Writes take an exclusive lock file (`<counters>.lock`, created with O_EXCL) and replace the counters
// through a temporary file and a rename, so parallel SubagentStart hooks neither lose a count nor leave
// a half-written file. No run in progress, or a run without a spawn limit, means the hook stays out of
// the way.
import { spawnSync } from 'node:child_process';
import { closeSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { activeLedgerTexts, commonDir } from './runs.mjs';

const BUDGET = /^\s*(?:[-*+]\s+)?`?budget:\s*`?([a-z][a-z-]*)\s+(\d+)`?\s*$/;

/** Every `budget: <name> <integer>` line in a ledger; the first line for a name wins. */
export function parseBudget(text) {
  const limits = {};
  for (const line of text.split(/\r?\n/)) {
    const m = BUDGET.exec(line);
    if (m && !(m[1] in limits)) limits[m[1]] = Number(m[2]);
  }
  return limits;
}

export const countersPath = (ledger) => ledger.replace(/\.md$/i, '.counters.json');

/** The counters next to a ledger; a missing file is zero. A corrupt one throws. */
export function readCounters(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { spawns: 0, agents: [] };
    throw error;
  }
  const data = JSON.parse(text);
  if (!Number.isInteger(data.spawns) || data.spawns < 0 || !Array.isArray(data.agents)) {
    throw new Error(`${path} is not a sorry-matt counters file`);
  }
  return data;
}

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Run fn while holding `<path>.lock`. A lock older than `stale` ms is left over from a killed hook
 * (a hook holds it for milliseconds) and is removed. Throws when the lock cannot be taken within `wait` ms.
 */
export function withLock(path, fn, { wait = 5000, stale = 2000, now = Date.now } = {}) {
  const lock = `${path}.lock`;
  const deadline = now() + wait;
  for (;;) {
    let fd;
    try {
      fd = openSync(lock, 'wx');
    } catch (error) {
      if (error.code !== 'EEXIST' && error.code !== 'EPERM') throw error;
      try {
        if (now() - statSync(lock).mtimeMs > stale) unlinkSync(lock);
      } catch {
        // gone already, or another hook is removing it
      }
      if (now() > deadline) throw new Error(`could not lock ${path}`);
      pause(10);
      continue;
    }
    try {
      return fn();
    } finally {
      closeSync(fd);
      try {
        unlinkSync(lock);
      } catch {
        // removed as stale by another hook; nothing left to release
      }
    }
  }
}

/** Replace a file through a temporary file and a rename; retry the rename while Windows has it open. */
export function writeAtomic(path, text) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, path);
      return;
    } catch (error) {
      if (attempt >= 20 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) {
        try {
          unlinkSync(tmp);
        } catch {
          // nothing to clean up
        }
        throw error;
      }
      pause(25);
    }
  }
}

/** Count one subagent against a ledger. Returns the new count; a seen agent_id is not counted again. */
export function recordSpawn(ledger, agentId, { now = () => new Date() } = {}) {
  const path = countersPath(ledger);
  return withLock(path, () => {
    const counters = readCounters(path);
    if (agentId && counters.agents.includes(agentId)) return counters.spawns;
    const next = {
      spawns: counters.spawns + 1,
      agents: agentId ? [...counters.agents, agentId] : counters.agents,
      updated: now().toISOString(),
    };
    writeAtomic(path, JSON.stringify(next, null, 2) + '\n');
    return next.spawns;
  });
}

const off = (env) => String(env.SORRY_MATT_BUDGET || '').toLowerCase() === 'off';

const ledgersFor = (event, git) => {
  const cwd = typeof event.cwd === 'string' && event.cwd ? event.cwd : process.cwd();
  const common = commonDir(cwd, git);
  return common ? activeLedgerTexts(common) : [];
};

export function denyReason(ledger, spawns, limit) {
  return `sorry-matt budget blocked this spawn: the run in ${ledger} has spawned ${spawns} subagents and its limit is ${limit} (\`budget: spawns ${limit}\`). Do not spawn another subagent or try another route. Stop opening rounds and hand off as get-to-work's budget rule says, writing which limit stopped the run; only the user raises a limit, by editing that ledger line. If that run is no longer running, its first line should be \`<!-- sorry-matt:run ended -->\`. (The user can turn this check off by setting SORRY_MATT_BUDGET=off under "env" in their Claude Code settings.)`;
}

const deny = (text) => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: text },
});

/**
 * PreToolUse on Agent: deny once an active run's spawn count has reached its `budget: spawns` limit.
 * @param {object} event the parsed hook event
 */
export function decideSpawn(event, { env = process.env, git = spawnSync } = {}) {
  if (off(env)) return null;
  for (const { ledger, text } of ledgersFor(event, git)) {
    const limit = parseBudget(text).spawns;
    if (limit === undefined) continue;
    let spawns;
    try {
      spawns = readCounters(countersPath(ledger)).spawns;
    } catch (error) {
      return deny(`sorry-matt budget could not read the spawn count of the run in ${ledger} (${error.message}), so this spawn is blocked. Report it to the user as a budget hook error; do not edit or delete the counters file yourself.`);
    }
    if (spawns >= limit) return deny(denyReason(ledger, spawns, limit));
  }
  return null;
}

/**
 * SubagentStart: count the subagent against every run in progress. Never blocks (it cannot);
 * returns the counts written, for tests.
 */
export function countSpawn(event, { env = process.env, git = spawnSync } = {}) {
  if (off(env)) return [];
  const agentId = typeof event.agent_id === 'string' && event.agent_id ? event.agent_id : null;
  const counted = [];
  for (const { ledger } of ledgersFor(event, git)) {
    try {
      counted.push({ ledger, spawns: recordSpawn(ledger, agentId) });
    } catch (error) {
      counted.push({ ledger, error: error.message });
    }
  }
  return counted;
}

/**
 * The hook's answer to one raw event: a PreToolUse deny decision, or null.
 * An event it cannot read identifies no run, so it is let through.
 */
export function handle(raw, deps = {}) {
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return null;
  }
  if (event.hook_event_name === 'SubagentStart') {
    countSpawn(event, deps);
    return null;
  }
  if (event.hook_event_name === 'PreToolUse' && event.tool_name === 'Agent') {
    try {
      return decideSpawn(event, deps);
    } catch (error) {
      return deny(`sorry-matt budget failed on this spawn (${error.message}), so it is blocked. Report it to the user as a budget hook error.`);
    }
  }
  return null;
}
