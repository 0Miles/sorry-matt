#!/usr/bin/env node
// brief: the spawn file an agent of get-to-work's pipeline is spawned with, and the `description` its Agent call
// carries. It fills the `{…}` placeholders of IMPLEMENTER.md or EXPANDER.md — read from this skill's own directory —
// writes the values below the template's `---` rule to a file, and prints where it is. The agents' fixed rules are
// not in the templates: they are the body of the plugin's agent definition files, `agents/implementer.md` and
// `agents/expander.md` two levels up from this skill's directory (`sorry-matt:implementer`, `sorry-matt:expander`).
// Beside the spawn file it writes the general-purpose fallback: the definition's body below its frontmatter (with
// `${CLAUDE_PLUGIN_ROOT}` replaced by the plugin's directory) followed by the same values, for a session where the
// agent type is not available. The review host agent has no agent type: its spawn file is REVIEWER.md's fixed rules
// followed by the values (review below). It spawns nothing and calls no tracker. No dependencies: runs on a bare
// Node 20+.
//
// Usage
//   node brief.mjs implement <values.json>
//   node brief.mjs expand <values.json>
//   node brief.mjs review <values.json>
//   node brief.mjs description <role> <target> [<target> …]
//
// The spawn `description` (the one source of this rule; the skill prose that repeats it is to point here instead)
//   Every Agent call that spawns an agent of the pipeline has a `description` that starts with the agent's role word,
//   then a space and what it works on: `<role> <target> [<target> …]`, as in `implement #72`.
//   Role words:
//     expand     the expansion agent; its targets are every ticket of its batch, as in `expand #75 #83`
//     implement  the implementation agent, also one spawned anew after a send-back or reassigned while implementing
//     fix        an agent reassigned while fixing
//     ci-fix     an agent newly spawned to fix a red light; its target is the ticket, or the line's integration
//                branch when the red light maps to no ticket
//     merge      the merge agent; its target is the ticket, or the line's integration branch for the merge that
//                syncs the base when the run finishes
//     review     the review host agent, spawned in the foreground at close-out to host prove-it for the ticket (its
//                spawn file from `review` below), and the minimal reviewer of review: minimal
//     simplify   the simplify agent, spawned in the foreground at the finish; its target is the line's integration
//                branch
//   prove-it's finder, architect, verifier and fix-verifier, which the review host spawns, are named by prove-it's own
//   rules.
//   A ticket target is the tracker identifier: `#N` on GitHub, the ticket's file name (not its path) for Local
//   Markdown. The plugin's budget hook logs each spawn's agent type and `description` next to the run ledger, and
//   spawns.mjs reads the role word and every ticket back from it (#173: a spawn naming several counts under each); a
//   spawn whose prefix is wrong counts as `general-purpose`. So every ticket target here must be one spawns.mjs reads as a whole ticket (its `ticketOf`);
//   a file name with whitespace or the punctuation spawns.mjs stops at is refused. A Local Markdown path is reduced
//   to its file name.
//
// implement — the implementation agent's spawn file, IMPLEMENTER.md, and the definition agents/implementer.md
//   values.json:
//   { "out":          "<file to write the filled brief to>",
//     "role":         "implement" | "fix" | "ci-fix",          // optional, default "implement"
//     "snapshot":     "<the ticket's acceptance snapshot>",     // acceptance.mjs output saved at dispatch
//     "worktree":     "<absolute path of the ticket worktree>",
//     "branch":       "<ticket branch>",
//     "integration":  "<integration branch>",
//     "bodyFile":     "<file holding the full ticket text>",
//     "sendBackFile": "<file holding the send-back record>" | null,   // null: none
//     "acceptance":   "criteria" | "ticket-text" }   // where the acceptance is; tick gives ticket-text under the
//                                                    // profile's expand: skip when the snapshot has no
//                                                    // criteria, criteria otherwise
//   The ticket and its tracker come from the snapshot (`id`, `tracker`, `source`); the expansion block is every
//   `expansions[].text` of the snapshot, a blank line apart, or none; the project command contract is
//   `<worktree>/docs/agents/commands.md` when that file exists, else none. The acceptance source is a choice
//   placeholder of the template, `{criteria=<text> | ticket-text=<text>}`: the spawn file carries the text of the
//   key `acceptance` names, in the template's own language (ticket-text: the ticket text is the acceptance).
//
// expand — the expansion agent's spawn file, EXPANDER.md, and the definition agents/expander.md
//   values.json:
//   { "out":     "<file to write the filled brief to>",
//     "run":     "<run name>",
//     "round":   <dispatch point number, 1 or more>,
//     "tracker": "github" | "local",
//     "repo":    "<owner>/<repo>",                              // with "github" only
//     "lines":   [{ "branch": "<integration branch>", "worktree": "<absolute path>" }],
//     "spec":    "<identifier or path>" | null,                 // null: none
//     "tickets": [{ "id": "#75" | "<path>/03-x.md", "line": "<integration branch>", "bodyFile": "<file>" }] }
//   Each ticket's `line` is one of `lines`.
//
// review — the review host agent's spawn file (#138): REVIEWER.md below its `---` rule (the fixed rules; it has no
//   placeholders), a `---` rule, then this review's values under English labels, each one filled in. tick writes the
//   values file at close-out and spawns a general-purpose agent with it in the foreground (prove-it review).
//   values.json:
//   { "out":          "<file to write the spawn file to>",
//     "mode":         "initial" | "recheck",
//     "root":         "<absolute path of the repo working tree>",         // label `repo`
//     "tracker":      "github" | "local",
//     "repo":         "<owner>/<repo>",                                    // with "github" only
//     "ticket":       "#72" | "<path>/03-x.md",
//     "bodyFile":     "<the ticket face: the ticket text with its expansion blocks>",   // must exist
//     "statusRecord": "<where the status record is>",
//     "snapshot":     "<the acceptance snapshot>",                         // must exist
//     "against":      "<acceptance.mjs --against output of this review>", // must exist; label `comparison`
//     "fixedPoint":   "<the line's integration branch>",
//     "branch":       "<ticket branch>",
//     "checksReport": "<file holding the implementation (or fix) agent's report of the round under review>",
//     "ci":           "covered" | "uncovered" | "no-origin",              // label `CI coverage`
//     "previous":     true | false,   // the previous review block is in the status record; a recheck always has it
//     "reviewer":     "primary" | "<the reviewer and the risk it looks at>",
//     "scratchpad":   "<absolute path>",
//     "tier":         "<prove-it's tier.mjs judge output>" | null }   // #139, label `review tier`: the tier and
//                                                    // that file, which prove-it then reads instead of judging;
//                                                    // null: none given, prove-it judges it (section 1)
//   The `targeted checks` value is the report's `targeted checks:` line (agents/implementer.md section 5), with its
//   `commit:` line when there is one and the report's path; a report without that line is no implementation agent's
//   report (exit 1). The label after it, `targeted checks ran at` (#140), is the SHA that line's `sha=` names (7 to 40
//   hex digits, lower-cased), or `not reported: rerun them (prove-it section 3)`: prove-it reuses the checks only
//   at the head it reviews. A key added here is a label added to the values and a line to REVIEWER.md's value list.
//
// Every key above is required; `null` is how a value says none. Files are read as UTF-8; a byte order mark is
// dropped and CRLF line ends read as LF. A value of several lines has its following lines indented under the list
// item it fills. The output files are written with LF line ends and no trailing whitespace; their directory is
// created when missing. The fallback is written next to `out`, its name `out`'s with `.general-purpose` before the
// extension (`72-1.md` → `72-1.general-purpose.md`; `fallbackPath`).
//
// Output (stdout, JSON, format "sorry-matt/brief@1"; fields are only ever added, never renamed)
//   implement / expand:
//   { "format": "sorry-matt/brief@1", "kind": "implement" | "expand", "role": "<role word>",
//     "brief": "<absolute path of the spawn file>", "description": "implement #72",
//     "prompt": "Read <brief> in full and follow it.",
//     "agentType": "sorry-matt:implementer" | "sorry-matt:expander",            // the Agent call's subagent_type
//     "fallback": "<absolute path of the general-purpose fallback>",
//     "fallbackPrompt": "Read <fallback> in full and follow it." }             // with subagent_type general-purpose
//   review: the same fields, "kind": "review", "agentType": "general-purpose", "fallback": null, "fallbackPrompt": null
//   description:
//   { "format": "sorry-matt/brief@1", "kind": "description", "role": "<role word>", "description": "merge #72" }
//
// Exit codes: 0 output written; 1 a file is missing or unreadable, the snapshot is not an acceptance snapshot, a
// definition file has no frontmatter, a review's checks report has no `targeted checks:` line or its tier file is not
// tier.mjs judge output, or a template's
// placeholders are not the ones this script fills (REVIEWER.md: any placeholder at all; the template and the script
// changed apart); nothing is written; 2 bad arguments, or a value missing or malformed.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, failure, runIfEntry } from './cli.mjs';
import { ticketOf } from './spawns.mjs';

