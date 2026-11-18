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
// a half-written file. Reads take no lock: a rename never exposes a half-written file.
// Failure modes: no run in progress, or a run without a spawn limit, means the hook stays out of the way.
// A counters file that is not JSON or not in this format fails closed (the spawn is denied); a read that
// keeps failing on a file lock (Windows antivirus and the like) after the retries fails open, since the
// count itself is still kept by SubagentStart and the next call reads it again.
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

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Errors Windows raises while another process (antivirus, indexer, a rename in flight) holds the file.
const TRANSIENT = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** Run fn, retrying while it fails with a transient file-lock error. */
export function retrying(fn, { attempts = 20, delay = 25 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return fn();
    } catch (error) {
      if (attempt >= attempts || !TRANSIENT.has(error.code)) throw error;
      pause(delay);
    }
  }
}

/** A counters file that exists but is not JSON or not in the counters format. */
export class CorruptCounters extends Error {}

/**
 * The counters next to a ledger; a missing file is zero. A corrupt one throws CorruptCounters;
 * a read still failing after the transient-error retries throws the original error.
 */
export function readCounters(path, { read = readFileSync, retry = {} } = {}) {
  let text;
  try {
    text = retrying(() => read(path, 'utf8'), retry);
  } catch (error) {
    if (error.code === 'ENOENT') return { spawns: 0, agents: [] };
    throw error;
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new CorruptCounters(`${path} is not JSON (${error.message})`);
  }
  if (!data || !Number.isInteger(data.spawns) || data.spawns < 0 || !Array.isArray(data.agents)) {
    throw new CorruptCounters(`${path} is not a sorry-matt counters file`);
  }
  return data;
}

/**
 * Run fn while holding `<path>.lock`. A lock older than `stale` ms is left over from a killed hook
 * (a hook holds it for milliseconds) and is removed. Throws when the lock cannot be taken within `wait` ms.
 *
 * Removing a stale lock re-checks its inode and mtime right before the unlink, so a lock another hook has
 * just replaced is left alone. A window remains between that re-check and the unlink; losing it means two
 * hooks write at once and one count is lost — an undercount by one, accepted because it needs a hook killed
 * while holding the lock and a second one racing to clear it within the same microseconds.
 */
export function withLock(path, fn, { wait = 5000, stale = 2000, now = Date.now } = {}) {
  const lock = `${path}.lock`;
  const deadline = now() + wait;
  for (;;) {
    let fd;
    try {
      fd = openSync(lock, 'wx');
    } catch (error) {
      if (error.code !== 'EEXIST' && !TRANSIENT.has(error.code)) throw error;
      clearStale(lock, stale, now);
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

function clearStale(lock, stale, now) {
  try {
    const seen = statSync(lock);
    if (now() - seen.mtimeMs <= stale) return;
    const again = statSync(lock);
    if (again.ino !== seen.ino || again.mtimeMs !== seen.mtimeMs) return;
    unlinkSync(lock);
  } catch {
    // gone already, or another hook is removing it
  }
}

/** Replace a file through a temporary file and a rename; retry the rename while Windows has it open. */
export function writeAtomic(path, text) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  try {
    retrying(() => renameSync(tmp, path));
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // nothing to clean up
    }
    throw error;
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
  return `sorry-matt budget blocked this spawn: the run in ${ledger} has spawned ${spawns} subagents and its limit is ${limit} (\`budget: spawns ${limit}\`). Do not spawn another subagent or try another route. Dispatch no more tickets and hand off as get-to-work's budget rule says, writing which limit stopped the run; only the user raises a limit, by editing that ledger line. If that run is no longer running, its first line should be \`<!-- sorry-matt:run ended -->\`. (The user can turn this check off by setting SORRY_MATT_BUDGET=off under "env" in their Claude Code settings.)`;
}

const deny = (text) => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: text },
});

/**
 * PreToolUse on Agent: deny once an active run's spawn count has reached its `budget: spawns` limit.
 * @param {object} event the parsed hook event
 * @returns {{ decision: object | null, warnings: string[] }}
 */
export function decideSpawn(event, { env = process.env, git = spawnSync, read } = {}) {
  const warnings = [];
  if (off(env)) return { decision: null, warnings };
  for (const { ledger, text } of ledgersFor(event, git)) {
    const limit = parseBudget(text).spawns;
    if (limit === undefined) continue;
    let spawns;
    try {
      spawns = readCounters(countersPath(ledger), { read }).spawns;
    } catch (error) {
      if (error instanceof CorruptCounters) {
        return {
          decision: deny(`sorry-matt budget could not read the spawn count of the run in ${ledger} (${error.message}), so this spawn is blocked. Report it to the user as a budget hook error; do not edit or delete the counters file yourself.`),
          warnings,
        };
      }
      warnings.push(`sorry-matt budget could not read the spawn count for ${ledger} (${error.message}); this spawn was let through`);
      continue;
    }
    if (spawns >= limit) return { decision: deny(denyReason(ledger, spawns, limit)), warnings };
  }
  return { decision: null, warnings };
}

/**
 * SubagentStart: count the subagent against every run in progress. Never blocks (it cannot).
 * @returns {{ ledger: string, spawns?: number, error?: string }[]}
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
 * The hook's whole answer to one raw event: `decision` is what goes to stdout (a PreToolUse deny, or null
 * for nothing), `warnings` what goes to stderr. An event it cannot read identifies no run, so it is let through.
 * @returns {{ decision: object | null, warnings: string[] }}
 */
export function handle(raw, deps = {}) {
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return { decision: null, warnings: [] };
  }
  if (event.hook_event_name === 'SubagentStart') {
    const warnings = countSpawn(event, deps)
      .filter((c) => c.error)
      .map(({ ledger, error }) => `sorry-matt budget could not count this subagent for ${ledger}: ${error}`);
    return { decision: null, warnings };
  }
  if (event.hook_event_name === 'PreToolUse' && event.tool_name === 'Agent') {
    try {
      return decideSpawn(event, deps);
    } catch (error) {
      return {
        decision: deny(`sorry-matt budget failed on this spawn (${error.message}), so it is blocked. Report it to the user as a budget hook error.`),
        warnings: [],
      };
    }
  }
  return { decision: null, warnings: [] };
}
