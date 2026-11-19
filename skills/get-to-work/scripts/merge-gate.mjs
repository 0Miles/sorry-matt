#!/usr/bin/env node
// merge-gate: whether get-to-work's finish may send `gh pr merge` for an aggregate PR into a base branch, as far as
// the base branch's merge queue is concerned (FINISH.md, "merge queue"). Read-only: it queries `gh` and `git` and
// never merges, enqueues or writes anything. Whether a merge may be sent at all (standing authority, the user's
// instruction, a line not synced or failing verification) is decided before it, by the host; this script only
// answers the queue's part. No dependencies: runs on a bare Node 20+ with git and the `gh` CLI.
//
// Usage
//   node merge-gate.mjs --repo <owner>/<name> --base <base branch> [--worktree <dir>]
//
// `--worktree` is any worktree of the repository (default: the current directory); `git` and `gh` run there.
// The queries, in order; the first that decides ends the run, and any query that fails decides "human":
//   1. merge-queue  gh api graphql -f query='query($owner:String!,$name:String!,$branch:String!){repository(
//                     owner:$owner,name:$name){mergeQueue(branch:$branch){url}}}' -f owner=… -f name=… -f branch=…
//                   `mergeQueue` null: no queue, decision "merge" (reason "no-queue"): send `gh pr merge` as before.
//                   Failed: `gh` exited non-zero, the response is not JSON, has a non-empty `errors`, or has no
//                   `data.repository`.
//   2. workflows    git grep -l merge_group origin/<base> -- .github/workflows
//                   Exit 0 (a workflow names `merge_group`): decision "queue" (reason "merge-group-trigger").
//                   Exit 1: none; go on. Any other exit (or git could not be started): failed.
//   3. rules        gh api repos/<owner>/<name>/rules/branches/<base>
//                     --jq '[.[]|select(.type=="required_status_checks")|.parameters.required_status_checks[].context]'
//   4. protection   gh api repos/<owner>/<name>/branches/<base> --jq '.protection.required_status_checks.contexts'
//                   Each prints a JSON array of check names; `null` (or nothing) is the empty set. Failed: `gh` exited non-zero
//                   or printed something that is not an array of strings (or null).
//                   The required checks are the union (rules first, then protection, each name once). None:
//                   decision "queue" (reason "no-required-checks"). Some: decision "human" (reason
//                   "required-checks-without-trigger"): they may come from a third-party CI whose answer to
//                   `merge_group` cannot be queried, and a PR sent would sit in the queue.
// Decisions
//   merge  No merge queue: send `gh pr merge` the usual way.
//   queue  The queue is on and its checks will run: send the same `gh pr merge <PR>`, with no merge strategy and
//          no `--admin` (never `--admin` to skip the queue, never GraphQL's `enqueuePullRequest` around
//          `gh pr merge`'s permission check).
//   human  Do not send: put it on the human-work list with the missing trigger and `requiredChecks`, or with the
//          failed query and its error.
//
// Output (stdout, JSON; format "sorry-matt/merge-gate@1"; fields are only ever added, never renamed)
//   { "format", "repo": "<owner>/<name>", "base",
//     "decision": "merge" | "queue" | "human",
//     "reason":   "no-queue" | "merge-group-trigger" | "no-required-checks" | "required-checks-without-trigger"
//                 | "query-failed",
//     "queue":    { "enabled": true | false, "url": "<url>" | null } | null,   // null: the query failed
//     "workflows": ["<path>"] | null,        // the workflows naming merge_group; null: not queried or failed
//     "requiredChecks": ["<name>"] | null,   // null: not queried or failed
//     "failed":   null | { "query": "merge-queue" | "workflows" | "rules" | "protection", "error": "<message>" } }
//
// Exit codes: 0 output written, a failed query included (it is a result: decision "human"); 1 something else went
// wrong; 2 bad arguments. On 1 and 2 nothing is written to stdout.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { UsageError, run, failure, runIfEntry } from './cli.mjs';

export const FORMAT = 'sorry-matt/merge-gate@1';

const QUERY = 'query($owner:String!,$name:String!,$branch:String!){repository(owner:$owner,name:$name){mergeQueue(branch:$branch){url}}}';
const RULES_JQ = '[.[]|select(.type=="required_status_checks")|.parameters.required_status_checks[].context]';
const PROTECTION_JQ = '.protection.required_status_checks.contexts';

/** Thrown inside a query: that query failed, and the decision is "human". */
class QueryFailed extends Error {
  constructor(query, message) {
    super(message);
    this.query = query;
  }
}

const errorText = (e) => String((e.stderr && String(e.stderr).trim()) || e.message).trim();

