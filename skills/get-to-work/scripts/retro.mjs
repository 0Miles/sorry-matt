#!/usr/bin/env node
// retro: what each ticket of a run cost and what its review found, kept as one row per ticket in a file that spans
// runs, and a report over those rows (#156). It reads only what a run leaves behind anyway — the state file, the
// budget hook's counters file, the ledger's `session:` line and Claude Code's transcripts — so no extra measuring run
// is needed. Nothing a skill reads at runtime comes from the rows: reading the report is a person's job. No
// dependencies: runs on a bare Node 20+.
//
// Usage
//   node retro.mjs record --state <run>.state.json --counters <run>.counters.json --ledger <ledger.md>
//                         [--projects <dir>] [--retro <file>] [--now <UTC>]
//   node retro.mjs report [--since <YYYY-MM-DD>] [--by version|model|tier|profile] [--retro <file>] [--repo <path>]
//                         [--json]
//
// record  Writes one row per ticket of the state's run to the retro file (default `<git common dir>/sorry-matt/
//         retro.jsonl`, the directory above the state file's `runs/`). The run's earlier rows are replaced, so a
//         rerun of the same run leaves one row per ticket. Lines of the file that are not JSON, and rows of other
//         runs, are kept as they are. The file is replaced through a temporary file and a rename.
//         Where its inputs come from:
//           tickets, stages, reviews, counts   the state (state.mjs header), required
//           spawns                             the counters `log` (hooks/budget.mjs); a missing file: no agents
//           transcripts                        the ledger's first `session: <id>` line names the host session;
//                                              `<projects>/<slug>/<session>.jsonl` is the host's transcript and
//                                              `<projects>/<slug>/<session>/subagents/agent-<id>.jsonl` each agent's,
//                                              the review host's second-level agents included. `--projects`
//                                              defaults to `$CLAUDE_CONFIG_DIR/projects`, else `~/.claude/projects`;
//                                              every `<slug>` directory is searched
//           plugin version                     `.claude-plugin/plugin.json` in the nearest directory above this script
//           tracker, repo, base                the state's tick configuration (`tick.mjs setup`); a state without
//                                              one: no tracker, no base, and the repo from `git remote get-url
//                                              origin` of the state's repository, as owner/repo
//         Tokens are only ever the `message.usage` of a transcript, one count per `message.id` (a message that is
//         split over several lines counts once, its last line's usage). A ticket's agents are the counters entries
//         whose description names it (spawns.mjs `ticketOf`); an agent's kind is the role word its description
//         starts with (spawns.mjs ROLES), else its spawns.mjs category. An agent with no id or no transcript has
//         `tokens: null` and a `reason`; so has every kind and host sum it would be part of. An agent whose
//         description names no ticket of the run (`simplify <line>`, `ci-fix <line>`, `merge <line>`, the agents
//         those spawn) is the run's: `runAgents`, the same on every row of the run. Nothing is estimated
//         from time or agent counts (ASKING.md section 7, field 9). The host's tokens are those of its transcript's
//         messages from the run's start to `--now`; they are the run's, not a ticket's, and are the same on every row
//         of the run.
//         A row (format "sorry-matt/retro@1"; fields are only ever added, never renamed):
//           { "format", "run", "ticket", "recorded": "<UTC>", "started": "<UTC>", "repo": "<owner/repo>" | null,
//             "tracker": "github" | "local" | null, "base": "<base branch>" | null,
//             "line": "<integration branch>", "endState": "<stage>", "reason": <the ticket's reason> | null,
//             "pluginVersion": "<x.y.z>" | null,
//             "profile": { <the effective profile> }, "models": ["<model id>"],
//             "agents": [{ "id", "kind", "type", "description", "at", "models": [], "tokens": <tokens> | null,
//                          "reason"? }],
//             "byKind": { "<kind>": { "spawns": <n>, "tokens": <tokens> | null, "reason"? } },
//             "host": { "session": <id> | null, "models": [], "tokens": <tokens> | null, "reason"? },
//             "runAgents": [<as agents>],                  // the run's agents that name no ticket
//             "tier": "light" | "standard" | "full" | null,   // of the last initial review
//             "tierReasons": [<tier.mjs reason>] | null, "verdict": "pass" | "fix" | "stuck" | null,   // last review
//             "reviews": [{ "mode", "kind", "verdict", "tier", "tierReasons", "findingCounts", "findings": <n> | null,
//                           "observations", "preExisting", "at" }],
//             "findingCounts": { "candidates", "confirmed", "invalid", "blocking" } | null,   // summed over the
//                                                          // reviews that recorded them; null: none did
//             "sendBacks", "fixRounds", "timeoutExtensions": <n> | null,   // null: an older state that counted
//                                                          // extensions for the run only, and had some
//             "timeoutReassignments": <n>, "stageSeconds": { "<stage>": <seconds> },   // from the stage history;
//                                                          // the time before a ticket's first move is not known
//             "merges": ["<sha>"], "mergeSha": "<sha>" | null, "deliveredAt": "<UTC>" | null }
//           <tokens> is { "input", "output", "cacheWrite", "cacheRead" }.
//         Output: { "format": "sorry-matt/retro-record@1", "command": "record", "retro", "run", "rows", "replaced",
//                   "gaps": ["<reason>"] }   // gaps: each distinct reason a token sum is null
// report  Sums up the rows (those whose run started on or after `--since`), in one group, or one per plugin version,
//         set of models, review tier or profile with `--by`. Per group:
//           tokens by stage   stage of a kind: expand (expand, sorry-matt:expander), implement (implement,
//                             sorry-matt:implementer), fix (fix, ci-fix), review (review, finder, architect, verifier,
//                             fix-verifier and their sorry-matt: types), merge, simplify, other. `total` is the sum of
//                             the four token fields; agents with no tokens are counted in `unknownAgents`, not
//                             estimated. A run's `runAgents` count once in each group that has a row of the run
//           reviewToImplement review total over implement + fix total; null when the latter is 0
//           byTier            per review tier: `confirmed` (the confirmed rulings of every review: a minimal review's
//                             findings count as confirmed), `reviewTokens` (the review stage of the tier's tickets
//                             whose every review has a known count; the others are counted in `unknownCounts`),
//                             `tokensPerConfirmed` (null with no confirmed finding), and `zeroConfirmedShare`, the
//                             share of initial reviews with a known count of 0 confirmed
//           escaped           for each delivered ticket: newer tickets on the GitHub tracker whose title or body names
//                             it (`#N`) or one of its merge SHAs (7 characters or more), whether a commit reverts a
//                             merge SHA (`This reverts commit <sha>` in `git log --all` of `--repo`, default the
//                             current directory; a ticket that went from delivered to stuck for its own red light
//                             counts as reverted, one stuck as `upstream reverted:` is looked up like any other), and
//                             whether a CI run failed after its delivery on the branch it was merged into (its
//                             integration branch, the base branch under `integrate: direct`). What cannot be read
//                             (`gh` missing or failing, a Local Markdown tracker or no GitHub repo, `git` failing) is
//                             "unknown"; the report goes on.
//         Output: a Markdown table per group; with `--json`, { "format": "sorry-matt/retro-report@1", "since", "by",
//                 "rows", "groups": [{ "key", "tickets", "runs", "tokensByStage", "unknownAgents", "reviewToImplement",
//                 "byTier", "escaped": { "delivered", "escaped", "unknown", "tickets": [...] } }] }.
//
// The rows cannot say that one way is better than another: runs have no control group and tickets differ in size.
// They show outliers — a kind of ticket that always gets the full tier and never a confirmed finding — and every row
// carries its plugin version and models so that rows of different rules or models are not compared as one.
//
// record takes `<retro>.lock` around its read and rewrite of the retro file (state.mjs withLock), so two runs that
// record at once both keep their rows.
//
// Exit codes: 0 done; 1 a file could not be read or written, or is not what it should be (the state, the retro file),
// or the lock could not be taken;
// 2 bad arguments.
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, failure, parseJson, run, runIfEntry } from './cli.mjs';
import { ROLES, category, ticketOf } from './spawns.mjs';
import { PROFILE_DEFAULTS, STAGES, withLock } from './state.mjs';

