// From a SessionStart(compact) event to the reminder the hook prints: re-read every run ledger in
// progress, then the rule files it lists. Ledgers and their format are defined in
// skills/have-it-all-done/ASKING.md section 7:
//   - location: <git common dir>/sorry-matt/runs/<run>.md
//   - in progress: the first line (a BOM aside) is `<!-- sorry-matt:run active -->`
//   - field 10, rule files: one line per file, `rule: <absolute path>` (a list bullet allowed, backticks allowed
//     around the value, and the whole line may be wrapped in backticks; the shape is ledgerLine below);
//     every such line in the ledger counts, which ASKING says by keeping `rule:` lines to field 10
// Anything it cannot find or read means "no run in progress": it prints nothing.
// budget.mjs finds the runs in progress through ledgersForEvent here and builds its line pattern with ledgerLine.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, win32 } from 'node:path';

export const ACTIVE = /^<!--\s*sorry-matt:run\s+active\s*-->$/;

/**
 * The one shape of a ledger's `<key>: <value>` line: leading space, an optional `-`, `*` or `+` bullet,
 * optional backticks around the value or the whole line (each side on its own), trailing space.
 * Space is allowed after an opening backtick (the value's or the whole line's) as well as before it, and before
 * the closing backtick as well as after it; none of it is part of the value: the value neither starts nor ends with space, whatever `value`
 * itself can match (the two lookarounds), so `rule: \` /abs/x.md \`` reads `/abs/x.md`.
 * Each run of space has one place to match — the space after a backtick belongs to that backtick's group, and
 * the lookarounds keep the value off both runs — so a line that fails does so without the nested backtracking
 * a long run of spaces would otherwise cause.
 * The captures come from `value`, a RegExp: only its `.source` is used (flags are ignored), and it must not match
 * a backtick itself, or the optional closing backticks above stop meaning anything.
 */
export const ledgerLine = (key, value) =>
  new RegExp(`^\\s*(?:[-*+]\\s+)?(?:\`\\s*)?${key}:\\s*(?:\`\\s*)?(?!\\s)${value.source}(?<!\\s)\\s*(?:\`\\s*)?$`);

const RULE = ledgerLine('rule', /([^`]+?)/);

/** The git common directory for cwd, or null outside a repo or without git. */
export function commonDir(cwd, run = spawnSync) {
  const out = run('git', ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  if (!out || out.error || out.status !== 0) return null;
  const dir = String(out.stdout || '').trim();
  return dir || null;
}

const isAbsolute = (p) => posix.isAbsolute(p) || win32.isAbsolute(p);

/** Parse one ledger's text: null unless it is in progress, else its rule file paths in order. */
export function parseLedger(text) {
  if (!isActive(text)) return null;
  const rules = [];
  for (const line of text.split(/\r?\n/)) {
    const m = RULE.exec(line);
    if (m && isAbsolute(m[1]) && !rules.includes(m[1])) rules.push(m[1]);
  }
  return { rules };
}

/** The first line (a BOM aside) is exactly the active marker. */
export const isActive = (text) => ACTIVE.test(firstLine(text).trim());
const firstLine = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/, 1)[0];

/** Every ledger in progress under <common dir>/sorry-matt/runs with its text, sorted by path. */
export function activeLedgerTexts(common) {
  const dir = join(common, 'sorry-matt', 'runs');
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const found = [];
  for (const name of names.filter((n) => n.endsWith('.md')).sort()) {
    const ledger = join(dir, name);
    try {
      if (!statSync(ledger).isFile()) continue;
      const text = readFileSync(ledger, 'utf8');
      if (isActive(text)) found.push({ ledger, text });
    } catch {
      // an unreadable ledger is not a run this hook can point at
    }
  }
  return found;
}

/** Every ledger in progress, with its text, for the repo of a hook event's cwd (else this process's cwd). */
export function ledgersForEvent(event, git = spawnSync) {
  const cwd = typeof event.cwd === 'string' && event.cwd ? event.cwd : process.cwd();
  const common = commonDir(cwd, git);
  return common ? activeLedgerTexts(common) : [];
}

/** Every ledger in progress under <common dir>/sorry-matt/runs, sorted by path. */
export const activeLedgers = (common) => withRules(activeLedgerTexts(common));

const withRules = (found) =>
  found.map(({ ledger, text }) => ({
    ledger,
    rules: parseLedger(text).rules.map((path) => ({ path, exists: existsSync(path) })),
  }));

/** The text added to context, or null when there is nothing to re-read. */
export function reminder(ledgers) {
  if (!ledgers.length) return null;
  const lines = [
    'sorry-matt: the conversation was just compacted while a run is in progress. Your first action, before anything else:',
    're-read the run ledger, then every rule file it lists, in full. Do not work from the compaction summary.',
  ];
  if (ledgers.length > 1) lines.push('More than one run is in progress in this repo; re-read the ledger of the run you were executing.');
  for (const { ledger, rules } of ledgers) {
    lines.push(`- ledger: ${ledger}`);
    if (!rules.length) lines.push('  - rule files: none listed (field 10 is empty; re-read the SKILL.md files the run was following)');
    for (const { path, exists } of rules) {
      lines.push(`  - rule: ${path}${exists ? '' : ' (not found: read the same file from the installed plugin version and fix field 10)'}`);
    }
  }
  return lines.join('\n') + '\n';
}

/**
 * @param {string} raw the SessionStart event JSON from stdin
 * @param {{ git?: typeof spawnSync }} deps
 */
export function respond(raw, { git = spawnSync } = {}) {
  try {
    return reminder(withRules(ledgersForEvent(JSON.parse(raw), git)));
  } catch {
    return null;
  }
}
