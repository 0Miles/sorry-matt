#!/usr/bin/env node
// tier: the review tier of one ticket for prove-it, and how its Finders and Verifiers are batched. No dependencies:
// runs on a bare Node 20+. Run it at the root of the review worktree.
//
// Usage
//   node tier.mjs judge --base <fixed-point> [--head <ref>] [--light-max-lines <n>] [--full-over-lines <n>]
//                       [--standard-max-verifiers <n>] [--light-cap <n>] [--standard-cap <n>] [--full-cap <n>]
//   node tier.mjs batch (--tier <light|standard|full> | --tier-file <judge output>) --items <items.json>
//                       [--stage verify|fix]
//
// judge  Judges the tier once from `git diff <base>...<head>` (head defaults to HEAD). Signals:
//          files          changed paths (`--no-renames`: a rename counts as its old and its new path)
//          added/deleted  lines from `git diff --numstat -M` (rename detection on, so a moved file counts only the
//                         lines it changed); a binary file counts 0; changedLines is their sum
//          docsOnly       every changed path is documentation: an extension in DOC_EXTENSIONS
//          sensitive      changed paths (old or new) that match a sensitive pattern. Patterns are the union of the
//                         `## Sensitive paths` section of docs/agents/commands.md on base and on head, so a ticket
//                         cannot lower its own tier by editing the contract. One repo-relative path per line (the
//                         first fenced block of the section, else its list items); an entry ending in `/` matches a
//                         directory prefix, `*` matches within one path segment, `**/` any number of directories,
//                         anything else the whole path. With no contract on either side, or `none` on both,
//                         DEFAULT_SENSITIVE (CI, hooks and guards, release and deploy, permissions, migrations).
//                         #152: an entry can name a symbol inside the files it matches, written as a predicted-files
//                         list writes one (overlap.mjs): `path#symbol`, nested `path#outer#inner`, spaces around `#`
//                         trimmed; a chain with an empty symbol is the whole path. Such an entry makes a path
//                         sensitive only when a changed line of `git diff -U0` lies inside the symbol: a deleted line
//                         in it on the old side (the merge-base) or an added line in it on head. Where the symbol is:
//                         in .md/.markdown/.mdx the heading whose text is the symbol, to the line before the next
//                         heading of its level or higher (an inner symbol: a deeper heading inside it); elsewhere a
//                         line declaring it (a keyword such as function, class, const, def, fn, then the name; an
//                         inner symbol may also be a member: `name(`, `name:`, `name =`), through the lines indented
//                         deeper and the lines of any bracket it leaves open, trailing blank lines excluded; every
//                         match counts. It fails safe, as touched: the symbol does not resolve on a side where the
//                         file exists (renamed, removed, never there), or the change has no changed line (binary,
//                         mode only).
//          signatureChanged  a deleted line in a non-doc file is a declaration (DECLARATION: export, module.exports,
//                         function, class, interface, type, enum, fn, def, func, a method with an access modifier,
//                         a const bound to a function). Changing a signature deletes its old line; a body-only edit
//                         does not. A heuristic: it decides whether the cross-file lens stands alone.
//          ruleFiles      CLAUDE.md, AGENTS.md, CONTRIBUTING.md, CODING_STANDARDS.md on head, at the root or in a
//                         directory above a changed path
//        Tier, top to bottom, the first match wins (`reasons` names every condition of the matching row that held):
//          full      a sensitive path, documentation or not (#139: an agent definition is   (sensitive, over-lines)
//                    Markdown, and what it grants is the permission boundary)
//          light     docsOnly                                                   (reason docs-only)
//          full      changedLines > --full-over-lines (400)                     (over-lines)
//          light     changedLines <= --light-max-lines (50)                     (few-lines)
//          standard  everything else                                            (default)
//        Finders: one per inner array of `finders`, which lists that finder's lenses (LENSES). Groups per tier:
//          light     [all five]
//          standard  [line-by-line, deleted-behaviour, cross-file], [acceptance, conventions]
//          full      [line-by-line, deleted-behaviour], [cross-file], [acceptance, conventions]
//        light and standard are pruned; full never is. Pruned lenses are listed in `pruned` with the reason:
//          deleted-behaviour  when deleted is 0
//          conventions        when ruleFiles is empty
//          cross-file         when signatureChanged is false (folded into line-by-line)
//        Verifiers: `verifiers.max` is 1 (light), --standard-max-verifiers (standard, 3) or null (full: one per file);
//        `fixVerifiers` is "one" (light, standard) or "per-file" (full). `mutationCap` is --light-cap (3),
//        --standard-cap (5) or --full-cap (10), each at most mutate.mjs's DEFAULT_CAP; null for docsOnly.
//        Reviewers: `reviewers` lists the sets of reviewers the review runs. Always "primary" (the Finders above);
//        full adds "architecture", the specialist reviewer of the high-risk tier (agents/architect.md, #105).
// batch  Splits candidates (stage verify) or findings (stage fix) into one batch per subagent.
//          verify  Candidates whose `suspected` is spec or pre-existing form one batch of their own (the short path);
//                  the rest group by `file`. light puts everything into one batch. When the batches exceed
//                  `verifiers.max`, the file groups with the fewest candidates fold into one (the short batch counts
//                  toward the max). Each batch has `short` and `normal` id lists; one verifier takes the whole batch.
//          fix     light and standard: one batch; full: one batch per file.
//        Items (JSON): an array, or { "items": [...] }, of { "id": "C1", "file": "src/a.js", "suspected": "none" }.
//        `id` and `file` are strings; `suspected` is spec, pre-existing or none (default none; ignored for fix).
//
// Output (stdout, JSON; fields are only ever added, never renamed)
//   judge: { "format": "sorry-matt/tier@1", "base", "head", "tier", "reasons": [...],
//            "signals": { "files", "added", "deleted", "changedLines", "docsOnly", "sensitive": [paths],
//                         "sensitiveSource": "commands.md" | "default", "signatureChanged", "ruleFiles": [paths] },
//            "thresholds": { "lightMaxLines", "fullOverLines", "standardMaxVerifiers", "lightCap", "standardCap",
//                            "fullCap" },
//            "finders": [[lens, ...], ...], "pruned": [{ "lens", "reason" }],
//            "verifiers": { "max": <n> | null }, "fixVerifiers": "one" | "per-file", "mutationCap": <n> | null,
//            "reviewers": ["primary"] | ["primary", "architecture"] }
//   batch: { "format": "sorry-matt/tier-batch@1", "tier", "stage",
//            "batches": [{ "files": [...], "short": [ids], "normal": [ids] }] }   // fix: { "files", "ids" }
//
// Exit codes: 0 done, 1 git failed (not a repository, a ref that does not resolve) or an unreadable file,
// 2 usage (a missing or unknown argument, a value that is not a positive integer, a cap over DEFAULT_CAP).
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CAP } from './mutate.mjs';

