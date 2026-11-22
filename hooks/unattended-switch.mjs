#!/usr/bin/env node
// UserPromptExpansion and Stop hook entry for `/sorry-matt:unattended`: the user's own switch, flipped when the user
// types the command, never by an agent's tool call (the skill has disable-model-invocation, and this hook runs only
// on a typed command's expansion). The result goes to the agent as additionalContext, never as a block: a block
// would stop the expansion, and the agent could not relay the result or the blocked list.
//   on        creates the switch file (~/.claude/sorry-matt-unattended); the automatic state is left alone
//   off       a person's turn only: removes the switch file, ends the automatic state, and hands over every
//             blocked action, whichever source it was blocked under, then empties the list
//   status    reads, writes nothing
//   (none)    off when any source holds (switch file, SORRY_MATT_UNATTENDED, automatic state), on otherwise
// "A person's turn" is the test unattended-return.mjs uses: the event's prompt_id, looked up in the transcript, has
// `turnOrigin: "human"`. Anything else leaves every file as it is and tells the user to remove the switch file
// themselves. An entry not written yet is reread for up to REREAD_MS, then left as a pending `off` that this
// session's Stop decides: a person's turn runs the `off` there and hands the result over as a Stop block reason;
// anything else only drops the pending turn. SORRY_MATT_UNATTENDED is the user's settings, not a file: `off` cannot
// end it, and says so. The command name is matched here, not only by the hooks.json matcher. Any failure is a
// message, never a thrown error: the hook always exits 0.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pause } from './budget.mjs';
import { guardOff, shownUnattendedFile, unattendedEnv, unattendedFile } from './decision.mjs';
import { autoState } from './unattended-state.mjs';
import { REREAD_MS, blockedLines, judge, time } from './unattended-return.mjs';

/** The only command name this hook answers: the plugin's `unattended` skill, as Claude Code names a plugin command. */
export const COMMAND = 'sorry-matt:unattended';
/** Every result starts with this, so the skill body can tell a hook result from anything else in the context. */
export const PREFIX = '[sorry-matt unattended]';
const STEP_MS = 25;
const RM = 'rm ~/.claude/sorry-matt-unattended';
const TOUCH = 'touch ~/.claude/sorry-matt-unattended';
const RELAY = '請把這段結果照實告訴使用者。';

