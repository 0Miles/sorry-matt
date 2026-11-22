#!/usr/bin/env node
// PermissionRequest hook entry: the event on stdin, a deny decision on stdout or nothing. Only an entry point —
// the logic lives in unattended-timeout.mjs — so it runs whatever path it was started from.
import { onPermissionRequest } from './unattended-timeout.mjs';

const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', async () => {
  const out = await onPermissionRequest(Buffer.concat(chunks).toString('utf8'));
  if (out) process.stdout.write(JSON.stringify(out));
});