export const FORMAT = 'sorry-matt/brief@1';
export const ROLES = ['expand', 'implement', 'fix', 'ci-fix', 'merge', 'review', 'simplify'];
const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_ROOT = join(SKILL_DIR, '..', '..');
/** The agent type each spawn file is for, and its definition file's name under `<plugin>/agents/`. */
export const AGENT_TYPES = { implement: 'sorry-matt:implementer', expand: 'sorry-matt:expander' };
const DEFINITIONS = { implement: 'implementer.md', expand: 'expander.md' };
// A placeholder is `{…}` with no brace inside; it may run over several lines.
const PLACEHOLDER = /\{[^{}]*\}/g;

const read = (path) => readFileSync(path, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
const readJson = (path) => {
  const text = read(path);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${path} is not JSON (${e.message})`);
  }
};

/** The ticket name a description carries for `id`, or null when spawns.mjs would not read it whole. */
export function ticketName(id) {
  const name = String(id).includes('#') ? String(id) : basename(String(id).replace(/\\/g, '/'));
  return ticketOf(name) === name ? name : null;
}

/** The `description` for a spawn of `role` working on `targets`; throws a UsageError when the rule is broken. */
export function description(role, targets) {
  if (!ROLES.includes(role)) throw new UsageError(`unknown role word ${JSON.stringify(role)}; one of ${ROLES.join(', ')}`);
  if (!targets.length) throw new UsageError(`${role} needs a target`);
  if (role !== 'expand' && targets.length !== 1) throw new UsageError(`${role} takes one target, got ${targets.length}`);
  const branchAllowed = role === 'ci-fix' || role === 'merge' || role === 'simplify';
  const names = targets.map((target) => {
    const name = ticketName(target);
    if (name) return name;
    if (branchAllowed && /^\S+$/.test(String(target))) return String(target);
    throw new UsageError(`${JSON.stringify(target)} is not a ticket spawns.mjs can read (#N or a <digits>-<slug>.md file name)`);
  });
  return `${role} ${names.join(' ')}`;
}

