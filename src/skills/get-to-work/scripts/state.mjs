#!/usr/bin/env node
// state: the machine-written run state of get-to-work's pipeline, `<run>.state.json` next to the run ledger
// (`<git common dir>/sorry-matt/runs/<run>.state.json`). It holds what used to be ledger field 4 (lines, tip SHAs,
// CI results, the per-SHA local verification records, the base sync), field 8 (the reconciliation table: one row
// per ticket with its stage, assignment record, counts and merge SHAs) and field 9 (usage and the stop reason).
// Only this script writes it; the host never edits the file by hand. The narrative fields (next action, self-answer
// log, human-work list, rule files) and the `rule:` / `budget:` lines that hooks/runs.mjs and hooks/budget.mjs read
// stay in the ledger. This header is the single source of truth for the file's schema and for the stage rules.
// No dependencies: runs on a bare Node 20+.
//
// Usage (every command takes the state file first; `--now <UTC>` fixes the clock on the commands that write)
//   node state.mjs init     <state> --run <run> [--tracker github|local]
//   node state.mjs import   <state> --from <seed.json> [--ledger <ledger.md>]
//   node state.mjs profile  <state> [--review full|minimal] [--fixRounds 0|1|2] [--recheck true|false]
//                           [--onUnfixed stuck|file-issue] [--expand agent|skip]
//                           [--integrate aggregate-pr|direct|ticket-pr] [--ci read|skip] [--simplify true|false]
//   node state.mjs show     <state>
//   node state.mjs resume   <state>
//   node state.mjs add      <state> <ticket>... --line <integration branch>
//   node state.mjs bundle   <state> <lead> <member>...
//   node state.mjs line     <state> <integration branch> [--lines <line>,<line>] [--tip <sha>]
//                           [--base <sha> --synced yes|no]
//   node state.mjs set      <state> <ticket> [--snapshot <sha256>] [--status-record <where>] [--branch <ticket branch>]
//                           [--deliverable <text>] [--verification <text>] [--unfixed-issue <issue id>]
//                           [--pr <number>] [--stack-parent <ticket>|none] [--waiting-on <ticket>,<ticket>|none]
//   node state.mjs stage   <state> <stage> <ticket>... [--reason <text>]
//   node state.mjs review   <state> <ticket> --mode initial|recheck --verdict pass|fix|stuck [--kind full|minimal]
//                           [--tier light|standard|full [--tier-reason <reason>]...]
//                           [--findings <id>,<id>] [--observations <n>] [--pre-existing <n>]
//                           [--candidates <n> --confirmed <n> --invalid <n> --blocking <n>] [--covered <n>]
//   node state.mjs report   <state> <ticket> [--fixed <id>,<id>] [--unfixed <id>,<id>]
//   node state.mjs merge    <state> <ticket> <merge sha>
//   node state.mjs assign   <state> <ticket>... --record <record.json> --type <agent type> [--worktree <path>] [--reassign]
//   node state.mjs assign   <state> --line <integration branch> --record <record.json> --type <agent type> --worktree <path>
//   node state.mjs agent    <state> <ticket>... | --line <integration branch>  --id <agent id>
//   node state.mjs extend   <state> <ticket>... | --line <integration branch>  --deadline <UTC>
//   node state.mjs release  <state> <ticket>... | --line <integration branch>  [--stopped]
//   node state.mjs ci       <state> <integration branch> --from <verdict.json> [--dispatch] [--branch-runs <n>]
//   node state.mjs local    <state> <integration branch> <full sha> green|red no-origin|ci-not-covering|no-verdict
//   node state.mjs usage    <state> [--started <UTC>] [--wait <seconds>] [--spawns <n>] [--add <counter>=<n>]...
//                           [--sleep-task <task id>|none] [--tokens <n>|unknown]
//   node state.mjs progress <state> --from <progress.json> [--note <text>]
//   node state.mjs check    <state> <gate> [<ticket or branch>...] [--repo <path>] [--base <ref>] [--ledger <path>]
//                           [--ended]
//
// Times are UTC, written `YYYY-MM-DDTHH:MM:SSZ`, as in deadline.mjs. A ticket id is the tracker's id (`#12`) or the
// ticket file name; an integration branch is the `<run>/<line-slug>` name. SHAs are lowercase hex, 7–64 digits
// (`local` takes the full 40 or 64).
//
// The file (format "sorry-matt/state@1"; fields are only ever added, never renamed; keys this version does not
// know are kept as they are on every write, so fields a later script adds survive)
//   { "format": "sorry-matt/state@1", "run": "<run>",
//     "tracker": "github" | "local" | null,               // set by init --tracker or the seed's `tracker`; null:
//                                                          // unknown (missing in an older file: null; #188)
//     "created": "<UTC>", "updated": "<UTC>", "revision": <writes so far>,
//     "imported": "<UTC>" | null,                         // set by import
//     "profile": null | { "review", "fixRounds", "recheck", "onUnfixed", "expand", "integrate", "ci", "simplify" },
//                                                          // written once (see Profile); null: the defaults
//     "lines": { "<integration branch>": {
//         "lines": ["<frontier.mjs line>"],                // the lines joined into this branch at the freeze
//         "tip": "<sha>" | null,                           // set by `line --tip` and by every `merge`
//         "ci": { "sha", "verdict", "reason", "at" } | null,   // the latest ci.mjs verdict recorded
//         "noRun": { "count": <n>, "round": <dispatch point> | null },   // consecutive dispatch points that
//                                                          // read an empty run list
//         "ciNotCovering": { "sha", "at" } | null,         // settled: CI does not cover the branch
//         "local": [{ "sha", "result": "green" | "red", "reason", "at" }],   // per-SHA local verification
//         "base": { "sha", "synced": true | false, "at" } | null,           // the finish's base sync
//         "assignment": null | { …as a ticket's, a { head, tree } fingerprint } } },   // the agent that works on
//                                                          // the line itself: the ci-fix of a red light that maps
//                                                          // to no ticket (missing in an older file: null)
//     "tickets": { "<ticket>": {
//         "line": "<integration branch>", "stage": "<stage>", "branch": "<ticket branch>" | null,
//         "deliverable", "verification", "statusRecord": <text> | null,   // free text the host gives
//         "snapshotSha256": "<sha256 of the acceptance snapshot>" | null,
//         "assignment": null | {                           // the current assignment record
//           "agentId": "<id>" | null, "type": "<subagent_type>", "worktree": "<path>" | null,
//           "assigned", "limit", "deadline": "<UTC>" | null, "extended": "no" | "yes",
//           "fingerprint": { "head", "tree" } | { "expansions": { "<ticket>": <n> } } },
//         "timeoutReassignments": { "implementing": <n>, "fixing": <n>, "expanding": <n>,
//                                   "in-review": <n> },     // the review host (#143); missing in an older file: 0
//         "sendBacks": <n>, "fixRounds": <n>,
//         "timeoutExtensions": <n>,                        // extensions of the agents that covered the ticket
//                                                          // (#156); missing in an older file, and in an
//                                                          // imported ticket whose seed gave none (#171)
//         "reviews": [{ "mode": "initial" | "recheck", "verdict": "pass" | "fix" | "stuck", "kind": "full" | "minimal",
//                       "tier": "light" | "standard" | "full" | null,   // the review tier tick judged; null: none
//                       "tierReasons": ["<tier.mjs reason>"] | null,    // its judge output's `reasons` (#156)
//                       "findings": ["<finding id>"] | null, "observations": <n>, "preExisting": <n>, "at",
//                       "findingCounts": { "candidates", "confirmed", "invalid", "blocking" } | null,   // (#156);
//                                                          // confirmed + invalid <= candidates, blocking <= confirmed
//                       "covered": <n>,                    // #205: candidates another open ticket of the run
//                                                          // covers; missing when the report gave none
//                       "after": <history length when recorded> }],   // the counts of the review report (#142)
//                                                          // tierReasons and findingCounts missing: an older file
//         "fixReports": [{ "fixed": [<finding id>], "unfixed": [<finding id>], "at", "after": <n> }],   // the
//                                                          // implementer's per-finding report (recheck: false)
//         "unfixedIssue": "<issue filed for unfixed findings>" | null,   // onUnfixed: file-issue
//         "pr": <the ticket's own pull request number> | null,           // its ticket-level PR (#188)
//         "stackParent": "<ticket>" | null,                // the ticket its PR is stacked on
//         "waitingOn": ["<ticket>"],                       // the upstream tickets it waits to see merged
//                                                          // stackParent and each waitingOn: another ticket of this
//                                                          // state, none twice; all three missing in an older file:
//                                                          // read as null, null, []
//         "merges": [{ "sha", "at" }],                     // every merge of the ticket, `-ci` merges included
//         "reason": "<why stuck or awaiting ruling>" | null,
//         "history": [{ "from", "to", "at", "reason" }],
//         "members": ["<ticket>"] } },                     // #205: a bundle's other tickets, this one its lead;
//                                                          // missing on a ticket that leads no bundle
//     "usage": { "started": "<UTC>" | null, "startedNote": <text> | null, "waitingSeconds": <n>,
//                "spawns": <n>, "spawnsSource": "counters" | "host", "rounds": <dispatch points>,
//                "noProgress": <n>, "snapshot": { "tips", "terminal" } | null,
//                "reviewRounds", "fixRounds", "fullVerifications", "sendBacks", "timeoutExtensions",
//                "timeoutStops", "compactions": <n>,
//                "sleepTask": "<task id>" | null, "tokens": <n> | null },   // tokens null: unknown
//     "stop": null | { "at", "stoppedBy": [<limit>], "usage": { "rounds", "spawns", "hours" }, "note" } }
//
// Stages: candidate → expanding → implementing → in-review → fixing → queued → integrating → an end state:
// delivered, stuck, awaiting-ruling. In flight means implementing through integrating. `stage` moves tickets only
// along these edges; every other move is refused:
//   candidate     → expanding, implementing, awaiting-ruling, stuck
//   expanding     → candidate, awaiting-ruling, stuck          (the expansion agent reported, or timed out twice)
//   implementing  → in-review, awaiting-ruling, stuck
//   in-review     → fixing, queued, awaiting-ruling, stuck
//   fixing        → in-review, awaiting-ruling, stuck          (the recheck after a fix round)
//   queued        → integrating, awaiting-ruling, stuck
//   integrating   → delivered, candidate (send back for a redo), awaiting-ruling, stuck
//   delivered     → stuck                                       (red-light revert, or upstream reverted)
//   stuck, awaiting-ruling → nothing
// and these guards hold on top, each refused with what is missing (the profile's defaults shown; see Profile):
//   - implementing from candidate needs the acceptance snapshot's sha256 (`set --snapshot`);
//   - queued needs a `pass` from a prove-it review (or a minimal review recorded with review tier light) as the latest review
//     recorded since the ticket last entered in-review; fixing needs a `fix` there, and at most two fix rounds per ticket (a third is refused: mark it
//     stuck);
//   - delivered needs a merge SHA recorded with `merge`;
//   - integrating → candidate (send back) at most once per ticket (a second is refused: mark it stuck);
//   - an end state never returns to a stage in flight or to candidate; implementing and fixing never skip
//     in-review to queued or integrating.
// A command naming several tickets is all or nothing.
//
// Profile: how strict this run's pipeline is, declared at the start and written once with `profile` (at the
// ruling point, or at the freeze of a standalone run); a second write is refused, and so is a first one once
// any ticket has left candidate or has a review: the defaults it moved under hold for the rest of the run. Fields
// not given, and every field while nothing is written, take the defaults, which are the strict flow above. A
// relaxed field changes what the guards accept, never what evidence they need:
//   review     full (default: prove-it) | minimal (a single reviewer reporting blocking findings only). Under full,
//              queued needs the passing review to be `--kind full`, or `--kind minimal --tier light` (#139: a ticket
//              whose review tier is light gets the minimal review); under minimal either kind counts. A review is
//              needed either way.
//   fixRounds  2 (default) | 1 | 0: the most fix rounds per ticket; fixing beyond it is refused.
//   recheck    true (default) | false: after a fix round, no re-review. fixing → queued is then allowed, but only
//              with the implementer's per-finding report for that round (`report`), naming every finding id of the
//              fix review (`review --findings`) once as fixed or unfixed.
//   onUnfixed  stuck (default) | file-issue: findings still open go to a raw issue and the ticket is integrated
//              anyway. queued is then allowed with a latest `fix` once the fix rounds are used up, or with unfixed
//              findings in the report — only with that issue recorded (`set --unfixed-issue`).
//   expand     agent (default) | skip: the ticket's own done-when is the acceptance; expanding is refused. The
//              snapshot sha256 is still needed for implementing.
//   integrate  aggregate-pr (default, whichever the tracker) | direct (merge straight into the base branch) |
//              ticket-pr (a pull request per ticket, #188): written only when the state's tracker is github (init
//              --tracker github, or the seed's `tracker`); a local or unknown tracker is refused (3, pointing to
//              aggregate-pr), by `profile` and by `import` alike;
//   ci         read (default) | skip;
//   simplify   true (default) | false.
//              These three are read by the host and the later scripts; no guard here relaxes for them (delivered
//              still needs its merge SHA).
// A profile holds these fields only: it cannot relax the guard hook's denies of catastrophic actions (deleting or
// force-pushing the remote main, a recursive delete of a root) or the budget and breaker limits, which stay in the ledger's
// `budget:` lines; an unknown field is refused.
//
// Commands
//   init      Creates the state with no lines and no tickets. `--tracker` records the run's tracker; without it the
//             tracker is null (unknown). Refused when the file exists.
//   import    One-time takeover of a ledger that has no state file. seed.json is written by the host from the
//             ledger: { "run", "tracker", "profile", "lines", "tickets", "usage", "stop" } in the shape above, any
//             field left out taking its default (a ticket needs `line` and `stage`). `--ledger` also reads every
//             `local: <branch> <full sha> <green|red> <reason>` line of the ledger (a list bullet and backticks
//             allowed) into the lines' `local`, the first record of a SHA winning. Without `usage.started` the
//             import time is taken and `startedNote` says the time before it was not counted. The imported
//             tickets must satisfy the guards of the seed's `profile` (queued and integrating as if entering
//             queued, delivered with a merge SHA), and integrate ticket-pr needs the seed's tracker github (see
//             Profile); refused when the file exists.
//   profile   Writes the profile once (see Profile). Refused when one is already written, or once any ticket has
//             left candidate or has a review, or with integrate ticket-pr on a run whose tracker is not github.
//   show      Prints the state; the fields an older file lacks are printed as they read (`tracker` null; a ticket's
//             `pr`, `stackParent`, `waitingOn` null, null, []), and the file is not changed.
//   resume    What a resumed host needs, from the state alone:
//             { "format", "command": "resume", "run", "tracker", "revision", "profile": <effective>, "profileWritten",
//               "open": [{ "id", "stage", "line", "agent": { "id", "type" } | null, "deadline", "members"?,
//                          "pr", "stackParent", "waitingOn" }],   // not at an end
//               "inFlight": [{ "id": "<agent id>", "type", "tickets": [<ticket>], "assigned", "limit", "deadline",
//                              "extended", "fingerprint", "worktree"?, "line"? }],   // one per agent with a
//                                                         // deadline (`line` and no tickets: a line's agent);
//                                                         // the agent list of a `deadline.mjs scan` plan (add the
//                                                         // current `expansions` counts for an expansion agent)
//               "unnamed": [<ticket>],                    // a deadline but no agent id: record ran, the spawn
//                                                         // or `agent` did not
//               "unnamedLines": [<integration branch>],   // the same for a line's assignment
//               "terminal": { "delivered": [], "stuck": [], "awaiting-ruling": [] },
//               "bundles": { "<lead>": ["<member>"] },    // #205: a member shares its lead's stage and end state
//               "lines": { "<branch>": { "tip", "ci", "ciNotCovering",
//                                        "local": ["local: <branch> <sha> <result> <reason>"] } },  // for ci.mjs
//               "usage", "stop" }
//   add       Adds tickets at candidate on an integration branch (created when new). Refused for a known ticket,
//             and for a member of a bundle.
//   bundle    (#205) Folds the members into a bundle led by <lead>: they leave `tickets` and are kept, in the order
//             given, as the lead's `members`. From then on the lead stands for the whole bundle — one dispatch, one
//             agent, one review, one merge — and every end state, merge SHA and review is the lead's for all of
//             them. A command naming a member is refused with the lead's name. Refused unless every ticket named is
//             at candidate with no history, review, assignment or merge, on the lead's line, and none leads a
//             bundle already. Which tickets to bundle is the host's ruling at the freeze (freeze.mjs `bundles`).
//   line      Creates or updates an integration branch: the joined frontier lines, the tip, the base sync.
//   set       Fills a ticket's free-text, snapshot and unfixed-issue fields, and its ticket-level PR fields: `--pr`
//             the PR number (1 or more), `--stack-parent` the ticket it is stacked on, `--waiting-on` the upstream
//             tickets it waits on (`none` clears either). Each ticket named must be another ticket of this state,
//             else refused (3); a ticket named twice in `--waiting-on` is bad input (2).
//   stage     Moves tickets to <stage> by the rules above; `--reason` is kept on the ticket and in its history.
//             Entering fixing adds a fix round (ticket and usage); a send back adds one to `sendBacks` (both).
//   review    Records a review conclusion; only in in-review. `--kind` defaults to full; `--tier` is the review
//             tier the review was chosen by (none without it); `--findings` (with `fix`) lists the finding ids;
//             `--observations` and `--pre-existing` are the report's counts of those two sections (default 0; a
//             review recorded before #142 has neither). `--tier-reason` (with `--tier`, once per reason, in order;
//             #173: any non-empty text, commas and spaces included) are the reasons of the tier.mjs judge output it
//             was chosen by; `--covered` (#205) is the report's count of candidates another open ticket of the run
//             covers (missing without it); `--candidates`, `--confirmed`, `--invalid` and `--blocking` (all four or none) are the
//             report's counts of the candidates, the verifier's confirmed and invalid rulings and the blocking findings
//             (#156). A ruling is of a candidate and a blocking finding is a confirmed one, so confirmed + invalid
//             above candidates, or blocking above confirmed, is refused (2; #173), and a state file holding such
//             counts is not a state file (1). Without them each is null. Adds one to usage `reviewRounds`.
//   report    Records the implementer's per-finding report of a fix round; only in fixing, and each finding id of
//             the latest (fix) review exactly once.
//   merge     Records a merge SHA; only in integrating, or in delivered for a red-light fix's `-ci` merge. Also the
//             line's tip.
//   assign    Records an assignment from `deadline.mjs record`'s output (record.json) with the agent type, for
//             each ticket the agent covers. `--worktree` is required with a { head, tree } fingerprint and not
//             allowed with { expansions }. The agent id is filled by `agent` after the spawn. `--reassign` marks a
//             timeout reassignment: it adds one to the ticket's count for its stage (implementing, fixing,
//             expanding, or in-review for the review host) and is refused when that count is already 1. `--line` records it on the integration
//             branch instead of tickets (an agent that works on the line itself, in its integration worktree): it
//             needs `--worktree` and a { head, tree } fingerprint, and takes no `--reassign`.
//   agent     Fills the agent id of the current assignment. Refused without an assignment in flight, or when
//             another id is already there.
//   extend    Sets the deadline from `deadline.mjs scan`'s `extend` and `extended` to "yes"; refused when already
//             extended. One call per agent, naming every ticket it covers: usage `timeoutExtensions` + 1, and + 1 on
//             each ticket named (#156) that has a count; an imported ticket whose seed gave none keeps none (#171).
//   release   The agent reported or was stopped: deadline null. `--stopped` (one call per agent) adds one to
//             usage `timeoutStops`. `agent`, `extend` and `release` take `--line` in place of tickets for a line's
//             assignment.
//   ci        Records a `ci.mjs verdict` output for its branch. An empty `no-run` read with `--dispatch` counts one
//             dispatch point (once per value of usage `rounds`); any other verdict resets the count. At a count of
//             two, `--branch-runs <n>` (the length of `gh run list --branch <branch> --limit 1`) of 0 settles the
//             branch as CI not covering it. Refused on a settled branch.
//             Output: { "format", "command": "ci", "revision", "branch", "noRun": <count>,
//                       "ciNotCovering": true | false, "branchCheckNeeded": true | false }
//   local     Appends a per-SHA local verification record. Refused when the SHA already has one on that branch:
//             reuse it.
//   usage     Updates field-9 usage. `--started` sets the start once. `--wait` adds waiting seconds. The spawn count
//             is read from `<run>.counters.json` next to the state file when it exists (written by the budget
//             hook; read only), else taken from `--spawns`. `--add` adds to `fullVerifications` or `compactions`.
//             Output: { "format", "command": "usage", "revision", "usage",
//                       "progressUsage": { "rounds", "spawns", "hours" } }   // for a `deadline.mjs progress` plan;
//                                                         // hours: now − started − waiting, null before a start
//   progress  Records a `deadline.mjs progress` output: `noProgress`, `snapshot`, and `rounds` when not stopped;
//             when stopped, `stop` with the limits, the usage at the time and `--note`. Refused once stopped.
//   check     Runs one stage-exit gate: assertions over the state, the git repository at `--repo` (default: the
//             current directory) and, for `ledger`, the run ledger. The gates, their assertions and their flags are
//             in the header of gates.mjs. Reads only: it takes no lock and never writes the state.
//             Output: { "format", "command": "check", "gate", "ok": true | false, "checked": [<assertion>],
//                       "failures": [{ "assertion", "subject", "message" }] }   // also on exit 4
//
// Output (stdout, JSON): `show` and `resume` as above; a write prints { "format", "command", "revision", ... }
// with the tickets, line or usage it changed. Every write takes `<state>.lock` (created exclusively; a lock older
// than two seconds is left over from a killed process and removed), reads, checks, and replaces the file through
// a temporary file and a rename — the same scheme as the budget hook's counters.json — so a reader never sees a
// half-written file and two writers never lose an update.
//
// Exit codes: 0 done; 1 the state (or the ledger, or a file named by a flag) could not be read or written, is
// missing, is not JSON or not a state file, or the lock could not be taken; 2 bad arguments or a bad input file;
// 3 refused: the command is well-formed but the state does not allow it (the message says what is missing);
// 4 a gate failed (`check`): stdout lists every failed assertion, stderr one line per failure.
// On 1, 2 or 3 nothing is written to stdout. On every code but 0 the state file is unchanged.
import { closeSync, existsSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { UsageError, failure, run as exec, runIfEntry } from './cli.mjs';
import { GATES, TARGETS, runGate } from './gates.mjs';

// The sensitive paths of docs/agents/commands.md name each constant from FORMAT to FINDING_COUNTS and each function of
// "the shape" and "the stage rules" below (#152): a change there makes prove-it's review tier full. A new constant
// or function in those parts goes into that list too.
export const FORMAT = 'sorry-matt/state@1';
/** The review tiers of prove-it's tier.mjs (#139): a review records the one tick judged. */
export const TIERS = ['light', 'standard', 'full'];
export const STAGES = ['candidate', 'expanding', 'implementing', 'in-review', 'fixing', 'queued', 'integrating', 'delivered', 'stuck', 'awaiting-ruling'];
export const TERMINAL = ['delivered', 'stuck', 'awaiting-ruling'];
const EDGES = {
  candidate: ['expanding', 'implementing', 'awaiting-ruling', 'stuck'],
  expanding: ['candidate', 'awaiting-ruling', 'stuck'],
  implementing: ['in-review', 'awaiting-ruling', 'stuck'],
  'in-review': ['fixing', 'queued', 'awaiting-ruling', 'stuck'],
  fixing: ['in-review', 'awaiting-ruling', 'stuck'],
  queued: ['integrating', 'awaiting-ruling', 'stuck'],
  integrating: ['delivered', 'candidate', 'awaiting-ruling', 'stuck'],
  delivered: ['stuck'],
  stuck: [],
  'awaiting-ruling': [],
};
const TIMEOUT_STAGES = ['implementing', 'fixing', 'expanding', 'in-review'];
// counts a state written before #143 does not have: read as 0
const TIMEOUT_STAGES_ADDED = ['in-review'];
export const PROFILE_DEFAULTS = Object.freeze({
  review: 'full',
  fixRounds: 2,
  recheck: true,
  onUnfixed: 'stuck',
  expand: 'agent',
  integrate: 'aggregate-pr',
  ci: 'read',
  simplify: true,
});
const PROFILE_VALUES = {
  review: ['full', 'minimal'],
  fixRounds: [0, 1, 2],
  recheck: [true, false],
  onUnfixed: ['stuck', 'file-issue'],
  expand: ['agent', 'skip'],
  integrate: ['aggregate-pr', 'direct', 'ticket-pr'],
  ci: ['read', 'skip'],
  simplify: [true, false],
};
/** The trackers a run can record (#188), as acceptance.mjs names them; null in the state: unknown. */
export const TRACKERS = ['github', 'local'];
const profileOf = (state) => ({ ...PROFILE_DEFAULTS, ...(state.profile ?? {}) });
const VERDICTS = ['query-failed', 'no-run', 'red', 'running', 'cancelled', 'green'];
const LOCAL_REASONS = ['no-origin', 'ci-not-covering', 'no-verdict'];
const ADDABLE = ['fullVerifications', 'compactions'];
const COUNTERS = ['reviewRounds', 'fixRounds', 'fullVerifications', 'sendBacks', 'timeoutExtensions', 'timeoutStops', 'compactions'];
/** A review's finding counts (#156), each a count of its report's `counts:` line. */
export const FINDING_COUNTS = ['candidates', 'confirmed', 'invalid', 'blocking'];

/** The command is well-formed but the state does not allow it: exit 3, state unchanged. */
export class Refusal extends Error {}
/** The state file is missing, unreadable or not a state file: exit 1. */
class StateError extends Error {}

// ---- values ------------------------------------------------------------------------------------------------------

const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const SHA = /^[0-9a-f]{7,64}$/;
const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const formatTime = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const isTime = (x) => typeof x === 'string' && TIME.test(x) && !Number.isNaN(Date.parse(x));
const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isCount = (x) => Number.isInteger(x) && x >= 0;
export const isText = (x) => typeof x === 'string' && x.length > 0;
const isId = (x) => isText(x) && !/\s/.test(x);

function time(text, where) {
  if (!isTime(text)) throw new UsageError(`${where}: expected a UTC time like 2026-01-31T23:59:59Z, got ${JSON.stringify(text)}`);
  return text;
}
function sha(text, where, full = false) {
  if (typeof text !== 'string' || !(full ? FULL_SHA : SHA).test(text)) {
    throw new UsageError(`${where}: expected a ${full ? 'full 40- or 64-digit' : '7–64 digit'} lowercase hex SHA, got ${JSON.stringify(text)}`);
  }
  return text;
}
function oneOf(text, list, where) {
  if (!list.includes(text)) throw new UsageError(`${where}: expected one of ${list.join(', ')}, got ${JSON.stringify(text)}`);
  return text;
}
function count(text, where) {
  if (!/^\d+$/.test(String(text))) throw new UsageError(`${where}: expected a whole number, 0 or more, got ${JSON.stringify(text)}`);
  return Number(text);
}

// ---- the shape -----------------------------------------------------------------------------------------------------

const newUsage = () => ({
  started: null,
  startedNote: null,
  waitingSeconds: 0,
  spawns: 0,
  spawnsSource: 'host',
  rounds: 0,
  noProgress: 0,
  snapshot: null,
  reviewRounds: 0,
  fixRounds: 0,
  fullVerifications: 0,
  sendBacks: 0,
  timeoutExtensions: 0,
  timeoutStops: 0,
  compactions: 0,
  sleepTask: null,
  tokens: null,
});
const newLine = () => ({ lines: [], tip: null, ci: null, noRun: { count: 0, round: null }, ciNotCovering: null, local: [], base: null, assignment: null });
const newTicket = (line) => ({
  line,
  stage: 'candidate',
  branch: null,
  deliverable: null,
  verification: null,
  statusRecord: null,
  snapshotSha256: null,
  assignment: null,
  timeoutReassignments: { implementing: 0, fixing: 0, expanding: 0, 'in-review': 0 },
  timeoutExtensions: 0,
  sendBacks: 0,
  fixRounds: 0,
  reviews: [],
  fixReports: [],
  unfixedIssue: null,
  pr: null,
  stackParent: null,
  waitingOn: [],
  merges: [],
  reason: null,
  history: [],
});
const newState = (run, now, tracker = null) => ({
  format: FORMAT,
  run,
  tracker,
  created: now,
  updated: now,
  revision: 0,
  imported: null,
  profile: null,
  lines: {},
  tickets: {},
  usage: newUsage(),
  stop: null,
});

/** One assignment record (a ticket's or a line's), through check's `need`. */
function checkAssignment(a, w, need) {
  need(isObject(a), w, 'is not an object or null');
  need(a.agentId === null || isText(a.agentId), `${w}.agentId`, 'is not an id or null');
  need(isText(a.type), `${w}.type`, 'is not an agent type');
  need(isTime(a.assigned) && (a.deadline === null || isTime(a.deadline)), w, 'has no assigned time, or a deadline that is not a time or null');
  need(Number.isInteger(a.limit) && a.limit > 0, `${w}.limit`, 'is not minutes above 0');
  need(a.extended === 'no' || a.extended === 'yes', `${w}.extended`, 'is not "no" or "yes"');
  need(isObject(a.fingerprint), `${w}.fingerprint`, 'is not an object');
  need(a.worktree === null || isText(a.worktree), `${w}.worktree`, 'is not a path or null');
}

/** What is wrong with a review's finding counts, or null (#173); the four are whole numbers. */
function countsProblem({ candidates, confirmed, invalid, blocking }) {
  if (confirmed + invalid > candidates) return `confirmed + invalid (${confirmed} + ${invalid}) is more than candidates (${candidates})`;
  if (blocking > confirmed) return `blocking (${blocking}) is more than confirmed (${confirmed})`;
  return null;
}

/**
 * What is wrong with a ticket's stack parent and the tickets it waits on, or null (#188): each must be another
 * ticket of this state, and none is named twice.
 */
function stackProblem(state, id, stackParent, waitingOn) {
  const named = [...(stackParent === null ? [] : [['stackParent', stackParent]]), ...waitingOn.map((x) => ['waitingOn', x])];
  for (const [what, other] of named) {
    if (!isId(other)) return `${what} has ${JSON.stringify(other)}, which is not a ticket id`;
    if (other === id) return `${what} names the ticket itself; it must be another ticket of this run`;
    if (!(other in state.tickets)) return `${what} names ${other}, which is not a ticket of this run`;
  }
  if (new Set(waitingOn).size !== waitingOn.length) return 'waitingOn names a ticket twice';
  return null;
}

// Every check throws `bad(where, what)`; the caller decides whether that is a corrupt file (1) or bad input (2).
function check(state, bad) {
  const need = (ok, where, what) => {
    if (!ok) bad(where, what);
  };
  const optText = (x) => x === null || typeof x === 'string';
  need(isObject(state) && state.format === FORMAT, 'format', `is not "${FORMAT}"`);
  need(isText(state.run), 'run', 'is not a run name');
  need(isTime(state.created) && isTime(state.updated), 'created/updated', 'are not UTC times');
  need(isCount(state.revision), 'revision', 'is not a count');
  need(state.imported === null || isTime(state.imported), 'imported', 'is not a UTC time or null');
  // a state written before #188 has no key: read as null (unknown)
  need(state.tracker == null || TRACKERS.includes(state.tracker), 'tracker', `is not one of ${TRACKERS.join(', ')} or null`);
  const why = profileProblem(state.profile ?? null);
  need(why === null, 'profile', why);
  need(isObject(state.lines) && isObject(state.tickets) && isObject(state.usage), 'lines/tickets/usage', 'are not objects');
  for (const [name, l] of Object.entries(state.lines)) {
    const w = `lines.${name}`;
    need(isObject(l), w, 'is not an object');
    need(Array.isArray(l.lines) && l.lines.every(isText), `${w}.lines`, 'is not a list of line names');
    need(l.tip === null || SHA.test(l.tip), `${w}.tip`, 'is not a SHA or null');
    need(l.ci === null || (isObject(l.ci) && SHA.test(l.ci.sha) && VERDICTS.includes(l.ci.verdict) && isTime(l.ci.at)), `${w}.ci`, 'is not a recorded verdict or null');
    need(isObject(l.noRun) && isCount(l.noRun.count) && (l.noRun.round === null || isCount(l.noRun.round)), `${w}.noRun`, 'is not { count, round }');
    need(l.ciNotCovering === null || (isObject(l.ciNotCovering) && isTime(l.ciNotCovering.at)), `${w}.ciNotCovering`, 'is not a settlement or null');
    need(Array.isArray(l.local), `${w}.local`, 'is not a list');
    l.local.forEach((r, i) =>
      need(isObject(r) && FULL_SHA.test(r.sha) && ['green', 'red'].includes(r.result) && LOCAL_REASONS.includes(r.reason) && isTime(r.at), `${w}.local[${i}]`, 'is not { sha, result, reason, at }'),
    );
    need(l.base === null || (isObject(l.base) && SHA.test(l.base.sha) && typeof l.base.synced === 'boolean'), `${w}.base`, 'is not { sha, synced } or null');
    // a state written before lines held assignments has no key: read as null
    if (l.assignment !== undefined && l.assignment !== null) {
      checkAssignment(l.assignment, `${w}.assignment`, need);
      need(isObject(l.assignment.fingerprint) && !isObject(l.assignment.fingerprint.expansions), `${w}.assignment.fingerprint`, 'is not { head, tree }');
    }
  }
  for (const [id, t] of Object.entries(state.tickets)) {
    const w = `tickets.${id}`;
    need(isId(id) && isObject(t), w, 'is not a ticket');
    need(isText(t.line) && t.line in state.lines, `${w}.line`, 'is not a known integration branch');
    need(STAGES.includes(t.stage), `${w}.stage`, `is not one of ${STAGES.join(', ')}`);
    for (const k of ['branch', 'deliverable', 'verification', 'statusRecord', 'snapshotSha256', 'reason']) need(optText(t[k]), `${w}.${k}`, 'is not text or null');
    if (t.assignment !== null) checkAssignment(t.assignment, `${w}.assignment`, need);
    need(
      isObject(t.timeoutReassignments) && TIMEOUT_STAGES.every((s) => isCount(t.timeoutReassignments[s]) || (TIMEOUT_STAGES_ADDED.includes(s) && t.timeoutReassignments[s] === undefined)),
      `${w}.timeoutReassignments`,
      'is not a count per stage',
    );
    need(isCount(t.sendBacks) && isCount(t.fixRounds), `${w}.sendBacks/fixRounds`, 'are not counts');
    need(Array.isArray(t.reviews), `${w}.reviews`, 'is not a list');
    t.reviews.forEach((r, i) =>
      need(
        isObject(r) && ['initial', 'recheck'].includes(r.mode) && ['pass', 'fix', 'stuck'].includes(r.verdict) && ['full', 'minimal'].includes(r.kind) &&
          (r.tier == null || TIERS.includes(r.tier)) &&
          isCount(r.after) && (r.findings === null || (Array.isArray(r.findings) && r.findings.every(isId))) &&
          [r.observations, r.preExisting].every((n) => n === undefined || isCount(n)) &&
          (r.tierReasons == null || (Array.isArray(r.tierReasons) && r.tierReasons.every(isText))) &&
          (r.findingCounts == null || (isObject(r.findingCounts) && FINDING_COUNTS.every((k) => isCount(r.findingCounts[k])))) &&
          (r.covered === undefined || isCount(r.covered)),
        `${w}.reviews[${i}]`,
        'is not { mode, verdict, kind, tier, tierReasons, findings, observations, preExisting, findingCounts, after }',
      ),
    );
    // #173: every ruling is of a candidate, every blocking finding a confirmed one
    t.reviews.forEach((r, i) => {
      const why = r.findingCounts ? countsProblem(r.findingCounts) : null;
      need(why === null, `${w}.reviews[${i}]`, `has findingCounts where ${why}`);
    });
    need(t.timeoutExtensions === undefined || isCount(t.timeoutExtensions), `${w}.timeoutExtensions`, 'is not a count');
    need(
      Array.isArray(t.fixReports) && t.fixReports.every((r) => isObject(r) && Array.isArray(r.fixed) && Array.isArray(r.unfixed) && isCount(r.after)),
      `${w}.fixReports`,
      'is not a list of { fixed, unfixed, after }',
    );
    need(t.unfixedIssue === null || isId(t.unfixedIssue), `${w}.unfixedIssue`, 'is not an issue id or null');
    // #188: a state written before has none of the three: read as null, null, []
    need(t.pr == null || (Number.isInteger(t.pr) && t.pr > 0), `${w}.pr`, 'is not a pull request number or null');
    need(t.waitingOn === undefined || Array.isArray(t.waitingOn), `${w}.waitingOn`, 'is not a list of tickets');
    const stacked = stackProblem(state, id, t.stackParent ?? null, t.waitingOn ?? []);
    need(stacked === null, w, stacked);
    need(Array.isArray(t.merges) && t.merges.every((m) => isObject(m) && SHA.test(m.sha)), `${w}.merges`, 'is not a list of { sha }');
    need(Array.isArray(t.history) && t.history.every((h) => isObject(h) && STAGES.includes(h.to)), `${w}.history`, 'is not a list of transitions');
    // #205: a bundle's other tickets; missing in an older file and on a ticket that leads no bundle
    need(t.members === undefined || (Array.isArray(t.members) && t.members.length > 0 && t.members.every((m) => isId(m) && m !== id && !(m in state.tickets))), `${w}.members`, 'is not a list of ticket ids outside the tickets');
  }
  const memberIds = Object.values(state.tickets).flatMap((t) => t.members ?? []);
  need(new Set(memberIds).size === memberIds.length, 'tickets.*.members', 'name a ticket in two bundles');
  const u = state.usage;
  need(u.started === null || isTime(u.started), 'usage.started', 'is not a UTC time or null');
  need(typeof u.waitingSeconds === 'number' && u.waitingSeconds >= 0, 'usage.waitingSeconds', 'is not seconds');
  for (const k of ['spawns', 'rounds', 'noProgress', ...COUNTERS]) need(isCount(u[k]), `usage.${k}`, 'is not a count');
  need(u.tokens === null || isCount(u.tokens), 'usage.tokens', 'is not a count or null');
  need(u.sleepTask === null || isText(u.sleepTask), 'usage.sleepTask', 'is not a task id or null');
  need(u.snapshot === null || (isObject(u.snapshot) && isObject(u.snapshot.tips) && Array.isArray(u.snapshot.terminal)), 'usage.snapshot', 'is not { tips, terminal } or null');
  need(state.stop === null || (isObject(state.stop) && Array.isArray(state.stop.stoppedBy)), 'stop', 'is not { stoppedBy, … } or null');
}

// ---- the stage rules -----------------------------------------------------------------------------------------------

/** Why a profile object is not valid, or null. Unknown keys are refused: nothing outside these fields is relaxable. */
function profileProblem(p) {
  if (p === null) return null;
  if (!isObject(p)) return 'is not an object or null';
  for (const [k, v] of Object.entries(p)) {
    if (!(k in PROFILE_VALUES)) return `has ${k}, which is not a profile field (${Object.keys(PROFILE_VALUES).join(', ')}); confirmations and budget limits are not in a profile`;
    if (!PROFILE_VALUES[k].includes(v)) return `${k} is ${JSON.stringify(v)}, expected one of ${PROFILE_VALUES[k].map((x) => JSON.stringify(x)).join(', ')}`;
  }
  return null;
}

/** Why this run's tracker does not allow the profile's integrate value, or null (#188): ticket-pr is for GitHub. */
function integrateProblem(profile, tracker) {
  if (profile === null || profile.integrate !== 'ticket-pr' || tracker === 'github') return null;
  return `integrate: ticket-pr opens a pull request per ticket and needs a GitHub run (init --tracker github); this run's tracker is ${tracker ?? 'unknown'}: use integrate aggregate-pr`;
}

const lastEntry = (t, stage) => t.history.findLastIndex((h) => h.to === stage);

/** The latest review recorded since the ticket last entered in-review, or null. */
function currentReview(t) {
  const latest = t.reviews.at(-1);
  return latest && latest.after > lastEntry(t, 'in-review') ? latest : null;
}

/** The latest per-finding report recorded since the ticket last entered fixing, or null. */
function currentReport(t) {
  const latest = t.fixReports.at(-1);
  return latest && latest.after > lastEntry(t, 'fixing') ? latest : null;
}

// Unfixed findings may go on only with `onUnfixed: file-issue` and the issue recorded.
function unfixedGate(id, t, profile, what) {
  if (profile.onUnfixed !== 'file-issue') return `${id}: queued with ${what} needs profile onUnfixed: file-issue; this run's is stuck (mark it stuck)`;
  if (t.unfixedIssue === null) return `${id}: queued with ${what} needs the issue filed for them recorded (set --unfixed-issue <id>)`;
  return null;
}

/** Why a ticket may not enter queued from in-review, or null. */
function queueFromReview(id, t, profile) {
  const r = currentReview(t);
  if (!r) return `${id}: queued needs a review recorded since it entered in-review; there is none (record it with review)`;
  if (profile.review === 'full' && r.kind !== 'full' && r.tier !== 'light')
    return `${id}: queued needs a prove-it review (profile review: full), or a minimal review of a ticket whose review tier is light; the latest is a ${r.kind === 'full' ? 'prove-it' : r.kind} review${r.tier ? ` (review tier ${r.tier})` : ''}`;
  if (r.verdict === 'pass') return null;
  if (r.verdict !== 'fix') return `${id}: queued needs the latest review verdict to be pass; it is ${r.verdict} (${r.mode})`;
  if (profile.onUnfixed !== 'file-issue') return `${id}: queued needs the latest review verdict to be pass; it is fix (${r.mode})`;
  if (t.fixRounds < profile.fixRounds) return `${id}: queued with a fix verdict: ${t.fixRounds} of ${profile.fixRounds} fix rounds used; fix it first`;
  return unfixedGate(id, t, profile, 'unfixed findings');
}

/** Why a ticket may not enter queued from fixing (profile recheck: false), or null. */
function queueFromFix(id, t, profile) {
  if (profile.recheck) return `${id}: queued cannot skip in-review: move it to in-review and record a review pass first`;
  const report = currentReport(t);
  if (!report) return `${id}: queued without a recheck (profile recheck: false) needs the implementer's per-finding report for this fix round (record it with report)`;
  return report.unfixed.length ? unfixedGate(id, t, profile, `unfixed findings ${report.unfixed.join(', ')}`) : null;
}

/** Why a ticket may not be at `to` coming from `from` (null for an import), or null; shared by `stage` and `import`. */
function stageGuard(id, t, to, from, profile) {
  if (to === 'expanding' && profile.expand === 'skip') return `${id}: expanding: this run's profile has expand: skip`;
  if (to === 'implementing' && from === 'candidate' && t.snapshotSha256 === null) {
    return `${id}: implementing needs the acceptance snapshot's sha256 recorded (set --snapshot)`;
  }
  if (to === 'fixing') {
    const r = currentReview(t);
    if (!r || r.verdict !== 'fix') return `${id}: fixing needs the latest review since it entered in-review to be fix; it is ${r ? r.verdict : 'missing'}`;
    if (t.fixRounds >= profile.fixRounds) return `${id}: fixing: ${t.fixRounds} of ${profile.fixRounds} fix rounds used; mark it stuck${profile.onUnfixed === 'file-issue' ? ', or file an issue and queue it' : ''}`;
  }
  if (to === 'queued') {
    if (from === 'fixing') return queueFromFix(id, t, profile);
    const viaReview = queueFromReview(id, t, profile);
    // An imported ticket (from null) may also have got there without a recheck.
    if (viaReview === null || from !== null || profile.recheck) return viaReview;
    return queueFromFix(id, t, profile) === null ? null : viaReview;
  }
  if (to === 'delivered' && !t.merges.length) return `${id}: delivered needs a merge SHA; none is recorded (record it with merge)`;
  return null;
}

function transition(state, id, to, reason, now) {
  const t = state.tickets[id];
  const from = t.stage;
  const profile = profileOf(state);
  if (from === to) throw new Refusal(`${id} is already ${to}`);
  const relaxed = from === 'fixing' && to === 'queued' && !profile.recheck;
  if (!EDGES[from].includes(to) && !relaxed) {
    let why;
    if (TERMINAL.includes(from)) why = `${from} is an end state; it never returns to ${to}`;
    else if ((from === 'implementing' || from === 'fixing') && (to === 'queued' || to === 'integrating')) {
      why = `${to} cannot skip in-review: move it to in-review and record a review pass first`;
    } else why = `there is no edge ${from} → ${to}`;
    throw new Refusal(`${id}: ${why} (from ${from}: ${EDGES[from].join(', ') || 'none'})`);
  }
  const guard = stageGuard(id, t, to, from, profile);
  if (guard) throw new Refusal(guard);
  if (to === 'fixing') {
    t.fixRounds += 1;
    state.usage.fixRounds += 1;
  }
  if (from === 'integrating' && to === 'candidate') {
    if (t.sendBacks >= 1) throw new Refusal(`${id}: it was already sent back once; a second send back is not allowed, mark it stuck`);
    t.sendBacks += 1;
    state.usage.sendBacks += 1;
  }
  if (reason !== undefined) t.reason = reason;
  t.stage = to;
  t.history.push({ from, to, at: now, reason: reason ?? null });
}

// ---- the file ------------------------------------------------------------------------------------------------------

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
// Errors Windows raises while another process (antivirus, indexer, a rename in flight) holds the file.
const TRANSIENT = new Set(['EPERM', 'EACCES', 'EBUSY']);
function retrying(fn, attempts = 20) {
  for (let attempt = 0; ; attempt++) {
    try {
      return fn();
    } catch (error) {
      if (attempt >= attempts || !TRANSIENT.has(error.code)) throw error;
      pause(25);
    }
  }
}

/** Run fn while holding `<path>.lock`; a lock older than `stale` ms is left over from a killed process. */
export function withLock(path, fn, { wait = 5000, stale = 2000, now = Date.now } = {}) {
  const lock = `${path}.lock`;
  const deadline = now() + wait;
  for (;;) {
    let fd;
    try {
      fd = openSync(lock, 'wx');
    } catch (error) {
      if (error.code !== 'EEXIST' && !TRANSIENT.has(error.code)) throw new StateError(`could not lock ${path} (${error.message})`);
      try {
        const seen = statSync(lock);
        if (now() - seen.mtimeMs > stale) {
          const again = statSync(lock);
          if (again.ino === seen.ino && again.mtimeMs === seen.mtimeMs) unlinkSync(lock);
        }
      } catch {
        // gone already, or another process is removing it
      }
      if (now() > deadline) throw new StateError(`could not lock ${path}: ${lock} is held`);
      pause(10);
      continue;
    }
    try {
      return fn();
    } finally {
      closeSync(fd);
      try {
        unlinkSync(lock);
      } catch {
        // removed as stale by another process; nothing left to release
      }
    }
  }
}

export function writeAtomic(path, text) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  try {
    retrying(() => renameSync(tmp, path));
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // nothing to clean up
    }
    throw new StateError(`could not write ${path} (${error.message})`);
  }
}

