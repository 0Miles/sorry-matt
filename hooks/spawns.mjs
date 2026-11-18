#!/usr/bin/env node
// PreToolUse(Agent) and SubagentStart hook entry: the event on stdin; for PreToolUse a deny decision on
// stdout or nothing, for SubagentStart nothing (it only counts). Only an entry point — the logic lives
// in budget.mjs — and it always exits 0: a counting error is reported on stderr, never as a block.
import { handle, countSpawn } from './budget.mjs';

const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  const raw = Buffer.concat(chunks).toString('utf8');
  let event = null;
  try {
    event = JSON.parse(raw);
  } catch {
    // handle() lets an unreadable event through
  }
  if (event && event.hook_event_name === 'SubagentStart') {
    for (const { ledger, error } of countSpawn(event)) {
      if (error) process.stderr.write(`sorry-matt budget could not count this subagent for ${ledger}: ${error}\n`);
    }
    return;
  }
  const out = handle(raw);
  if (out) process.stdout.write(JSON.stringify(out));
});
