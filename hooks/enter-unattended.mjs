#!/usr/bin/env node
// The agent's way into unattended mode: `node enter-unattended.mjs "<reason>"`. The guard lets this one line
// through without a prompt and records the entry itself when it sees the call (decision.mjs); running it records
// the same entry again, which changes nothing, and tells the agent what is in force. Entering only makes the guard
// stricter. There is no command that leaves: the automatic state ends when the user is back.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { autoState } from './unattended-state.mjs';

/** @returns {{ok: boolean, text: string}} */
export function enter(reason, { state = autoState(), now = Date.now() } = {}) {
  if (!String(reason ?? '').trim()) {
    return { ok: false, text: 'sorry-matt guard：進入無人值守要附原因：node "<plugin>/hooks/enter-unattended.mjs" "<原因>"。沒有進入。' };
  }
  try {
    const entered = state.enter({ at: now, reason: String(reason).trim(), by: 'agent' });
    return {
      ok: true,
      text: `sorry-matt guard：已進入無人值守模式（自動進入）。進入時間 ${new Date(entered.at).toISOString()}，原因：${entered.reason}\n之後所有 session 需要使用者確認的動作都會直接擋下並記進清單。使用者回來送出訊息後才解除；agent 不能解除，也不要動它的狀態檔。`,
    };
  } catch (error) {
    return { ok: false, text: `sorry-matt guard：無法寫入無人值守狀態（${error.message}），沒有進入。` };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { ok, text } = enter(process.argv[2]);
  (ok ? process.stdout : process.stderr).write(text + '\n');
  process.exit(ok ? 0 : 1);
}
