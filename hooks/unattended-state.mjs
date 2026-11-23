// The automatic source of unattended mode, and the list of what was blocked while unattended (either source).
// One global file, apart from the user's switch file, so every session reads the same state on its next call:
//   ~/.claude/sorry-matt-guard/unattended.json
//   { "entered": { "at": <ms>, "reason": "<why>", "by": "agent", "session": "<session_id or null>" },
//     "pending": [ { "session": "<session_id>", "prompt_id": "<prompt_id>" } ],
//     "pendingOff": [ { "session": "<session_id>", "prompt_id": "<prompt_id>" } ],
//     "blocked": [ { "session": "<session_id>", "at": <ms>, "subject": "<command, or the tool name>", "reason": "<why it needs the user>" } ] }
// `entered` is there only while the automatic source holds; `blocked` is kept under the user's switch too.
// `pending` holds the turns whose transcript entry was not there yet when UserPromptSubmit ran (unattended-return.mjs);
// it lives only while `entered` does, and the session's Stop hook decides each one.
// `pendingOff` holds the `/sorry-matt:unattended off` turns whose transcript entry was not there yet
// (unattended-switch.mjs); it does not depend on `entered`, since `off` also ends the user's switch file, and the
// session's Stop hook decides each one.
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

// An entry is usable only with a time a Date can hold (±8.64e15 ms) and a string reason; anything else is damage.
const validEntry = (e) => !!e && typeof e === 'object' && !Array.isArray(e) &&
  Number.isFinite(e.at) && !Number.isNaN(new Date(e.at).getTime()) && typeof e.reason === 'string';
const validPending = (p) => !!p && typeof p === 'object' && typeof p.session === 'string' && typeof p.prompt_id === 'string';
const empty = () => ({ entered: null, pending: [], pendingOff: [], blocked: [] });
const samePending = (a, b) => a.session === b.session && a.prompt_id === b.prompt_id;
// What a change returns to leave the file exactly as it is.
const NO_WRITE = Symbol('no write');

/** What the file holds. Throws when it is there but cannot be read; missing or damaged content is the empty state. */
function loadStrict(path, read) {
  let text;
  try {
    text = retrying(() => read(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return empty();
    throw error;
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return empty();
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return empty();
  const entered = validEntry(data.entered) ? data.entered : null;
  return {
    entered,
    pending: entered && Array.isArray(data.pending) ? data.pending.filter(validPending) : [],
    pendingOff: Array.isArray(data.pendingOff) ? data.pendingOff.filter(validPending) : [],
    blocked: Array.isArray(data.blocked) ? data.blocked.filter(validEntry) : [],
  };
}

function load(path, read) {
  try {
    return loadStrict(path, read);
  } catch {
    return empty();
  }
}

const serialize = (state) => JSON.stringify({
  ...(state.entered ? { entered: state.entered } : {}),
  ...(state.entered && state.pending.length ? { pending: state.pending } : {}),
  ...(state.pendingOff.length ? { pendingOff: state.pendingOff } : {}),
  blocked: state.blocked,
}, null, 2) + '\n';

/**
 * @param {string} home the user's home directory
 * @param {{read?: typeof readFileSync}} io how the state file is read
 */
export function autoState(home = homedir(), { read = readFileSync } = {}) {
  const path = autoStateFile(home);
  // A change whose function returns NO_WRITE leaves the file alone and returns null.
  const change = (fn) => {
    mkdirSync(dirname(path), { recursive: true });
    return withLock(path, () => {
      const state = loadStrict(path, read);
      const result = fn(state);
      if (result === NO_WRITE) return null;
      writeAtomic(path, serialize(state));
      return result;
    });
  };
  // A turn to decide at the session's Stop, onto `key`; with `needsEntered`, only while the automatic state holds.
  const deferTo = (key, needsEntered) => ({ session, prompt_id }) =>
    change((state) => {
      if (needsEntered && !state.entered) return NO_WRITE;
      const item = { session: String(session), prompt_id: String(prompt_id) };
      if (!state[key].some((p) => samePending(p, item))) state[key].push(item);
      return true;
    }) ?? false;
  // Takes one pending turn off `key`; true when it was there.
  const settleFrom = (key) => ({ session, prompt_id }) =>
    change((state) => {
      const kept = state[key].filter((p) => !samePending(p, { session, prompt_id }));
      if (kept.length === state[key].length) return NO_WRITE;
      state[key] = kept;
      return true;
    }) ?? false;
  return {
    path,
    /** @returns {{entered: object | null, pending: object[], pendingOff: object[], blocked: object[]}} */
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
    /**
     * Ends the automatic state: `entered`, every pending turn and the blocked list go in one locked write, and are
     * returned. null, with the file untouched, when the automatic state does not hold, so of two sessions clearing
     * at once only one gets the list. The user's switch file and SORRY_MATT_UNATTENDED are not this module's, and
     * neither are the pending `off` turns.
     */
    clear: () =>
      change((state) => {
        if (!state.entered) return NO_WRITE;
        const cleared = { entered: state.entered, pending: state.pending, blocked: state.blocked };
        Object.assign(state, { entered: null, pending: [], blocked: [] });
        return cleared;
      }),
    /**
     * `/sorry-matt:unattended off`: `entered`, both pending lists and the blocked list go in one locked write,
     * whether or not the automatic state holds (the list is kept under the user's switch too), and are returned.
     * null, with the file untouched, when there is nothing to clear, so of two clearing at once only one gets the list.
     */
    clearAll: () =>
      change((state) => {
        if (!state.entered && !state.pending.length && !state.pendingOff.length && !state.blocked.length) return NO_WRITE;
        const cleared = { ...state };
        Object.assign(state, empty());
        return cleared;
      }),
    /** A turn to decide at the session's Stop. Only while the automatic state holds; true when it is on the list. */
    defer: deferTo('pending', true),
    /** A `/sorry-matt:unattended off` turn to decide at the session's Stop; true when it is on the list. */
    deferOff: deferTo('pendingOff', false),
    /** `/sorry-matt:unattended on`: every pending `off` turn, of every session, is dropped; returns how many. */
    dropOffs: () =>
      change((state) => {
        if (!state.pendingOff.length) return NO_WRITE;
        const dropped = state.pendingOff.length;
        state.pendingOff = [];
        return dropped;
      }) ?? 0,
    /** Takes one pending `off` turn off the list; true when it was there. */
    settleOff: settleFrom('pendingOff'),
    /** Takes one pending turn off the list; true when it was there. */
    settle: settleFrom('pending'),
  };
}
