// PermissionRequest: a permission dialog nobody answers takes itself back, and the guard enters unattended mode.
// Claude Code runs this hook alongside the dialog and takes whichever decides first (spec #89 Further Notes 1–2), so
// the hook waits SORRY_MATT_UNATTENDED_AFTER minutes (default 10, at most 60; 0 or off turns this off) and then, if
// the call is still unanswered, writes the automatic state (unattended-state.mjs, `by: 'timeout'`), adds the call to
// the blocked list and answers deny with the guard's unattended message. Every dialog counts: one the guard's
// PreToolUse asked for and one of Claude Code's own permission prompts alike. When the guard is already unattended,
// from either source, the dialog is denied at once and listed, so no prompt shows; that holds with the wait turned
// off too.
// The event has no tool_use_id, so "still unanswered" is read from the event's transcript: the last tool_use with
// this call's tool name and input, and whether a tool_result answers it (answeredIn). It is asked about every 5 s
// and once more at the deadline; an answer ends the wait with no output and nothing written. A transcript that cannot
// be read, or no such tool_use, is unanswered: wrong that way, the guard is only stricter until the user's next
// message ends the automatic state (unattended-return.mjs). Known gap: a call allowed shortly before the deadline
// that is still running then has no tool_result yet (scripts/unattended.live.mjs).
// Dialogs waiting at the same time each run out on their own; entering is idempotent, so the first keeps its time
// and reason. Anything that goes wrong is no output: the dialog stays up for the user, as without this hook.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { subjectOf, unattended, unattendedMessage } from './decision.mjs';
import { autoState } from './unattended-state.mjs';

export const DEFAULT_MINUTES = 10;
export const MAX_MINUTES = 60;
export const POLL_MS = 5000;
const MINUTE_MS = 60_000;

/**
 * The wait in minutes from SORRY_MATT_UNATTENDED_AFTER, or null when automatic entry is off (`0` or `off`).
 * Unset, or anything but a plain non-negative decimal, is the default; more than the cap is the cap.
 */
export function waitMinutes(value) {
  const text = String(value ?? '').trim();
  if (/^off$/i.test(text)) return null;
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(text)) return DEFAULT_MINUTES;
  const minutes = Number(text);
  if (minutes === 0) return null;
  return Math.min(minutes, MAX_MINUTES);
}

// The same input whatever the key order.
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
};

/** Whether transcript JSONL has a tool_result for the last tool_use of this tool with this input. */
export function answeredIn(text, toolName, toolInput) {
  const wanted = canonical(toolInput ?? {});
  let id = null;
  const results = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.includes('"tool_use') && !line.includes('"tool_result')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (entry.type === 'assistant' && block?.type === 'tool_use' && typeof block.id === 'string' &&
        block.name === toolName && canonical(block.input ?? {}) === wanted) id = block.id;
      if (entry.type === 'user' && block?.type === 'tool_result' && typeof block.tool_use_id === 'string') results.add(block.tool_use_id);
    }
  }
  return id !== null && results.has(id);
}

/** answeredIn on the event's transcript; a transcript that is not there or cannot be read is unanswered. */
export function answered(event, read = readFileSync) {
  if (typeof event.transcript_path !== 'string' || !event.transcript_path) return false;
  try {
    return answeredIn(read(event.transcript_path, 'utf8'), event.tool_name, event.tool_input);
  } catch {
    return false;
  }
}

const deny = (message) => ({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message } } });
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * @param {string} raw the PermissionRequest event JSON
 * @param {Record<string, string | undefined>} env the hook process environment
 * @param {{home?: string, state?: object, exists?: Function, now?: () => number, sleep?: (ms: number) => Promise<void>,
 *   answered?: (event: object) => boolean, read?: typeof readFileSync}} deps
 * @returns {Promise<object | null>} the hook output, or null for none
 */
export async function onPermissionRequest(raw, env = process.env, deps = {}) {
  if (String(env.SORRY_MATT_GUARD || '').toLowerCase() === 'off') return null;
  try {
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!event || typeof event !== 'object' || event.hook_event_name !== 'PermissionRequest') return null;
    const home = deps.home ?? homedir();
    const state = deps.state ?? autoState(home);
    const now = deps.now ?? Date.now;
    const sleep = deps.sleep ?? wait;
    const isAnswered = deps.answered ?? ((e) => answered(e, deps.read));
    const session = event.session_id ?? null;
    const subject = subjectOf(event);
    const park = (at, reason) => {
      try {
        state.record({ session, at, subject, reason });
      } catch {
        // the list is for the user's return; losing an entry must not bring the dialog back
      }
      return deny(unattendedMessage(reason, home));
    };

    if (unattended(env, deps.exists ?? existsSync, home) || state.active()) {
      return park(now(), `這是 Claude Code 的權限提示（${event.tool_name}）。`);
    }
    const minutes = waitMinutes(env.SORRY_MATT_UNATTENDED_AFTER);
    if (minutes === null) return null;
    const deadline = now() + minutes * MINUTE_MS;
    const stillOpen = () => {
      try {
        return !isAnswered(event);
      } catch {
        return true;
      }
    };
    for (let left = deadline - now(); left > 0; left = deadline - now()) {
      await sleep(Math.min(POLL_MS, left));
      if (!stillOpen()) return null;
    }
    const at = now();
    try {
      state.enter({ at, reason: `權限確認框 ${minutes} 分鐘沒有回應：${subject}`, by: 'timeout', session });
    } catch {
      // the dialog still ran out: deny it; the next one waits again
    }
    return park(at, `權限確認框 ${minutes} 分鐘沒有人回應。`);
  } catch {
    return null;
  }
}
