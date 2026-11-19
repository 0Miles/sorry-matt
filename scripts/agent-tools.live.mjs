#!/usr/bin/env node
// Live test: what does the `tools:` line of a plugin agent definition give the agent in Claude Code? (#104, #82)
// prove-it's review agents (agents/finder.md, architect.md, verifier.md, fix-verifier.md) and the expansion agent rest
// on facts no unit test can show, so this asks real headless sessions:
//   1. A definition's `tools:` line is the agent's whole tool set: the review definitions give no Edit and no Write
//      tool, and a spawned agent whose `tools:` line has neither cannot call them (a control agent that has them can).
//      They keep a shell, which can still write files: what this proves is "no Edit and Write tool", never read-only.
//   2. `${CLAUDE_PLUGIN_ROOT}` in a definition's body is replaced by the plugin's directory, so the body can point at a
//      file inside the plugin (agents/fix-verifier.md reads agents/verifier.md that way).
//   3. In a session that has the PowerShell tool and no Bash tool (simulated with --tools), a definition whose only
//      shell is `Bash` gets no shell at all, silently; one that lists both shells gets PowerShell. A listed tool the
//      session lacks is dropped without an error, so listing both is safe where only one exists. (From #74.)
// Facts 1 and 3 are read two ways: deterministically, from the tool list of the `system/init` event of a one-turn
// session run as the agent (`--agent`), and on a real spawn, from a hook that logs every tool call of the subagent.
// The spawn checks use throwaway copies of the definitions' `tools:` lines with a neutral body, so a refusal written
// in a real body cannot pass for a missing tool.
// It spends API quota (well under a dollar with haiku), so it is run by hand, never in CI:
//   node scripts/agent-tools.live.mjs [work dir]
// It builds a throwaway git repo and a throwaway probe plugin; this checkout is loaded with --plugin-dir only for the
// one-turn `--agent` sessions. The PowerShell-only checks need the PowerShell tool, so they run on Windows only.
//
// Result, Claude Code 2.1.328 (2026-11-20, Windows 11): all 46 checks passed, $0.036 with haiku. Facts 1–3 hold.
// The review definitions resolve to Read, Glob, Grep and whichever shells the session has, never Edit or Write; the
// spawned copy of their `tools:` line made no Edit or Write call, left the file alone and replied that both tools were
// missing, while the control agent edited and created its files. A body's `${CLAUDE_PLUGIN_ROOT}` became the probe
// plugin's directory. With PowerShell and no Bash, a `tools: Read, Bash` agent resolved to Read alone and replied
// NO-SHELL; the review line ran PowerShell. That is why every definition lists both shells (#82, from #74).
// agents/architect.md (#105) came after that run. Its `tools:` line is the other three's, word for word, so the spawn
// checks above (which use a copy of the line, not the body) already cover it; its own `--agent` resolution checks run
// from the next run on.
// Re-run it by hand after a Claude Code upgrade that touches agents, tools or plugins, and after changing a
// definition's `tools:` line.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const plugin = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(join(process.argv[2] || tmpdir(), 'agent-tools-live-'));
const repo = join(work, 'repo');
const probe = join(work, 'probe');
const log = join(work, 'events.jsonl');
const windows = process.platform === 'win32';
mkdirSync(repo);
for (const dir of ['.claude-plugin', 'agents', 'hooks']) mkdirSync(join(probe, dir), { recursive: true });
const git = (...args) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
git('init', '-q');
git('-c', 'user.name=live', '-c', 'user.email=live@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'init');

const REVIEW = ['finder', 'architect', 'verifier', 'fix-verifier'];
const toolsLine = (name) => {
  const m = /^tools:\s*(.*)$/m.exec(readFileSync(join(plugin, 'agents', `${name}.md`), 'utf8').replace(/\r\n/g, '\n'));
  return m ? m[1].trim() : null;
};
const reviewTools = [...new Set(REVIEW.map(toolsLine))];

// The probe plugin: neutral-bodied agents, a file only its own directory holds, and a hook that logs every tool call.
const secret = `probe-${randomUUID()}`;
writeFileSync(join(probe, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'agent-tools-probe', version: '0.0.0' }));
writeFileSync(join(probe, 'probe-secret.txt'), `${secret}\n`);
const NEUTRAL = 'You are a probe agent for a tool-availability test in a throwaway repository. Do exactly what the prompt says.';
const agent = (name, tools, body = NEUTRAL) =>
  writeFileSync(join(probe, 'agents', `${name}.md`), `---\nname: ${name}\ndescription: Probe agent of a live test. Not for general delegation.\ntools: ${tools}\n---\n\n${body}\n`);
