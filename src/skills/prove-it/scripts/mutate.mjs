#!/usr/bin/env node
// mutate: diff-scoped manual mutation for prove-it. No dependencies: runs on a bare Node 20+.
// Run it in the review worktree (a detached checkout of the ticket branch), never in the implementer's worktree.
//
// Usage
//   node mutate.mjs lines --base <fixed-point> [--head <ref>] [--lcov <lcov-file>]
//   node mutate.mjs run --plan <plan.json> --cmd "<test command>" [--cap <n>] [--timeout <seconds>]
//
// lines  Lists the lines this ticket added or changed: `git diff -U0 <base>...<head>` (head defaults to HEAD), new-file
//        line numbers, blank lines left out. With --lcov, each line's `covered` is true when the lcov file has a
//        `DA:<line>,<hits>` with hits > 0 for that file; without it, `covered` is null (unknown, the reviewer infers).
// run    Runs a plan of manual mutants against the test command, one mutant at a time:
//          1. Validates the plan: at most --cap mutants (default 10), at most one mutant per file:line, each
//             `original` equal to the current text of that line, each `mutant` different from it.
//          2. Runs the command once on the untouched tree (the baseline). A red baseline stops here: exit 1.
//          3. For each mutant: reads the file's bytes, writes the mutated line (keeping the file's line endings), runs
//             the command, then writes the original bytes back and checks their SHA-256. Exit status 0 means the
//             mutant survived; a timeout counts as killed (reported as "timeout"); any other status means killed.
//        A failed restore stops at once with exit 3; nothing else is mutated.
//
// Plan (JSON)
//   { "mutants": [{ "file": "src/a.js", "line": 12, "operator": "boundary",
//                   "original": "  if (n > max) {", "mutant": "  if (n >= max) {" }] }
//   `file` is relative to the current directory; `line` is 1-based; `original` and `mutant` carry no line ending.
//   An empty `mutant` deletes the line's content.
//
// Output (stdout, JSON; fields are only ever added, never renamed)
//   lines: { "format": "sorry-matt/mutate-lines@1", "base", "head", "coverage": "lcov" | null,
//            "files": [{ "path", "lines": [{ "line": 12, "text": "...", "covered": true | false | null }] }] }
//   run:   { "format": "sorry-matt/mutate-run@1", "cmd", "cap", "baseline": "green" | "red",
//            "results": [{ "file", "line", "operator", "outcome": "killed" | "timeout" | "survived",
//                          "ms", "tail" }],                 // tail: last lines of the test output, evidence only
//            "survived": <n>, "restored": true | false }
//
// Exit codes: 0 done (survivors are data, not failure), 1 red baseline or runtime error, 2 usage or invalid plan,
// 3 a file could not be restored byte for byte.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LINES_FORMAT = 'sorry-matt/mutate-lines@1';
export const RUN_FORMAT = 'sorry-matt/mutate-run@1';
export const DEFAULT_CAP = 10;

class UsageError extends Error {}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const unquote = (p) => (p.startsWith('"') && p.endsWith('"') ? JSON.parse(p) : p);

// Windows paths compare case-insensitively; every key uses forward slashes.
const keyOf = (p) => {
  const k = p.split(sep).join('/');
  return process.platform === 'win32' ? k.toLowerCase() : k;
};

// `git diff -U0` text -> [{ path, lines: [{ line, text }] }], new-file line numbers of added lines.
export function changedLines(diffText) {
  const files = [];
  let current = null;
  let next = 0;
  for (const raw of diffText.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('diff --git ')) {
      current = null;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const target = line.slice(4);
      current = target === '/dev/null' ? null : { path: unquote(target).replace(/^b\//, ''), lines: [] };
      if (current) files.push(current);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      next = Number(hunk[1]);
      continue;
    }
    if (!current || line.startsWith('---')) continue;
    if (line.startsWith('+')) {
      const text = line.slice(1);
      if (text.trim() !== '') current.lines.push({ line: next, text });
      next += 1;
    }
  }
  return files.filter((f) => f.lines.length > 0);
}

// lcov text -> Map(path key -> Set of lines with hits > 0). SF paths may be absolute or relative to cwd.
export function coveredLines(lcovText, cwd) {
  const out = new Map();
  let file = null;
  for (const raw of lcovText.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('SF:')) {
      file = keyOf(relative(cwd, resolve(cwd, line.slice(3))));
      if (!out.has(file)) out.set(file, new Set());
    } else if (line.startsWith('DA:') && file) {
      const [n, hits] = line.slice(3).split(',');
      if (Number(hits) > 0) out.get(file).add(Number(n));
    } else if (line === 'end_of_record') {
      file = null;
    }
  }
  return out;
}

