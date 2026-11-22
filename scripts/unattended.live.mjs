#!/usr/bin/env node
// Live test: which turns does hooks/unattended-return.mjs take for "the user is back"? (#94, spec #89)
// The automatic unattended state ends on a turn the user sent: the UserPromptSubmit event's `prompt_id` is looked up
// in the session transcript, and only a user entry with that `promptId` and `turnOrigin: "human"` counts. That rests
// on facts about Claude Code no unit test can show, so this asks real sessions:
//   1. which `turnOrigin` each kind of turn gets, and whether UserPromptSubmit fires for it;
//   2. whether the transcript entry is already there when the hook runs, or is written after it.
// Two parts:
//   node scripts/unattended.live.mjs [work dir]   one headless session over stream-json input, with a throwaway probe
//       plugin whose hooks only log events: a prompt, a background subagent's report and a `/loop` wake-up. It spends
//       API quota (a few cents with haiku), so it is run by hand, never in CI. It never loads this checkout's hooks
//       and never touches the real unattended state.
//   node scripts/unattended.live.mjs --survey      no API calls: tallies the user entries of the transcripts already
//       under ~/.claude/projects by `turnOrigin`, `promptSource`, `origin.kind`, `wakeupSource`, `entrypoint` and
//       version. Only those field values are read and printed, never a message. A headless session cannot type as a
//       person, so this is where `human` and the other sources a person's own sessions produce are seen.
//
// Result, Claude Code 2.1.328 (2026-11-22, Windows 11). The headless part ran once (every turn came back); the survey read this machine's transcripts from 2.1.280 to 2.1.328. Values per source:
//   - Typed by a person: `turnOrigin: "human"`, `origin.kind: "human"`, in the CLI (`promptSource: "typed"`) and in
//     the desktop app (`promptSource: "sdk"`, `entrypoint: "claude-desktop"`) alike (survey). UserPromptSubmit fires
//     for it (spec #89 Further Notes 5, 2.1.325 and 2.1.328, 2026-11-19); a headless session cannot type as a person,
//     so this script does not see that itself.
//   - A `/loop` wake-up: `turnOrigin: "scheduled"`, `wakeupSource: "schedule_wakeup"` headless and `"loop_wakeup"` in
//     the desktop app (survey, spec #89). UserPromptSubmit fires for it (headless part).
//   - A background subagent's report: `turnOrigin: "task_notification"`, `origin.kind: "task-notification"`.
//     UserPromptSubmit fires for it (headless part).
//   - A headless `-p` or stream-json prompt: `turnOrigin: "sdk"`. UserPromptSubmit fires for it (headless part). Not a
//     person, so it never ends the automatic state, even typed into `claude -p` by hand.
//   - A message another session sent: `turnOrigin: "peer"`, `origin.kind: "peer"` (survey). Whether UserPromptSubmit
//     fires for it is not tested.
//   - A cron scheduled task: not tested apart. The survey has `turnOrigin: "scheduled"` entries without
//     `wakeupSource`, some with `origin.kind: "task-notification"`; which of them are cron tasks the fields do not say.
//   - Also in the survey, never a person: `host_synthetic` and `auto_continuation`.
//   Every value but `human` leaves the automatic state as it is, so an untested source can only keep the guard strict.
// Timing: in the headless part one of four entries was written 30 ms after the hook ran, the others 131–163 ms
// before; spec #89 saw 40–54 ms late in two of four. Hence the hook rereads for up to 500 ms and otherwise leaves the
// turn to that session's Stop hook.
// Re-run it by hand after a Claude Code upgrade that touches hooks, transcripts, `/loop` or background agents.
//
// Also: does hooks/permission-request.mjs take back a permission dialog nobody answers? (#92, spec #89) Three more
// parts, all with a throwaway probe plugin whose PreToolUse asks for `echo sorry-matt-probe …` and whose
// PermissionRequest runs this checkout's handler (hooks/unattended-timeout.mjs) against a home inside the work dir, so
// the real unattended state is never touched:
//   node scripts/unattended.live.mjs --permission [work dir]               headless `claude -p` (a cent or less with
//       haiku): PreToolUse asks, and PermissionRequest should not run at all.
//   node scripts/unattended.live.mjs --permission-interactive [work dir]   sets up the probe (wait 0.5 min) and prints
//       the interactive `claude --plugin-dir` line and the two dialogs a person leaves alone and answers.
//   node scripts/unattended.live.mjs --permission-report <work dir>        what the probe saw: each PermissionRequest
//       run, its input fields, whether it decided or was ended first, and the automatic state it wrote.
// Result, Claude Code 2.1.328 (2026-11-22, Windows 11):
//   - Headless `-p`: PreToolUse ran once and asked; PermissionRequest did not run (0 runs, automatic state none). In
//     `-p` an ask is denied at once, so there is no dialog to take back (also spec #89 Further Notes 3).
//   - The dialog is taken back: not re-run here. The interactive part needs a key press before the first prompt (the
//     Chrome extension startup choice), which an agent cannot send. Spec #89 Further Notes 1–2 (2.1.325 and 2.1.328,
//     2026-11-19, a probe that waited 25–30 s and then denied): the dialog on screen went away and the tool call was
//     denied with the hook's `message`, in `permission_mode: "auto"`, the dialog raised by a PreToolUse ask.
//   - PermissionRequest input (spec #89 Further Notes 3, same runs): `session_id`, `prompt_id`, `permission_mode`,
//     `tool_name`, `tool_input`, alongside the common `hook_event_name`, `transcript_path` and `cwd`; no `tool_use_id`.
//     Hence "still unanswered" is read from the transcript: the last tool_use with the same tool name and input, and
//     whether a tool_result answers it.
//   - Eyes-on, not done yet: (a) a dialog answered before the deadline: the call goes as answered, and afterwards
//     `unattended.json` has no `entered`. If Claude Code ends the waiting hook once the user answers, the report says
//     "never decided"; if not, the transcript check must say "no output (answered)". Known gap either way it is read:
//     a call allowed shortly before the deadline that is still running has no tool_result yet, so the hook enters.
//     The same for a call whose input the PreToolUse guard rewrote (the two-step first step) or a subagent's call
//     whose tool_use lives in another transcript: no matching tool_use is "unanswered", only ever stricter.
//     (b) The desktop app (SDK host): whether its dialog is taken back the same way. The official docs say the hook
//     and the host run side by side and the first to decide wins; install a build with this hook, set
//     SORRY_MATT_UNATTENDED_AFTER=0.5 in Claude Code's "env", leave one dialog alone for 30 s and look.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const userEntries = (text) => text.split(/\r?\n/).flatMap((line) => {
  try {
    const entry = JSON.parse(line);
    return entry && entry.type === 'user' ? [entry] : [];
  } catch {
    return [];
  }
});

