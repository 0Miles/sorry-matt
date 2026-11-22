#!/usr/bin/env node
// UserPromptSubmit and Stop hook entry: the automatic unattended state ends when the user is back.
// "Back" is a turn a person sent, in any session: the event's `prompt_id` is looked up in the session transcript, and
// only the first user entry with that `promptId` whose `turnOrigin` is "human" counts. A `/loop` wake-up
// ("scheduled"), a background subagent's report ("task_notification"), a headless prompt ("sdk"), another session's
// message ("peer"), any other value, no value, or a transcript that cannot be read all leave the state as it is
// (values measured in scripts/unattended.live.mjs). Ending it puts every session back to the usual prompts, and the
// list of what was blocked meanwhile is handed to the agent to tell the user, then emptied. It never touches the
// user's own source (the switch file or SORRY_MATT_UNATTENDED): only the user turns that one off.
// The transcript entry can be written after UserPromptSubmit runs (spec #89 saw 40–54 ms). The hook rereads for up to
// REREAD_MS, then leaves the turn as pending in the state file, and that session's Stop hook decides it: a "human" turn
// ends the state there and hands the list over as a Stop block reason; anything else only drops the pending turn.
// Stop, not the guard's next PreToolUse, because a turn may make no tool call that needs the user, and Stop comes once
// per turn, after the entry is written. Nothing is printed and nothing written without the automatic state, or with
// the guard off. Any failure is "not back": the hook always exits 0 and never blocks a prompt.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pause } from './budget.mjs';
import { guardOff, shownUnattendedFile, unattended } from './decision.mjs';
import { autoState } from './unattended-state.mjs';

export const REREAD_MS = 500;
const STEP_MS = 25;

/** The `turnOrigin` of the first user entry for `promptId` in transcript JSONL; `found: false` when there is none yet. */
export function turnOrigin(text, promptId) {
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.includes(promptId)) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry && entry.type === 'user' && entry.promptId === promptId) return { found: true, origin: entry.turnOrigin };
  }
  return { found: false };
}

/** 'human', 'other', 'missing' (no entry yet, or no file yet) or 'unreadable'. */
export function judge(path, promptId, read) {
  let text;
  try {
    text = read(path, 'utf8');
  } catch (error) {
    return error.code === 'ENOENT' ? 'missing' : 'unreadable';
  }
  const found = turnOrigin(text, promptId);
  if (!found.found) return 'missing';
  return found.origin === 'human' ? 'human' : 'other';
}

export const time = (ms) => new Date(ms).toISOString();
const indent = (text) => String(text).split(/\r?\n/).join('\n     ');

/** The blocked list as the agent is handed it: one numbered item per action, with session, time, command and reason. */
export const blockedLines = (blocked) => blocked.flatMap((b, i) =>
  [`${i + 1}. session ${b.session ?? '（不明）'}，${time(b.at)}`, `   原指令：${indent(b.subject)}`, `   理由：${indent(b.reason)}`]);

/** What the agent is told when the automatic state ends: the entry, and every blocked action. */
export function handover({ entered, blocked }, { env = process.env, home = homedir(), exists = existsSync } = {}) {
  const lines = [
    `sorry-matt guard：使用者回來送出了訊息，自動進入的無人值守模式已解除（進入時間 ${time(entered.at)}，原因：${entered.reason}）。之後需要使用者確認的動作會照常跳確認框。`,
  ];
  if (unattended(env, exists, home)) {
    lines.push(`使用者自己開的無人值守（開關檔 ${shownUnattendedFile(home)} 或環境變數 SORRY_MATT_UNATTENDED）仍然開著，需要確認的動作仍會直接擋下；它只由使用者關閉。`);
  }
  if (!blocked.length) {
    lines.push('無人值守期間沒有擋下任何動作。請告訴使用者無人值守已解除。');
    return lines.join('\n');
  }
  lines.push(`無人值守期間擋下了 ${blocked.length} 個需要使用者確認的動作。請把下面的清單完整告訴使用者（session、時間、原指令、理由），由使用者決定要不要執行；不要自己重跑它們。`);
  lines.push(...blockedLines(blocked));
  return lines.join('\n');
}

