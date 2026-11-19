#!/usr/bin/env node
// scope: what prove-it's live run covers for one ticket — the affected scope, or the full suite when nothing else will
// run it before the line finishes. No dependencies: runs on a bare Node 20+. Run it at the root of the review worktree.
//
// Usage
//   node scope.mjs --base <fixed-point> [--head <ref>] [--ci covered|uncovered|no-origin]
//
// --ci   Whether CI runs the line's integration branch, as the caller knows it:
//          covered     it does (a get-to-work line that has `origin` and was not ruled otherwise)
//          uncovered   get-to-work ruled "CI does not cover the integration branch" for this line
//          no-origin   the repository has no `origin`, so nothing is pushed and no CI runs
//        Omitted: no-origin when `git remote get-url origin` fails, else covered (`ciSource` says which).
// scope  full when --ci is uncovered or no-origin: no one else runs the full suite before the line finishes.
//        affected otherwise: typecheck, the tests that cover the changed files, the lint of the changed files.
// source Read from docs/agents/commands.md on head (the project command contract):
//          full      its `## Full checks` commands (the lines of the section's first fenced block, `#` comments left
//                    out); source commands.md. No contract, no such section, or `none`: commands is null, source
//                    self-found — the reviewer finds them in the manifest and the CI config.
//          affected  its `## Targeted checks` section, verbatim in `targeted`; source commands.md. No contract, no
//                    such section, or `none`: targeted is null, source self-found — the reviewer derives the
//                    narrowed commands itself. Either way the reviewer picks the commands; `tests` only helps.
// tests  Test files on head that a narrowed run should include (candidates, not a verdict): every changed test file
//        (reason changed), and every test file whose text names a changed non-test, non-doc file (reason references,
//        `via` lists those files): the file name with its extension, a quoted module path ending in its stem
//        (`'./tier'`, `"../lib/tier"`), or a Python `from`/`import` of it. A test file is a path under test/, tests/,
//        __tests__/, spec/ or specs/, or named *.test.*, *.spec.*, *_test.*, test_*.py, *Test(s).<java|kt|cs|swift|
//        scala|php>. Documentation (tier.mjs's DOC_EXTENSIONS) is never a test file.
//
// Output (stdout, JSON; fields are only ever added, never renamed)
//   { "format": "sorry-matt/live-scope@1", "base", "head", "ci", "ciSource": "caller" | "origin-check",
//     "scope": "affected" | "full", "source": "commands.md" | "self-found", "commands": [lines] | null,
//     "targeted": "<section text>" | null, "changed": [paths], "tests": [{ "path", "reason", "via": [paths] }] }
//
// Exit codes: 0 done, 1 git failed (not a repository, a ref that does not resolve), 2 usage (a missing or unknown
// argument, an unknown --ci value).
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDoc, CONTRACT } from './tier.mjs';

export const FORMAT = 'sorry-matt/live-scope@1';
export const CI_VALUES = ['covered', 'uncovered', 'no-origin'];

class UsageError extends Error {}

const TEST_PATH = [
  /(^|\/)(test|tests|__tests__|spec|specs)\//,
  /\.(test|spec)\.[^/]+$/,
  /_test\.[^/.]+$/,
  /(^|\/)test_[^/]+\.py$/,
  /[A-Za-z0-9]Tests?\.(java|kt|cs|swift|scala|php)$/,
];
export const isTest = (path) => !isDoc(path) && TEST_PATH.some((re) => re.test(path));

// commands.md text + `## <title>` -> null (no such section, or `none`) or the section's body (trimmed).
export function section(text, title) {
  if (text == null) return null;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let start = -1;
  let fenced = false;
  const heading = new RegExp(`^##\\s+${title}\\s*$`, 'i');
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*```/.test(lines[i])) fenced = !fenced;
    else if (!fenced && heading.test(lines[i])) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return null;
  const body = [];
  fenced = false;
  for (let i = start; i < lines.length; i += 1) {
    if (/^\s*```/.test(lines[i])) fenced = !fenced;
    else if (!fenced && /^#{1,2}\s/.test(lines[i])) break;
    body.push(lines[i]);
  }
  const trimmed = body.join('\n').trim();
  return trimmed === '' || /^none\.?$/i.test(trimmed) ? null : trimmed;
}

// A `## Full checks` body -> the command lines of its first fenced block, or null.
export function fullCommands(body) {
  if (body == null) return null;
  const lines = body.split('\n');
  const open = lines.findIndex((l) => /^\s*```/.test(l));
  if (open < 0) return null;
  const close = lines.findIndex((l, i) => i > open && /^\s*```/.test(l));
  const commands = lines
    .slice(open + 1, close < 0 ? undefined : close)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));
  return commands.length && !(commands.length === 1 && /^none\.?$/i.test(commands[0])) ? commands : null;
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A changed path -> a RegExp that matches a test file's text naming it.
export function referencePattern(path) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const q = '[\'"`]';
  return new RegExp(
    [
      `(^|[^\\w.-])${escape(name)}(?![\\w-])`,
      `${q}(?:[^'"\`\\s]*/)?${escape(stem)}${q}`,
      `\\b(?:from|import)\\s+(?:[\\w.]+\\.)?${escape(stem)}\\b`,
    ].join('|'),
    'm',
  );
}

