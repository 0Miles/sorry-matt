// The run's spawn budget, enforced by hooks. Ledgers and their fields are defined in
// skills/have-it-all-done/ASKING.md section 7; this module reads two things from them:
//   - in progress: the first line is `<!-- sorry-matt:run active -->` (runs.mjs)
//   - field 9, limits: one line per limit, `budget: <name> <integer>` (a list bullet allowed, backticks allowed
//     around the value, and the whole line may be wrapped in backticks; the shape is ledgerLine in runs.mjs);
//     the hook enforces only `budget: spawns <N>`; the others (`rounds`, `hours`, `no-progress`, and the stage
//     time limits `timeout-<stage>` in minutes) are for the host
// The spawn count lives next to the ledger in `<run>.counters.json`, written only by the hook:
//   {
//     "spawns":  <int>,
//     "agents":  [<agent_id>, ...],
//     "log":     [{ "id": <agent_id> | null, "type": <agent type> | null, "description": <string> | null,
//                   "at": "<ISO time>" }, ...],          // one entry per counted spawn, in the order counted
//     "pending": [{ "type": <agent type>, "description": <string> | null, "at": "<ISO time>" }, ...],
//     "updated": "<ISO time>"
//   }
// `log` and `pending` were added later: a file without them (written by an older hook) reads the same, with
// both taken as empty, so its `spawns` may be larger than its `log`. Only `spawns` and `agents` are validated
// or used for the limit. The log is summed up by type and by ticket with
// skills/get-to-work/scripts/spawns.mjs.
// SubagentStart adds one per new agent_id (it also fires when a subagent is resumed, so a seen id is not
// counted again); PreToolUse on Agent denies the spawn once the count has reached the limit.
// The type in the log is SubagentStart's `agent_type`. That event carries no description and shares no id with
// the Agent call that caused it, so a PreToolUse on Agent that is let through leaves its `subagent_type`
// (`general-purpose` when absent) and `description` in `pending`, and the next new SubagentStart of the same
// type takes the oldest one. A pending call older than ten minutes never became a subagent (another hook or a
// permission prompt stopped it) and is dropped. Recording a pending call never changes the allow or deny
// decision: a failure there is only a warning.
// That deny really stops the spawn: checked live on Claude Code 2.1.325 (2026-11-19) with
// scripts/spawn-deny.live.mjs — at the limit, a foreground and a background Agent call both came back as this
// deny and no SubagentStart fired. Re-run it by hand after a Claude Code upgrade that touches hooks or Agent.
// Writes take an exclusive lock file (`<counters>.lock`, created with O_EXCL) and replace the counters
// through a temporary file and a rename, so parallel SubagentStart hooks neither lose a count nor leave
// a half-written file. Reads take no lock: a rename never exposes a half-written file.
// Failure modes: no run in progress, or a run without a spawn limit, means the hook stays out of the way.
// A counters file that is not JSON or not in this format fails closed (the spawn is denied); a read that
// keeps failing on a file lock (Windows antivirus and the like) after the retries fails open, since the
// count itself is still kept by SubagentStart and the next call reads it again.
import { spawnSync } from 'node:child_process';
import { closeSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { ledgerLine, ledgersForEvent } from './runs.mjs';

const BUDGET = ledgerLine('budget', /([a-z][a-z-]*)\s+(\d+)/);

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

const PENDING_TTL = 10 * 60 * 1000;
const list = (value) => (Array.isArray(value) ? value : []);
const text = (value) => (typeof value === 'string' && value ? value : null);

/** The pending Agent calls still young enough to become a subagent. */
const waiting = (counters, at) =>
  list(counters.pending).filter((call) => call && at.getTime() - Date.parse(call.at) <= PENDING_TTL);

const save = (path, counters, at) =>
  writeAtomic(path, JSON.stringify({ ...counters, updated: at.toISOString() }, null, 2) + '\n');

/**
 * Count one subagent against a ledger and log it with its type and the description of the oldest pending
 * Agent call of that type. Returns the new count; a seen agent_id is not counted again and changes nothing.
 */
export function recordSpawn(ledger, agentId, { now = () => new Date(), type = null, lock } = {}) {
  const path = countersPath(ledger);
  return withLock(path, () => {
    const counters = readCounters(path);
    if (agentId && counters.agents.includes(agentId)) return counters.spawns;
    const at = now();
    const pending = waiting(counters, at);
    const match = pending.findIndex((call) => call.type === type);
    const description = match < 0 ? null : text(pending.splice(match, 1)[0].description);
    const next = {
      spawns: counters.spawns + 1,
      agents: agentId ? [...counters.agents, agentId] : counters.agents,
      log: [...list(counters.log), { id: agentId, type, description, at: at.toISOString() }],
      pending,
    };
    save(path, next, at);
    return next.spawns;
  }, lock);
}

/** Leave an Agent call that was let through waiting for its SubagentStart. Changes no count. */
export function recordCall(ledger, { type, description }, { now = () => new Date(), lock } = {}) {
  const path = countersPath(ledger);
  withLock(path, () => {
    const counters = readCounters(path);
    const at = now();
    const next = {
      spawns: counters.spawns,
      agents: counters.agents,
      log: list(counters.log),
      pending: [...waiting(counters, at), { type, description, at: at.toISOString() }],
    };
    save(path, next, at);
  }, lock);
}

const off = (env) => String(env.SORRY_MATT_BUDGET || '').toLowerCase() === 'off';

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
export function decideSpawn(event, { env = process.env, git = spawnSync, read, ledgers } = {}) {
  const warnings = [];
  if (off(env)) return { decision: null, warnings };
  for (const { ledger, text: ledgerText } of ledgers ?? ledgersForEvent(event, git)) {
    const limit = parseBudget(ledgerText).spawns;
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
export function countSpawn(event, { env = process.env, git = spawnSync, now, lock } = {}) {
  if (off(env)) return [];
  const agentId = text(event.agent_id);
  const counted = [];
  for (const { ledger } of ledgersForEvent(event, git)) {
    try {
      counted.push({ ledger, spawns: recordSpawn(ledger, agentId, { now, type: text(event.agent_type), lock }) });
    } catch (error) {
      counted.push({ ledger, error: error.message });
    }
  }
  return counted;
}

/**
 * PreToolUse on Agent, once let through: leave the call pending in every run in progress, so the SubagentStart
 * it causes can be logged with its description. Never throws.
 * @returns {string[]} one warning per run the call could not be recorded for
 */
export function noteCall(event, ledgers, { now, lock } = {}) {
  const input = event.tool_input || {};
  const call = { type: text(input.subagent_type) || 'general-purpose', description: text(input.description) };
  const warnings = [];
  for (const { ledger } of ledgers) {
    try {
      recordCall(ledger, call, { now, lock });
    } catch (error) {
      warnings.push(`sorry-matt budget could not record this Agent call for ${ledger}: ${error.message}; its spawn will be logged without a description`);
    }
  }
  return warnings;
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
    let judged;
    try {
      const { env = process.env, git = spawnSync } = deps;
      if (off(env)) return { decision: null, warnings: [] };
      const ledgers = ledgersForEvent(event, git);
      judged = { ledgers, ...decideSpawn(event, { ...deps, ledgers }) };
    } catch (error) {
      return {
        decision: deny(`sorry-matt budget failed on this spawn (${error.message}), so it is blocked. Report it to the user as a budget hook error.`),
        warnings: [],
      };
    }
    const { ledgers, decision, warnings } = judged;
    // Recorded only after the decision stands, and outside its try: a recording failure cannot turn into a deny.
    return { decision, warnings: decision ? warnings : [...warnings, ...noteCall(event, ledgers, deps)] };
  }
  return { decision: null, warnings: [] };
}
