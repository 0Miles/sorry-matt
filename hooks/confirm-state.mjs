// State of the two-step confirmation (README "Guard hook"). One file per session:
//   <os.tmpdir()>/sorry-matt-guard/<session_id>.json
//   { "<token>": { "tool": "<tool_name>", "summary": "<what the first prompt said>",
//                  "created": <ms>, "approved": <bool>, "approvedAt": <ms>, "used": <bool> } }
// A token is the first 16 hex digits of sha256(session_id, tool_name, normalized tool_input), so the same
// call in the same session always maps to the same entry. The guard creates an entry at the first step;
// hooks/confirm.mjs marks it approved once the user has allowed it; the guard spends it at the second step.
// Writes take the lock and rename of budget.mjs, so concurrent hooks neither lose nor half-write an entry.
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { retrying, withLock, writeAtomic } from './budget.mjs';

export const TTL = 10 * 60 * 1000;
const PRUNE = 60 * 60 * 1000;
export const TOKEN = /^[0-9a-f]{16}$/;

export const stateDir = () => join(tmpdir(), 'sorry-matt-guard');
const fileFor = (dir, sessionId) => join(dir, `${String(sessionId || 'no-session').replace(/[^\w.-]/g, '_')}.json`);

// Keys sorted at every level, so the same input always serializes the same way.
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
};

/** A shell call is its command alone (a new description or timeout is the same call); anything else is its whole input. */
export function normalizeInput(toolName, input = {}) {
  if (toolName === 'Bash' || toolName === 'PowerShell') return String(input.command ?? '').trim();
  return stable(input);
}

export function tokenFor(sessionId, toolName, input) {
  return createHash('sha256')
    .update(`${sessionId ?? ''}\0${toolName ?? ''}\0${normalizeInput(toolName, input)}`)
    .digest('hex')
    .slice(0, 16);
}

/** An entry is live while unused and younger than TTL, counted from approval once approved. */
export const isLive = (entry, now) => !!entry && !entry.used && now - (entry.approved ? entry.approvedAt : entry.created) <= TTL;

function readEntries(path) {
  let text;
  try {
    text = retrying(() => readFileSync(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${path} is not a sorry-matt guard state file`);
  return data;
}

/**
 * The file-backed store. `read(session)` returns the entries; `update(session, fn)` runs fn on them under the
 * lock and writes what it returns. Both throw on any failure, and callers treat a throw as "no approval".
 */
export function fileStore(dir = stateDir()) {
  return {
    read: (sessionId) => readEntries(fileFor(dir, sessionId)),
    update(sessionId, fn, now = Date.now()) {
      mkdirSync(dir, { recursive: true });
      const path = fileFor(dir, sessionId);
      return withLock(path, () => {
        const entries = readEntries(path);
        for (const [k, e] of Object.entries(entries)) if (!e || now - (e.approvedAt || e.created || 0) > PRUNE) delete entries[k];
        const result = fn(entries);
        writeAtomic(path, JSON.stringify(entries, null, 2) + '\n');
        return result;
      });
    },
    /** The session whose file holds this token, for confirm.mjs, which is given the token alone. */
    sessionOf(token) {
      let names = [];
      try {
        names = readdirSync(dir).filter((n) => n.endsWith('.json'));
      } catch {
        return null;
      }
      for (const name of names) {
        try {
          if (token in readEntries(join(dir, name))) return name.slice(0, -'.json'.length);
        } catch {
          // a broken file holds no token we can use
        }
      }
      return null;
    },
  };
}
