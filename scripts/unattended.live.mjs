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
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

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

if (process.argv.includes('--survey')) survey();
else await headless();
