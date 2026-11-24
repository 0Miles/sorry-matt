// From a raw PreToolUse event to the hook's answer: a deny for a catastrophic command (classify.mjs), or null to
// stay out of the way. It never asks: everything it does not deny is left to Claude Code's own permission settings.
// It fails closed: an event it cannot read is denied, so a broken guard is loud, not silent.
import { classify } from './classify.mjs';

/** SORRY_MATT_GUARD=off turns the guard off. */
export const guardOff = (env = process.env) => String(env.SORRY_MATT_GUARD || '').toLowerCase() === 'off';

const OPT_OUT = '（使用者可在 Claude Code 設定的 "env" 加 SORRY_MATT_GUARD=off 關掉這個 guard。）';

/**
 * @param {string} raw the event JSON from stdin
 * @param {Record<string, string | undefined>} env the hook process environment
 */
export function decide(raw, env = process.env) {
  if (guardOff(env)) return null;
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return deny('sorry-matt guard 讀不懂這次工具呼叫，所以擋下。請把它當成 guard 錯誤回報給使用者。');
  }
  try {
    const verdicts = classify(event).filter((v) => v.deny);
    if (!verdicts.length) return null;
    const why = [...new Set(verdicts.map((v) => v.consequence))].join('\n');
    return deny(`sorry-matt guard 擋下災難級操作，不會執行：\n${why}\n要執行的是：${verdicts.map((v) => v.detail).join('；')}\n不要換一種寫法重試；需要的話，請使用者自己在終端機執行。${OPT_OUT}`);
  } catch (e) {
    return deny(`sorry-matt guard 判斷這次工具呼叫時出錯（${e.message}），所以擋下。請把它當成 guard 錯誤回報給使用者。`);
  }
}

const deny = (permissionDecisionReason) => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason },
});
