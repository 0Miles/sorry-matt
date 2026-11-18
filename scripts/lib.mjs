// Shared helpers for the repo checks. No dependencies: runs on a bare Node 20+.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

// Working trees may check files out as CRLF (core.autocrlf); every comparison and hash uses LF.
export const readLF = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

export const sha256LF = (path) => createHash('sha256').update(readLF(path), 'utf8').digest('hex').toUpperCase();

export const isDir = (path) => existsSync(path) && statSync(path).isDirectory();

export const listDirs = (path) =>
  isDir(path) ? readdirSync(path).filter((name) => isDir(join(path, name))).sort() : [];

// Every file under `root`, as forward-slash paths relative to it.
export function listFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(root, full).split(sep).join('/'));
    }
  };
  if (isDir(root)) walk(root);
  return out;
}

export function frontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split('\n')) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return fields;
}

// Lines outside fenced code blocks, so a `# comment` in a bash block is not read as a heading.
export function proseLines(text) {
  const out = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) out.push(line);
  }
  return out;
}

export function report(name, problems) {
  if (problems.length === 0) {
    console.log(`${name}: all green`);
    return 0;
  }
  console.error(`${name}: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  - ${p}`);
  return 1;
}
