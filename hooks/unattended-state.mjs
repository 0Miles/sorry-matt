// The automatic source of unattended mode, and the list of what was blocked while unattended (either source).
// One global file, apart from the user's switch file, so every session reads the same state on its next call:
//   ~/.claude/sorry-matt-guard/unattended.json
//   { "entered": { "at": <ms>, "reason": "<why>", "by": "agent", "session": "<session_id or null>" },
//     "blocked": [ { "session": "<session_id>", "at": <ms>, "subject": "<command, or the tool name>", "reason": "<why it needs the user>" } ] }
// `entered` is there only while the automatic source holds; `blocked` is kept under the user's switch too.
// Every hook goes through this module. Reading never throws: a missing, unreadable or damaged file is "no automatic
// state", so the guard asks as usual. Writing throws, and each caller decides what a failed write means. A write
// starts from what is on disk: only a file that is not there, or one whose content cannot be used, counts as empty;
// when the file cannot be read at all nothing is written, so a read that fails for a moment never wipes the state.
// Writes take the lock and rename of budget.mjs, so concurrent hooks neither lose nor half-write an entry.
import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { retrying, withLock, writeAtomic } from './budget.mjs';

export const autoStateFile = (home = homedir()) => join(home, '.claude', 'sorry-matt-guard', 'unattended.json');

const validEntry = (e) => !!e && typeof e === 'object' && !Array.isArray(e) && Number.isFinite(e.at);

/** What the file holds. Throws when it is there but cannot be read; missing or damaged content is the empty state. */
function loadStrict(path, read) {
  let text;
  try {
    text = retrying(() => read(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { entered: null, blocked: [] };
    throw error;
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { entered: null, blocked: [] };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { entered: null, blocked: [] };
  return {
    entered: validEntry(data.entered) ? data.entered : null,
    blocked: Array.isArray(data.blocked) ? data.blocked.filter(validEntry) : [],
  };
}

function load(path, read) {
  try {
    return loadStrict(path, read);
  } catch {
    return { entered: null, blocked: [] };
  }
}

/**
 * @param {string} home the user's home directory
 * @param {{read?: typeof readFileSync}} io how the state file is read
 */
export function autoState(home = homedir(), { read = readFileSync } = {}) {
  const path = autoStateFile(home);
  const change = (fn) => {
    mkdirSync(dirname(path), { recursive: true });
    return withLock(path, () => {
      const state = loadStrict(path, read);
      const result = fn(state);
      const out = { ...(state.entered ? { entered: state.entered } : {}), blocked: state.blocked };
      writeAtomic(path, JSON.stringify(out, null, 2) + '\n');
      return result;
    });
  };
  return {
    path,
    /** @returns {{entered: object | null, blocked: object[]}} */
    read: () => load(path, read),
    active: () => load(path, read).entered !== null,
    /** Idempotent: an earlier entry keeps its time and reason, and the blocked list is left alone. Returns the entry in force. */
    enter: ({ at, reason, by, session = null }) =>
      change((state) => (state.entered ??= { at, reason: String(reason), by, session })),
    /** One more blocked action. */
    record: ({ session, at, subject, reason }) =>
      change((state) => {
        state.blocked.push({ session: session ?? null, at, subject: String(subject), reason: String(reason) });
      }),
  };
}
