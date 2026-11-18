#!/usr/bin/env node
// Verify every vendored upstream file against the SHA-256 pinned in its NOTICE.md.
// Hashes are taken over LF-normalized content, matching `git show HEAD:<path> | sha256sum`.
// NOTICE.md lists one entry per file: - `<local file>` ← `<upstream path>`: `<SHA-256>`
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLF, sha256LF, listDirs, listFiles, report } from './lib.mjs';

export function parseNotice(text) {
  const entries = [];
  for (const m of text.matchAll(/^\s*-\s*`([^`]+)`\s*←\s*`([^`]+)`:\s*`([0-9A-Fa-f]{64})`/gm)) {
    entries.push({ local: m[1], upstream: m[2], hash: m[3].toUpperCase() });
  }
  return entries;
}

export function checkVendoredDir(dir, label) {
  const problems = [];
  const files = listFiles(dir).filter((f) => f !== 'NOTICE.md');
  if (files.length === 0) return problems;
  const noticePath = join(dir, 'NOTICE.md');
  if (!existsSync(noticePath)) return [`${label}: vendored files without NOTICE.md`];
  const notice = readLF(noticePath);
  if (!/^- Pin: /m.test(notice)) problems.push(`${label}/NOTICE.md: no "- Pin:" line`);
  if (!/^- Source: /m.test(notice)) problems.push(`${label}/NOTICE.md: no "- Source:" line`);
  if (!/License/.test(notice)) problems.push(`${label}/NOTICE.md: no license text`);
  const entries = parseNotice(notice);
  for (const f of files) {
    const entry = entries.find((e) => e.local === f);
    if (!entry) {
      problems.push(`${label}/${f}: no pinned hash in NOTICE.md`);
      continue;
    }
    const actual = sha256LF(join(dir, f));
    if (actual !== entry.hash) problems.push(`${label}/${f}: SHA-256 ${actual} does not match pinned ${entry.hash}`);
  }
  for (const e of entries.filter((e) => !files.includes(e.local))) {
    problems.push(`${label}/NOTICE.md: pins ${e.local}, which does not exist`);
  }
  return problems;
}

export function checkRepo(root) {
  const problems = [];
  for (const tree of ['src/skills', 'skills']) {
    for (const skill of listDirs(join(root, tree))) {
      const rel = `${tree}/${skill}/references/upstream`;
      problems.push(...checkVendoredDir(join(root, rel), rel));
    }
  }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..'));
  process.exit(report('vendored SHA-256', checkRepo(root)));
}