export function linesReport({ base, head = 'HEAD', diffText, lcovText, cwd }) {
  const covered = lcovText == null ? null : coveredLines(lcovText, cwd);
  const files = changedLines(diffText).map((f) => {
    const hits = covered ? covered.get(keyOf(f.path)) || new Set() : null;
    return { path: f.path, lines: f.lines.map((l) => ({ ...l, covered: hits ? hits.has(l.line) : null })) };
  });
  return { format: LINES_FORMAT, base, head, coverage: covered ? 'lcov' : null, files };
}

// Split into [content, ending] pairs so a mutation keeps the file's own line endings.
function splitLines(text) {
  const parts = [];
  const re = /\r\n|\n|\r/g;
  let start = 0;
  let m;
  while ((m = re.exec(text))) {
    parts.push([text.slice(start, m.index), m[0]]);
    start = m.index + m[0].length;
  }
  if (start < text.length) parts.push([text.slice(start), '']);
  return parts;
}

export function lineAt(text, n) {
  const parts = splitLines(text);
  return n >= 1 && n <= parts.length ? parts[n - 1][0] : undefined;
}

export function applyMutant(text, n, mutant) {
  const parts = splitLines(text);
  if (n < 1 || n > parts.length) throw new UsageError(`line ${n} is outside the file (${parts.length} lines)`);
  parts[n - 1][0] = mutant;
  return parts.map(([c, e]) => c + e).join('');
}

// Returns a list of problems; empty means the plan may run.
export function validatePlan(plan, { cap, read }) {
  const problems = [];
  const mutants = plan && Array.isArray(plan.mutants) ? plan.mutants : null;
  if (!mutants) return ['plan has no "mutants" array'];
  if (mutants.length > cap) problems.push(`plan has ${mutants.length} mutants, over the cap of ${cap}`);
  const seen = new Set();
  mutants.forEach((m, i) => {
    const at = `mutant ${i + 1}`;
    if (typeof m.file !== 'string' || !Number.isInteger(m.line) || typeof m.original !== 'string' || typeof m.mutant !== 'string') {
      problems.push(`${at}: needs string "file", integer "line", string "original" and string "mutant"`);
      return;
    }
    const key = `${keyOf(m.file)}:${m.line}`;
    if (seen.has(key)) problems.push(`${at}: ${m.file}:${m.line} already has a mutant (one per line)`);
    seen.add(key);
    if (m.mutant === m.original) problems.push(`${at}: mutant is identical to the original line`);
    let text;
    try {
      text = read(m.file).toString('utf8');
    } catch (e) {
      problems.push(`${at}: cannot read ${m.file} (${e.code || e.message})`);
      return;
    }
    const current = lineAt(text, m.line);
    if (current !== m.original) {
      problems.push(`${at}: ${m.file}:${m.line} is ${JSON.stringify(current)}, not the plan's original ${JSON.stringify(m.original)}`);
    }
  });
  return problems;
}

const tail = (s, n = 20) => s.split(/\r?\n/).filter((l) => l.trim() !== '').slice(-n).join('\n');

export function defaultDeps(cwd = process.cwd()) {
  return {
    cwd,
    read: (file) => readFileSync(resolve(cwd, file)),
    write: (file, buf) => writeFileSync(resolve(cwd, file), buf),
    exec: (cmd, timeoutMs) => {
      const r = spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
      const timedOut = r.error?.code === 'ETIMEDOUT' || (r.signal != null && r.status == null);
      if (r.error && !timedOut) throw r.error;
      return { status: r.status, timedOut, output: `${r.stdout || ''}${r.stderr || ''}` };
    },
    git: (args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }),
    now: () => Date.now(),
  };
}