export const FORMAT = 'sorry-matt/retro@1';
export const RECORD_FORMAT = 'sorry-matt/retro-record@1';
export const REPORT_FORMAT = 'sorry-matt/retro-report@1';
export const BY = ['version', 'model', 'tier', 'profile'];
const TOKEN_FIELDS = [
  ['input', 'input_tokens'],
  ['output', 'output_tokens'],
  ['cacheWrite', 'cache_creation_input_tokens'],
  ['cacheRead', 'cache_read_input_tokens'],
];
const STAGE_OF = {
  expand: 'expand',
  'sorry-matt:expander': 'expand',
  implement: 'implement',
  'sorry-matt:implementer': 'implement',
  fix: 'fix',
  'ci-fix': 'fix',
  review: 'review',
  finder: 'review',
  architect: 'review',
  verifier: 'review',
  'fix-verifier': 'review',
  'sorry-matt:finder': 'review',
  'sorry-matt:architect': 'review',
  'sorry-matt:verifier': 'review',
  'sorry-matt:fix-verifier': 'review',
  merge: 'merge',
  simplify: 'simplify',
};
export const REPORT_STAGES = ['expand', 'implement', 'fix', 'review', 'merge', 'simplify', 'other'];
const UNKNOWN = 'unknown';

// ---- values ----------------------------------------------------------------------------------------------------------

