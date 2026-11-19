#!/usr/bin/env node
// spawns: a run's spawns summed up by kind of agent, and by ticket where the ticket can be told. It reads the
// counters file the plugin's budget hook keeps next to the run ledger (`<run>.counters.json`) and writes
// nothing. No dependencies: runs on a bare Node 20+.
//
// Usage
//   node spawns.mjs <counters file>
//
// The counters file, as the hook writes it (hooks/budget.mjs); only these keys are read:
//   {
//     "spawns": <int>,                         // every spawn the hook counted
//     "log":    [{ "id": ..., "type": "<agent type>" | null, "description": "<string>" | null, "at": ... }]
//   }
//   `log` has one entry per spawn counted since the hook started logging; a file from an older hook has none.
//
// Category of a log entry
//   - `type` is neither "general-purpose" nor null: the category is `type` (a named agent type, such as
//     "sorry-matt:expander").
//   - otherwise the first word of `description`, lowercased, when it is one of the role words the skills start
//     an Agent call's description with: expand, implement, fix, ci-fix, merge, review, finder, architect, verifier,
//     fix-verifier.
//   - otherwise "general-purpose".
//   Spawns counted but not logged (`spawns` minus the number of log entries) are "unknown".
//
// Ticket of a log entry: the first `#<digits>` or `<digits>-<slug>.md` marker in `description`, by position. An
// entry without one is in no ticket; it still counts in `byType`. A file-name marker:
//   - starts at digits not preceded by a letter, a digit, `_`, `.` or `-` (so after a space, `/`, `(` and the like);
//   - has a slug in any script: any characters but whitespace, path separators, and the punctuation that
//     separates or wraps names: , ; : ( ) [ ] { } < > quotes, and the full-width ，、。；：（）「」;
//   - ends at the last `.md` of that run which is not followed by a letter, a digit, `_` or `-`, nor by a `.` and
//     one of those. So `03-a.md.md` and `03-v1.2-notes.md` are whole names, `03-x.md.` and `03-x.md,` give
//     `03-x.md`, and `03-x.md.txt` is no ticket.
//
// Output (stdout, JSON, format "sorry-matt/spawns@1"; fields are only ever added, never renamed)
//   {
//     "format":   "sorry-matt/spawns@1",
//     "spawns":   17,
//     "byType":   { "implement": 5, "sorry-matt:expander": 2, "finder": 6, "unknown": 4 },
//     "byTicket": { "#72": { "implement": 1, "finder": 3 }, "03-add-login.md": { "implement": 1 } }
//   }
//   The values of `byType` add up to `spawns`. Categories and tickets appear in the order first seen, "unknown"
//   last; one with no spawn is left out.
//
// Exit codes: 0 output written; 1 the file is missing, not JSON, or not a counters file (nothing on stdout);
// 2 bad arguments.
import { readFileSync } from 'node:fs';
import { UsageError, failure, runIfEntry } from './cli.mjs';

export const FORMAT = 'sorry-matt/spawns@1';
export const ROLES = ['expand', 'implement', 'fix', 'ci-fix', 'merge', 'review', 'finder', 'architect', 'verifier', 'fix-verifier'];

// The file-name marker is described in the header: its start, its slug and its end.
const WORD = '\\p{L}\\p{N}_';
const SLUG = '[^\\s\\/\\\\,;:()\\[\\]{}<>"\'`，、。；：（）「」]';
const TICKET = new RegExp(`#\\d+|(?<![${WORD}.-])\\d+-${SLUG}*\\.md(?!\\.?[${WORD}-])`, 'u');
const optionalString = (value) => value === null || value === undefined || typeof value === 'string';

/** The category one log entry counts under. */
export function category({ type, description }) {
  if (type && type !== 'general-purpose') return type;
  const word = String(description ?? '').trim().split(/\s+/)[0].toLowerCase();
  return ROLES.includes(word) ? word : 'general-purpose';
}

/** The ticket a description names, or null. */
export const ticketOf = (description) => TICKET.exec(String(description ?? ''))?.[0] ?? null;

/** The summary of parsed counters; throws when they are not in the counters format. */
export function summarize(counters, path = 'the input') {
  const wrong = () => new Error(`${path} is not a sorry-matt counters file`);
  if (!counters || typeof counters !== 'object' || Array.isArray(counters)) throw wrong();
  const { spawns, log = [] } = counters;
  if (!Number.isInteger(spawns) || spawns < 0 || !Array.isArray(log)) throw wrong();
  if (log.some((e) => !e || typeof e !== 'object' || !optionalString(e.type) || !optionalString(e.description))) throw wrong();
  if (log.length > spawns) throw new Error(`${path} has ${log.length} log entries but ${spawns} spawns`);

  // Null-prototype tallies: an agent type or ticket named like an Object.prototype key (`constructor`,
  // `__proto__`) is a key like any other.
  const tally = () => Object.create(null);
  const byType = tally();
  const byTicket = tally();
  const add = (counts, key) => (counts[key] = (counts[key] || 0) + 1);
  for (const entry of log) {
    const kind = category(entry);
    add(byType, kind);
    const ticket = ticketOf(entry.description);
    if (ticket) add((byTicket[ticket] ||= tally()), kind);
  }
  if (spawns > log.length) byType.unknown = (byType.unknown || 0) + spawns - log.length;
  return { format: FORMAT, spawns, byType, byTicket };
}

export function main(argv) {
  try {
    if (argv.length !== 1) throw new UsageError('expected one argument, the counters file');
    const [path] = argv;
    const text = readFileSync(path, 'utf8');
    let counters;
    try {
      counters = JSON.parse(text);
    } catch (e) {
      throw new Error(`${path} is not JSON (${e.message})`);
    }
    return { code: 0, out: JSON.stringify(summarize(counters, path), null, 2) + '\n', err: '' };
  } catch (e) {
    return failure('spawns', e);
  }
}

runIfEntry(import.meta.url, main);