export const TIER_FORMAT = 'sorry-matt/tier@1';
export const BATCH_FORMAT = 'sorry-matt/tier-batch@1';
export const TIERS = ['light', 'standard', 'full'];
export const LENSES = ['line-by-line', 'deleted-behaviour', 'cross-file', 'acceptance', 'conventions'];
export const DEFAULT_THRESHOLDS = Object.freeze({
  lightMaxLines: 50,
  fullOverLines: 400,
  standardMaxVerifiers: 3,
  lightCap: 3,
  standardCap: 5,
  fullCap: 10,
});
export const REVIEWERS = Object.freeze({
  light: ['primary'],
  standard: ['primary'],
  full: ['primary', 'architecture'],
});
export const DOC_EXTENSIONS = ['.md', '.markdown', '.mdx', '.txt', '.rst', '.adoc', '.asciidoc', '.org'];
export const RULE_FILES = ['CLAUDE.md', 'AGENTS.md', 'CONTRIBUTING.md', 'CODING_STANDARDS.md'];
export const CONTRACT = 'docs/agents/commands.md';
export const DEFAULT_SENSITIVE = [
  // CI
  '.github/workflows/', '.gitlab-ci.yml', '.circleci/', '.buildkite/', 'azure-pipelines.yml',
  'bitbucket-pipelines.yml', '.travis.yml', 'Jenkinsfile',
  // hooks and guards
  'hooks/', '.husky/', '.githooks/', '.claude/hooks/', '.pre-commit-config.yaml', 'lefthook.yml',
  // release and deploy
  '.claude-plugin/', '.releaserc*', 'release.config.*', '.goreleaser.y*ml', '**/Dockerfile', 'docker-compose*.y*ml',
  'deploy/', 'k8s/', 'helm/', 'terraform/', '**/*.tf', 'vercel.json', 'netlify.toml', 'fly.toml', 'Procfile',
  'serverless.y*ml',
  // permissions
  '.claude/settings.json', '.claude/settings.local.json', 'CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS',
  // database migrations
  '**/migrations/', '**/migrate/',
];
export const DECLARATION = new RegExp(
  '^\\s*(?:' +
    [
      'export\\b',
      'module\\.exports\\b',
      'exports\\.[\\w$]+\\s*=',
      '(?:async\\s+)?function\\b',
      '(?:(?:abstract|declare)\\s+)*class\\b',
      'interface\\b',
      'type\\s+[\\w$]+(?:<[^>]*>)?\\s*=',
      'enum\\b',
      '(?:pub(?:\\([\\w:]+\\))?\\s+)?(?:async\\s+)?(?:unsafe\\s+)?fn\\b',
      '(?:async\\s+)?def\\b',
      'func\\b',
      '(?:(?:public|protected|private|internal|static|abstract|final|override|virtual|sealed)\\s+)+[^=;]*\\(',
      '(?:const|let|var)\\s+[\\w$]+\\s*=\\s*(?:async\\b\\s*)?(?:function\\b|\\([^)]*\\)\\s*=>|[\\w$]+\\s*=>)',
    ].join('|') +
    ')',
);