// The value of a required key of `values`, checked by `ok`.
function need(values, key, ok = (v) => typeof v === 'string' && v.trim() !== '', what = 'a non-empty string') {
  if (!(key in values)) throw new UsageError(`missing ${key}`);
  if (!ok(values[key])) throw new UsageError(`${key} must be ${what}`);
  return values[key];
}
const text = (v) => typeof v === 'string' && v.trim() !== '';
const absolute = (v) => text(v) && isAbsolute(v);
const orNull = (ok) => (v) => v === null || ok(v);

// Following lines of a multi-line value, indented to stay under the list item it fills.
const indent = (value, pad) => value.replace(/\n(?=[^\n])/g, `\n${pad}`);

/**
 * The fill of a choice placeholder `{<key>=<text> | <key>=<text>}`: the text of `key`. A placeholder without that
 * key means the template and the script changed apart.
 */
export function choose(key) {
  return (placeholder, templatePath) => {
    for (const option of placeholder.slice(1, -1).split('|')) {
      const at = option.indexOf('=');
      if (at > 0 && option.slice(0, at).trim() === key) return option.slice(at + 1).trim();
    }
    throw new Error(`${templatePath}: the placeholder ${placeholder} has no ${key}=: the template and the script changed apart`);
  };
}

/** The template below its `---` rule, with its placeholders filled by `fills` in order (a function fills a choice). */
export function fill(templatePath, fills) {
  const template = read(templatePath);
  const rule = template.search(/^---$/m);
  if (rule < 0) throw new Error(`${templatePath} has no --- rule`);
  const body = template.slice(rule + 3).replace(/^\n+/, '');
  const found = body.match(PLACEHOLDER) ?? [];
  if (found.length !== fills.length)
    throw new Error(`${templatePath} has ${found.length} placeholders, brief.mjs fills ${fills.length}: the template and the script changed apart`);
  let i = 0;
  return body
    .replace(PLACEHOLDER, (placeholder) => {
      const f = fills[i++];
      return typeof f === 'function' ? f(placeholder, templatePath) : f;
    })
    .replace(/[ \t]+$/gm, '');
}