function ghCall(deps, query, args) {
  try {
    return deps.gh(args, deps.cwd);
  } catch (e) {
    throw new QueryFailed(query, errorText(e));
  }
}

function mergeQueue(deps, owner, name, base) {
  const out = ghCall(deps, 'merge-queue', ['api', 'graphql', '-f', `query=${QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-f', `branch=${base}`]);
  let body;
  try {
    body = JSON.parse(out);
  } catch {
    throw new QueryFailed('merge-queue', 'the GraphQL response is not JSON');
  }
  if (Array.isArray(body?.errors) && body.errors.length) {
    throw new QueryFailed('merge-queue', body.errors.map((e) => e?.message ?? JSON.stringify(e)).join('; '));
  }
  const repository = body?.data?.repository;
  if (!repository || typeof repository !== 'object') throw new QueryFailed('merge-queue', 'the GraphQL response has no data.repository');
  const q = repository.mergeQueue;
  if (q === null || q === undefined) return { enabled: false, url: null };
  return { enabled: true, url: typeof q.url === 'string' ? q.url : null };
}

function workflows(deps, base) {
  const ref = `origin/${base}`;
  const r = deps.git(['grep', '-l', 'merge_group', ref, '--', '.github/workflows'], deps.cwd);
  if (r.status === 1) return [];
  if (r.status !== 0) throw new QueryFailed('workflows', String(r.stderr || r.error?.message || `git grep exited ${r.status}`).trim());
  return r.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => (l.startsWith(`${ref}:`) ? l.slice(ref.length + 1) : l));
}

function checks(deps, query, args) {
  const out = ghCall(deps, query, args);
  if (!out.trim()) return [];
  let value;
  try {
    value = JSON.parse(out);
  } catch {
    throw new QueryFailed(query, `gh printed something that is not JSON: ${out.trim().slice(0, 200)}`);
  }
  if (value === null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) throw new QueryFailed(query, 'gh did not print an array of check names');
  return value;
}

/** The gate for one base branch: the output object without its format. */
export function gate({ owner, name, base }, deps) {
  const out = { repo: `${owner}/${name}`, base, decision: 'human', reason: 'query-failed', queue: null, workflows: null, requiredChecks: null, failed: null };
  try {
    out.queue = mergeQueue(deps, owner, name, base);
    if (!out.queue.enabled) return { ...out, decision: 'merge', reason: 'no-queue' };
    out.workflows = workflows(deps, base);
    if (out.workflows.length) return { ...out, decision: 'queue', reason: 'merge-group-trigger' };
    const rules = checks(deps, 'rules', ['api', `repos/${owner}/${name}/rules/branches/${base}`, '--jq', RULES_JQ]);
    const protection = checks(deps, 'protection', ['api', `repos/${owner}/${name}/branches/${base}`, '--jq', PROTECTION_JQ]);
    out.requiredChecks = [...new Set([...rules, ...protection])];
    if (!out.requiredChecks.length) return { ...out, decision: 'queue', reason: 'no-required-checks' };
    return { ...out, decision: 'human', reason: 'required-checks-without-trigger' };
  } catch (e) {
    if (!(e instanceof QueryFailed)) throw e;
    return { ...out, decision: 'human', reason: 'query-failed', failed: { query: e.query, error: e.message } };
  }
}

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const name = a.startsWith('--') ? a.slice(2) : null;
    if (!['repo', 'base', 'worktree'].includes(name)) throw new UsageError(`unexpected argument ${a}`);
    if (name in flags) throw new UsageError(`${a} is given twice`);
    if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`);
    flags[name] = argv[(i += 1)];
  }
  if (!flags.repo || !/^[^/\s]+\/[^/\s]+$/.test(flags.repo)) throw new UsageError('--repo <owner>/<name> is required');
  if (!flags.base) throw new UsageError('--base <base branch> is required');
  return flags;
}

export function defaultDeps() {
  return {
    cwd: process.cwd(),
    gh: (args, cwd) => run('gh', args, cwd),
    git: (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 << 20 }),
  };
}

// Returns { code, out, err } instead of touching the process, so tests can drive it.
export function main(argv, deps = defaultDeps()) {
  try {
    const flags = parseArgs(argv);
    const [owner, name] = flags.repo.split('/');
    const cwd = resolve(deps.cwd, flags.worktree ?? '.');
    const result = gate({ owner, name, base: flags.base }, { ...deps, cwd });
    return { code: 0, out: `${JSON.stringify({ format: FORMAT, ...result }, null, 2)}\n`, err: '' };
  } catch (e) {
    return failure('merge-gate', e);
  }
}

runIfEntry(import.meta.url, main);