const parse = (raw) => {
  try {
    const event = JSON.parse(raw);
    return event && typeof event === 'object' ? event : null;
  } catch {
    return null;
  }
};
const text = (v) => typeof v === 'string' && v !== '';
const isCommand = (name) => typeof name === 'string' && name.replace(/^\//, '') === COMMAND;

function context(env, deps) {
  const home = deps.home ?? homedir();
  return {
    env,
    home,
    state: deps.state ?? autoState(home),
    exists: deps.exists ?? existsSync,
    remove: deps.remove ?? rmSync,
    read: deps.read ?? readFileSync,
    now: deps.now ?? Date.now,
    sleep: deps.sleep ?? pause,
  };
}

/** Which sources hold right now. Reads only. */
function sources({ env, home, state, exists }) {
  let file = false;
  try {
    file = exists(unattendedFile(home));
  } catch {
    // unknown is off: status says so, and `off` has nothing of its to remove
  }
  return { file, env: unattendedEnv(env), auto: state.read() };
}
const anyOn = (s) => s.file || s.env || s.auto.entered !== null;

const ENV_NOTE = '環境變數 SORRY_MATT_UNATTENDED 是使用者在 Claude Code settings 的 "env" 設的，/sorry-matt:unattended off 清不掉它；要關掉，請使用者從 settings 的 "env" 拿掉 SORRY_MATT_UNATTENDED（之後新開的 session 才生效）。';
const auto = (entered) => `進入時間 ${time(entered.at)}，原因：${entered.reason}，session ${entered.session ?? '（不明）'}`;

function statusText(ctx) {
  const s = sources(ctx);
  if (!anyOn(s)) {
    return `${PREFIX} 無人值守未開啟：開關檔、環境變數 SORRY_MATT_UNATTENDED 與自動進入的狀態都沒有開著，需要使用者確認的動作會照常跳確認框。${RELAY}`;
  }
  const lines = [`${PREFIX} 無人值守開著。成立的來源：`];
  if (s.file) lines.push(`- 開關檔：${shownUnattendedFile(ctx.home)}`);
  if (s.env) lines.push(`- 環境變數：SORRY_MATT_UNATTENDED=${String(ctx.env.SORRY_MATT_UNATTENDED).trim()}`);
  if (s.auto.entered) lines.push(`- 自動進入：${auto(s.auto.entered)}`);
  lines.push(`擋下清單目前有 ${s.auto.blocked.length} 筆（/sorry-matt:unattended off 時交出並清空）。`);
  if (s.env) lines.push(ENV_NOTE);
  lines.push(RELAY);
  return lines.join('\n');
}

function turnOn({ home, exists }) {
  const path = unattendedFile(home);
  const shown = shownUnattendedFile(home);
  let there = false;
  try {
    there = exists(path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '', { flag: 'a' });
  } catch (error) {
    return `${PREFIX} 無法建立開關檔 ${shown}（${error.message}），無人值守沒有開啟。請使用者自己執行 \`${TOUCH}\`。${RELAY}`;
  }
  return [
    `${PREFIX} 已開啟無人值守：${there ? `開關檔 ${shown} 原本就在，維持開啟` : `建立了開關檔 ${shown}`}。`,
    '之後所有 session 需要使用者確認的動作與提問都直接擋下、記進清單，不跳確認框。',
    `要關閉，請使用者輸入 /sorry-matt:unattended off，或執行 \`${RM}\`。${RELAY}`,
  ].join('\n');
}

/** `off` once the turn is known to be a person's: the switch file, the automatic state and the list. */
function turnOff(ctx) {
  const s = sources(ctx);
  if (!anyOn(s)) {
    return `${PREFIX} 無人值守本來就沒開（開關檔、環境變數與自動進入的狀態都沒有開著），沒有改任何檔。${RELAY}`;
  }
  const path = unattendedFile(ctx.home);
  const shown = shownUnattendedFile(ctx.home);
  let cleared;
  try {
    cleared = ctx.state.clearAll();
  } catch (error) {
    return `${PREFIX} 無法清除無人值守的狀態檔（${error.message}），沒有關閉：開關檔、自動進入的狀態與擋下清單都沒動。請使用者執行 \`${RM}\` 關閉開關檔。${RELAY}`;
  }
  const lines = [`${PREFIX} /sorry-matt:unattended off：`];
  let fileLeft = false;
  if (s.file) {
    try {
      ctx.remove(path, { force: true });
      lines.push(`- 刪掉了開關檔 ${shown}。`);
    } catch (error) {
      fileLeft = true;
      lines.push(`- 開關檔 ${shown} 刪不掉（${error.message}），仍然開著；請使用者執行 \`${RM}\`。`);
    }
  }
  const entered = cleared?.entered ?? null;
  if (entered) lines.push(`- 自動進入的無人值守已解除（${auto(entered)}）。`);
  if (s.env) {
    lines.push(`無人值守仍因環境變數 SORRY_MATT_UNATTENDED 開著：需要使用者確認的動作仍會直接擋下。${ENV_NOTE}`);
  } else if (!fileLeft) {
    lines.push('無人值守已關閉：之後需要使用者確認的動作會照常跳確認框。');
  }
  const blocked = cleared?.blocked ?? [];
  if (!blocked.length) {
    lines.push(`無人值守期間沒有擋下任何動作。${RELAY}`);
    return lines.join('\n');
  }
  lines.push(`無人值守期間擋下了 ${blocked.length} 個需要使用者確認的動作（清單已清空）。請把下面的清單完整告訴使用者（session、時間、原指令、理由），由使用者決定要不要執行；不要自己重跑它們。`);
  lines.push(...blockedLines(blocked));
  return lines.join('\n');
}

const notHuman = (why) =>
  `${PREFIX} 沒有關閉無人值守：${why}，判不出這一輪是使用者親自送出的，所以開關檔、自動進入的狀態與擋下清單都沒動。要關閉，請使用者在終端機執行 \`${RM}\`（自動進入的狀態在使用者親自送出訊息時解除；環境變數 SORRY_MATT_UNATTENDED 要從 settings 的 "env" 拿掉）。${RELAY}`;
const DEFERRED = `${PREFIX} 這一輪的 transcript 紀錄還沒寫入，還判不出是不是使用者親自送出的，所以先記成待判定，現在什麼都還沒改。這一輪結束時（Stop）再判定：是使用者送出的就關閉，並把結果與擋下清單交回來；不是就不關閉。`;

/** `off` and the toggle that turns off: a person's turn only. */
function offTurn(event, ctx) {
  if (!anyOn(sources(ctx))) return turnOff(ctx);
  if (!text(event.prompt_id) || !text(event.transcript_path)) return notHuman('事件沒有 prompt_id 或 transcript_path');
  const deadline = ctx.now() + REREAD_MS;
  let verdict = judge(event.transcript_path, event.prompt_id, ctx.read);
  while (verdict === 'missing' && ctx.now() < deadline) {
    ctx.sleep(STEP_MS);
    verdict = judge(event.transcript_path, event.prompt_id, ctx.read);
  }
  if (verdict === 'missing') {
    if (text(event.session_id)) {
      try {
        ctx.state.deferOff({ session: event.session_id, prompt_id: event.prompt_id });
        return DEFERRED;
      } catch {
        // cannot be left for Stop: not decided
      }
    }
    return notHuman('這一輪的 transcript 紀錄還沒寫入，也無法留到這一輪結束時再判定');
  }
  if (verdict === 'unreadable') return notHuman('讀不到這個 session 的 transcript');
  if (verdict !== 'human') return notHuman('transcript 裡這一輪不是使用者親自輸入的（例如排程或 /loop 喚醒、背景 agent 的通知），或沒有記下來源');
  return turnOff(ctx);
}

const usage = (arg) =>
  `${PREFIX} 不認得的參數「${arg}」，沒有改任何檔。寫法：/sorry-matt:unattended on（開啟）、/sorry-matt:unattended off（關閉）、/sorry-matt:unattended status（顯示狀態）、/sorry-matt:unattended（不帶參數：任一來源開著就關閉，否則開啟）。${RELAY}`;
const GUARD_OFF = `${PREFIX} sorry-matt guard 已關閉（SORRY_MATT_GUARD=off），無人值守沒有作用，所以沒有改任何檔。要讓無人值守生效，請使用者先從 Claude Code settings 的 "env" 拿掉 SORRY_MATT_GUARD=off。${RELAY}`;
const say = (additionalContext) => ({ hookSpecificOutput: { hookEventName: 'UserPromptExpansion', additionalContext } });

/**
 * UserPromptExpansion: the result of `/sorry-matt:unattended [on|off|status]` as additionalContext; null, with nothing
 * read or written, for any other command.
 * @param {{home?: string, state?: object, exists?: Function, remove?: Function, read?: typeof readFileSync, now?: () => number, sleep?: (ms: number) => void}} deps
 */
export function onExpansion(raw, env = process.env, deps = {}) {
  const event = parse(raw);
  if (!event || !isCommand(event.command_name)) return null;
  if (guardOff(env)) return say(GUARD_OFF);
  try {
    const ctx = context(env, deps);
    const arg = String(event.command_args ?? '').trim();
    const word = arg.toLowerCase();
    if (word === 'status') return say(statusText(ctx));
    if (word === 'on') return say(turnOn(ctx));
    if (word === 'off') return say(offTurn(event, ctx));
    if (word === '') return say(anyOn(sources(ctx)) ? offTurn(event, ctx) : turnOn(ctx));
    return say(usage(arg));
  } catch (error) {
    return say(`${PREFIX} 處理時出錯（${error.message}），沒有完成切換。請使用者自己執行 \`${TOUCH}\`（開啟）或 \`${RM}\`（關閉）。${RELAY}`);
  }
}

/**
 * Stop: decides this session's pending `off` turns. A person's turn runs the `off` and returns a block whose reason is
 * its result; any other turn is only taken off the pending list. The pending turn goes before the block, so the stop
 * the block causes finds nothing to do.
 */
export function onStop(raw, env = process.env, deps = {}) {
  if (guardOff(env)) return null;
  try {
    const event = parse(raw);
    if (!event || !text(event.session_id)) return null;
    const ctx = context(env, deps);
    const mine = ctx.state.read().pendingOff.filter((p) => p.session === event.session_id);
    const path = text(event.transcript_path) ? event.transcript_path : null;
    for (const turn of mine) {
      const verdict = path ? judge(path, turn.prompt_id, ctx.read) : 'unreadable';
      ctx.state.settleOff(turn);
      if (verdict === 'human') return { decision: 'block', reason: turnOff(ctx) };
    }
    return null;
  } catch {
    return null;
  }
}

/** The hook's answer for any event it is registered on. */
export function respond(raw, env = process.env, deps = {}) {
  const name = parse(raw)?.hook_event_name;
  if (name === 'UserPromptExpansion') return onExpansion(raw, env, deps);
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
