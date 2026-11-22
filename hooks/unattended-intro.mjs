#!/usr/bin/env node
// SessionStart hook entry: prints, as plain text Claude Code adds to the context, the one line that enters
// unattended mode for this plugin root (decision.mjs `enterIntro`). Nothing with the guard off. Only an entry
// point, and it always exits 0: an intro hook never blocks a session.
import { enterIntro, guardOff, pluginRoot } from './decision.mjs';

process.stdin.resume();
process.stdin.on('data', () => {});
process.stdin.on('end', () => {
  if (guardOff()) return;
  process.stdout.write(`${enterIntro(pluginRoot())}\n`);
});
