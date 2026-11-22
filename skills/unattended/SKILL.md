---
name: unattended
description: Toggle the sorry-matt guard's unattended mode by hand with on, off or status; no argument flips it
disable-model-invocation: true
---

# unattended: Toggle unattended mode by hand

You do not do the toggling. When the user types `/sorry-matt:unattended [on|off|status]`, the plugin's
`UserPromptExpansion` hook has already run before the command expanded, and it hands you its result as additional
context. You only relay it.

1. Look in the context for a hook result that starts with `[sorry-matt unattended]`. When there is one, relay it to
   the user as it stands: what was done, what was not and why, which sources still hold, and what the user has to do
   themselves (such as removing `SORRY_MATT_UNATTENDED` from the `env` of their settings, or running
   `rm ~/.claude/sorry-matt-unattended` in a terminal). When the result carries the blocked list, list every item in
   full (session, time, command, reason) and leave it to the user whether to run them; do not rerun anything on the
   list yourself.
2. When the result says this turn's entry was not written yet and it will be decided when the turn ends, say so.
   When the turn ends the hook hands the decision back, and you relay it as in step 1.
3. When the context holds no hook result starting with `[sorry-matt unattended]`, tell the user the toggle did not
   run: the plugin's hooks are not loaded, or the guard is turned off with `SORRY_MATT_GUARD=off`. Then give the
   switch-file commands for the user to run in a terminal themselves:

   ```bash
   touch ~/.claude/sorry-matt-unattended   # on
   rm ~/.claude/sorry-matt-unattended      # off
   ```

In every case, never create, delete, rewrite or move the switch file `~/.claude/sorry-matt-unattended` or the
automatic state file `~/.claude/sorry-matt-guard/unattended.json` yourself, and do not change settings: only the user
toggles unattended mode.

Done when: the user knows the outcome of this toggle — a faithful relay of the hook result, including the full
blocked list, when there is one; otherwise that the toggle did not run, why, and the `touch` / `rm` commands; and you
created, deleted or rewrote no file.
