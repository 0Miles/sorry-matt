// From a raw PreToolUse event to the hook's answer: ask, deny, or null to stay out of the way.
//   - double verdicts go through the two-step confirmation (README "Guard hook"; state in confirm-state.mjs)
//   - ask verdicts ask once
//   - merge verdicts ask once when deploy-on-merge.mjs says the merge deploys, or cannot tell
// It fails closed: an event it cannot read is denied, so a broken guard is loud, not silent.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify } from './classify.mjs';
import { parse, unwrap, commandName } from './shell.mjs';
import { fileStore, isLive, tokenFor, TOKEN } from './confirm-state.mjs';
import { mergeDeploys } from './deploy-on-merge.mjs';

const HOOK_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const pluginRoot = (env = process.env) => env.CLAUDE_PLUGIN_ROOT || HOOK_ROOT;
// Forward slashes run in Bash, Git Bash and PowerShell alike, on Windows too.
export const confirmCommand = (root, token) => `node "${join(root, 'hooks', 'confirm.mjs').replace(/\\/g, '/')}" ${token}`;

const BYPASS = 'bypassPermissions';
const OPT_OUT = '（使用者可在 Claude Code 設定的 "env" 加 SORRY_MATT_GUARD=off 關掉這個 guard。）';

/**
 * @param {string} raw the event JSON from stdin
 * @param {Record<string, string | undefined>} env the hook process environment
 * @param {{store?: object, now?: number, pluginRoot?: string, detect?: Function}} deps
 */
export function decide(raw, env = process.env, deps = {}) {
  if (String(env.SORRY_MATT_GUARD || '').toLowerCase() === 'off') return null;
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return deny('sorry-matt guard 讀不懂這次工具呼叫，所以擋下。請把它當成 guard 錯誤回報給使用者。');
  }
  try {
    const ctx = {
      event,
      env,
      mode: event.permission_mode || 'default',
      store: deps.store ?? fileStore(),
      now: deps.now ?? Date.now(),
      root: deps.pluginRoot ?? pluginRoot(env),
      detect: deps.detect ?? mergeDeploys,
    };
    const token = confirmInvocation(event);
    if (token !== null) return confirmStep(ctx, token);

    const verdicts = classify(event);
    const doubles = verdicts.filter((v) => v.level === 'double');
    if (doubles.length) return twoStep(ctx, doubles);
    const asks = verdicts.filter((v) => v.level === 'ask');
    if (asks.length) return ask(asks.map(askReason).join('\n'));
    for (const verdict of verdicts.filter((v) => v.level === 'merge')) {
      const result = ctx.detect(verdict.target, { cwd: event.cwd || process.cwd(), env });
      if (result.deploys !== false) return ask(mergeReason(verdict, result));
    }
    return null;
  } catch (error) {
    return deny(`sorry-matt guard 處理這次工具呼叫時出錯（${error.message}），所以擋下。請把它當成 guard 錯誤回報給使用者。`);
  }
}

// ---------- the two-step confirmation ----------

/**
 * The token when the call runs the guard's confirm.mjs: the token for the one form the guard hands out,
 * '' for any other form (chained, extra arguments, a malformed token), null when confirm.mjs is not run.
 */
export function confirmInvocation(event) {
  if (event.tool_name !== 'Bash' && event.tool_name !== 'PowerShell') return null;
  const segments = parse(String(event.tool_input?.command || ''), event.tool_name === 'PowerShell' ? 'powershell' : 'bash');
  const runs = segments.map((s) => unwrap(s.argv).argv).filter((argv) => commandName(argv[0]) === 'node' && /(^|[\\/])hooks[\\/]confirm\.mjs$/i.test(argv[1] ?? ''));
  if (!runs.length) return null;
  const [argv] = runs;
  return segments.length === 1 && argv.length === 3 && TOKEN.test(argv[2]) ? argv[2] : '';
}

const subjectOf = (event) =>
  event.tool_name === 'Bash' || event.tool_name === 'PowerShell' ? String(event.tool_input?.command ?? '') : event.tool_name;

