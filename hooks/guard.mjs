#!/usr/bin/env node
// PreToolUse hook entry: the event on stdin, an ask or deny decision on stdout or nothing. Only an entry
// point — the logic lives in decision.mjs — so it runs whatever path it was started from.
import { decide } from './decision.mjs';

const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  const out = decide(Buffer.concat(chunks).toString('utf8'));
  if (out) process.stdout.write(JSON.stringify(out));
});