/** Where the general-purpose fallback of the spawn file `out` is written. */
export function fallbackPath(out) {
  const ext = extname(out);
  return `${out.slice(0, out.length - ext.length)}.general-purpose${ext}`;
}

/** The body of a plugin agent definition below its frontmatter, `${CLAUDE_PLUGIN_ROOT}` replaced by `root`. */
export function definitionBody(path, root) {
  const text = read(path);
  const m = /^---\n[\s\S]*?\n---\n/.exec(text);
  if (!m) throw new Error(`${path} has no frontmatter`);
  return text.slice(m[0].length).split('${CLAUDE_PLUGIN_ROOT}').join(root).replace(/^\n+/, '').replace(/\s+$/, '').replace(/[ \t]+$/gm, '');
}

const trackerText = (tracker, repo) => (tracker === 'github' ? `GitHub (${repo})` : 'Local Markdown');

function implement(values) {
  const out = need(values, 'out');
  const role = values.role ?? 'implement';
  if (!['implement', 'fix', 'ci-fix'].includes(role)) throw new UsageError(`role must be implement, fix or ci-fix`);
  const snapshotPath = need(values, 'snapshot');
  const worktree = need(values, 'worktree', absolute, 'an absolute path');
  const branch = need(values, 'branch');
  const integration = need(values, 'integration');
  const bodyFile = need(values, 'bodyFile');
  const sendBackFile = need(values, 'sendBackFile', orNull(text), 'a file path or null');
  const acceptance = need(values, 'acceptance', (v) => v === 'criteria' || v === 'ticket-text', '"criteria" or "ticket-text"');

  const snapshot = readJson(snapshotPath);
  const wrong = () => new Error(`${snapshotPath} is not a sorry-matt acceptance snapshot`);
  if (!snapshot || snapshot.format !== 'sorry-matt/acceptance@1' || !text(snapshot.id)) throw wrong();
  if (!['github', 'local'].includes(snapshot.tracker) || !Array.isArray(snapshot.expansions)) throw wrong();
  const id = snapshot.id;
  const desc = description(role, [id]);
  const expansion = snapshot.expansions.map((e) => String(e?.text ?? '').trim()).filter(Boolean).join('\n\n');
  const commands = join(worktree, 'docs', 'agents', 'commands.md');

  const pad = '  ';
  const filled = fill(join(SKILL_DIR, 'IMPLEMENTER.md'), [
    id,
    trackerText(snapshot.tracker, snapshot.source),
    worktree,
    branch,
    integration,
    indent(read(bodyFile).trim(), pad),
    expansion ? indent(expansion, pad) : 'none',
    choose(acceptance),
    existsSync(commands) ? commands : 'none',
    sendBackFile === null ? 'none' : indent(read(sendBackFile).trim(), pad),
  ]);
  return { out, kind: 'implement', role, desc, filled };
}

function expand(values) {
  const out = need(values, 'out');
  const run = need(values, 'run');
  const round = need(values, 'round', (v) => Number.isInteger(v) && v >= 1, 'an integer, 1 or more');
  const tracker = need(values, 'tracker', (v) => v === 'github' || v === 'local', '"github" or "local"');
  const repo = tracker === 'github' ? need(values, 'repo', (v) => /^[^/\s]+\/[^/\s]+$/.test(v), '<owner>/<repo>') : null;
  const lines = need(values, 'lines', (v) => Array.isArray(v) && v.length > 0, 'a non-empty array');
  lines.forEach((line, n) => {
    if (!line || typeof line !== 'object') throw new UsageError(`lines[${n}] must be an object`);
    need(line, 'branch');
    need(line, 'worktree', absolute, 'an absolute path');
  });
  const spec = need(values, 'spec', orNull(text), 'a string or null');
  const tickets = need(values, 'tickets', (v) => Array.isArray(v) && v.length > 0, 'a non-empty array');
  tickets.forEach((ticket, n) => {
    if (!ticket || typeof ticket !== 'object') throw new UsageError(`tickets[${n}] must be an object`);
    need(ticket, 'id');
    need(ticket, 'line');
    need(ticket, 'bodyFile');
    if (!lines.some((line) => line.branch === ticket.line)) throw new UsageError(`tickets[${n}].line ${ticket.line} is not one of lines`);
  });
  const desc = description('expand', tickets.map((ticket) => ticket.id));

  const filled = fill(join(SKILL_DIR, 'EXPANDER.md'), [
    run,
    String(round),
    trackerText(tracker, repo),
    lines.map((line) => `\n  - ${line.branch}: ${line.worktree}`).join(''),
    spec ?? 'none',
    tickets.map((ticket) => `\n  - ${ticket.id} [${ticket.line}]\n    ${indent(read(ticket.bodyFile).trim(), '    ')}`).join(''),
  ]);
  return { out, kind: 'expand', role: 'expand', desc, filled };
}

