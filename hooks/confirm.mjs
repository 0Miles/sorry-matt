#!/usr/bin/env node
// The first step of the guard's two-step confirmation: `node confirm.mjs <token>`. The guard sends this command
// in place of a dangerous one and asks the user before it runs; running it means the user allowed that first
// prompt. It marks the token approved and nothing else; the original call has to be sent again, unchanged,
// for the second prompt. A missing, expired or spent token changes nothing and exits 1.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { fileStore, isLive, TOKEN } from './confirm-state.mjs';

/** @returns {{ok: boolean, text: string}} */
export function approve(token, { store = fileStore(), now = Date.now() } = {}) {
  if (!TOKEN.test(token ?? '')) return { ok: false, text: 'sorry-matt guard：確認碼格式不對，沒有記錄任何確認。' };
  const session = store.sessionOf(token);
  if (!session) return { ok: false, text: 'sorry-matt guard：找不到這個確認碼，沒有記錄任何確認。請原樣重送原指令，重新開始兩段確認。' };
  try {
    const ok = store.update(session, (entries) => {
      const entry = entries[token];
      if (!isLive(entry, now)) return false;
      entry.approved = true;
      entry.approvedAt = now;
      return true;
    }, now);
    return ok
      ? { ok: true, text: '第一次確認已記錄，請原樣重送原指令以進行第二次確認（10 分鐘內有效）。' }
      : { ok: false, text: 'sorry-matt guard：這個確認碼已過期或已使用，沒有記錄任何確認。請原樣重送原指令，重新開始兩段確認。' };
  } catch (error) {
    return { ok: false, text: `sorry-matt guard：無法寫入確認紀錄（${error.message}），沒有記錄任何確認。` };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { ok, text } = approve(process.argv[2]);
  (ok ? process.stdout : process.stderr).write(text + '\n');
  process.exit(ok ? 0 : 1);
}