const zero = () => Object.fromEntries(TOKEN_FIELDS.map(([k]) => [k, 0]));
const addTokens = (to, from) => {
  for (const [k] of TOKEN_FIELDS) to[k] += from[k];
  return to;
};
const totalOf = (t) => TOKEN_FIELDS.reduce((n, [k]) => n + t[k], 0);
const seconds = (from, to) => Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000));
const readText = (p) => readFileSync(p, 'utf8');
const readJson = (p, what) => {
  try {
    return parseJson(readText(p));
  } catch (e) {
    throw new Error(`${what} ${p}: ${e.code === 'ENOENT' ? 'no such file' : e.message}`);
  }
};

/** The kind an agent of the counters log counts under: its description's role word, else its spawns.mjs category. */
export function kindOf(entry) {
  const word = String(entry.description ?? '').trim().split(/\s+/)[0].toLowerCase();
  return ROLES.includes(word) ? word : category(entry);
}

/** The report stage of a kind. */
export const stageOf = (kind) => STAGE_OF[kind] ?? 'other';

/**
 * The usage of one transcript (JSON lines): one count per `message.id`, the last line of a message winning, and the
 * models it ran on. `since`/`until` (UTC) keep only lines whose `timestamp` lies between them. Lines that are not
 * JSON (a transcript cut off mid-write) are skipped.
 */
export function transcriptUsage(text, { since = null, until = null } = {}) {
  const byId = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const m = entry?.message;
    if (!m || typeof m.id !== 'string' || !m.usage || typeof m.usage !== 'object') continue;
    const at = Date.parse(entry.timestamp);
    if ((since && !(at >= Date.parse(since))) || (until && !(at <= Date.parse(until)))) continue;
    byId.set(m.id, m);
  }
  const tokens = zero();
  const models = new Set();
  for (const m of byId.values()) {
    for (const [k, field] of TOKEN_FIELDS) tokens[k] += Number.isFinite(m.usage[field]) ? m.usage[field] : 0;
    if (typeof m.model === 'string' && m.model && !m.model.startsWith('<')) models.add(m.model);
  }
  return { tokens, models: [...models].sort(), messages: byId.size };
}