class UsageError extends Error {}

const unquote = (p) => (p.startsWith('"') && p.endsWith('"') ? JSON.parse(p) : p);

export const isDoc = (path) => {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot > 0 && DOC_EXTENSIONS.includes(name.slice(dot));
};

// A sensitive-path entry -> RegExp over repo-relative forward-slash paths.
export function patternRegex(entry) {
  let s = entry.trim().replace(/^\.\//, '').replace(/^\/+/, '');
  const dir = s.endsWith('/');
  if (dir) s = s.replace(/\/+$/, '');
  let re = '';
  for (let i = 0; i < s.length; i += 1) {
    if (s.startsWith('**/', i)) {
      re += '(?:.*/)?';
      i += 2;
    } else if (s.startsWith('**', i)) {
      re += '.*';
      i += 1;
    } else if (s[i] === '*') re += '[^/]*';
    else if (s[i] === '?') re += '[^/]';
    else re += s[i].replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}${dir ? '/' : '$'}`);
}

// commands.md text -> null (no `## Sensitive paths` section), [] (`none`), or the entries.
export function parseSensitive(text) {
  if (text == null) return null;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let start = -1;
  let fenced = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*```/.test(lines[i])) fenced = !fenced;
    else if (!fenced && /^##\s+Sensitive paths\s*$/i.test(lines[i])) {
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
  const clean = (l) => l.trim().replace(/^[-*]\s+/, '').replace(/^`(.*)`$/, '$1').trim();
  let entries;
  const open = body.findIndex((l) => /^\s*```/.test(l));
  if (open >= 0) {
    const close = body.findIndex((l, i) => i > open && /^\s*```/.test(l));
    entries = body.slice(open + 1, close < 0 ? undefined : close).map(clean);
  } else {
    entries = body.filter((l) => /^\s*[-*]\s+\S/.test(l)).map(clean);
    if (entries.length === 0) entries = body.map(clean).filter((l) => /^none\.?$/i.test(l));
  }
  entries = entries.filter((l) => l !== '');
  return entries.length === 1 && /^none\.?$/i.test(entries[0]) ? [] : entries.filter((l) => !/^none\.?$/i.test(l));
}

// `git diff --numstat -z --no-renames` -> [{ path, added, deleted }].
export function parseNumstat(text) {
  return text
    .split('\0')
    .filter((r) => r !== '')
    .map((record) => {
      const [added, deleted, ...rest] = record.replace(/^\n/, '').split('\t');
      return { path: rest.join('\t'), added: added === '-' ? 0 : Number(added), deleted: deleted === '-' ? 0 : Number(deleted) };
    });
}

// `path#outer#inner` -> { path, symbol: [outer, inner] }, spaces around `#` trimmed. A copy of get-to-work's
// overlap.mjs splitEntry, kept here so prove-it loads on its own; tier.test.mjs checks the two split alike.
export function splitEntry(text) {
  const [path, ...rest] = String(text).split('#');
  return { path, symbol: rest.map((s) => s.trim()) };
}

// A sensitive-path entry -> { re, symbol }: the path part as patternRegex reads it, the symbol chain as splitEntry
// splits it ([] for the whole file). An entry with an empty symbol in its chain is read as its whole path.
export function sensitiveEntry(text) {
  const { path, symbol } = splitEntry(text);
  return { re: patternRegex(path), symbol: symbol.some((s) => !s) ? [] : symbol };
}

// `git diff -U0 --no-renames` -> Map path -> { old: [line numbers], new: [line numbers] }: the lines each hunk deleted
// from the old file and added to the new one. A path appears once a file header names it, hunks or not.
export function changedLineNumbers(diffText) {
  const out = new Map();
  let at = null;
  let names = {};
  const entry = (path) => {
    if (!out.has(path)) out.set(path, { old: [], new: [] });
    return out.get(path);
  };
  for (const raw of diffText.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('diff --git ')) {
      at = null;
      names = {};
    } else if (at === null && (line.startsWith('--- ') || line.startsWith('+++ '))) {
      const source = line.slice(4).replace(/\t$/, '');
      if (source !== '/dev/null') names[line[0] === '-' ? 'old' : 'new'] = unquote(source).replace(/^[ab]\//, '');
      if (line.startsWith('+++ ')) at = entry(names.new ?? names.old);
    } else if (at && line.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!m) continue;
      const [oldStart, oldCount, newStart, newCount] = [m[1], m[2] ?? '1', m[3], m[4] ?? '1'].map(Number);
      for (let i = 0; i < oldCount; i += 1) at.old.push(oldStart + i);
      for (let i = 0; i < newCount; i += 1) at.new.push(newStart + i);
    }
  }
  return out;
}

const HEADING_FILES = ['.md', '.markdown', '.mdx'];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DECLARE_KEYWORDS = '(?:function\\*?|class|const|let|var|def|fn|func|interface|type|enum|struct|trait|module|namespace)';
const DECLARE_MODIFIERS = '(?:(?:export|default|async|static|public|private|protected|internal|abstract|declare|final|override|unsafe|pub(?:\\([\\w:]+\\))?)\\s+)*';
const MEMBER_MODIFIERS = '(?:(?:static|async|get|set|public|private|protected|readonly|override)\\s+)*';

// Markdown: the heading whose text is the symbol, to the line before the next heading of its level or higher.
function headingRanges(lines, name, [lo, hi], parentLevel) {
  const headings = [];
  let fenced = false;
  for (let i = lo; i <= hi; i += 1) {
    if (/^ {0,3}(```|~~~)/.test(lines[i])) fenced = !fenced;
    const m = !fenced && /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(lines[i]);
    if (m) headings.push({ at: i, level: m[1].length, text: m[2].trim() });
  }
  return headings
    .filter((h) => h.level > parentLevel && h.text === name)
    .map((h) => {
      const next = headings.find((n) => n.at > h.at && n.level <= h.level);
      return { range: [h.at, next ? next.at - 1 : hi], level: h.level };
    });
}

// Code: a line declaring the symbol (a nested one may also be a member: a method, a key, a field), through the lines
// indented deeper and any bracket it leaves open; trailing blank lines are not part of it.
function declarationRanges(lines, name, [lo, hi], nested) {
  const n = escapeRe(name);
  const declares = [new RegExp(`^\\s*${DECLARE_MODIFIERS}${DECLARE_KEYWORDS}\\s+${n}(?![\\w$])`)];
  if (nested) declares.push(new RegExp(`^\\s*${MEMBER_MODIFIERS}\\*?(['"]?)${n}\\1\\s*(?:\\(|:|=(?!=))`));
  const indent = (l) => /^\s*/.exec(l)[0].length;
  const depthOf = (l) => {
    const bare = l.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '');
    return (bare.match(/[{[(]/g) ?? []).length - (bare.match(/[}\])]/g) ?? []).length;
  };
  const out = [];
  for (let s = lo; s <= hi; s += 1) {
    if (!declares.some((re) => re.test(lines[s]))) continue;
    let depth = Math.max(0, depthOf(lines[s]));
    let end = s;
    for (let i = s + 1; i <= hi; i += 1) {
      const blank = lines[i].trim() === '';
      if (!blank && depth === 0 && indent(lines[i]) <= indent(lines[s])) break;
      if (!blank) end = i;
      depth = Math.max(0, depth + depthOf(lines[i]));
    }
    out.push({ range: [s, end] });
  }
  return out;
}

// A file's text and a symbol chain -> the 1-based [first, last] line ranges of the innermost symbol, every place the
// chain resolves (each inner one searched inside its outer one), or null when it resolves nowhere.
export function symbolRanges(text, path, chain) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const headings = HEADING_FILES.some((ext) => path.toLowerCase().endsWith(ext));
  let found = [{ range: [0, lines.length - 1], level: 0 }];
  chain.forEach((name, k) => {
    found = found.flatMap((f) =>
      headings ? headingRanges(lines, name, f.range, f.level) : declarationRanges(lines, name, k === 0 ? f.range : [f.range[0] + 1, f.range[1]], k > 0),
    );
  });
  return found.length ? found.map((f) => [f.range[0] + 1, f.range[1] + 1]) : null;
}

// Whether a change to `path` touches the symbol: a changed line inside it on either side. Fails safe, as touched:
// a side where the file exists but the symbol does not resolve, or a change with no changed line (binary, mode).
function touchesSymbol(path, chain, changed, fileAt) {
  const lines = changed.get(path) ?? { old: [], new: [] };
  const texts = { old: fileAt('old', path), new: fileAt('new', path) };
  if ((lines.old.length === 0 && lines.new.length === 0) || (texts.old == null && texts.new == null)) return true;
  return ['old', 'new'].some((side) => {
    if (texts[side] == null) return false;
    const ranges = symbolRanges(texts[side], path, chain);
    return ranges === null || lines[side].some((n) => ranges.some(([a, b]) => n >= a && n <= b));
  });
}

// `git diff -U0 --no-renames` -> [{ path, text }] for every deleted line, under the old path.
export function deletedLines(diffText) {
  const out = [];
  let path = null;
  let inHunk = false;
  for (const raw of diffText.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('diff --git ')) {
      path = null;
      inHunk = false;
    } else if (!inHunk && line.startsWith('--- ')) {
      const source = line.slice(4).replace(/\t$/, '');
      path = source === '/dev/null' ? null : unquote(source).replace(/^a\//, '');
    } else if (line.startsWith('@@')) inHunk = true;
    else if (inHunk && path && line.startsWith('-')) out.push({ path, text: line.slice(1) });
  }
  return out;
}

export function ruleFilesFor(treePaths, changed) {
  return treePaths
    .filter((p) => RULE_FILES.includes(p.slice(p.lastIndexOf('/') + 1)))
    .filter((p) => {
      const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '';
      return dir === '' || changed.some((c) => c.startsWith(dir));
    })
    .sort();
}

const GROUPS = {
  light: [[...LENSES]],
  standard: [['line-by-line', 'deleted-behaviour', 'cross-file'], ['acceptance', 'conventions']],
  full: [['line-by-line', 'deleted-behaviour'], ['cross-file'], ['acceptance', 'conventions']],
};

export function finderPlan(tier, signals) {
  const groups = GROUPS[tier].map((g) => [...g]);
  if (tier === 'full') return { finders: groups, pruned: [] };
  const pruned = [];
  if (signals.deleted === 0) pruned.push({ lens: 'deleted-behaviour', reason: 'no deleted lines' });
  if (signals.ruleFiles.length === 0) pruned.push({ lens: 'conventions', reason: 'no rule file covers the changed files' });
  if (!signals.signatureChanged) pruned.push({ lens: 'cross-file', reason: 'no signature changed; folded into line-by-line' });
  const drop = new Set(pruned.map((p) => p.lens));
  return { finders: groups.map((g) => g.filter((l) => !drop.has(l))).filter((g) => g.length > 0), pruned };
}

// Signals + thresholds -> the judge report minus base/head.
export function judgeTier(signals, thresholds = DEFAULT_THRESHOLDS) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  let tier;
  let reasons;
  const full = [
    ...(signals.sensitive.length > 0 ? ['sensitive'] : []),
    ...(signals.changedLines > t.fullOverLines ? ['over-lines'] : []),
  ];
  if (signals.sensitive.length > 0) [tier, reasons] = ['full', full];
  else if (signals.docsOnly) [tier, reasons] = ['light', ['docs-only']];
  else if (full.length) [tier, reasons] = ['full', full];
  else if (signals.changedLines <= t.lightMaxLines) [tier, reasons] = ['light', ['few-lines']];
  else [tier, reasons] = ['standard', ['default']];
  const { finders, pruned } = finderPlan(tier, signals);
  return {
    format: TIER_FORMAT,
    tier,
    reasons,
    signals,
    thresholds: t,
    finders,
    pruned,
    verifiers: { max: tier === 'light' ? 1 : tier === 'standard' ? t.standardMaxVerifiers : null },
    fixVerifiers: tier === 'full' ? 'per-file' : 'one',
    mutationCap: signals.docsOnly ? null : t[`${tier}Cap`],
    reviewers: [...REVIEWERS[tier]],
  };
}

// `git diff --numstat -M` (rename detection on) -> { added, deleted }. Only the two count columns are read, so the
// rename forms of the path column (`a => b`, `{a => b}/c`) do not matter.
export function countLines(numstatText) {
  let added = 0;
  let deleted = 0;
  for (const line of numstatText.split('\n')) {
    const m = /^(\d+|-)\t(\d+|-)\t/.exec(line.replace(/\r$/, ''));
    if (!m) continue;
    if (m[1] !== '-') added += Number(m[1]);
    if (m[2] !== '-') deleted += Number(m[2]);
  }
  return { added, deleted };
}

// numstat: --no-renames -z (paths, old and new); counts: -M (line counts as a rename-aware diff reports them).
// fileAt(side, path): the file's text on the old side (the merge-base the diff starts from) or the new side (head),
// null where it does not exist; read only for changed paths a `path#symbol` entry matches.
export function collectSignals({ numstat, counts, diffText, base: baseContract, head: headContract, treePaths, fileAt = () => null }) {
  const rows = parseNumstat(numstat);
  const paths = [...new Set(rows.map((r) => r.path))];
  const { added, deleted } = counts == null
    ? { added: rows.reduce((n, r) => n + r.added, 0), deleted: rows.reduce((n, r) => n + r.deleted, 0) }
    : countLines(counts);
  const lists = [parseSensitive(baseContract), parseSensitive(headContract)].filter((l) => l && l.length > 0);
  const sensitiveSource = lists.length ? 'commands.md' : 'default';
  const entries = (lists.length ? [...new Set(lists.flat())] : DEFAULT_SENSITIVE).map(sensitiveEntry);
  const changed = changedLineNumbers(diffText);
  const isSensitive = (p) =>
    entries.some((e) => e.re.test(p) && e.symbol.length === 0) ||
    entries.some((e) => e.re.test(p) && e.symbol.length > 0 && touchesSymbol(p, e.symbol, changed, fileAt));
  return {
    files: paths.length,
    added,
    deleted,
    changedLines: added + deleted,
    docsOnly: paths.length > 0 && paths.every(isDoc),
    sensitive: paths.filter(isSensitive).sort(),
    sensitiveSource,
    signatureChanged: deletedLines(diffText).some((d) => !isDoc(d.path) && DECLARATION.test(d.text)),
    ruleFiles: ruleFilesFor(treePaths, paths),
  };
}

// Items -> batches, per the header.
export function batchItems({ tier, stage = 'verify', items, maxVerifiers }) {
  const byFile = (list) => {
    const groups = new Map();
    for (const item of list) {
      if (!groups.has(item.file)) groups.set(item.file, []);
      groups.get(item.file).push(item);
    }
    return [...groups.values()];
  };
  const filesOf = (list) => [...new Set(list.map((i) => i.file))];
  if (items.length === 0) return [];
  if (stage === 'fix') {
    const groups = tier === 'full' ? byFile(items) : [items];
    return groups.map((g) => ({ files: filesOf(g), ids: g.map((i) => i.id) }));
  }
  const isShort = (i) => i.suspected === 'spec' || i.suspected === 'pre-existing';
  const short = items.filter(isShort);
  const normal = items.filter((i) => !isShort(i));
  const max = tier === 'light' ? 1 : maxVerifiers ?? (tier === 'standard' ? DEFAULT_THRESHOLDS.standardMaxVerifiers : Infinity);
  const make = (s, n) => ({ files: filesOf([...s, ...n]), short: s.map((i) => i.id), normal: n.map((i) => i.id) });
  const room = max - (short.length ? 1 : 0);
  if (room < 1) return [make(short, normal)];
  let groups = byFile(normal);
  if (groups.length > room) {
    // Keep the room - 1 largest groups; the rest (the fewest candidates) fold into one, in input order.
    const order = groups.map((g, i) => [g.length, i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    const keep = new Set(order.slice(0, room - 1).map(([, i]) => i));
    const folded = groups.filter((_, i) => !keep.has(i)).flat();
    const firstFolded = groups.findIndex((_, i) => !keep.has(i));
    groups = groups.flatMap((g, i) => (keep.has(i) ? [g] : i === firstFolded ? [folded] : []));
  }
  return [...(short.length ? [make(short, [])] : []), ...groups.map((g) => make([], g))];
}

const FLAGS = {
  judge: ['base', 'head', 'light-max-lines', 'full-over-lines', 'standard-max-verifiers', 'light-cap', 'standard-cap', 'full-cap'],
  batch: ['tier', 'tier-file', 'items', 'stage'],
};
const camel = (flag) => flag.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!FLAGS[command]) throw new UsageError('first argument must be "judge" or "batch"');
  const args = { command };
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    const name = flag.startsWith('--') ? flag.slice(2) : null;
    if (!name || !FLAGS[command].includes(name)) throw new UsageError(`unknown argument ${flag}`);
    if (i + 1 >= rest.length) throw new UsageError(`${flag} needs a value`);
    if (camel(name) in args) throw new UsageError(`${flag} given twice`);
    args[camel(name)] = rest[++i];
  }
  if (command === 'judge') {
    if (!args.base) throw new UsageError('judge needs --base');
    const thresholds = {};
    for (const key of Object.keys(DEFAULT_THRESHOLDS)) {
      if (args[key] == null) continue;
      if (!/^\d+$/.test(args[key]) || Number(args[key]) < 1) throw new UsageError(`--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} must be a positive integer`);
      thresholds[key] = Number(args[key]);
    }
    for (const key of ['lightCap', 'standardCap', 'fullCap']) {
      if (thresholds[key] > DEFAULT_CAP) throw new UsageError(`a mutation cap can be at most ${DEFAULT_CAP} (mutate.mjs refuses more)`);
    }
    args.thresholds = thresholds;
  } else {
    if (!args.items) throw new UsageError('batch needs --items');
    if ((args.tier == null) === (args.tierFile == null)) throw new UsageError('batch needs exactly one of --tier and --tier-file');
    if (args.tier != null && !TIERS.includes(args.tier)) throw new UsageError(`--tier must be one of ${TIERS.join(', ')}`);
    args.stage ??= 'verify';
    if (!['verify', 'fix'].includes(args.stage)) throw new UsageError('--stage must be verify or fix');
  }
  return args;
}

function readItems(deps, path) {
  let data;
  try {
    data = JSON.parse(deps.read(path).toString('utf8'));
  } catch (e) {
    throw Object.assign(new Error(`cannot read items ${path}: ${e.message}`), { runtime: true });
  }
  const items = Array.isArray(data) ? data : data && Array.isArray(data.items) ? data.items : null;
  if (!items) throw new UsageError(`${path} is neither an array nor { "items": [...] }`);
  const ids = new Set();
  return items.map((item, i) => {
    const at = `item ${i + 1}`;
    if (!item || typeof item.id !== 'string' || typeof item.file !== 'string') throw new UsageError(`${at}: needs string "id" and string "file"`);
    if (ids.has(item.id)) throw new UsageError(`${at}: id ${item.id} appears twice`);
    ids.add(item.id);
    const suspected = item.suspected ?? 'none';
    if (!['spec', 'pre-existing', 'none'].includes(suspected)) throw new UsageError(`${at}: suspected must be spec, pre-existing or none`);
    return { id: item.id, file: item.file, suspected };
  });
}

export function defaultDeps(cwd = process.cwd()) {
  return {
    cwd,
    read: (file) => readFileSync(resolve(cwd, file)),
    git: (args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }),
  };
}

function fileAt(deps, ref, path) {
  const listed = deps.git(['ls-tree', '--full-tree', '--name-only', ref, '--', path]).trim();
  return listed === '' ? null : deps.git(['show', `${ref}:${path}`]);
}
const contractAt = (deps, ref) => fileAt(deps, ref, CONTRACT);

export function main(argv, deps = defaultDeps()) {
  try {
    const args = parseArgs(argv);
    if (args.command === 'batch') {
      let tier = args.tier;
      let maxVerifiers;
      if (args.tierFile) {
        let judged;
        try {
          judged = JSON.parse(deps.read(args.tierFile).toString('utf8'));
        } catch (e) {
          throw Object.assign(new Error(`cannot read ${args.tierFile}: ${e.message}`), { runtime: true });
        }
        if (judged.format !== TIER_FORMAT || !TIERS.includes(judged.tier)) throw new UsageError(`${args.tierFile} is not ${TIER_FORMAT} output`);
        tier = judged.tier;
        maxVerifiers = judged.verifiers?.max ?? undefined;
      }
      const items = readItems(deps, args.items);
      const batches = batchItems({ tier, stage: args.stage, items, maxVerifiers });
      return { code: 0, out: `${JSON.stringify({ format: BATCH_FORMAT, tier, stage: args.stage, batches }, null, 2)}\n`, err: '' };
    }
    const head = args.head || 'HEAD';
    for (const ref of [args.base, head]) {
      try {
        deps.git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
      } catch (e) {
        throw Object.assign(new Error(`cannot resolve ${ref} to a commit`), { stderr: e.stderr });
      }
    }
    const range = `${args.base}...${head}`;
    const sides = { old: deps.git(['merge-base', args.base, head]).trim(), new: head };
    const signals = collectSignals({
      numstat: deps.git(['diff', '--numstat', '-z', '--no-renames', '--no-color', '--no-ext-diff', range]),
      counts: deps.git(['diff', '--numstat', '-M', '--no-color', '--no-ext-diff', range]),
      diffText: deps.git(['-c', 'core.quotePath=false', 'diff', '-U0', '--no-renames', '--no-color', '--no-ext-diff', range]),
      base: contractAt(deps, args.base),
      head: contractAt(deps, head),
      treePaths: deps.git(['ls-tree', '--full-tree', '-r', '--name-only', '-z', head]).split('\0').filter(Boolean),
      fileAt: (side, path) => fileAt(deps, sides[side], path),
    });
    const report = { ...judgeTier(signals, args.thresholds), base: args.base, head };
    const ordered = { format: report.format, base: report.base, head: report.head, ...report };
    return { code: 0, out: `${JSON.stringify(ordered, null, 2)}\n`, err: '' };
  } catch (e) {
    const usage = e instanceof UsageError;
    const detail = (e.stderr && String(e.stderr).trim()) || e.message;
    return { code: usage ? 2 : 1, out: '', err: `tier: ${detail}\n${usage ? 'usage: see the header of tier.mjs\n' : ''}` };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { code, out, err } = main(process.argv.slice(2));
  process.stdout.write(out);
  process.stderr.write(err);
  process.exitCode = code;
}