function survey() {
  const root = join(homedir(), '.claude', 'projects');
  const counts = new Map();
  for (const dir of existsSync(root) ? readdirSync(root) : []) {
    let files = [];
    try {
      files = readdirSync(join(root, dir)).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const file of files) {
      const path = join(root, dir, file);
      if (!statSync(path).isFile()) continue;
      for (const e of userEntries(readFileSync(path, 'utf8'))) {
        if (!('turnOrigin' in e)) continue;
        const key = [e.turnOrigin, e.promptSource ?? '-', e.origin?.kind ?? '-', e.wakeupSource ?? '-', e.entrypoint ?? '-', e.version ?? '-'].join(' | ');
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  console.log('turnOrigin | promptSource | origin.kind | wakeupSource | entrypoint | version: user entries');
  for (const [key, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`${key}: ${n}`);
}

async function headless() {
  const work = mkdtempSync(join(process.argv[2] || tmpdir(), 'unattended-live-'));
  const repo = join(work, 'repo');
  const probe = join(work, 'probe');
  const log = join(work, 'events.jsonl');
  mkdirSync(repo);
  mkdirSync(join(probe, '.claude-plugin'), { recursive: true });
  mkdirSync(join(probe, 'hooks'));
  writeFileSync(join(probe, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'unattended-live-probe', version: '0.0.0', description: 'logs hook events' }));
  writeFileSync(join(probe, 'hooks', 'log.mjs'), [
    "import { appendFileSync } from 'node:fs';",
    'const chunks = [];',
    "process.stdin.on('data', (c) => chunks.push(c));",
    "process.stdin.on('end', () => appendFileSync(process.env.UNATTENDED_LIVE_LOG, JSON.stringify({ at: Date.now(), event: JSON.parse(Buffer.concat(chunks).toString('utf8')) }) + '\\n'));",
  ].join('\n'));
  const command = 'node "${CLAUDE_PLUGIN_ROOT}/hooks/log.mjs"';
  writeFileSync(join(probe, 'hooks', 'hooks.json'), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command }] }], Stop: [{ hooks: [{ type: 'command', command }] }] } }));

  const child = spawn('claude', ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--plugin-dir', probe,
    '--model', 'haiku', '--max-budget-usd', '1', '--allowedTools', 'Agent'], { cwd: repo, env: { ...process.env, UNATTENDED_LIVE_LOG: log }, stdio: ['pipe', 'pipe', 'inherit'] });
  let results = 0;
  let cost = null;
  let buffer = '';
  const waiters = [];
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type === 'result') {
          results++;
          cost = event.total_cost_usd ?? cost;
        }
      } catch {
        // not an event line
      }
    }
    for (const w of waiters.splice(0)) w();
  });
  const until = async (n, ms) => {
    const deadline = Date.now() + ms;
    while (results < n && Date.now() < deadline) await new Promise((done) => { waiters.push(done); setTimeout(done, 1000); });
    return results >= n;
  };
  const send = (text) => child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n');

  send("Use the Agent tool exactly once with run_in_background true, subagent_type general-purpose, model haiku, description 'live bg', and prompt 'Reply with the single word OK and nothing else. Do not use any tools.' Then end your turn at once with the word STARTED; do not wait for it.");
  console.log(`prompt turn done: ${await until(1, 180000)}`);
  console.log(`background report turn done: ${await until(2, 240000)}`);
  send('/loop 1m Reply with the single word TICK and nothing else. Do not use any tools.');
  console.log(`/loop turn done: ${await until(3, 180000)}`);
  console.log(`/loop wake-up turn done: ${await until(4, 240000)}`);
  child.stdin.end();
  child.kill();

  const events = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const transcript = events.find((e) => e.event.transcript_path)?.event.transcript_path;
  const entries = transcript && existsSync(transcript) ? userEntries(readFileSync(transcript, 'utf8')) : [];
  console.log(`transcript: ${transcript ?? 'none'}`);
  for (const { at, event } of events.filter((e) => e.event.hook_event_name === 'UserPromptSubmit')) {
    const entry = entries.find((e) => e.promptId === event.prompt_id);
    const late = entry ? Date.parse(entry.timestamp) - at : null;
    console.log(`UserPromptSubmit prompt_id=${event.prompt_id}: turnOrigin=${entry?.turnOrigin ?? 'no entry'}, entry written ${late} ms after the hook ran`);
  }
  const fired = new Set(events.map((e) => e.event.prompt_id).filter(Boolean));
  const seen = new Set();
  for (const e of entries) {
    if (!e.promptId || seen.has(e.promptId)) continue;
    seen.add(e.promptId);
    console.log(`turn promptId=${e.promptId}: turnOrigin=${e.turnOrigin}, wakeupSource=${e.wakeupSource ?? '-'}, origin.kind=${e.origin?.kind ?? '-'}, UserPromptSubmit fired: ${fired.has(e.promptId)}`);
  }
  console.log(`version: ${entries[0]?.version ?? 'unknown'}; cost (USD): ${cost ?? 'unknown'}; logs in ${work}`);
}