export function runPlan({ plan, cmd, cap, timeoutMs, deps }) {
  const problems = validatePlan(plan, { cap, read: deps.read });
  if (problems.length) throw new UsageError(`invalid plan:\n  - ${problems.join('\n  - ')}`);
  const report = { format: RUN_FORMAT, cmd, cap, baseline: 'green', results: [], survived: 0, restored: true };

  const base = deps.exec(cmd, timeoutMs);
  if (base.timedOut || base.status !== 0) {
    report.baseline = 'red';
    report.baselineTail = tail(base.output);
    return { code: 1, report };
  }

  for (const m of plan.mutants) {
    const original = deps.read(m.file);
    const digest = sha256(original);
    const started = deps.now();
    let r;
    try {
      deps.write(m.file, Buffer.from(applyMutant(original.toString('utf8'), m.line, m.mutant), 'utf8'));
      r = deps.exec(cmd, timeoutMs);
    } finally {
      deps.write(m.file, original);
      if (sha256(deps.read(m.file)) !== digest) {
        report.restored = false;
        report.restoreFailed = `${m.file}:${m.line}`;
      }
    }
    if (!report.restored) return { code: 3, report };
    const outcome = r.timedOut ? 'timeout' : r.status === 0 ? 'survived' : 'killed';
    if (outcome === 'survived') report.survived += 1;
    report.results.push({ file: m.file, line: m.line, operator: m.operator ?? null, outcome, ms: deps.now() - started, tail: tail(r.output) });
  }
  return { code: 0, report };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command !== 'lines' && command !== 'run') throw new UsageError('first argument must be "lines" or "run"');
  const args = { command };
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    if (!/^--(base|head|lcov|plan|cmd|cap|timeout)$/.test(flag)) throw new UsageError(`unknown argument ${flag}`);
    if (i + 1 >= rest.length) throw new UsageError(`${flag} needs a value`);
    args[flag.slice(2)] = rest[++i];
  }
  if (command === 'lines' && !args.base) throw new UsageError('lines needs --base');
  if (command === 'run' && (!args.plan || !args.cmd)) throw new UsageError('run needs --plan and --cmd');
  for (const k of ['cap', 'timeout']) {
    if (args[k] != null && !(Number.isInteger(Number(args[k])) && Number(args[k]) > 0)) {
      throw new UsageError(`--${k} must be a positive integer`);
    }
  }
  return args;
}

export function main(argv, deps = defaultDeps()) {
  try {
    const args = parseArgs(argv);
    if (args.command === 'lines') {
      const head = args.head || 'HEAD';
      const diffText = deps.git(['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', '-U0', `${args.base}...${head}`]);
      const lcovText = args.lcov ? deps.read(args.lcov).toString('utf8') : null;
      const report = linesReport({ base: args.base, head, diffText, lcovText, cwd: deps.cwd });
      return { code: 0, out: `${JSON.stringify(report, null, 2)}\n`, err: '' };
    }
    let plan;
    try {
      plan = JSON.parse(deps.read(args.plan).toString('utf8'));
    } catch (e) {
      throw new UsageError(`cannot read plan ${args.plan}: ${e.message}`);
    }
    const cap = args.cap ? Number(args.cap) : DEFAULT_CAP;
    const timeoutMs = (args.timeout ? Number(args.timeout) : 300) * 1000;
    const { code, report } = runPlan({ plan, cmd: args.cmd, cap, timeoutMs, deps });
    const err = code === 1 ? 'mutate: baseline is red; nothing was mutated\n'
      : code === 3 ? `mutate: could not restore ${report.restoreFailed} byte for byte; stop and discard the review worktree\n` : '';
    return { code, out: `${JSON.stringify(report, null, 2)}\n`, err };
  } catch (e) {
    const usage = e instanceof UsageError;
    const detail = (e.stderr && String(e.stderr).trim()) || e.message;
    return { code: usage ? 2 : 1, out: '', err: `mutate: ${detail}\n${usage ? 'usage: see the header of mutate.mjs\n' : ''}` };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { code, out, err } = main(process.argv.slice(2));
  process.stdout.write(out);
  process.stderr.write(err);
  process.exitCode = code;
}
