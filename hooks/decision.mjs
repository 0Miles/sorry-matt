// From a raw PreToolUse event to the hook's answer: a deny decision, or null to stay out of the way.
// It fails closed: an event it cannot read is denied, so a broken guard is loud, not silent.
import { classify, CATEGORIES } from './permanent-exceptions.mjs';

// Modes where no person confirms a call before it runs, so a merge would be the mode's decision.
const UNATTENDED = new Set(['bypassPermissions', 'auto']);

export function reason({ category, detail }, mode) {
  if (category === 'merge') {
    return `sorry-matt guard blocked \`${detail}\`: in ${mode} mode nobody confirms a merge, so the mode would be deciding it. Leave the merge to the user (they merge it, or rerun it in a mode with permission prompts) and carry on with everything else.`;
  }
  if (category === 'merge-bypass') {
    return `sorry-matt guard blocked \`${detail}\`: it lands changes on a protected branch without going through \`gh pr merge\`, so it skips the permission check. Use plain \`gh pr merge\` and let Claude Code's permission settings decide; if that is blocked, tell the user which permission rule would allow it. Do not try another route.`;
  }
  return `sorry-matt guard blocked \`${detail}\`: ${CATEGORIES[category]} is something an agent never does on its own. Do not retry it with another command. Tell the user what you meant to do and the exact command, so they can run it themselves, and carry on with everything else. (The user can turn this guard off by setting SORRY_MATT_GUARD=off under "env" in their Claude Code settings.)`;
}

/**
 * @param {string} raw the event JSON from stdin
 * @param {Record<string, string | undefined>} env the hook process environment
 */
export function decide(raw, env = process.env) {
  if (String(env.SORRY_MATT_GUARD || '').toLowerCase() === 'off') return null;
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return deny('sorry-matt guard could not read this tool call, so it is blocked. Report it to the user as a guard error.');
  }
  try {
    const verdict = classify(event);
    if (!verdict) return null;
    const mode = event.permission_mode || 'default';
    if (verdict.category === 'merge') {
      return UNATTENDED.has(mode) ? deny(reason(verdict, mode)) : null;
    }
    return deny(reason(verdict, mode));
  } catch (error) {
    return deny(`sorry-matt guard failed on this tool call (${error.message}), so it is blocked. Report it to the user as a guard error.`);
  }
}

const deny = (text) => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: text },
});