// Changed paths + { path: text } of the test files on head -> [{ path, reason, via }].
export function testCandidates(changed, testFiles) {
  const out = [];
  const sources = changed.filter((p) => !isTest(p) && !isDoc(p));
  const patterns = sources.map((p) => [p, referencePattern(p)]);
  for (const [path, text] of Object.entries(testFiles)) {
    if (changed.includes(path)) {
      out.push({ path, reason: 'changed', via: [] });
      continue;
    }
    const via = patterns.filter(([, re]) => re.test(text)).map(([p]) => p);
    if (via.length) out.push({ path, reason: 'references', via });
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function defaultDeps(cwd = process.cwd()) {
  return {
    cwd,
    git: (args, input) =>
      execFileSync('git', args, {
        cwd,
        input,
        encoding: input === undefined ? 'utf8' : null, // null: a Buffer, read by exact byte sizes
        maxBuffer: 256 * 1024 * 1024,
        stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      }),
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const name = argv[i].startsWith('--') ? argv[i].slice(2) : null;
    if (!name || !['base', 'head', 'ci'].includes(name)) throw new UsageError(`unknown argument ${argv[i]}`);
    if (i + 1 >= argv.length) throw new UsageError(`${argv[i]} needs a value`);
    if (name in args) throw new UsageError(`${argv[i]} given twice`);
    args[name] = argv[++i];
  }
  if (!args.base) throw new UsageError('needs --base');
  if (args.ci != null && !CI_VALUES.includes(args.ci)) throw new UsageError(`--ci must be one of ${CI_VALUES.join(', ')}`);
  return args;
}

// `git cat-file --batch` output -> [text] in request order (missing objects -> null).
export function parseBatch(buf, count) {
  const out = [];
  let at = 0;
  for (let n = 0; n < count; n += 1) {
    const eol = buf.indexOf(0x0a, at);
    const header = buf.subarray(at, eol).toString('utf8');
    at = eol + 1;
    const m = /^\S+ \S+ (\d+)$/.exec(header);
    if (!m) {
      out.push(null);
      continue;
    }
    const size = Number(m[1]);
    out.push(buf.subarray(at, at + size).toString('utf8'));
    at += size + 1;
  }
  return out;
}

export function main(argv, deps = defaultDeps()) {
  try {
    const args = parseArgs(argv);
    const head = args.head || 'HEAD';
    for (const ref of [args.base, head]) {
      try {
        deps.git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
      } catch (e) {
        throw Object.assign(new Error(`cannot resolve ${ref} to a commit`), { stderr: e.stderr });
      }
    }
    let ci = args.ci;
    let ciSource = 'caller';
    if (ci == null) {
      ciSource = 'origin-check';
      try {
        deps.git(['remote', 'get-url', 'origin']);
        ci = 'covered';
      } catch {
        ci = 'no-origin';
      }
    }
    const scope = ci === 'covered' ? 'affected' : 'full';
    const listed = deps.git(['ls-tree', '--full-tree', '--name-only', head, '--', CONTRACT]).trim();
    const contract = listed === '' ? null : deps.git(['show', `${head}:${CONTRACT}`]);
    const commands = scope === 'full' ? fullCommands(section(contract, 'Full checks')) : null;
    const targeted = scope === 'affected' ? section(contract, 'Targeted checks') : null;
    const source = (scope === 'full' ? commands : targeted) ? 'commands.md' : 'self-found';
    const changed = deps
      .git(['-c', 'core.quotePath=false', 'diff', '--name-only', '-z', '--no-renames', `${args.base}...${head}`])
      .split('\0')
      .filter(Boolean);
    const testPaths = deps.git(['ls-tree', '--full-tree', '-r', '--name-only', '-z', head]).split('\0').filter((p) => p && isTest(p));
    const texts = testPaths.length
      ? parseBatch(deps.git(['cat-file', '--batch'], testPaths.map((p) => `${head}:${p}`).join('\n') + '\n'), testPaths.length)
      : [];
    const testFiles = Object.fromEntries(testPaths.map((p, i) => [p, texts[i] ?? '']));
    const report = {
      format: FORMAT,
      base: args.base,
      head,
      ci,
      ciSource,
      scope,
      source,
      commands,
      targeted,
      changed,
      tests: testCandidates(changed, testFiles),
    };
    return { code: 0, out: `${JSON.stringify(report, null, 2)}\n`, err: '' };
  } catch (e) {
    const usage = e instanceof UsageError;
    const detail = (e.stderr && String(e.stderr).trim()) || e.message;
    return { code: usage ? 2 : 1, out: '', err: `scope: ${detail}\n${usage ? 'usage: see the header of scope.mjs\n' : ''}` };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { code, out, err } = main(process.argv.slice(2));
  process.stdout.write(out);
  process.stderr.write(err);
  process.exitCode = code;
}