/** The state at `path`; throws a StateError (exit 1) when it is missing or not a state file. */
export function load(path) {
  let text;
  try {
    text = retrying(() => readFileSync(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new StateError(`${path} does not exist: create it with init, or import a ledger`);
    throw new StateError(`could not read ${path} (${error.message})`);
  }
  let state;
  try {
    state = JSON.parse(text.replace(/^﻿/, ''));
  } catch (error) {
    throw new StateError(`${path} is not JSON (${error.message})`);
  }
  check(state, (where, what) => {
    throw new StateError(`${path} is not a sorry-matt state file: ${where} ${what}`);
  });
  return state;
}

const save = (path, state) => writeAtomic(path, `${JSON.stringify(state, null, 2)}\n`);

/**
 * Apply `change(state)` under the lock and save, bumping the revision. `change` returns the command's output fields;
 * a throw leaves the file as it was. The module's API for later scripts (integrate.mjs, verify.mjs).
 */
export function update(path, now, change) {
  return withLock(path, () => {
    const state = load(path);
    const result = change(state);
    state.revision += 1;
    state.updated = now;
    check(state, (where, what) => {
      throw new Error(`internal: the change left ${where} ${what}`);
    });
    save(path, state);
    return { revision: state.revision, ...result };
  });
}

function create(path, state) {
  return withLock(path, () => {
    if (existsSync(path)) throw new Refusal(`${path} already exists; import and init only start a state`);
    save(path, state);
    return state;
  });
}

// ---- arguments -----------------------------------------------------------------------------------------------------

function parseArgs(argv, spec) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      rest.push(a);
      continue;
    }
    const name = a.slice(2);
    if (!(name in spec)) throw new UsageError(`unknown flag ${a}`);
    if (spec[name] === 'bool') {
      if (name in flags) throw new UsageError(`${a} is given twice`);
      flags[name] = true;
      continue;
    }
    if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`);
    const value = argv[(i += 1)];
    if (spec[name] === 'many') (flags[name] ??= []).push(value);
    else if (name in flags) throw new UsageError(`${a} is given twice`);
    else flags[name] = value;
  }
  return { flags, rest };
}

function readJson(path, what, read) {
  let text;
  try {
    text = read(resolve(path));
  } catch (error) {
    throw new StateError(`could not read ${what} ${path} (${error.message})`);
  }
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch (error) {
    throw new UsageError(`${what} ${path} is not JSON (${error.message})`);
  }
}

const ids = (text, where) => {
  const list = text.split(',').map((x) => x.trim()).filter(Boolean);
  if (!list.length || !list.every(isId)) throw new UsageError(`${where}: expected comma-separated ids`);
  return list;
};
const ticketsOf = (state, ids) => {
  if (!ids.length) throw new UsageError('name at least one ticket');
  if (new Set(ids).size !== ids.length) throw new UsageError('a ticket is named twice');
  for (const id of ids) {
    if (id in state.tickets) continue;
    const lead = leadOf(state, id);
    throw new Refusal(lead ? `${id} is a member of bundle ${lead}: name its lead, ${lead}` : `${id} is not a ticket of this run (add it first)`);
  }
  return ids;
};
/** #205: the lead whose bundle a ticket id is a member of, or null. */
export const leadOf = (state, id) => Object.entries(state.tickets).find(([, t]) => (t.members ?? []).includes(id))?.[0] ?? null;
const lineOf = (state, branch) => {
  if (!(branch in state.lines)) throw new Refusal(`${branch} is not an integration branch of this run (create it with line or add)`);
  return state.lines[branch];
};
const view = (state, ids) => Object.fromEntries(ids.map((id) => [id, state.tickets[id]]));

const hoursAt = (usage, nowMs) =>
  usage.started === null ? null : Math.max(0, (nowMs - Date.parse(usage.started)) / 1000 - usage.waitingSeconds) / 3600;

// The budget hook's spawn count next to the state, or null when there is none.
function hookSpawns(path, read) {
  if (!/\.state\.json$/i.test(path)) return null;
  const counters = path.replace(/\.state\.json$/i, '.counters.json');
  let text;
  try {
    text = read(counters);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new StateError(`could not read ${counters} (${error.message})`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new StateError(`${counters} is not JSON (${error.message})`);
  }
  if (!isObject(data) || !isCount(data.spawns)) throw new StateError(`${counters} is not a sorry-matt counters file`);
  return data.spawns;
}

// ---- commands ------------------------------------------------------------------------------------------------------

function init(path, rest, flags, ctx) {
  if (rest.length) throw new UsageError(`init takes no more arguments, got ${rest[0]}`);
  if (!isText(flags.run)) throw new UsageError('init needs --run <run>');
  const tracker = flags.tracker === undefined ? null : oneOf(flags.tracker, TRACKERS, '--tracker');
  const state = create(path, newState(flags.run, ctx.now, tracker));
  return { revision: state.revision, run: state.run, tracker: state.tracker };
}

const LEDGER_LOCAL = /^\s*(?:[-*]\s+)?`?local:\s+(\S+)\s+([0-9a-f]{40}|[0-9a-f]{64})\s+(green|red)\s+(\S+)/;

function importLedger(path, rest, flags, ctx) {
  if (rest.length) throw new UsageError(`import takes no more arguments, got ${rest[0]}`);
  if (flags.from === undefined) throw new UsageError('import needs --from <seed.json>');
  const seed = readJson(flags.from, 'seed', ctx.read);
  if (!isObject(seed) || !isText(seed.run)) throw new UsageError(`seed ${flags.from}: needs { "run": "<run>", … }`);
  const state = newState(seed.run, ctx.now, seed.tracker ?? null);
  state.imported = ctx.now;
  for (const [branch, l] of Object.entries(seed.lines ?? {})) {
    if (!isObject(l)) throw new UsageError(`seed: lines.${branch} is not an object`);
    state.lines[branch] = { ...newLine(), ...l };
  }
  for (const [id, t] of Object.entries(seed.tickets ?? {})) {
    if (!isObject(t) || !isText(t.line) || !isText(t.stage)) throw new UsageError(`seed: tickets.${id} needs line and stage`);
    state.lines[t.line] ??= newLine();
    const ticket = { ...newTicket(t.line), ...t };
    // #156 F14: a seed that counted extensions for the run only stays that way; 0 would claim none for the ticket
    if (!('timeoutExtensions' in t)) delete ticket.timeoutExtensions;
    ticket.timeoutReassignments = { ...newTicket().timeoutReassignments, ...(t.timeoutReassignments ?? {}) };
    ticket.reviews = (t.reviews ?? []).map((r) => ({ kind: 'full', tier: null, findings: null, at: ctx.now, after: 0, ...r }));
    ticket.fixReports = (t.fixReports ?? []).map((r) => ({ at: ctx.now, after: 0, ...r }));
    ticket.merges = (t.merges ?? []).map((m) => (typeof m === 'string' ? { sha: m, at: ctx.now } : { at: ctx.now, ...m }));
    state.tickets[id] = ticket;
  }
  state.usage = { ...newUsage(), ...(seed.usage ?? {}) };
  if (state.usage.started === null) {
    state.usage.started = ctx.now;
    state.usage.startedNote = `imported ${ctx.now}: the time before the import is not counted`;
  }
  if (seed.stop !== undefined) state.stop = seed.stop;
  if (seed.profile !== undefined && seed.profile !== null) state.profile = { ...PROFILE_DEFAULTS, ...seed.profile };
  let records = 0;
  if (flags.ledger !== undefined) {
    let text;
    try {
      text = ctx.read(resolve(flags.ledger));
    } catch (error) {
      throw new StateError(`could not read ledger ${flags.ledger} (${error.message})`);
    }
    for (const row of text.split(/\r?\n/)) {
      const m = LEDGER_LOCAL.exec(row);
      if (!m || !LOCAL_REASONS.includes(m[4].replace(/`$/, ''))) continue;
      const line = (state.lines[m[1]] ??= newLine());
      if (line.local.some((r) => r.sha === m[2])) continue;
      line.local.push({ sha: m[2], result: m[3], reason: m[4].replace(/`$/, ''), at: ctx.now });
      records += 1;
    }
  }
  const spawns = hookSpawns(path, ctx.read);
  if (spawns !== null) Object.assign(state.usage, { spawns, spawnsSource: 'counters' });
  check(state, (where, what) => {
    throw new UsageError(`seed ${flags.from}: ${where} ${what}`);
  });
  const integrate = integrateProblem(state.profile, state.tracker);
  if (integrate) throw new Refusal(`seed: ${integrate}`);
  const profile = profileOf(state);
  for (const [id, t] of Object.entries(state.tickets)) {
    if (!['queued', 'integrating', 'delivered'].includes(t.stage)) continue;
    const guard = stageGuard(id, t, t.stage === 'delivered' ? 'delivered' : 'queued', null, profile);
    if (guard) throw new Refusal(`seed: ${guard}`);
  }
  create(path, state);
  return { revision: state.revision, run: state.run, tickets: Object.keys(state.tickets).length, lines: Object.keys(state.lines).length, localRecords: records };
}

/** A ticket's own PR fields (#188), as an older file without them reads. */
const prFields = (t) => ({ pr: t.pr ?? null, stackParent: t.stackParent ?? null, waitingOn: t.waitingOn ?? [] });

/** The state as `show` prints it: the file, with the fields an older file lacks read as their defaults (#188). */
const show = (state) => ({
  ...state,
  tracker: state.tracker ?? null,
  tickets: Object.fromEntries(Object.entries(state.tickets).map(([id, t]) => [id, { ...t, ...prFields(t) }])),
});

const localLine = (branch, r) => `local: ${branch} ${r.sha} ${r.result} ${r.reason}`;

function resume(state) {
  const open = [];
  const terminal = Object.fromEntries(TERMINAL.map((s) => [s, []]));
  const agents = new Map();
  const unnamed = [];
  for (const [id, t] of Object.entries(state.tickets)) {
    const a = t.assignment;
    if (TERMINAL.includes(t.stage)) terminal[t.stage].push(id);
    else open.push({ id, stage: t.stage, line: t.line, agent: a && a.agentId ? { id: a.agentId, type: a.type } : null, deadline: a ? a.deadline : null, ...(t.members ? { members: t.members } : {}), ...prFields(t) });
    if (!a || a.deadline === null) continue;
    if (a.agentId === null) {
      unnamed.push(id);
      continue;
    }
    const seen = agents.get(a.agentId);
    if (seen) {
      seen.tickets.push(id);
      continue;
    }
    const entry = { id: a.agentId, type: a.type, tickets: [id], assigned: a.assigned, limit: a.limit, deadline: a.deadline, extended: a.extended, fingerprint: a.fingerprint };
    if (a.worktree !== null) entry.worktree = a.worktree;
    agents.set(a.agentId, entry);
  }
  const unnamedLines = [];
  for (const [branch, l] of Object.entries(state.lines)) {
    const a = l.assignment;
    if (!a || a.deadline === null) continue;
    if (a.agentId === null) unnamedLines.push(branch);
    else agents.set(a.agentId, { id: a.agentId, type: a.type, tickets: [], line: branch, assigned: a.assigned, limit: a.limit, deadline: a.deadline, extended: a.extended, fingerprint: a.fingerprint, worktree: a.worktree });
  }
  const lines = Object.fromEntries(
    Object.entries(state.lines).map(([branch, l]) => [
      branch,
      { tip: l.tip, ci: l.ci, ciNotCovering: l.ciNotCovering !== null, local: l.local.map((r) => localLine(branch, r)) },
    ]),
  );
  const bundles = Object.fromEntries(Object.entries(state.tickets).filter(([, t]) => t.members).map(([id, t]) => [id, t.members]));
  return { run: state.run, tracker: state.tracker ?? null, revision: state.revision, profile: profileOf(state), profileWritten: state.profile !== null, open, inFlight: [...agents.values()], unnamed, unnamedLines, terminal, bundles, lines, usage: state.usage, stop: state.stop };
}

function add(path, rest, flags, ctx) {
  if (!isText(flags.line)) throw new UsageError('add needs --line <integration branch>');
  if (!rest.length) throw new UsageError('add needs at least one ticket');
  for (const id of rest) if (!isId(id)) throw new UsageError(`${JSON.stringify(id)} is not a ticket id`);
  if (new Set(rest).size !== rest.length) throw new UsageError('a ticket is named twice');
  return update(path, ctx.now, (state) => {
    for (const id of rest) if (id in state.tickets) throw new Refusal(`${id} is already a ticket of this run (on ${state.tickets[id].line})`);
    for (const id of rest) if (leadOf(state, id)) throw new Refusal(`${id} is already a member of bundle ${leadOf(state, id)}`);
    state.lines[flags.line] ??= newLine();
    for (const id of rest) state.tickets[id] = newTicket(flags.line);
    return { tickets: view(state, rest) };
  });
}

/** #205: folds tickets into a bundle led by the first: they leave `tickets` and become the lead's `members`. */
function bundle(path, rest, flags, ctx) {
  if (rest.length < 2) throw new UsageError('bundle takes the lead and at least one member');
  if (new Set(rest).size !== rest.length) throw new UsageError('a ticket is named twice');
  const [lead, ...members] = rest;
  return update(path, ctx.now, (state) => {
    ticketsOf(state, rest);
    const fresh = (id) => {
      const t = state.tickets[id];
      if (t.stage !== 'candidate' || t.history.length || t.reviews.length || t.assignment !== null || t.merges.length) throw new Refusal(`${id}: only a ticket that never left candidate can be bundled; it is ${t.stage}`);
      if (t.members) throw new Refusal(`${id} already leads bundle ${[id, ...t.members].join(', ')}`);
    };
    for (const id of rest) fresh(id);
    const line = state.tickets[lead].line;
    for (const id of members) if (state.tickets[id].line !== line) throw new Refusal(`${id} is on ${state.tickets[id].line}, the lead on ${line}: a bundle stays on one line`);
    for (const id of members) delete state.tickets[id];
    state.tickets[lead].members = members;
    return { tickets: view(state, [lead]) };
  });
}

function line(path, rest, flags, ctx) {
  if (rest.length !== 1) throw new UsageError('line takes exactly one integration branch');
  const [branch] = rest;
  const lines = flags.lines === undefined ? undefined : flags.lines.split(',').map((s) => s.trim()).filter(Boolean);
  if (flags.tip !== undefined) sha(flags.tip, '--tip');
  if ((flags.base === undefined) !== (flags.synced === undefined)) throw new UsageError('--base and --synced go together');
  if (flags.base !== undefined) {
    sha(flags.base, '--base');
    oneOf(flags.synced, ['yes', 'no'], '--synced');
  }
  return update(path, ctx.now, (state) => {
    const l = (state.lines[branch] ??= newLine());
    if (lines !== undefined) l.lines = lines;
    if (flags.tip !== undefined) l.tip = flags.tip;
    if (flags.base !== undefined) l.base = { sha: flags.base, synced: flags.synced === 'yes', at: ctx.now };
    return { branch, line: l };
  });
}

function set(path, rest, flags, ctx) {
  if (rest.length !== 1) throw new UsageError('set takes exactly one ticket');
  const fields = {
    snapshot: 'snapshotSha256',
    'status-record': 'statusRecord',
    branch: 'branch',
    deliverable: 'deliverable',
    verification: 'verification',
    'unfixed-issue': 'unfixedIssue',
    pr: 'pr',
    'stack-parent': 'stackParent',
    'waiting-on': 'waitingOn',
  };
  const given = Object.keys(fields).filter((k) => flags[k] !== undefined);
  if (!given.length) throw new UsageError(`set needs at least one of ${Object.keys(fields).map((k) => `--${k}`).join(', ')}`);
  if (flags.snapshot !== undefined && !/^[0-9a-f]{64}$/.test(flags.snapshot)) throw new UsageError('--snapshot: expected the 64-digit sha256 of the acceptance snapshot');
  if (flags['unfixed-issue'] !== undefined && !isId(flags['unfixed-issue'])) throw new UsageError('--unfixed-issue: expected an issue id');
  const values = { ...flags };
  if (flags.pr !== undefined) {
    if (!/^[1-9]\d*$/.test(flags.pr)) throw new UsageError(`--pr: expected a pull request number, 1 or more, got ${JSON.stringify(flags.pr)}`);
    values.pr = Number(flags.pr);
  }
  if (flags['stack-parent'] !== undefined && flags['stack-parent'] !== 'none' && !isId(flags['stack-parent'])) throw new UsageError('--stack-parent: expected a ticket id or none');
  if (flags['stack-parent'] === 'none') values['stack-parent'] = null;
  if (flags['waiting-on'] !== undefined) {
    values['waiting-on'] = flags['waiting-on'] === 'none' ? [] : ids(flags['waiting-on'], '--waiting-on');
    if (new Set(values['waiting-on']).size !== values['waiting-on'].length) throw new UsageError('--waiting-on: a ticket is named twice');
  }
  return update(path, ctx.now, (state) => {
    const [id] = ticketsOf(state, rest);
    const t = state.tickets[id];
    for (const k of given) t[fields[k]] = values[k];
    const stacked = stackProblem(state, id, t.stackParent ?? null, t.waitingOn ?? []);
    if (stacked) throw new Refusal(`${id}: ${stacked}`);
    return { tickets: view(state, [id]) };
  });
}

function stage(path, rest, flags, ctx) {
  const [to, ...ids] = rest;
  oneOf(to, STAGES, 'stage');
  return update(path, ctx.now, (state) => {
    for (const id of ticketsOf(state, ids)) transition(state, id, to, flags.reason, ctx.now);
    return { tickets: view(state, ids) };
  });
}

function review(path, rest, flags, ctx) {
  if (rest.length !== 1) throw new UsageError('review takes exactly one ticket');
  const mode = oneOf(flags.mode, ['initial', 'recheck'], '--mode');
  const verdict = oneOf(flags.verdict, ['pass', 'fix', 'stuck'], '--verdict');
  const kind = oneOf(flags.kind ?? 'full', ['full', 'minimal'], '--kind');
  const tier = flags.tier === undefined ? null : oneOf(flags.tier, TIERS, '--tier');
  const findings = flags.findings === undefined ? null : ids(flags.findings, '--findings');
  if (findings !== null && verdict !== 'fix') throw new UsageError('--findings goes with --verdict fix');
  const observations = count(flags.observations ?? 0, '--observations');
  const preExisting = count(flags['pre-existing'] ?? 0, '--pre-existing');
  if (flags['tier-reason'] !== undefined && tier === null) throw new UsageError('--tier-reason goes with --tier');
  const tierReasons = flags['tier-reason'] ?? null;
  if (tierReasons && !tierReasons.every(isText)) throw new UsageError('--tier-reason: expected a reason, not an empty text');
  const given = FINDING_COUNTS.filter((k) => flags[k] !== undefined);
  if (given.length && given.length < FINDING_COUNTS.length) throw new UsageError('--candidates, --confirmed, --invalid and --blocking go together');
  const findingCounts = given.length ? Object.fromEntries(FINDING_COUNTS.map((k) => [k, count(flags[k], `--${k}`)])) : null;
  const why = findingCounts && countsProblem(findingCounts);
  if (why) throw new UsageError(`the finding counts do not add up: ${why}`);
  const covered = flags.covered === undefined ? undefined : count(flags.covered, '--covered');
  return update(path, ctx.now, (state) => {
    const [id] = ticketsOf(state, rest);
    const t = state.tickets[id];
    if (t.stage !== 'in-review') throw new Refusal(`${id}: a review is recorded only in in-review; it is ${t.stage}`);
    t.reviews.push({ mode, verdict, kind, tier, tierReasons, findings, observations, preExisting, findingCounts, ...(covered === undefined ? {} : { covered }), at: ctx.now, after: t.history.length });
    state.usage.reviewRounds += 1;
    return { tickets: view(state, [id]) };
  });
}

function profile(path, rest, flags, ctx) {
  if (rest.length) throw new UsageError(`profile takes flags only, got ${rest[0]}`);
  const given = {};
  for (const k of Object.keys(PROFILE_VALUES)) {
    if (flags[k] === undefined) continue;
    const typed = typeof PROFILE_DEFAULTS[k] === 'boolean' ? { true: true, false: false }[flags[k]] : typeof PROFILE_DEFAULTS[k] === 'number' ? Number(flags[k]) : flags[k];
    if (!PROFILE_VALUES[k].includes(typed)) throw new UsageError(`--${k}: expected one of ${PROFILE_VALUES[k].join(', ')}, got ${JSON.stringify(flags[k])}`);
    given[k] = typed;
  }
  return update(path, ctx.now, (state) => {
    if (state.profile !== null) throw new Refusal(`the profile was written once already; it is not changed during a run (${JSON.stringify(state.profile)})`);
    const moved = Object.entries(state.tickets).find(([, t]) => t.stage !== 'candidate' || t.history.length || t.reviews.length);
    if (moved) {
      throw new Refusal(`the profile is written before the first ticket moves; ${moved[0]} is already ${moved[1].stage} under the defaults, which hold for the rest of the run`);
    }
    const profile = { ...PROFILE_DEFAULTS, ...given };
    const integrate = integrateProblem(profile, state.tracker ?? null);
    if (integrate) throw new Refusal(integrate);
    state.profile = profile;
    return { profile: state.profile };
  });
}

function report(path, rest, flags, ctx) {
  if (rest.length !== 1) throw new UsageError('report takes exactly one ticket');
  const fixed = flags.fixed === undefined ? [] : ids(flags.fixed, '--fixed');
  const unfixed = flags.unfixed === undefined ? [] : ids(flags.unfixed, '--unfixed');
  if (!fixed.length && !unfixed.length) throw new UsageError('report needs --fixed and/or --unfixed');
  return update(path, ctx.now, (state) => {
    const [id] = ticketsOf(state, rest);
    const t = state.tickets[id];
    if (t.stage !== 'fixing') throw new Refusal(`${id}: a per-finding report is recorded only in fixing; it is ${t.stage}`);
    const r = t.reviews.at(-1);
    if (!r || r.verdict !== 'fix' || r.findings === null) {
      throw new Refusal(`${id}: the fix review recorded no finding ids (review --findings), so the report cannot be checked against them`);
    }
    const named = [...fixed, ...unfixed];
    const missing = r.findings.filter((f) => !named.includes(f));
    const extra = named.filter((f) => !r.findings.includes(f));
    if (missing.length || extra.length || new Set(named).size !== named.length) {
      throw new Refusal(`${id}: the report must name each finding of the fix review (${r.findings.join(', ')}) exactly once${missing.length ? `; missing ${missing.join(', ')}` : ''}${extra.length ? `; not in the review ${extra.join(', ')}` : ''}`);
    }
    t.fixReports.push({ fixed, unfixed, at: ctx.now, after: t.history.length });
    return { tickets: view(state, [id]) };
  });
}

function merge(path, rest, flags, ctx) {
  if (rest.length !== 2) throw new UsageError('merge takes a ticket and a merge SHA');
  const merged = sha(rest[1], 'merge SHA');
  return update(path, ctx.now, (state) => {
    const [id] = ticketsOf(state, [rest[0]]);
    const t = state.tickets[id];
    if (t.stage !== 'integrating' && t.stage !== 'delivered') {
      throw new Refusal(`${id}: a merge SHA is recorded in integrating (or delivered, for a -ci merge); it is ${t.stage}`);
    }
    if (t.merges.some((m) => m.sha === merged)) throw new Refusal(`${id}: ${merged} is already recorded`);
    t.merges.push({ sha: merged, at: ctx.now });
    state.lines[t.line].tip = merged;
    return { tickets: view(state, [id]) };
  });
}

function assign(path, rest, flags, ctx) {
  if (flags.record === undefined || !isText(flags.type)) throw new UsageError('assign needs --record <record.json> and --type <agent type>');
  const r = readJson(flags.record, 'record', ctx.read);
  if (!isObject(r) || r.format !== 'sorry-matt/deadline@1' || r.command !== 'record') {
    throw new UsageError(`record ${flags.record}: not the output of deadline.mjs record`);
  }
  time(r.assigned, 'record.assigned');
  time(r.deadline, 'record.deadline');
  if (!Number.isInteger(r.limit) || r.limit <= 0) throw new UsageError('record.limit: not minutes above 0');
  const f = r.fingerprint;
  const expander = isObject(f) && isObject(f.expansions);
  if (!expander && !(isObject(f) && isText(f.head) && isText(f.tree))) throw new UsageError('record.fingerprint: not { head, tree } or { expansions }');
  if (expander && flags.worktree !== undefined) throw new UsageError('--worktree: an expansion agent works in no worktree');
  if (!expander && flags.worktree === undefined) throw new UsageError('--worktree is required with a { head, tree } fingerprint');
  if (flags.line !== undefined) {
    if (rest.length) throw new UsageError('assign takes tickets or --line <integration branch>, not both');
    if (expander) throw new UsageError('--line: a line is assigned an agent that works in its integration worktree, not an expansion agent');
    if (flags.reassign) throw new UsageError('--reassign is for tickets');
    return update(path, ctx.now, (state) => {
      const l = lineOf(state, flags.line);
      l.assignment = newAssignment(flags, r, f, false);
      return { branch: flags.line, line: l };
    });
  }
  return update(path, ctx.now, (state) => {
    const ids = ticketsOf(state, rest);
    for (const id of ids) {
      const t = state.tickets[id];
      if (!flags.reassign) continue;
      if (!TIMEOUT_STAGES.includes(t.stage)) throw new Refusal(`${id}: a timeout reassignment is for ${TIMEOUT_STAGES.join(', ')}; it is ${t.stage}`);
      if ((t.timeoutReassignments[t.stage] ?? 0) >= 1) throw new Refusal(`${id}: it was already reassigned for a timeout in ${t.stage}; the rule is stuck (awaiting-ruling for expanding)`);
    }
    for (const id of ids) {
      const t = state.tickets[id];
      if (flags.reassign) t.timeoutReassignments[t.stage] = (t.timeoutReassignments[t.stage] ?? 0) + 1;
      t.assignment = newAssignment(flags, r, f, expander);
    }
    return { tickets: view(state, ids) };
  });
}

const newAssignment = (flags, r, f, expander) => ({
  agentId: null,
  type: flags.type,
  worktree: expander ? null : resolve(flags.worktree),
  assigned: r.assigned,
  limit: r.limit,
  deadline: r.deadline,
  extended: r.extended === 'yes' ? 'yes' : 'no',
  fingerprint: f,
});

/**
 * What `agent`, `extend` and `release` act on: the named tickets, or the line `--line` names (never both). Each
 * holder is { name, holder } with `holder.assignment` its record; `out` gives the command's output.
 */
function holdersOf(state, rest, flags) {
  if (flags.line === undefined) {
    const ids = ticketsOf(state, rest);
    return { holders: ids.map((id) => ({ name: id, holder: state.tickets[id] })), out: () => ({ tickets: view(state, ids) }) };
  }
  if (rest.length) throw new UsageError('name tickets or --line <integration branch>, not both');
  const l = lineOf(state, flags.line);
  return { holders: [{ name: flags.line, holder: l }], out: () => ({ branch: flags.line, line: l }) };
}

function agent(path, rest, flags, ctx) {
  if (!isText(flags.id)) throw new UsageError('agent needs --id <agent id>');
  return update(path, ctx.now, (state) => {
    const { holders, out } = holdersOf(state, rest, flags);
    for (const { name, holder } of holders) {
      const a = holder.assignment;
      if (!a || a.deadline === null) throw new Refusal(`${name}: no assignment in flight; run deadline.mjs record and assign before the spawn`);
      if (a.agentId !== null && a.agentId !== flags.id) throw new Refusal(`${name}: the assignment already belongs to ${a.agentId}; a new dispatch needs a new assign`);
    }
    for (const { holder } of holders) holder.assignment.agentId = flags.id;
    return out();
  });
}

function inFlight(holders) {
  for (const { name, holder } of holders) {
    const a = holder.assignment;
    if (!a || a.deadline === null) throw new Refusal(`${name}: no assignment in flight`);
  }
}

function extend(path, rest, flags, ctx) {
  const deadline = time(flags.deadline, '--deadline');
  return update(path, ctx.now, (state) => {
    const { holders, out } = holdersOf(state, rest, flags);
    inFlight(holders);
    for (const { name, holder } of holders) if (holder.assignment.extended === 'yes') throw new Refusal(`${name}: the assignment was already extended once; stop it`);
    for (const { holder } of holders) Object.assign(holder.assignment, { deadline, extended: 'yes' });
    // #156: a ticket keeps its own count (a line's agent is counted in usage only); #171: an imported ticket whose
    // seed gave it none stays without one, so retro.mjs reads it as unknown rather than as this extension alone
    if (flags.line === undefined) for (const { holder } of holders) if ('timeoutExtensions' in holder) holder.timeoutExtensions += 1;
    state.usage.timeoutExtensions += 1;
    return out();
  });
}

function release(path, rest, flags, ctx) {
  return update(path, ctx.now, (state) => {
    const { holders, out } = holdersOf(state, rest, flags);
    inFlight(holders);
    for (const { holder } of holders) holder.assignment.deadline = null;
    if (flags.stopped) state.usage.timeoutStops += 1;
    return out();
  });
}

function ci(path, rest, flags, ctx) {
  if (rest.length !== 1) throw new UsageError('ci takes exactly one integration branch');
  const [branch] = rest;
  if (flags.from === undefined) throw new UsageError('ci needs --from <verdict.json>');
  const v = readJson(flags.from, 'verdict', ctx.read);
  if (!isObject(v) || v.format !== 'sorry-matt/ci@1' || v.command !== 'verdict') throw new UsageError(`verdict ${flags.from}: not the output of ci.mjs verdict`);
  if (v.branch !== branch) throw new UsageError(`verdict ${flags.from}: it is for ${v.branch}, not ${branch}`);
  sha(v.sha, 'verdict.sha');
  oneOf(v.verdict, VERDICTS, 'verdict.verdict');
  const branchRuns = flags['branch-runs'] === undefined ? undefined : count(flags['branch-runs'], '--branch-runs');
  return update(path, ctx.now, (state) => {
    const l = lineOf(state, branch);
    if (l.ciNotCovering !== null) throw new Refusal(`${branch}: settled as CI not covering it at ${l.ciNotCovering.at}; it is not read again`);
    l.ci = { sha: v.sha, verdict: v.verdict, reason: v.reason ?? null, at: ctx.now };
    const empty = v.verdict === 'no-run' && v.reason === 'empty';
    if (!empty) l.noRun = { count: 0, round: null };
    else if (flags.dispatch && l.noRun.round !== state.usage.rounds) l.noRun = { count: l.noRun.count + 1, round: state.usage.rounds };
    if (empty && l.noRun.count >= 2 && branchRuns === 0) l.ciNotCovering = { sha: v.sha, at: ctx.now };
    return {
      branch,
      noRun: l.noRun.count,
      ciNotCovering: l.ciNotCovering !== null,
      branchCheckNeeded: empty && l.noRun.count >= 2 && l.ciNotCovering === null && branchRuns === undefined,
    };
  });
}

function local(path, rest, flags, ctx) {
  if (rest.length !== 4) throw new UsageError('local takes a branch, a full SHA, green|red and a reason');
  const [branch, at, result, reason] = rest;
  sha(at, 'SHA', true);
  oneOf(result, ['green', 'red'], 'result');
  oneOf(reason, LOCAL_REASONS, 'reason');
  return update(path, ctx.now, (state) => {
    const l = lineOf(state, branch);
    const seen = l.local.find((r) => r.sha === at);
    if (seen) throw new Refusal(`${branch}: ${at} already has a local verification record (${seen.result}, ${seen.reason}); reuse it`);
    const record = { sha: at, result, reason, at: ctx.now };
    l.local.push(record);
    return { branch, record, line: localLine(branch, record) };
  });
}

function usage(path, rest, flags, ctx) {
  if (rest.length) throw new UsageError(`usage takes flags only, got ${rest[0]}`);
  if (flags.started !== undefined) time(flags.started, '--started');
  const wait = flags.wait === undefined ? 0 : count(flags.wait, '--wait');
  const spawnsFlag = flags.spawns === undefined ? undefined : count(flags.spawns, '--spawns');
  const adds = (flags.add ?? []).map((pair) => {
    const [name, n] = pair.split('=');
    oneOf(name, ADDABLE, '--add');
    return [name, count(n, `--add ${name}`)];
  });
  const tokens = flags.tokens === undefined ? undefined : flags.tokens === 'unknown' ? null : count(flags.tokens, '--tokens');
  if (flags['sleep-task'] !== undefined && !isText(flags['sleep-task'])) throw new UsageError('--sleep-task: a task id or none');
  const spawns = hookSpawns(path, ctx.read);
  return update(path, ctx.now, (state) => {
    const u = state.usage;
    if (flags.started !== undefined) {
      if (u.started !== null && u.started !== flags.started) throw new Refusal(`usage: the start is already ${u.started}; it is set once`);
      u.started = flags.started;
    }
    u.waitingSeconds += wait;
    if (spawns !== null) Object.assign(u, { spawns, spawnsSource: 'counters' });
    else if (spawnsFlag !== undefined) Object.assign(u, { spawns: spawnsFlag, spawnsSource: 'host' });
    for (const [name, n] of adds) u[name] += n;
    if (tokens !== undefined) u.tokens = tokens;
    if (flags['sleep-task'] !== undefined) u.sleepTask = flags['sleep-task'] === 'none' ? null : flags['sleep-task'];
    return { usage: u, progressUsage: { rounds: u.rounds, spawns: u.spawns, hours: hoursAt(u, Date.parse(ctx.now)) } };
  });
}

function progress(path, rest, flags, ctx) {
  if (rest.length) throw new UsageError(`progress takes flags only, got ${rest[0]}`);
  if (flags.from === undefined) throw new UsageError('progress needs --from <progress.json>');
  const p = readJson(flags.from, 'progress', ctx.read);
  if (!isObject(p) || p.format !== 'sorry-matt/deadline@1' || p.command !== 'progress') throw new UsageError(`progress ${flags.from}: not the output of deadline.mjs progress`);
  if (!isCount(p.noProgress) || !isCount(p.rounds) || typeof p.stop !== 'boolean' || !Array.isArray(p.stoppedBy) || !isObject(p.snapshot)) {
    throw new UsageError(`progress ${flags.from}: missing noProgress, rounds, stop, stoppedBy or snapshot`);
  }
  return update(path, ctx.now, (state) => {
    if (state.stop !== null) throw new Refusal(`the run stopped at ${state.stop.at} (${state.stop.stoppedBy.join(', ')}); there are no more dispatch points`);
    const u = state.usage;
    u.noProgress = p.noProgress;
    u.snapshot = p.snapshot;
    if (p.stop) {
      state.stop = {
        at: ctx.now,
        stoppedBy: p.stoppedBy,
        usage: { rounds: u.rounds, spawns: u.spawns, hours: hoursAt(u, Date.parse(ctx.now)) },
        note: flags.note ?? null,
      };
    } else u.rounds = p.rounds;
    return { usage: u, stop: state.stop };
  });
}

function checkGate(path, rest, flags, ctx) {
  const [name, ...targets] = rest;
  oneOf(name, GATES, 'gate');
  const kind = TARGETS[name];
  if (!kind && targets.length) throw new UsageError(`check ${name} takes no tickets or branches, got ${targets[0]}`);
  if (kind === 'ticket!' && !targets.length) throw new UsageError(`check ${name} needs at least one ticket`);
  if (new Set(targets).size !== targets.length) throw new UsageError('a ticket or branch is named twice');
  if (name === 'freeze' && !isText(flags.base)) throw new UsageError('check freeze needs --base <ref>');
  if (name !== 'freeze' && flags.base !== undefined) throw new UsageError('--base goes with check freeze');
  if (name === 'ledger' && !isText(flags.ledger)) throw new UsageError('check ledger needs --ledger <path>');
  if (name !== 'ledger' && (flags.ledger !== undefined || flags.ended)) throw new UsageError('--ledger and --ended go with check ledger');
  const state = load(path);
  if (kind === 'branch') for (const b of targets) lineOf(state, b);
  else if (kind && targets.length) ticketsOf(state, targets);
  const profile = profileOf(state);
  const repo = resolve(flags.repo ?? '.');
  return runGate(name, state, { targets, base: flags.base, ledger: flags.ledger, ended: flags.ended === true }, {
    profile,
    queueGuard: (id, t) => stageGuard(id, t, 'queued', null, profile),
    git: ctx.git ?? ((args) => exec('git', ['-C', repo, ...args])),
    read: ctx.read,
    env: ctx.env,
  });
}

// ---- entry ---------------------------------------------------------------------------------------------------------

const NOW = { now: 'one' };
const COMMANDS = {
  init: [init, { run: 'one', tracker: 'one', ...NOW }],
  import: [importLedger, { from: 'one', ledger: 'one', ...NOW }],
  show: [(path) => show(load(path)), {}],
  resume: [(path) => resume(load(path)), {}],
  add: [add, { line: 'one', ...NOW }],
  bundle: [bundle, NOW],
  line: [line, { lines: 'one', tip: 'one', base: 'one', synced: 'one', ...NOW }],
  profile: [profile, { ...Object.fromEntries(Object.keys(PROFILE_VALUES).map((k) => [k, 'one'])), ...NOW }],
  set: [set, { snapshot: 'one', 'status-record': 'one', branch: 'one', deliverable: 'one', verification: 'one', 'unfixed-issue': 'one', pr: 'one', 'stack-parent': 'one', 'waiting-on': 'one', ...NOW }],
  stage: [stage, { reason: 'one', ...NOW }],
  review: [review, { mode: 'one', verdict: 'one', kind: 'one', tier: 'one', 'tier-reason': 'many', findings: 'one', observations: 'one', 'pre-existing': 'one', covered: 'one', ...Object.fromEntries(FINDING_COUNTS.map((k) => [k, 'one'])), ...NOW }],
  report: [report, { fixed: 'one', unfixed: 'one', ...NOW }],
  merge: [merge, NOW],
  assign: [assign, { record: 'one', type: 'one', worktree: 'one', reassign: 'bool', line: 'one', ...NOW }],
  agent: [agent, { id: 'one', line: 'one', ...NOW }],
  extend: [extend, { deadline: 'one', line: 'one', ...NOW }],
  release: [release, { stopped: 'bool', line: 'one', ...NOW }],
  ci: [ci, { from: 'one', dispatch: 'bool', 'branch-runs': 'one', ...NOW }],
  local: [local, NOW],
  usage: [usage, { started: 'one', wait: 'one', spawns: 'one', add: 'many', 'sleep-task': 'one', tokens: 'one', ...NOW }],
  progress: [progress, { from: 'one', note: 'one', ...NOW }],
  check: [checkGate, { repo: 'one', base: 'one', ledger: 'one', ended: 'bool' }],
};

export function defaultDeps() {
  return { read: (p) => readFileSync(p, 'utf8'), clock: () => Date.now(), env: process.env };
}

// Returns { code, out, err } instead of touching the process, so tests can drive it.
export function main(argv, deps = defaultDeps()) {
  try {
    const entry = COMMANDS[argv[0]];
    if (!entry) throw new UsageError(`expected one of ${Object.keys(COMMANDS).join(', ')}`);
    const [run, spec] = entry;
    const { flags, rest } = parseArgs(argv.slice(1), spec);
    if (!rest.length) throw new UsageError(`${argv[0]} needs the state file first`);
    const path = resolve(rest[0]);
    const now = flags.now === undefined ? formatTime(Math.floor(deps.clock() / 1000) * 1000) : time(flags.now, '--now');
    const result = run(path, rest.slice(1), flags, { now, read: deps.read, env: deps.env ?? {}, git: deps.git });
    const out = argv[0] === 'show' ? result : { format: FORMAT, command: argv[0], ...result };
    const failed = argv[0] === 'check' && !result.ok;
    const err = failed ? result.failures.map((f) => `state: check ${result.gate}: ${f.assertion}: ${f.subject}: ${f.message}\n`).join('') : '';
    return { code: failed ? 4 : 0, out: `${JSON.stringify(out, null, 2)}\n`, err };
  } catch (e) {
    if (e instanceof Refusal) return { code: 3, out: '', err: `state: refused: ${e.message}\n` };
    return failure('state', e);
  }
}

runIfEntry(import.meta.url, main);
