#!/usr/bin/env node
// Live test: can the spawn budget tell the run's host session from every other session in the repo?
// hooks/budget.mjs counts a spawn against a run only when the hook event's `session_id` is the session id the
// ledger records for its host (field 9, `session: <id>`). That rests on facts about Claude Code this script asks a
// real headless session about, since no unit test can:
//   1. PreToolUse(Agent) and SubagentStart carry the host session's id, also for an Agent call a subagent makes;
//   2. the host can read its own id: CLAUDE_CODE_SESSION_ID in its shell commands is that same id;
//   3. `claude --resume` and a compaction keep the id (if they did not, the ledger line would go stale).
// It spends API quota (a few cents with haiku), so it is run by hand, never in CI:
//   node scripts/host-session.live.mjs [work dir]
// It builds a throwaway git repo and a throwaway plugin whose hooks only append each event's ids to a log, so
// nothing from this checkout's hooks is loaded and no real run is touched.
//
// Result, Claude Code 2.1.328 (2026-11-20): all checks passed. Facts 1–3 hold, so budget.mjs counts and blocks
// per host session (step 2 of #109). A subagent's own Agent call is reported with the host's session_id (and the
// subagent's agent_id), so nested spawns are counted against the run as before.
// Re-run it by hand after a Claude Code upgrade that touches hooks, sessions, resume or compaction.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const work = mkdtempSync(join(process.argv[2] || tmpdir(), 'host-session-live-'));
const repo = join(work, 'repo');
const probe = join(work, 'probe');
const log = join(work, 'events.jsonl');
mkdirSync(repo);
mkdirSync(join(probe, '.claude-plugin'), { recursive: true });
mkdirSync(join(probe, 'hooks'));
const git = (...args) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
git('init', '-q');
git('-c', 'user.name=live', '-c', 'user.email=live@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'init');

writeFileSync(join(probe, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'host-session-probe', version: '0.0.0' }));
writeFileSync(
  join(probe, 'hooks', 'dump.mjs'),
  `import { appendFileSync } from 'node:fs';
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  const e = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const pick = ({ hook_event_name, session_id, agent_id, agent_type, tool_name, source, tool_input }) =>
    ({ hook_event_name, session_id, agent_id, agent_type, tool_name, source, description: tool_input && tool_input.description });
  appendFileSync(process.env.HOST_SESSION_PROBE_LOG, JSON.stringify(pick(e)) + '\\n');
});
`,
);
const dump = { hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/dump.mjs"' }] };
writeFileSync(
  join(probe, 'hooks', 'hooks.json'),
  JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Agent', ...dump }], SubagentStart: [dump], SessionStart: [dump] } }),
);

// The session running this script may itself be Claude Code: none of its session identity reaches the child.
const env = { ...process.env, HOST_SESSION_PROBE_LOG: log };
for (const key of Object.keys(env)) {
  if (key === 'CLAUDECODE' || /^CLAUDE_CODE_.*(SESSION|MESSAGING|ENTRYPOINT)/.test(key)) delete env[key];
}

const events = () =>
  existsSync(log) ? readFileSync(log, 'utf8').split(/\n/).filter(Boolean).map((l) => JSON.parse(l)) : [];

function session(name, prompt, resume) {
  const before = events().length;
  const out = spawnSync(
    'claude',
    ['-p', prompt, ...(resume ? ['--resume', resume] : []), '--plugin-dir', probe, '--model', 'haiku',
      '--max-turns', '12', '--max-budget-usd', '1', '--allowedTools', 'Bash', '--output-format', 'stream-json', '--verbose'],
    { cwd: repo, env, encoding: 'utf8', timeout: 600000, maxBuffer: 64 << 20 },
  );
  if (out.error) throw out.error;
  writeFileSync(join(work, `${name}.jsonl`), out.stdout || '');
  const stream = String(out.stdout || '').split(/\n/).filter(Boolean).map((l) => JSON.parse(l));
  const init = stream.find((e) => e.type === 'system' && e.subtype === 'init');
  const said = stream
    .filter((e) => e.type === 'user')
    .flatMap((e) => (e.message && e.message.content) || [])
    .filter((c) => c.type === 'tool_result')
    .map((c) => JSON.stringify(c.content))
    .join('\n');
  const echoed = /SID=([0-9a-f-]{36})/.exec(said);
  return { id: init && init.session_id, echoed: echoed && echoed[1], hooks: events().slice(before) };
}

const failures = [];
const expect = (ok, what) => {
  console.log(`${ok ? 'pass' : 'FAIL'}: ${what}`);
  if (!ok) failures.push(what);
};
const ECHO = `run this Bash command exactly: node -e "console.log('SID='+process.env.CLAUDE_CODE_SESSION_ID)"`;
const OK = "prompt 'Reply with the single word OK and nothing else. Do not use any tools.'";
const spawnsOf = (s) => s.hooks.filter((e) => e.hook_event_name === 'SubagentStart' || e.tool_name === 'Agent');
const allHost = (s, id) => spawnsOf(s).every((e) => e.session_id === id);

const first = session(
  'host',
  `First ${ECHO}. Then use the Agent tool exactly once with subagent_type general-purpose, model haiku, description 'outer', and prompt 'Use the Agent tool exactly once with subagent_type general-purpose, model haiku, description inner, and ${OK} Then reply with what it returned. If you have no Agent tool, reply NO-AGENT-TOOL.' Then report what it returned. Use no other tool and do not retry.`,
);
const host = first.id;
expect(Boolean(host), `the host session has an id (${host})`);
expect(first.echoed === host, `CLAUDE_CODE_SESSION_ID in a shell command is the host's id (${first.echoed})`);
const outer = first.hooks.filter((e) => e.tool_name === 'Agent' && e.description === 'outer');
const inner = first.hooks.filter((e) => e.tool_name === 'Agent' && e.description === 'inner');
expect(outer.length === 1, `the host's Agent call reached PreToolUse (saw ${outer.length})`);
expect(first.hooks.some((e) => e.hook_event_name === 'SubagentStart'), 'a SubagentStart fired');
expect(allHost(first, host), `every PreToolUse(Agent) and SubagentStart carried the host's id: ${JSON.stringify(spawnsOf(first))}`);
console.log(`note: a subagent's own Agent call ${inner.length ? `reached PreToolUse with session_id ${inner[0].session_id} and agent_id ${inner[0].agent_id}` : 'did not happen (no Agent tool in the subagent, or the model skipped it)'}`);

const resumed = session(
  'resume',
  `First ${ECHO}. Then use the Agent tool exactly once with subagent_type general-purpose, model haiku, description 'after resume', and ${OK} Use no other tool and do not retry.`,
  host,
);
expect(resumed.id === host, `--resume keeps the session id (${resumed.id})`);
expect(resumed.echoed === host, `after --resume CLAUDE_CODE_SESSION_ID is still the host's id (${resumed.echoed})`);
expect(spawnsOf(resumed).length >= 2 && allHost(resumed, host), `after --resume the spawn events carry the host's id: ${JSON.stringify(spawnsOf(resumed))}`);

const compacted = session('compact', '/compact', host);
const compactStart = compacted.hooks.filter((e) => e.hook_event_name === 'SessionStart' && e.source === 'compact');
expect(compactStart.length === 1 && compactStart[0].session_id === host, `SessionStart(compact) carries the host's id: ${JSON.stringify(compactStart)}`);

const after = session(
  'after-compact',
  `First ${ECHO}. Then use the Agent tool exactly once with subagent_type general-purpose, model haiku, description 'after compact', and ${OK} Use no other tool and do not retry.`,
  host,
);
expect(after.id === host && after.echoed === host, `after the compaction the id is unchanged (${after.id}, echoed ${after.echoed})`);
expect(spawnsOf(after).length >= 2 && allHost(after, host), `after the compaction the spawn events carry the host's id: ${JSON.stringify(spawnsOf(after))}`);

const version = spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout;
console.log(`claude ${String(version || '').trim()}; streams and events in ${work}`);
process.exit(failures.length ? 1 : 0);