/** REVIEWER.md below its `---` rule: the review host's fixed rules. A placeholder there means it changed apart from this script. */
export function rules(templatePath) {
  const template = read(templatePath);
  const rule = template.search(/^---$/m);
  if (rule < 0) throw new Error(`${templatePath} has no --- rule`);
  const body = template.slice(rule + 3).replace(/^\n+/, '').replace(/\s+$/, '').replace(/[ \t]+$/gm, '');
  const left = body.match(PLACEHOLDER);
  if (left) throw new Error(`${templatePath} has the placeholder ${left[0]}, and review fills none: the template and the script changed apart`);
  return body;
}

/** The value of a report's `<name>: <value>` line (markdown list marks, quotes and code ticks around it allowed), or null. */
export function reportField(text, name) {
  return new RegExp(`^[\\s>*\`-]*${name}[\\s*\`]*:[\\s*\`]*(\\S.*?)\\s*$`, 'im').exec(String(text).replace(/\r\n/g, '\n'))?.[1] ?? null;
}

/**
 * The `targeted checks:` line of an implementation agent's report (agents/implementer.md section 5), with its commit,
 * and the SHA it says they ran at (its `sha=`, lower case; #140), null when it gives none.
 */
export function targetedChecks(reportPath) {
  const report = read(reportPath);
  const checks = reportField(report, 'targeted checks');
  if (!checks) throw new Error(`${reportPath} has no \`targeted checks:\` line: it is not an implementation agent's report`);
  const commit = reportField(report, 'commit');
  const sha = /(?:^|[\s;`*(])sha=([0-9a-f]{7,40})(?![0-9a-z])/i.exec(checks)?.[1]?.toLowerCase() ?? null;
  return { text: `${checks} (${commit ? `commit ${commit}; ` : ''}the agent's report: ${resolve(reportPath)})`, sha };
}

export const CI_COVERAGE = ['covered', 'uncovered', 'no-origin'];
export const TIER_FORMAT = 'sorry-matt/tier@1';

/** #139: the review tier of prove-it's `tier.mjs judge` output (format sorry-matt/tier@1), which tick ran before the review. */
function judgedTier(path) {
  if (!existsSync(path)) throw new Error(`${path} does not exist`);
  const judged = readJson(path);
  if (judged?.format !== TIER_FORMAT || !['light', 'standard', 'full'].includes(judged.tier)) throw new Error(`${path} is not ${TIER_FORMAT} output with a tier`);
  return judged.tier;
}

function review(values) {
  const out = need(values, 'out');
  const mode = need(values, 'mode', (v) => v === 'initial' || v === 'recheck', '"initial" or "recheck"');
  const root = need(values, 'root', absolute, 'an absolute path');
  const tracker = need(values, 'tracker', (v) => v === 'github' || v === 'local', '"github" or "local"');
  const repo = tracker === 'github' ? need(values, 'repo', (v) => /^[^/\s]+\/[^/\s]+$/.test(v), '<owner>/<repo>') : null;
  const ticket = need(values, 'ticket');
  const bodyFile = need(values, 'bodyFile');
  const statusRecord = need(values, 'statusRecord');
  const snapshot = need(values, 'snapshot');
  const against = need(values, 'against');
  const fixedPoint = need(values, 'fixedPoint');
  const branch = need(values, 'branch');
  const checksReport = need(values, 'checksReport');
  const ci = need(values, 'ci', (v) => CI_COVERAGE.includes(v), CI_COVERAGE.join(', '));
  const previous = need(values, 'previous', (v) => typeof v === 'boolean', 'true or false');
  if (mode === 'recheck' && !previous) throw new UsageError('a recheck always has the previous review block: previous must be true');
  const reviewer = need(values, 'reviewer');
  const scratchpad = need(values, 'scratchpad', absolute, 'an absolute path');
  const tierFile = need(values, 'tier', orNull(text), 'a file path or null');
  const desc = description('review', [ticket]);

  for (const file of [bodyFile, snapshot, against]) if (!existsSync(file)) throw new Error(`${file} does not exist`);
  const checks = targetedChecks(checksReport);
  const tier = tierFile === null ? 'none given: judge it yourself (prove-it section 1)' : `${judgedTier(tierFile)} (tier.mjs judge output: ${resolve(tierFile)})`;
  const filled = [
    rules(join(SKILL_DIR, 'REVIEWER.md')),
    '---',
    [
      "Spawn values: this review's values, every one filled in. The rules above are all you follow.",
      '',
      `- mode: ${mode}`,
      `- repo: ${root}`,
      `- tracker: ${trackerText(tracker, repo)}`,
      `- ticket: ${ticket}; ticket face (the ticket text with its expansion blocks): ${resolve(bodyFile)}`,
      `- status record: ${statusRecord}`,
      `- acceptance snapshot: ${resolve(snapshot)}; comparison: ${resolve(against)}`,
      `- fixed point: ${fixedPoint}`,
      `- ticket branch: ${branch}`,
      `- targeted checks: ${checks.text}`,
      `- targeted checks ran at: ${checks.sha ?? 'not reported: rerun them (prove-it section 3)'}`,
      `- CI coverage: ${ci}`,
      `- previous review block: ${previous ? 'in the status record' : 'none'}`,
      `- reviewer: ${reviewer}`,
      `- scratchpad: ${scratchpad}`,
      `- review tier: ${tier}`,
    ].join('\n'),
  ].join('\n\n');
  return { out, kind: 'review', role: 'review', desc, filled: `${filled.replace(/[ \t]+$/gm, '')}\n` };
}

export function main(argv) {
  try {
    const [kind, ...rest] = argv;
    if (kind === 'description') {
      const [role, ...targets] = rest;
      if (!role) throw new UsageError('description needs a role word and a target');
      return { code: 0, out: JSON.stringify({ format: FORMAT, kind, role, description: description(role, targets) }, null, 2) + '\n', err: '' };
    }
    if (!['implement', 'expand', 'review'].includes(kind)) throw new UsageError('expected implement, expand, review or description');
    if (rest.length !== 1) throw new UsageError(`${kind} takes one argument, the values file`);
    const values = readJson(rest[0]);
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new UsageError(`${rest[0]} must hold a JSON object`);
    if (kind === 'review') {
      const { out, role, desc, filled } = review(values);
      const brief = resolve(out);
      mkdirSync(dirname(brief), { recursive: true });
      writeFileSync(brief, filled);
      // the review host is a general-purpose agent: there is no agent type to fall back from
      const result = { format: FORMAT, kind, role, brief, description: desc, prompt: `Read ${brief} in full and follow it.`, agentType: 'general-purpose', fallback: null, fallbackPrompt: null };
      return { code: 0, out: JSON.stringify(result, null, 2) + '\n', err: '' };
    }
    const { out, role, desc, filled } = kind === 'implement' ? implement(values) : expand(values);
    const body = definitionBody(join(PLUGIN_ROOT, 'agents', DEFINITIONS[kind]), resolve(PLUGIN_ROOT));
    const brief = resolve(out);
    const fallback = fallbackPath(brief);
    mkdirSync(dirname(brief), { recursive: true });
    writeFileSync(brief, filled);
    writeFileSync(fallback, `${body}\n\n---\n\n${filled}`);
    const result = {
      format: FORMAT,
      kind,
      role,
      brief,
      description: desc,
      prompt: `Read ${brief} in full and follow it.`,
      agentType: AGENT_TYPES[kind],
      fallback,
      fallbackPrompt: `Read ${fallback} in full and follow it.`,
    };
    return { code: 0, out: JSON.stringify(result, null, 2) + '\n', err: '' };
  } catch (e) {
    return failure('brief', e);
  }
}

runIfEntry(import.meta.url, main);