function confirmStep({ event, mode, store, now }, token) {
  if (!token) return deny('sorry-matt guard：確認指令只能單獨、原樣執行 guard 給的那一行（`node ".../hooks/confirm.mjs" <確認碼>`），不能串接其他指令或改寫。');
  if (mode === BYPASS) return deny(`sorry-matt guard：目前是 ${BYPASS} 模式，不保證會跳確認提示，所以不記錄確認。請使用者切到有確認提示的模式後自己執行原指令。`);
  let entry;
  try {
    entry = store.read(event.session_id)[token];
  } catch (error) {
    return deny(`sorry-matt guard 讀不到確認紀錄（${error.message}），所以不記錄確認。請把它當成 guard 錯誤回報給使用者。`);
  }
  if (!isLive(entry, now)) {
    return deny('sorry-matt guard：這個確認碼無效（不存在、已過期或已使用）。要執行原指令，請原樣重送它，重新開始兩段確認；不要自己改寫確認指令。');
  }
  return ask(`sorry-matt guard 第一次確認（共兩次）\n${entry.summary}\n允許後只會記錄這次確認，原指令不會執行；agent 原樣重送原指令後，會再問第二次。`);
}

function twoStep({ event, mode, store, now, root }, verdicts) {
  const consequence = [...new Set(verdicts.map((v) => v.consequence))].join('\n');
  const summary = `${consequence}\n要執行的是：${subjectOf(event)}`;
  if (mode === BYPASS) {
    return deny(`sorry-matt guard 擋下這次呼叫：${summary}\n目前是 ${BYPASS} 模式，不保證會跳出確認提示，所以這類動作一律擋下。不要換寫法重試；告訴使用者要執行的指令與原因，請使用者切到有確認提示的模式後自己執行。${OPT_OUT}`);
  }
  const session = event.session_id;
  const tool = event.tool_name;
  const input = event.tool_input || {};
  const token = tokenFor(session, tool, input);

  // Second step: an approval for this exact call, in this session, within the TTL. It is spent on the ask.
  try {
    const spent = store.update(session, (entries) => {
      const entry = entries[token];
      if (!entry?.approved || !isLive(entry, now)) return false;
      entry.used = true;
      return true;
    }, now);
    if (spent) return ask(`sorry-matt guard 第二次確認（最後一次）\n${summary}\n允許後就會真的執行。`);
  } catch {
    // no readable approval: back to the first step
  }

  // First step: record a pending token; it is approved only when confirm.mjs runs.
  try {
    store.update(session, (entries) => {
      entries[token] = { tool, summary, created: now, approved: false, used: false };
    }, now);
  } catch (error) {
    return deny(`sorry-matt guard 擋下這次呼叫：${summary}\n這類動作要兩次確認，但確認紀錄無法寫入（${error.message}），所以無法開始確認。請把它當成 guard 錯誤回報給使用者。`);
  }
  const command = confirmCommand(root, token);
  if (tool === 'Bash' || tool === 'PowerShell') {
    const updatedInput = { ...input, command };
    delete updatedInput.run_in_background;
    if ('description' in updatedInput) updatedInput.description = 'sorry-matt guard：記錄第一次確認';
    return ask(`sorry-matt guard 第一次確認（共兩次）\n${summary}\n允許後只會記錄這次確認，原指令不會執行；agent 原樣重送原指令後，會再問第二次。`, updatedInput);
  }
  return deny(`sorry-matt guard 需要兩次確認：${summary}\n若要執行，先跑這支指令取得第一次確認：\`${command}\`，再原樣重送這次呼叫（會再問第二次）。不要換寫法繞過。`);
}

// ---------- asking once ----------

function askReason(verdict) {
  if (verdict.category === 'claude-settings') {
    return `sorry-matt guard 確認：這會寫入 Claude Code 設定檔 ${verdict.path}，可能改變權限、hook 或環境變數。（${verdict.detail}）`;
  }
  return `sorry-matt guard 確認：這是發布版本或部署正式環境的動作，送出後外部就看得到或用得到：${verdict.detail}`;
}

function mergeReason(verdict, result) {
  if (result.deploys) return `sorry-matt guard 確認：這次合併會立即觸發正式部署或發布。${result.reason}。（${verdict.detail}）`;
  return `sorry-matt guard 確認：無法判斷這次合併會不會立即觸發正式部署（${result.reason}），所以先問。（${verdict.detail}）可以設定 SORRY_MATT_MERGE_DEPLOYS=no，或在 repo 的 .claude/sorry-matt.json 寫 {"mergeDeploysProduction": false}，明確告訴 guard 合併不會部署。`;
}

// ---------- hook output ----------

const output = (permissionDecision, permissionDecisionReason, updatedInput) => ({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision,
    permissionDecisionReason,
    ...(updatedInput ? { updatedInput } : {}),
  },
});
const ask = (text, updatedInput) => output('ask', text, updatedInput);
const deny = (text) => output('deny', text);