/** The first `session: <id>` line of a ledger (a list bullet and backticks allowed), as the budget hook reads it. */
export function sessionOf(text) {
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*(?:[-*]\s+)?`?session:\s*`?\s*([^`\s]+)\s*`?\s*`?\s*$/.exec(line);
    if (m) return m[1];
  }
  return null;
}

/** owner/repo of a GitHub remote URL, or null. */
export function repoOf(url) {
  const m = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(String(url ?? '').trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/** The version in the nearest `.claude-plugin/plugin.json` above `from`, or null. */
export function pluginVersion(from = dirname(fileURLToPath(import.meta.url))) {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const file = join(dir, '.claude-plugin', 'plugin.json');
    if (existsSync(file)) {
      try {
        const v = parseJson(readText(file)).version;
        return typeof v === 'string' ? v : null;
      } catch {
        return null;
      }
    }
    if (dirname(dir) === dir) return null;
  }
}

// ---- transcripts -----------------------------------------------------------------------------------------------------

/** Where a session's transcripts are: its host transcript files and its session directories, across every slug. */
function sessionPlaces(projects, session) {
  if (!session) return { reason: 'the ledger has no session: line', hosts: [], dirs: [] };
  let slugs;
  try {
    slugs = readdirSync(projects, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(projects, d.name));
  } catch {
    return { reason: `no transcript directory ${projects}`, hosts: [], dirs: [] };
  }
  const hosts = slugs.map((s) => join(s, `${session}.jsonl`)).filter((p) => existsSync(p));
  const dirs = slugs.map((s) => join(s, session)).filter((p) => existsSync(p));
  return { reason: null, hosts, dirs };
}

function agentUsage(places, entry) {
  if (places.reason) return { tokens: null, models: [], reason: places.reason };
  if (typeof entry.id !== 'string' || !entry.id) return { tokens: null, models: [], reason: 'the counters log has no agent id' };
  const file = places.dirs.map((d) => join(d, 'subagents', `agent-${entry.id}.jsonl`)).find((p) => existsSync(p));
  if (!file) return { tokens: null, models: [], reason: `no transcript for agent ${entry.id}` };
  const u = transcriptUsage(readText(file));
  return { tokens: u.tokens, models: u.models };
}

function hostUsage(places, session, since, until) {
  if (places.reason) return { session, models: [], tokens: null, reason: places.reason };
  if (!places.hosts.length) return { session, models: [], tokens: null, reason: `no transcript for host session ${session}` };
  const tokens = zero();
  const models = new Set();
  for (const file of places.hosts) {
    const u = transcriptUsage(readText(file), { since, until });
    addTokens(tokens, u.tokens);
    u.models.forEach((m) => models.add(m));
  }
  return { session, models: [...models].sort(), tokens };
}

// ---- record ----------------------------------------------------------------------------------------------------------

function stageSeconds(history) {
  const out = {};
  history.forEach((h, i) => {
    const next = history[i + 1];
    if (next && h.at && next.at) out[h.to] = (out[h.to] ?? 0) + seconds(h.at, next.at);
  });
  return out;
}

function reviewRow(r) {
  return {
    mode: r.mode,
    kind: r.kind ?? 'full',
    verdict: r.verdict,
    tier: r.tier ?? null,
    tierReasons: r.tierReasons ?? null,
    findingCounts: r.findingCounts ?? null,
    findings: Array.isArray(r.findings) ? r.findings.length : null,
    observations: r.observations ?? null,
    preExisting: r.preExisting ?? null,
    at: r.at ?? null,
  };
}

/** The rows of one run: one per ticket of its state. */
export function rowsOf({ state, log, logReason, session, places, version, repo, tracker = null, base = null, now }) {
  const started = state.usage?.started ?? state.created;
  const host = hostUsage(places, session, started, now);
  const profile = { ...PROFILE_DEFAULTS, ...(state.profile ?? {}) };
  const agents = log.map((entry) => {
    const ticket = ticketOf(entry.description);
    const u = agentUsage(places, entry);
    return {
      ticket: ticket && ticket in state.tickets ? ticket : null,
      agent: { id: entry.id ?? null, kind: kindOf(entry), type: entry.type ?? null, description: entry.description ?? null, at: entry.at ?? null, models: u.models, tokens: u.tokens, ...(u.reason ? { reason: u.reason } : {}) },
    };
  });
  const runAgents = agents.filter((a) => a.ticket === null).map((a) => a.agent);
  return Object.entries(state.tickets).map(([id, t]) => {
    const mine = agents.filter((a) => a.ticket === id).map((a) => a.agent);
    const byKind = {};
    for (const a of mine) {
      const k = (byKind[a.kind] ??= { spawns: 0, tokens: zero(), reasons: [] });
      k.spawns += 1;
      if (a.tokens && k.tokens) addTokens(k.tokens, a.tokens);
      else {
        k.tokens = null;
        k.reasons.push(a.reason);
      }
    }
    for (const k of Object.values(byKind)) {
      if (k.reasons.length) k.reason = [...new Set(k.reasons)].join('; ');
      delete k.reasons;
    }
    const reviews = (t.reviews ?? []).map(reviewRow);
    const initial = reviews.filter((r) => r.mode === 'initial').at(-1) ?? null;
    const counted = reviews.filter((r) => r.findingCounts);
    const findingCounts = counted.length
      ? counted.reduce((s, r) => ({ candidates: s.candidates + r.findingCounts.candidates, confirmed: s.confirmed + r.findingCounts.confirmed, invalid: s.invalid + r.findingCounts.invalid, blocking: s.blocking + r.findingCounts.blocking }), { candidates: 0, confirmed: 0, invalid: 0, blocking: 0 })
      : null;
    const history = t.history ?? [];
    const merges = (t.merges ?? []).map((m) => (typeof m === 'string' ? m : m.sha));
    return {
      format: FORMAT,
      run: state.run,
      ticket: id,
      recorded: now,
      started,
      repo,
      tracker,
      base,
      line: t.line,
      endState: t.stage,
      reason: t.reason ?? null,
      pluginVersion: version,
      profile,
      models: [...new Set(mine.flatMap((a) => a.models))].sort(),
      agents: mine,
      byKind: mine.length || !logReason ? byKind : null,
      ...(logReason && !mine.length ? { byKindReason: logReason } : {}),
      host,
      runAgents,
      tier: initial?.tier ?? null,
      tierReasons: initial?.tierReasons ?? null,
      verdict: reviews.at(-1)?.verdict ?? null,
      reviews,
      findingCounts,
      sendBacks: t.sendBacks ?? 0,
      fixRounds: t.fixRounds ?? 0,
      timeoutExtensions: t.timeoutExtensions ?? (state.usage?.timeoutExtensions ? null : 0),
      timeoutReassignments: Object.values(t.timeoutReassignments ?? {}).reduce((n, x) => n + (Number.isInteger(x) ? x : 0), 0),
      stageSeconds: stageSeconds(history),
      merges,
      mergeSha: merges[0] ?? null,
      deliveredAt: history.find((h) => h.to === 'delivered')?.at ?? null,
    };
  });
}

/** The retro file's lines, split into this run's rows and everything else (kept as it is). */
function readRetro(path) {
  if (!existsSync(path)) return [];
  return readText(path).split(/\r?\n/).filter((l) => l.trim());
}

function writeAtomic(path, text) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

export function record(flags, deps) {
  for (const k of ['state', 'counters', 'ledger']) if (!flags[k]) throw new UsageError(`record needs --${k} <path>`);
  const statePath = resolve(flags.state);
  const state = readJson(statePath, 'state');
  if (!state || state.format !== 'sorry-matt/state@1' || typeof state.run !== 'string' || !state.tickets || typeof state.tickets !== 'object')
    throw new Error(`${statePath} is not a sorry-matt state file`);
  for (const t of Object.values(state.tickets)) if (!STAGES.includes(t?.stage)) throw new Error(`${statePath} is not a sorry-matt state file`);

  let log = [];
  let logReason = null;
  if (!existsSync(flags.counters)) logReason = `no counters file ${flags.counters}`;
  else {
    const counters = readJson(flags.counters, 'counters');
    if (!Array.isArray(counters?.log)) logReason = `the counters file ${flags.counters} has no spawn log`;
    else log = counters.log.filter((e) => e && typeof e === 'object');
  }
  let session = null;
  let ledgerReason = null;
  try {
    session = sessionOf(readText(flags.ledger));
  } catch {
    ledgerReason = `no ledger ${flags.ledger}`;
  }
  const env = deps.env ?? process.env;
  const projects = resolve(flags.projects ?? (env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, 'projects') : join(deps.home ?? homedir(), '.claude', 'projects')));
  const places = ledgerReason ? { reason: ledgerReason, hosts: [], dirs: [] } : sessionPlaces(projects, session);
  // the tracker and base the run was set up with (tick.mjs setup); an older state: the origin remote's repo
  const config = state.tick?.config && typeof state.tick.config === 'object' ? state.tick.config : null;
  const tracker = typeof config?.tracker === 'string' ? config.tracker : null;
  const base = typeof config?.base === 'string' ? config.base : null;
  let repo = null;
  if (config) repo = tracker === 'github' && typeof config.repo === 'string' ? config.repo : null;
  else {
    try {
      repo = repoOf(deps.git(['remote', 'get-url', 'origin'], dirname(statePath)));
    } catch {
      repo = null;
    }
  }
  const now = flags.now ?? new Date(deps.clock()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const rows = rowsOf({ state, log, logReason, session, places, version: deps.version ?? pluginVersion(), repo, tracker, base, now });

  const retro = resolve(flags.retro ?? join(dirname(dirname(statePath)), 'retro.jsonl'));
  // #156: under the lock, so a run recording at the same time is not lost between this read and the rename
  const replaced = withLock(retro, () => {
    const kept = [];
    let n = 0;
    for (const line of readRetro(retro)) {
      let row = null;
      try {
        row = JSON.parse(line);
      } catch {
        row = null;
      }
      if (row?.format === FORMAT && row.run === state.run) n += 1;
      else kept.push(line);
    }
    writeAtomic(retro, [...kept, ...rows.map((r) => JSON.stringify(r))].map((l) => `${l}\n`).join(''));
    return n;
  });
  const gaps = new Set();
  for (const r of rows) {
    if (r.byKindReason) gaps.add(r.byKindReason);
    for (const a of [...r.agents, ...r.runAgents]) if (a.reason) gaps.add(a.reason);
    if (r.host.reason) gaps.add(r.host.reason);
  }
  return { format: RECORD_FORMAT, command: 'record', retro, run: state.run, rows: rows.length, replaced, gaps: [...gaps] };
}

// ---- report ----------------------------------------------------------------------------------------------------------

const groupKey = {
  version: (r) => r.pluginVersion ?? UNKNOWN,
  model: (r) => (r.models?.length ? r.models.join('+') : UNKNOWN),
  tier: (r) => r.tier ?? 'none',
  profile: (r) => Object.entries(r.profile ?? {}).map(([k, v]) => `${k}=${v}`).join(',') || UNKNOWN,
};

/** The escaped-defect signals of a ticket's row, from what `gh` and `git` give (memoised per repo and branch). */
function escapes(row, look) {
  if (!row.deliveredAt) return null;
  const shas = (row.merges ?? []).filter((s) => typeof s === 'string' && s.length >= 7);
  let mentions = UNKNOWN;
  const issues = row.repo && row.tracker !== 'local' ? look.issues(row.repo) : null;
  if (issues) {
    const num = /^#(\d+)$/.exec(row.ticket)?.[1];
    const names = (text) =>
      (num && new RegExp(`(^|[^\\w&/])#${num}(?!\\w)`).test(text)) ||
      (String(text).match(/\b[0-9a-f]{7,64}\b/g) ?? []).some((tok) => shas.some((s) => s.startsWith(tok) || tok.startsWith(s)));
    mentions = issues
      .filter((i) => `#${i.number}` !== row.ticket && Date.parse(i.createdAt) > Date.parse(row.deliveredAt) && names(`${i.title ?? ''}\n${i.body ?? ''}`))
      .map((i) => `#${i.number}`);
  }
  // stuck after delivery for its own red light is its revert; `upstream reverted:` is another ticket's
  const upstream = /^upstream reverted:/.test(String(row.reason ?? ''));
  let reverted = row.endState === 'stuck' && !upstream ? true : UNKNOWN;
  if (reverted !== true) {
    const bodies = look.log();
    if (bodies !== null) reverted = shas.some((s) => new RegExp(`This reverts commit ${s}`).test(bodies));
  }
  let ciRed = UNKNOWN;
  const branch = row.profile?.integrate === 'direct' ? row.base : row.line;
  const runs = row.repo && branch ? look.runs(row.repo, branch) : null;
  if (runs) ciRed = runs.some((r) => r.conclusion === 'failure' && Date.parse(r.createdAt) > Date.parse(row.deliveredAt));
  const escaped = (Array.isArray(mentions) && mentions.length > 0) || reverted === true || ciRed === true;
  const unknown = !escaped && [mentions, reverted, ciRed].includes(UNKNOWN);
  return { run: row.run, ticket: row.ticket, mentions, reverted, ciRed, escaped, unknown };
}

function lookups(deps, repoDir) {
  const memo = new Map();
  const once = (key, fn) => {
    if (!memo.has(key)) {
      try {
        memo.set(key, fn());
      } catch {
        memo.set(key, null);
      }
    }
    return memo.get(key);
  };
  return {
    issues: (repo) => once(`issues:${repo}`, () => JSON.parse(deps.gh(['issue', 'list', '--repo', repo, '--state', 'all', '--limit', '1000', '--json', 'number,title,body,createdAt']))),
    runs: (repo, branch) => once(`runs:${repo}:${branch}`, () => JSON.parse(deps.gh(['run', 'list', '--repo', repo, '--branch', branch, '--limit', '100', '--json', 'conclusion,createdAt,headSha']))),
    log: () => once('log', () => deps.git(['log', '--all', '--format=%B'], repoDir)),
  };
}

function summarize(key, rows, look) {
  const tokensByStage = Object.fromEntries(REPORT_STAGES.map((s) => [s, zero()]));
  let unknownAgents = 0;
  // a run's own agents count once in the group, whichever of its rows brings them
  const runs = new Map();
  for (const r of rows) if (!runs.has(r.run)) runs.set(r.run, r.runAgents ?? []);
  for (const a of [...rows.flatMap((r) => r.agents ?? []), ...[...runs.values()].flat()]) {
    if (a.tokens) addTokens(tokensByStage[stageOf(a.kind)], a.tokens);
    else unknownAgents += 1;
  }
  for (const s of REPORT_STAGES) tokensByStage[s].total = totalOf(tokensByStage[s]);
  const implement = tokensByStage.implement.total + tokensByStage.fix.total;
  const byTier = {};
  for (const r of rows) {
    const tier = r.tier ?? 'none';
    const b = (byTier[tier] ??= { tickets: 0, reviews: 0, confirmed: 0, reviewTokens: 0, unknownCounts: 0, initialKnown: 0, initialZero: 0 });
    b.tickets += 1;
    const confirmedOf = (v) => (v.findingCounts ? v.findingCounts.confirmed : v.kind === 'minimal' ? (v.findings ?? 0) : null);
    // #156: a ticket with a review of unknown count spent review tokens on findings no one counted: left out
    if ((r.reviews ?? []).some((v) => confirmedOf(v) === null)) b.unknownCounts += 1;
    else b.reviewTokens += (r.agents ?? []).filter((a) => a.tokens && stageOf(a.kind) === 'review').reduce((n, a) => n + totalOf(a.tokens), 0);
    for (const v of r.reviews ?? []) {
      const confirmed = confirmedOf(v);
      if (confirmed === null) continue;
      b.reviews += 1;
      b.confirmed += confirmed;
      if (v.mode === 'initial') {
        b.initialKnown += 1;
        if (confirmed === 0) b.initialZero += 1;
      }
    }
  }
  for (const b of Object.values(byTier)) {
    b.tokensPerConfirmed = b.confirmed ? Math.round(b.reviewTokens / b.confirmed) : null;
    b.zeroConfirmedShare = b.initialKnown ? b.initialZero / b.initialKnown : null;
    delete b.initialKnown;
    delete b.initialZero;
  }
  const signals = rows.map((r) => escapes(r, look)).filter(Boolean);
  return {
    key,
    tickets: rows.length,
    runs: runs.size,
    tokensByStage,
    unknownAgents,
    reviewToImplement: implement ? tokensByStage.review.total / implement : null,
    byTier,
    escaped: { delivered: signals.length, escaped: signals.filter((s) => s.escaped).length, unknown: signals.filter((s) => s.unknown).length, tickets: signals },
  };
}

const fmt = (n) => (n === null || n === undefined ? UNKNOWN : typeof n === 'number' && !Number.isInteger(n) ? n.toFixed(2) : String(n));

function markdown(out) {
  const lines = [`# Retro report${out.since ? ` since ${out.since}` : ''}${out.by ? ` by ${out.by}` : ''}`, '', `${out.rows} rows.`, ''];
  for (const g of out.groups) {
    lines.push(`## ${g.key}`, '', `${g.tickets} tickets of ${g.runs} runs; review / implement + fix tokens: ${fmt(g.reviewToImplement)}; agents with no tokens: ${g.unknownAgents}`, '');
    lines.push('| stage | input | output | cache write | cache read | total |', '| --- | ---: | ---: | ---: | ---: | ---: |');
    for (const [s, t] of Object.entries(g.tokensByStage)) if (t.total) lines.push(`| ${s} | ${t.input} | ${t.output} | ${t.cacheWrite} | ${t.cacheRead} | ${t.total} |`);
    lines.push('', '| tier | tickets | reviews | confirmed | review tokens | unknown counts | tokens per confirmed | zero-confirmed share |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const [tier, b] of Object.entries(g.byTier)) lines.push(`| ${tier} | ${b.tickets} | ${b.reviews} | ${b.confirmed} | ${b.reviewTokens} | ${b.unknownCounts} | ${fmt(b.tokensPerConfirmed)} | ${fmt(b.zeroConfirmedShare)} |`);
    lines.push('', `Escaped: ${g.escaped.escaped} of ${g.escaped.delivered} delivered (${g.escaped.unknown} unknown).`, '');
    if (g.escaped.tickets.length) {
      lines.push('| run | ticket | named by | reverted | CI red after |', '| --- | --- | --- | --- | --- |');
      for (const s of g.escaped.tickets) lines.push(`| ${s.run} | ${s.ticket} | ${Array.isArray(s.mentions) ? s.mentions.join(', ') || 'none' : UNKNOWN} | ${s.reverted} | ${s.ciRed} |`);
      lines.push('');
    }
  }
  return `${lines.join('\n')}\n`;
}

export function report(flags, deps) {
  if (flags.by !== undefined && !BY.includes(flags.by)) throw new UsageError(`--by: expected one of ${BY.join(', ')}, got ${JSON.stringify(flags.by)}`);
  if (flags.since !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(flags.since) || Number.isNaN(Date.parse(flags.since))))
    throw new UsageError(`--since: expected a date like 2026-01-31, got ${JSON.stringify(flags.since)}`);
  const repoDir = resolve(flags.repo ?? '.');
  let retro = flags.retro;
  if (!retro) {
    const common = deps.git(['rev-parse', '--git-common-dir'], repoDir).trim();
    retro = join(resolve(repoDir, common), 'sorry-matt', 'retro.jsonl');
  }
  let text;
  try {
    text = readText(retro);
  } catch (e) {
    throw new Error(`retro ${retro}: ${e.code === 'ENOENT' ? 'no such file (run record first)' : e.message}`);
  }
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row?.format !== FORMAT) continue;
    if (flags.since && !(String(row.started ?? '').slice(0, 10) >= flags.since)) continue;
    rows.push(row);
  }
  const look = lookups(deps, repoDir);
  const groups = new Map();
  for (const r of rows) {
    const key = flags.by ? groupKey[flags.by](r) : 'all';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const out = { format: REPORT_FORMAT, since: flags.since ?? null, by: flags.by ?? null, rows: rows.length, groups: [...groups].map(([k, g]) => summarize(k, g, look)) };
  return flags.json ? `${JSON.stringify(out, null, 2)}\n` : markdown(out);
}

