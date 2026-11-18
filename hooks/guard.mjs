#!/usr/bin/env node
// PreToolUse hook: deny permanent exceptions (ASKING.md section 5) and merges around `gh pr merge`.
// Reads the hook event on stdin and prints a deny decision, or nothing to let the call through.
// It fails closed: an event it cannot read is denied, so a broken guard is loud, not silent.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, CATEGORIES } from './permanent-exceptions.mjs';

export function reason({ category, detail }) {
  if (category === 'merge-bypass') {
    return `sorry-matt guard: \`${detail}\` routes a merge around the permission check. Merge only with plain \`gh pr merge\` (no \`--admin\`), so Claude Code's permission settings decide; if that is blocked, put the merge on the human-work list with the permission rule that would allow it. Do not try another route.`;
  }
  return `sorry-matt guard: \`${detail}\` is a permanent exception (${CATEGORIES[category]}). No permission rule or instruction in this session unlocks it, and other spellings of the same call are blocked too. Do not retry: put it on the human-work list with the exact command and carry on with everything else. The user can run it themselves.`;
}

export function decide(raw) {
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return deny('sorry-matt guard could not read this tool call, so it is blocked. Report it as a guard error.');
  }
  try {
    const verdict = classify(event);
    return verdict ? deny(reason(verdict)) : null;
  } catch (error) {
    return deny(`sorry-matt guard failed on this tool call (${error.message}), so it is blocked. Report it as a guard error.`);
  }
}

const deny = (text) => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: text },
});

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const chunks = [];
  process.stdin.on('data', (c) => chunks.push(c));
  process.stdin.on('end', () => {
    const out = decide(Buffer.concat(chunks).toString('utf8'));
    if (out) process.stdout.write(JSON.stringify(out));
  });
}