// ---------- #92: a permission dialog nobody answers (PermissionRequest) ----------

const PROBE_COMMAND = 'echo sorry-matt-probe';

/** A probe plugin: PreToolUse asks for the probe command, and PermissionRequest runs this checkout's handler. */
function permissionProbe(work, after) {
  const probe = join(work, 'probe');
  const log = join(work, 'events.jsonl');
  const home = join(work, 'home');
  mkdirSync(join(probe, '.claude-plugin'), { recursive: true });
  mkdirSync(join(probe, 'hooks'), { recursive: true });
  mkdirSync(home, { recursive: true });
  const handler = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'unattended-timeout.mjs')).href;
  writeFileSync(join(probe, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'unattended-permission-probe', version: '0.0.0', description: 'times out permission dialogs' }));
  const common = [
    "import { appendFileSync } from 'node:fs';",
    `const log = (o) => appendFileSync(${JSON.stringify(log)}, JSON.stringify({ at: Date.now(), pid: process.pid, ...o }) + '\\n');`,
    'const chunks = [];',
    "process.stdin.on('data', (c) => chunks.push(c));",
  ];
  writeFileSync(join(probe, 'hooks', 'ask.mjs'), [...common,
    "process.stdin.on('end', () => {",
    "  const event = JSON.parse(Buffer.concat(chunks).toString('utf8'));",
    "  log({ phase: 'pretooluse', tool_name: event.tool_name, permission_mode: event.permission_mode });",
    `  if (String(event.tool_input?.command ?? '').includes(${JSON.stringify(PROBE_COMMAND)})) {`,
    "    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: 'unattended live probe' } }));",
    '  }',
    '});',
  ].join('\n'));
  // The handler gets a home inside the work dir, so the probe never touches this machine's real unattended state.
  writeFileSync(join(probe, 'hooks', 'permission.mjs'), [...common,
    `const { onPermissionRequest } = await import(${JSON.stringify(handler)});`,
    "process.stdin.on('end', async () => {",
    "  const raw = Buffer.concat(chunks).toString('utf8');",
    "  log({ phase: 'start', event: JSON.parse(raw) });",
    `  const out = await onPermissionRequest(raw, { ...process.env, SORRY_MATT_UNATTENDED: '', SORRY_MATT_UNATTENDED_AFTER: ${JSON.stringify(after)} }, { home: ${JSON.stringify(home)} });`,
    "  log({ phase: 'end', out });",
    '  if (out) process.stdout.write(JSON.stringify(out));',
    '});',
  ].join('\n'));
  const hook = (file, extra = {}) => ({ hooks: [{ type: 'command', command: `node "\${CLAUDE_PLUGIN_ROOT}/hooks/${file}"`, ...extra }] });
  writeFileSync(join(probe, 'hooks', 'hooks.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', ...hook('ask.mjs') }], PermissionRequest: [hook('permission.mjs', { timeout: 3700 })] } }));
  return { probe, log, home };
}