reviewTools.forEach((tools, i) => agent(`review-${i}`, tools));
agent('writer', 'Read, Edit, Write');
agent('bash-only', 'Read, Bash');
agent('root', 'Read', 'Use the Read tool on the file ${CLAUDE_PLUGIN_ROOT}/probe-secret.txt and reply with its first line only. If the read fails, reply READ-FAILED and the path you tried.');
writeFileSync(
  join(probe, 'hooks', 'dump.mjs'),
  `import { appendFileSync } from 'node:fs';
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  const { hook_event_name, agent_id, agent_type, tool_name } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  appendFileSync(process.env.AGENT_TOOLS_PROBE_LOG, JSON.stringify({ hook_event_name, agent_id, agent_type, tool_name }) + '\\n');
});
`,
);
const dump = { hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/dump.mjs"' }] };
writeFileSync(join(probe, 'hooks', 'hooks.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: '*', ...dump }], SubagentStart: [dump] } }));

// The session running this script may itself be Claude Code: none of its session identity reaches the child.
const env = { ...process.env, AGENT_TOOLS_PROBE_LOG: log };
for (const key of Object.keys(env)) {
  if (key === 'CLAUDECODE' || /^CLAUDE_CODE_.*(SESSION|MESSAGING|ENTRYPOINT)/.test(key)) delete env[key];
}
const events = () => (existsSync(log) ? readFileSync(log, 'utf8').split(/\n/).filter(Boolean).map((l) => JSON.parse(l)) : []);

let runs = 0;
function claude(name, args) {
  const out = spawnSync('claude', [...args, '--model', 'haiku', '--max-budget-usd', '1', '--output-format', 'stream-json', '--verbose'], {
    cwd: repo, env, encoding: 'utf8', timeout: 600000, maxBuffer: 64 << 20, input: '',
  });
  if (out.error) throw out.error;
  writeFileSync(join(work, `${String(++runs).padStart(2, '0')}-${name}.jsonl`), out.stdout || '');
  return String(out.stdout || '').split(/\n/).filter(Boolean).map((l) => JSON.parse(l));
}

// The tool set an agent type resolves to, under a session tool pool (`--tools`; null keeps the default pool).
function resolved(type, pool, pluginDir) {
  const stream = claude(`as-${type.replace(/\W+/g, '-')}-${pool ? pool.replace(/\W+/g, '-') : 'default'}`, [
    '-p', 'Reply with the single word OK. Use no tools.', '--plugin-dir', pluginDir, '--agent', type, '--max-turns', '1',
    ...(pool ? ['--tools', pool] : []),
  ]);
  const init = stream.find((e) => e.type === 'system' && e.subtype === 'init') || {};
  return { tools: init.tools || [], known: (init.agents || []).includes(type) };
}

// One host session that spawns one agent in the foreground; returns the tool calls that agent made and its reply.
function spawned(name, type, prompt, pool) {
  const before = events().length;
  const stream = claude(name, [
    '-p', `Use the Agent tool exactly once, in the foreground (run_in_background false), with subagent_type ${type}, description 'probe ${name}', and this prompt verbatim: ${JSON.stringify(prompt)} When it returns, print its reply verbatim and stop. Use no other tool and do not retry.`,
    '--plugin-dir', probe, '--max-turns', '6', '--allowedTools', 'Read', 'Edit', 'Write', 'Bash', 'PowerShell', 'Agent',
    ...(pool ? ['--tools', pool] : []),
  ]);
  const mine = events().slice(before);
  const id = (mine.find((e) => e.hook_event_name === 'SubagentStart' && e.agent_type === type) || {}).agent_id;
  const calls = mine.filter((e) => e.hook_event_name === 'PreToolUse' && id && e.agent_id === id).map((e) => e.tool_name);
  const reply = stream
    .filter((e) => e.type === 'user' && !e.parent_tool_use_id)
    .flatMap((e) => (e.message && e.message.content) || [])
    .filter((c) => c.type === 'tool_result')
    .map((c) => JSON.stringify(c.content))
    .join('\n');
  return { started: Boolean(id), calls, reply };
}

const failures = [];
const expect = (ok, what) => {
  console.log(`${ok ? 'pass' : 'FAIL'}: ${what}`);
  if (!ok) failures.push(what);
};
const has = (tools, t) => tools.includes(t);
const shells = (tools) => tools.filter((t) => t === 'Bash' || t === 'PowerShell');

// 1. Resolution of the real definitions, as `--agent` sessions with this checkout loaded.
const pools = [[null, 'default pool']];
if (windows) {
  pools.push(['Read,Glob,Grep,PowerShell,Edit,Write', 'PowerShell-only pool']);
  pools.push(['Read,Glob,Grep,Bash,Edit,Write', 'Bash-only pool']);
}
for (const name of [...REVIEW, 'expander']) {
  for (const [pool, label] of pools) {
    const r = resolved(`sorry-matt:${name}`, pool, plugin);
    const review = REVIEW.includes(name);
    expect(r.known, `${label}: sorry-matt:${name} is a known agent type`);
    expect(review ? !has(r.tools, 'Edit') && !has(r.tools, 'Write') : has(r.tools, 'Edit') && has(r.tools, 'Write'),
      `${label}: sorry-matt:${name} ${review ? 'has no Edit and no Write tool' : 'has Edit and Write'} (${r.tools.join(', ')})`);
    expect(shells(r.tools).length > 0, `${label}: sorry-matt:${name} has a shell (${shells(r.tools).join(', ') || 'none'})`);
  }
}

// 3a. The old expander line had Bash as its only shell: what such a definition resolves to without a Bash tool.
if (windows) {
  const r = resolved('agent-tools-probe:bash-only', 'Read,Glob,Grep,PowerShell,Edit,Write', probe);
  expect(r.known && shells(r.tools).length === 0, `PowerShell-only pool: a definition with only Bash gets no shell (${r.tools.join(', ')})`);
}

// 1. Enforcement on a real spawn: the review tools line cannot call Edit or Write; the control agent can.
const edit = (file, created) =>
  `Call the Edit tool on ${join(repo, file)} to replace the word original with edited. Then call the Write tool to create ${join(repo, created)} containing the word new. If Edit or Write is not among your tools, do not use any other tool in its place: reply MISSING and the tool's name. Then list the names of every tool you have.`;
writeFileSync(join(repo, 'control.txt'), 'original\n');
const control = spawned('writer', 'agent-tools-probe:writer', edit('control.txt', 'control-new.txt'));
expect(control.started && has(control.calls, 'Edit') && has(control.calls, 'Write'), `control: an agent with Edit and Write calls them (${control.calls.join(', ')})`);
expect(readFileSync(join(repo, 'control.txt'), 'utf8').includes('edited') && existsSync(join(repo, 'control-new.txt')), 'control: its edit and new file landed');
reviewTools.forEach((tools, i) => {
  writeFileSync(join(repo, `review-${i}.txt`), 'original\n');
  const r = spawned(`review-${i}`, `agent-tools-probe:review-${i}`, edit(`review-${i}.txt`, `review-${i}-new.txt`));
  expect(r.started, `review tools line "${tools}": the agent started`);
  expect(!has(r.calls, 'Edit') && !has(r.calls, 'Write'), `review tools line "${tools}": no Edit or Write call (${r.calls.join(', ') || 'no calls'})`);
  expect(readFileSync(join(repo, `review-${i}.txt`), 'utf8') === 'original\n' && !existsSync(join(repo, `review-${i}-new.txt`)), `review tools line "${tools}": the file is unchanged and nothing was created`);
});

// 2. `${CLAUDE_PLUGIN_ROOT}` in a definition body.
const root = spawned('root', 'agent-tools-probe:root', 'Follow your instructions.');
expect(root.started && has(root.calls, 'Read'), `root: the agent read a file (${root.calls.join(', ')})`);
expect(root.reply.includes(secret), 'root: its reply holds the token of the file inside the plugin, so ${CLAUDE_PLUGIN_ROOT} was replaced');

// 3b. Spawns in a session with PowerShell and no Bash.
if (windows) {
  const RUN = 'Run git --version with a shell tool and reply with its output. If you have no shell tool, reply NO-SHELL and use no other tool.';
  const pool = 'Agent,Read,Glob,Grep,PowerShell';
  const bash = spawned('bash-only-ps-session', 'agent-tools-probe:bash-only', RUN, pool);
  expect(bash.started && shells(bash.calls).length === 0, `PowerShell-only session: a spawned agent with only Bash makes no shell call (${bash.calls.join(', ') || 'no calls'})`);
  reviewTools.forEach((tools, i) => {
    const r = spawned(`review-${i}-ps-session`, `agent-tools-probe:review-${i}`, RUN, pool);
    expect(r.started && has(r.calls, 'PowerShell'), `PowerShell-only session: review tools line "${tools}" runs PowerShell (${r.calls.join(', ') || 'no calls'})`);
  });
} else {
  console.log('skip: the PowerShell-only checks need the PowerShell tool (Windows)');
}

const version = spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout;
console.log(`claude ${String(version || '').trim()} on ${process.platform}; streams and events in ${work}`);
process.exit(failures.length ? 1 : 0);
