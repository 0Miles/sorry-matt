#!/usr/bin/env node
// SessionStart(compact) hook entry: the event on stdin, a plain-text reminder on stdout or nothing.
// Claude Code adds a SessionStart hook's plain-text stdout to the context. Only an entry point —
// the logic lives in runs.mjs — and it always exits 0: a reminder hook never blocks a session.
import { respond } from './runs.mjs';

const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  const out = respond(Buffer.concat(chunks).toString('utf8'));
  if (out) process.stdout.write(out);
});