/** What the probe saw: every PermissionRequest hook process, whether it decided, and the automatic state it wrote. */
function permissionReport(work) {
  const log = join(work, 'events.jsonl');
  const events = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  console.log(`PreToolUse calls: ${events.filter((e) => e.phase === 'pretooluse').length}`);
  const starts = events.filter((e) => e.phase === 'start');
  console.log(`PermissionRequest hook runs: ${starts.length}`);
  for (const start of starts) {
    const end = events.find((e) => e.phase === 'end' && e.pid === start.pid);
    const decision = end?.out?.hookSpecificOutput?.decision;
    console.log(`  pid ${start.pid}: input fields ${Object.keys(start.event).sort().join(', ')}; tool ${start.event.tool_name}, permission_mode ${start.event.permission_mode}; ` +
      (end ? `decided after ${end.at - start.at} ms: ${decision ? decision.behavior : 'no output (answered)'}` : 'never decided: the process was ended first'));
  }
  const state = join(work, 'home', '.claude', 'sorry-matt-guard', 'unattended.json');
  console.log(`automatic state: ${existsSync(state) ? readFileSync(state, 'utf8').trim() : 'none'}`);
}

/** Headless `-p`: the probe's PreToolUse asks, and PermissionRequest should not run at all. */
async function permissionHeadless() {
  const work = mkdtempSync(join(process.argv[3] || tmpdir(), 'unattended-permission-'));
  const repo = join(work, 'repo');
  mkdirSync(repo);
  const { probe } = permissionProbe(work, '0.1');
  const run = spawn('claude', ['-p', `Use the Bash tool exactly once to run this command: ${PROBE_COMMAND} headless. Then reply DONE.`, '--plugin-dir', probe,
    '--model', 'haiku', '--max-budget-usd', '0.5', '--output-format', 'json'], { cwd: repo, stdio: ['ignore', 'pipe', 'inherit'] });
  let stdout = '';
  run.stdout.on('data', (c) => (stdout += c));
  await new Promise((done) => run.on('close', done));
  let result = {};
  try {
    result = JSON.parse(stdout);
  } catch {
    // not JSON: print what came back
  }
  console.log(`claude -p: ${result.subtype ?? stdout.trim()}; cost (USD): ${result.total_cost_usd ?? 'unknown'}`);
  permissionReport(work);
  console.log(`logs in ${work}`);
}

/** Interactive: sets up the probe and prints what a person runs and looks at. */
function permissionInteractive() {
  const work = mkdtempSync(join(process.argv[3] || tmpdir(), 'unattended-permission-'));
  const { probe } = permissionProbe(work, '0.5');
  console.log([
    'In a terminal, in a folder Claude Code already trusts, run:',
    `  claude --model haiku --plugin-dir "${probe}"`,
    `1. Ask: "Run this Bash command once: ${PROBE_COMMAND} 1". Leave the dialog alone for 30 s: it should go away by itself and the`,
    '   tool call come back denied with the sorry-matt unattended message.',
    `2. Ask: "Run this Bash command once: ${PROBE_COMMAND} 2". Answer the dialog (allow or deny) within 30 s. A run that ends`,
    '   "no output (answered)", or never decides, is what the design needs; a deny there is the known gap.',
    'Then quit and run:',
    `  node scripts/unattended.live.mjs --permission-report "${work}"`,
  ].join('\n'));
}

if (process.argv.includes('--survey')) survey();
else if (process.argv[2] === '--permission') await permissionHeadless();
else if (process.argv[2] === '--permission-interactive') permissionInteractive();
else if (process.argv[2] === '--permission-report') permissionReport(process.argv[3]);
else await headless();
