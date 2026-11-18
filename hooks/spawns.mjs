#!/usr/bin/env node
// PreToolUse(Agent) and SubagentStart hook entry: the event on stdin, a deny decision on stdout or nothing,
// warnings on stderr. Only an entry point — the logic lives in budget.mjs — and it always exits 0: a counting
// error is reported, never turned into a block.
import { handle } from './budget.mjs';

const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  const { decision, warnings } = handle(Buffer.concat(chunks).toString('utf8'));
  for (const warning of warnings) process.stderr.write(`${warning}\n`);
  if (decision) process.stdout.write(JSON.stringify(decision));
});
