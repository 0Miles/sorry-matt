// node --test scripts/guard.test.mjs
// The PreToolUse guard in hooks/: it denies outright a recursive delete of the filesystem root, a system directory or
// the home directory, and deleting or force-pushing the remote main or master branch, read from plain command text.
// Everything else gets no answer and is left to Claude Code's permission settings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { classify } from '../hooks/classify.mjs';
import { decide } from '../hooks/decision.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const event = (tool_name, command) => JSON.stringify({ hook_event_name: 'PreToolUse', tool_name, tool_input: { command }, cwd: root, session_id: 's1' });
const decision = (tool, command, env = {}) => decide(event(tool, command), env)?.hookSpecificOutput ?? null;
const denied = (tool, command) => decision(tool, command)?.permissionDecision === 'deny';

const DELETES = {
  Bash: ['rm -rf /', 'rm -rf /*', 'rm -fr ~', 'rm -rf ~/', 'rm -rf $HOME', 'rm -rf "$HOME"', 'rm -r --force ${HOME}/', 'sudo rm -rf /', 'rm -rf /etc', 'rm -rf /usr/', 'rm -rf /c/', 'rm -rf /c/Windows', 'cd /tmp && rm -rf /'],
  PowerShell: ['Remove-Item -Recurse -Force C:\\Windows', 'Remove-Item -Recurse C:\\', 'Remove-Item -Path C:\\ -Recurse -Force', 'ri -r -fo "C:\\Program Files"', 'Remove-Item -Recurse -Force $env:USERPROFILE', 'Remove-Item -Recurse $HOME', 'rd /s /q C:\\', 'Remove-Item -Recurse -Force C:\\Users'],
};
const PUSHES = {
  Bash: ['git push origin --delete main', 'git push origin :main', 'git push -d origin master', 'git push origin :refs/heads/master', 'git push --force origin main', 'git push -f origin master', 'git push --force-with-lease origin main', 'git push origin +main', 'git push origin HEAD:main --force', 'git -C repo push -f origin main'],
};
PUSHES.PowerShell = PUSHES.Bash;

for (const [tool, commands] of Object.entries(DELETES)) {
  test(`${tool}: a recursive delete of the root, a system directory or the home directory is denied`, () => {
    for (const command of commands) assert.ok(denied(tool, command), command);
  });
}

for (const [tool, commands] of Object.entries(PUSHES)) {
  test(`${tool}: deleting or force-pushing the remote main or master is denied`, () => {
    for (const command of commands) assert.ok(denied(tool, command), command);
  });
}

test('the home directory spelled as its absolute path is denied', () => {
  assert.ok(denied('Bash', `rm -rf "${homedir().replace(/\\/g, '/')}"`));
  assert.ok(denied('PowerShell', `Remove-Item -Recurse -Force "${homedir()}"`));
});

test('the deny says what it would wipe and that it is not to be retried', () => {
  const out = decision('Bash', 'rm -rf ~');
  assert.equal(out.hookEventName, 'PreToolUse');
  assert.equal(out.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /家目錄/);
  assert.match(out.permissionDecisionReason, /不要換一種寫法重試/);
  assert.match(decision('Bash', 'git push -f origin main').permissionDecisionReason, /強制推送遠端的 main/);
  assert.match(decision('Bash', 'git push origin :master').permissionDecisionReason, /刪除遠端的 master/);
});

test('common commands are allowed: no answer at all', () => {
  const bash = [
    'git push origin feature-x', 'git push --force origin feature-x', 'git push -f origin HEAD:feature-x', 'git push origin main', 'git push',
    'git push origin --delete feature-x', 'git push origin :feature-x', 'git commit -m "rm -rf /"', 'echo rm -rf /',
    'rm -rf node_modules', 'rm -rf ./build', 'rm -rf /tmp/build', 'rm -rf /etc/nginx/sites-enabled/old', 'rm ~/notes.txt', 'rm -rf ~/projects/old',
    'npm publish', 'gh pr merge 1', 'git status', 'ls /',
  ];
  for (const command of bash) assert.equal(decision('Bash', command), null, command);
  for (const command of ['Remove-Item -Recurse .\\dist', 'Remove-Item -Recurse -Force C:\\Windows\\Temp\\x', 'Remove-Item C:\\', 'npm publish', 'gh pr merge 1']) {
    assert.equal(decision('PowerShell', command), null, command);
  }
});

test('other tools pass through, and so does the opt-out', () => {
  for (const tool_name of ['Write', 'Edit', 'Read', 'Agent', 'AskUserQuestion', 'mcp__gmail__send_email']) {
    const raw = JSON.stringify({ tool_name, tool_input: { command: 'rm -rf /', file_path: '/etc/passwd' } });
    assert.equal(decide(raw, {}), null, tool_name);
    assert.deepEqual(classify(JSON.parse(raw)), [], tool_name);
  }
  assert.equal(decision('Bash', 'rm -rf /', { SORRY_MATT_GUARD: 'off' }), null);
});

test('a plain push to main gets no verdict and is let through', () => {
  assert.deepEqual(classify({ tool_name: 'Bash', tool_input: { command: 'git -C /repo push -u origin main' } }), []);
  assert.equal(decision('Bash', 'git -C /repo push -u origin main'), null);
  assert.deepEqual(classify({ tool_name: 'Bash', tool_input: { command: 'git push -u origin run/line-a' } }), []);
});

test('an event it cannot read is denied', () => {
  assert.equal(decide('not json', {}).hookSpecificOutput.permissionDecision, 'deny');
});

test('the hook entry denies end to end', () => {
  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: root };
  delete env.SORRY_MATT_GUARD;
  const run = (command) => spawnSync(process.execPath, [join(root, 'hooks/guard.mjs')], { input: event('Bash', command), encoding: 'utf8', env });
  const deny = run('rm -rf /');
  assert.equal(deny.status, 0, deny.stderr);
  assert.equal(JSON.parse(deny.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const allow = run('git status');
  assert.equal(allow.status, 0, allow.stderr);
  assert.equal(allow.stdout, '');
});

test('hooks.json wires the guard to Bash and PowerShell only', () => {
  const config = JSON.parse(readFileSync(join(root, 'hooks/hooks.json'), 'utf8'));
  const entry = config.hooks.PreToolUse.find((e) => e.hooks.some((h) => h.command.includes('hooks/guard.mjs')));
  assert.ok(entry, 'PreToolUse has the guard');
  const matcher = new RegExp(`^(${entry.matcher})$`);
  for (const tool of ['Bash', 'PowerShell']) assert.ok(matcher.test(tool), tool);
  for (const tool of ['Agent', 'Write', 'Edit', 'AskUserQuestion', 'mcp__gmail__send_email']) assert.ok(!matcher.test(tool), tool);
  assert.deepEqual(Object.keys(config.hooks).sort(), ['PreToolUse', 'SessionStart', 'SubagentStart']);
});