/** Ends the automatic state; the handover text, or null when another session ended it first. */
function end(state, { env, home, exists }) {
  const cleared = state.clear();
  return cleared ? handover(cleared, { env, home, exists }) : null;
}

const parse = (raw) => {
  try {
    const event = JSON.parse(raw);
    return event && typeof event === 'object' ? event : null;
  } catch {
    return null;
  }
};
const text = (v) => typeof v === 'string' && v !== '';
// The user's switch command. Claude Code runs UserPromptSubmit before the command's UserPromptExpansion, so ending
// the automatic state here would leave unattended-switch.mjs no source to see: its toggle would turn on instead of
// off, and its `off` would find no list to hand over. That turn is the switch hook's to decide.
const SWITCH_PROMPT = /^\s*\/sorry-matt:unattended(\s|$)/;
export const isSwitchCommand = (prompt) => typeof prompt === 'string' && SWITCH_PROMPT.test(prompt);

/**
 * UserPromptSubmit: ends the automatic state on a person's turn and returns the hook output that hands the list to
 * the agent; null for everything else.
 * @param {{home?: string, state?: object, read?: typeof readFileSync, now?: () => number, sleep?: (ms: number) => void, exists?: Function}} deps
 */
export function onPromptSubmit(raw, env = process.env, deps = {}) {
  if (guardOff(env)) return null;
  try {
    const event = parse(raw);
    const home = deps.home ?? homedir();
    const state = deps.state ?? autoState(home);
    if (!event || isSwitchCommand(event.prompt) || !state.active()) return null;
    if (!text(event.prompt_id) || !text(event.transcript_path)) return null;
    const { read = readFileSync, now = Date.now, sleep = pause } = deps;
    const deadline = now() + REREAD_MS;
    let verdict = judge(event.transcript_path, event.prompt_id, read);
    while (verdict === 'missing' && now() < deadline) {
      sleep(STEP_MS);
      verdict = judge(event.transcript_path, event.prompt_id, read);
    }
    if (verdict === 'missing') {
      if (text(event.session_id)) state.defer({ session: event.session_id, prompt_id: event.prompt_id });
      return null;
    }
    if (verdict !== 'human') return null;
    const list = end(state, { env, home, exists: deps.exists });
    return list ? { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: list } } : null;
  } catch {
    return null;
  }
}

/**
 * Stop: decides this session's pending turns. A person's turn ends the automatic state and returns a block whose
 * reason is the list; any other turn is only taken off the pending list. Also with `stop_hook_active`: the pending
 * turns are gone once the state is cleared, so the block comes once.
 */
export function onStop(raw, env = process.env, deps = {}) {
  if (guardOff(env)) return null;
  try {
    const event = parse(raw);
    if (!event || !text(event.session_id)) return null;
    const home = deps.home ?? homedir();
    const state = deps.state ?? autoState(home);
    const mine = state.read().pending.filter((p) => p.session === event.session_id);
    const read = deps.read ?? readFileSync;
    const path = text(event.transcript_path) ? event.transcript_path : null;
    for (const turn of mine) {
      const verdict = path ? judge(path, turn.prompt_id, read) : 'unreadable';
      if (verdict === 'human') {
        const list = end(state, { env, home, exists: deps.exists });
        return list ? { decision: 'block', reason: list } : null;
      }
      state.settle(turn);
    }
    return null;
  } catch {
    return null;
  }
}

/** The hook's answer for any event it is registered on. */
export function respond(raw, env = process.env, deps = {}) {
  const name = parse(raw)?.hook_event_name;
  if (name === 'UserPromptSubmit') return onPromptSubmit(raw, env, deps);
  if (name === 'Stop') return onStop(raw, env, deps);
  return null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const chunks = [];
  process.stdin.on('data', (c) => chunks.push(c));
  process.stdin.on('end', () => {
    const out = respond(Buffer.concat(chunks).toString('utf8'));
    if (out) process.stdout.write(JSON.stringify(out));
  });
}
