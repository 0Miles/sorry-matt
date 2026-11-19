#!/usr/bin/env node
// Live test: does the PreToolUse deny from hooks/spawns.mjs really stop an Agent spawn in Claude Code?
// Unit tests (scripts/budget.test.mjs) only show the hook prints a deny; this asks a real headless session.
// It spends API quota (a few cents with haiku), so it is run by hand, never in CI:
//   node scripts/spawn-deny.live.mjs [work dir]
// It builds a throwaway git repo (in the work dir, default the OS temp dir) whose only active run ledger has
// `budget: spawns 1`, loads this checkout as the plugin with --plugin-dir, and asks the model for two Agent calls
// in a row, then one with run_in_background. Pass: the first spawn runs and is counted, the next two come back
// as the budget deny, no second subagent starts, and the counters file still says 1.
// Never point it at a real repo: an active ledger with a low limit blocks every run's spawns in that repo.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const plugin = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(join(process.argv[2] || tmpdir(), 'spawn-deny-live-'));
const repo = join(work, 'repo');
mkdirSync(repo);
const git = (...args) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
git('init', '-q');
git('-c', 'user.name=live', '-c', 'user.email=live@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'init');
const runs = join(repo, '.git', 'sorry-matt', 'runs');
mkdirSync(runs, { recursive: true });
writeFileSync(join(runs, 'live.md'), '<!-- sorry-matt:run active -->\n# live test run\n\n9. budget\n- budget: spawns 1\n');

const OK = "prompt 'Reply with the single word OK and nothing else. Do not use any tools.'";
function session(name, prompt) {
  const out = spawnSync(
    'claude',
    ['-p', prompt, '--plugin-dir', plugin, '--model', 'haiku', '--max-turns', '8', '--max-budget-usd', '1',
      '--output-format', 'stream-json', '--verbose', '--include-hook-events'],
    { cwd: repo, encoding: 'utf8', timeout: 300000, maxBuffer: 64 << 20 },
  );
  if (out.error) throw out.error;
  writeFileSync(join(work, `${name}.jsonl`), out.stdout || '');
  const events = String(out.stdout || '').split(/\n/).filter(Boolean).map((l) => JSON.parse(l));
  const results = events
    .filter((e) => e.type === 'user')
    .flatMap((e) => e.message.content || [])
    .filter((c) => c.type === 'tool_result')
    .map((c) => ({ error: Boolean(c.is_error), text: JSON.stringify(c.content) }));
  const starts = events.filter(
    (e) => e.type === 'system' && e.subtype === 'hook_started' && /^SubagentStart/.test(e.hook_name || ''),
  ).length;
  return { results, starts };
}

const failures = [];
const expect = (ok, what) => {
  console.log(`${ok ? 'pass' : 'FAIL'}: ${what}`);
  if (!ok) failures.push(what);
};
const denied = (r) => Boolean(r && r.error && r.text.includes('sorry-matt budget blocked this spawn'));

const one = session(
  'sequential',
  `Use the Agent tool exactly twice, one call after the other (not in parallel). Each time use subagent_type general-purpose, model haiku, description 'live test N', and ${OK} Then report what each call returned. Use no other tool and do not retry a failed call.`,
);
expect(one.results.length === 2, `sequential session made two Agent calls (saw ${one.results.length})`);
expect(Boolean(one.results[0] && !one.results[0].error), 'first spawn, under the limit, ran');
expect(denied(one.results[1]), 'second spawn, at the limit, came back as the budget deny');
expect(one.starts === 1, `exactly one subagent started (saw ${one.starts} SubagentStart)`);

const bg = session(
  'background',
  `Use the Agent tool exactly once with run_in_background true, subagent_type general-purpose, model haiku, description 'live test bg', and ${OK} Then report what the call returned. Use no other tool and do not retry.`,
);
expect(denied(bg.results[0]), 'background spawn at the limit came back as the budget deny');
expect(bg.starts === 0, `no background subagent started (saw ${bg.starts} SubagentStart)`);

const counters = JSON.parse(readFileSync(join(runs, 'live.counters.json'), 'utf8'));
expect(counters.spawns === 1, `counters file says 1 spawn (says ${counters.spawns})`);

const version = spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout;
console.log(`claude ${String(version || '').trim()}; streams in ${work}`);
process.exit(failures.length ? 1 : 0);