// ---- entry -----------------------------------------------------------------------------------------------------------

const SPECS = {
  record: { state: 'one', counters: 'one', ledger: 'one', projects: 'one', retro: 'one', now: 'one' },
  report: { since: 'one', by: 'one', retro: 'one', repo: 'one', json: 'bool' },
};

function parseFlags(argv, spec) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z-]+)$/.exec(argv[i]);
    if (!m || !(m[1] in spec)) throw new UsageError(`unknown argument ${JSON.stringify(argv[i])}`);
    if (m[1] in flags) throw new UsageError(`--${m[1]} given twice`);
    if (spec[m[1]] === 'bool') flags[m[1]] = true;
    else {
      if (i + 1 >= argv.length) throw new UsageError(`--${m[1]} needs a value`);
      flags[m[1]] = argv[++i];
    }
  }
  return flags;
}

export function defaultDeps() {
  return {
    git: (args, cwd) => run('git', args, cwd),
    gh: (args) => run('gh', args),
    clock: () => Date.now(),
    env: process.env,
  };
}

export function main(argv, deps = defaultDeps()) {
  try {
    const [command, ...rest] = argv;
    if (!(command in SPECS)) throw new UsageError(`expected one of ${Object.keys(SPECS).join(', ')}`);
    const flags = parseFlags(rest, SPECS[command]);
    if (command === 'record') {
      if (flags.now !== undefined && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(flags.now)) throw new UsageError(`--now: expected a UTC time like 2026-01-31T23:59:59Z`);
      return { code: 0, out: `${JSON.stringify(record(flags, deps), null, 2)}\n`, err: '' };
    }
    return { code: 0, out: report(flags, deps), err: '' };
  } catch (e) {
    return failure('retro', e);
  }
}

runIfEntry(import.meta.url, main);
