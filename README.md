# sorry-matt

plz stop grilling me<br>
grill them

![I don't know](assets/karyl-i-dont-know.png)

## Skills

| Skill | Description |
| --- | --- |
| `ask-miles` | Route among sorry-matt skills and identify the best next skill for the current situation |
| `grill-them` | Run an autonomous iterative interview between two agents to refine a plan or design |
| `take-this` | Carry completed grilling into an executable spec and ticket set for a new task |
| `get-to-work` | Clear a prepared ticket set as a per-ticket pipeline: ready tickets whose files do not overlap are implemented at once, each one reviewed and integrated as soon as it is done, delivering one aggregate GitHub PR or local integration branch per line |
| `have-it-all-done` | Take over one complete task, carrying prior grilling through planning and implementation to something a human can merge |
| `issue-chain` | Build a chain from tracker and local evidence, establish blocker edges, and choose exactly one immediately executable next action |
| `review-pr` | Review a GitHub PR and publish evidenced, directly applicable feedback to it. Use when a user asks to review a PR, post review findings to the PR, or re-review it after fixes. |
| `prove-it` | Ticket-level independent review for the sorry-matt workflow: an evidence chain, a live run, and mutation limited to the ticket's diff, ending in a pass / fix / stuck verdict in the ticket's status record. Called by `get-to-work`; posts no PR comments. |
| `no-bullshit` | Cut the crap. Get to the point: answer first, ceremony gone, every technical fact kept — in conversation, or on a draft written for people. Adapted from [caveman](https://github.com/JuliusBrussee/caveman). |
| `clean-it-up` | Safely remove merged local branches and obsolete worktrees after a Git task is finished; remote branches require explicit opt-in. |
| `figure-out-the-ui` | Before writing a new interface, settle who it is for and what it solves. Produces a UI brief, no code. |
| `build-the-ui-right` | While writing user-visible frontend code, consult design and platform guidance, cover every state, and reuse the project's own tokens and components. |
| `actually-look-at-the-ui` | After a frontend change, open it in a real browser, record evidence for each claim, and mark what was not seen as unverified. |
| `make-the-ui-fast` | When the UI is slow, measure first, name the bottleneck, change one thing, and measure again. |
| `make-this-shit-pretty` | Rework an existing piece of UI in small verified steps, with behavior unchanged. |
| `set-up-ui-skills` | Map a frontend project's component library, tokens, shared components, and conventions into `docs/agents/ui.md` for the frontend skills. Run once per project. |

The tracker-aware workflows support both GitHub Issues and Matt's Local Markdown tracker. The repository's
`docs/agents/issue-tracker.md` selects the active provider and defines its conventions.

## Frontend skills

Run the setup once per frontend project before the frontend skills:

```
/set-up-ui-skills
```

It explores the project for its component library, tokens, shared components, and conventions, asks everything
it cannot settle from evidence in one batch with a recommended answer each, shows you the draft, then writes
`docs/agents/ui.md` and a `### UI` subsection in your `CLAUDE.md` or `AGENTS.md`. The frontend skills read that
file as the project's component map. Edit it directly afterwards; re-run the setup only to start over.

Four of the frontend skills need no command. The agent picks them up on its own while working on a web
frontend, each at its own moment:

| When the agent is… | It loads |
| --- | --- |
| about to add a page, component, form, or flow, or restructure an existing one | `figure-out-the-ui` |
| writing or changing user-visible frontend code | `build-the-ui-right` |
| done with a frontend change and about to report it | `actually-look-at-the-ui` |
| asked about slow loads, laggy interactions, layout jumps, or LCP, INP, CLS, bundle size | `make-the-ui-fast` |

Ask for the work as you normally would — "add a settings page", "this list feels slow" — and the matching
skills load. You can still type any of them as a slash command to force it.

The fifth is yours to run. When an existing piece of UI needs reworking without changing what it does:

```
/make-this-shit-pretty <page, component, route, or flow>
```

It walks the whole journey for problems, shows you the findings and the proposed structure once for a ruling,
then rewrites in small steps with a before/after pair and one commit per step.

For design and platform knowledge, the frontend skills consult two upstream skills when they are installed:
[`master-design`](https://github.com/master-co/design) for what to build and why, and
[`modern-web-guidance`](https://github.com/GoogleChrome/modern-web-guidance) for which platform API to use.
Without them the skills still run on their own rules and tell you which one was missing.

Verification needs a browser tool in the agent's environment. Without one, `actually-look-at-the-ui` marks its
claims unverified instead of reporting them as checked.

## Installation

Install the upstream mattpocock skills first, then install this plugin:

```bash
claude plugin marketplace add mattpocock/skills
claude plugin install mattpocock-skills@mattpocock
claude plugin marketplace add 0Miles/sorry-matt
claude plugin install sorry-matt@sorry-matt
```

You can also use the `/plugin` interface in Claude Code.

Optionally, install the two upstream skills the frontend skills consult:

```bash
npx skills add master-co/design --skill master-design
npx modern-web-guidance@latest install
```

## Guard hook

The plugin ships a PreToolUse hook (`hooks/hooks.json` → `hooks/guard.mjs`, needs Node.js 20+ on `PATH`) on
`Bash`, `PowerShell`, `Edit`, `Write`, `MultiEdit`, `NotebookEdit` and MCP tools. It runs in **every session
where the plugin is enabled**, not only sorry-matt runs. It does not decide what an agent may do — your permission
settings do — it adds a prompt before a few things that should not happen unseen. Each call gets one of three
levels:

| Level | What | Covers |
| --- | --- | --- |
| **double** | two-step confirmation, with the consequences spelled out | catastrophic actions: a recursive delete of `~`, `/`, a drive root, `.`, `..` or a path outside the project; `format`, `mkfs*`, `dd of=/dev/…`, `diskpart`; `dropdb`, SQL `DROP DATABASE/SCHEMA/TABLE`, `TRUNCATE`, `FLUSHALL`/`FLUSHDB`, `dropDatabase()`; `gh repo delete`, the API/GraphQL repo deletes and MCP `delete_repository`; `terraform`/`tofu`/`pulumi destroy`; `gcloud projects delete`, `az group delete`; `kubectl delete namespace`, `aws s3 rb` and `aws cloudformation delete-stack` aimed at prod; a force-push to, or delete of, `main`, `master` or the remote's default branch. Outgoing messages: mailers, `git send-email`, chat and mail APIs through `curl` and friends (a plain GET only reads, except APIs that send on GET such as Telegram's `sendMessage`), MCP send/post actions. Payments: `stripe` writes, non-GET calls to payment APIs, MCP payment actions |
| **ask** | asked once | releases and production deploys: `npm`/`pnpm`/`yarn`/`bun` publish (recursive and workspace forms too), `cargo publish`, `gem push`, `dotnet nuget push`, `twine upload`, `vsce publish`, `gh release create`, `terraform`/`pulumi` apply, `fly deploy`, `wrangler deploy`, `firebase deploy`, other deploy tools and SQL writes aimed at prod, also through `npx`/`bunx`/`pnpm dlx`, `gh workflow run` with prod. Not asked: `--dry-run`, and targets explicitly named as non-production (`-var-file=staging.tfvars`, `TF_WORKSPACE=dev`, `fly deploy -a shop-staging`, `wrangler deploy --env staging`, `firebase deploy -P app-dev`), and `ssh prod-host <read-only command>` such as `uptime`, `tail` or `systemctl status`. Writes to files that change how Claude Code behaves: `.claude/settings*.json`, `managed-settings.json`, `.claude/hooks/`, `~/.claude.json`, `.mcp.json`, `managed-mcp.json`, `.claude/sorry-matt.json` (reading, printing, testing, opening or committing them is not a write, and a copy writes only its destination). A merge that deploys to production right away (below) |
| none | let through to your permission settings | everything else: force-pushing a feature branch, `git reset --hard`, `git clean`, deletes inside the project, cloning, installing packages or extensions, `curl … \| sh`, reading or writing credential files, `sudo`, `chmod`, `icacls` |

**What it is not.** The guard matches command text; it is not a security boundary. It does not see through an
interpreter wrapper (`node -e`, `python -c`), variable expansion, scripts that do the work for it, or commands like
`find / -delete`. The two-step confirmation guards against a misjudgment or a slip, not against an agent set on
getting around it. And it only adds a prompt; whether that prompt is shown depends on the rest of the setup:

- Without managed settings, another plugin's or your own hook that returns `allow` for the same call can keep the
  prompt from appearing.
- In `dontAsk` mode, or with prompts turned into denials, an `ask` becomes a deny.
- In `bypassPermissions` mode nothing guarantees a prompt: the guard denies double-level calls outright, and the
  single-confirmation ones mostly run without a prompt.

**Two-step confirmation.** The first time a double-level shell command comes in, the hook asks with the
consequences ("recursive delete of /home/me: no recycle bin, unrecoverable without a backup") and swaps the command
for `node "<plugin>/hooks/confirm.mjs" <token>`. Allowing that prompt runs only `confirm.mjs`, which records the
approval and asks the agent to resend the original command unchanged; refusing records nothing. The resend — same
session, same tool, same input, within 10 minutes — gets the second prompt, and only allowing that one runs it. An
approval is spent on that second prompt. MCP tools cannot have their input swapped, so their first call is denied
with the `confirm.mjs` command to run first. The state lives in `<os temp dir>/sorry-matt-guard/<session>.json`; if
it cannot be read or written the call is never let through on that account. Only the exact command the guard hands
out may run `confirm.mjs`: any other command that names `confirm.mjs`, `confirm-state` or the state directory
(chained, rewritten, another path, an interpreter one-liner, a redirect), and any file-tool write into the state
directory, is denied; reading the scripts or committing them is not. In `auto` mode and every other attended mode
the flow above applies, since a PreToolUse `ask` goes to the permission prompt.

**Merges that deploy.** `gh pr merge` (with `--admin` or `--auto` too) and every direct write to a protected branch
(`git push` to it, `gh api` merge, ref and contents endpoints, GraphQL `mergePullRequest`,
`enablePullRequestAutoMerge`, `enqueuePullRequest`, `createCommitOnBranch`, MCP merge and push tools) are asked
only when the merge would deploy right away. The hook takes, in order:

1. `SORRY_MATT_MERGE_DEPLOYS` (`yes`/`no`) in the environment, or `{"mergeDeploysProduction": true|false}` in the
   repo's `.claude/sorry-matt.json` (that file only speaks for its own clone's origin);
2. otherwise detection, on the workflows the merge leaves on the base branch: for a PR, `gh pr view` gives the base
   and the head, and the head's `.github/workflows/*.y*ml` are read (the base's when the head is not available
   locally, which the prompt says); for a PR in another repo than this clone's origin (`--repo`), the same files
   are read from GitHub with `gh api graphql`; for a push, the tree of the ref being pushed. A variable set earlier
   on the same command line (`R=owner/repo; gh pr merge 1 --repo $R`) is read as its value. A workflow that a push to the base
   triggers deploys when a job has `environment: prod`/`production`, uses a known deploy action
   (`actions/deploy-pages`, `peaceiris/actions-gh-pages`, `cloudflare/wrangler-action`,
   `FirebaseExtended/action-hosting-deploy`, …), calls a reusable workflow named like a deploy or release, or runs
   `vercel --prod`, `fly deploy`, `wrangler deploy`, `firebase deploy`, `netlify deploy --prod`, `npm publish`,
   `cargo publish`, `gh release create`, or `kubectl apply`/`helm upgrade` with prod — unless that job or step is
   gated on a release tool's output (release-please's `release_created`, changesets' `published`) or on a tag.
   Merging the release tool's own release PR (head `release-please--*` or `changeset-release/*`, or the
   `autorelease: pending` label) lifts that gate: it releases right away.

Detected: asked, naming the workflow and the signal. Clearly not: let through to your permission settings. A lookup
that fails, or a job or step named like a deploy, release or publish whose action the hook does not recognize:
asked, saying why.

**Unattended.** A prompt waits for an answer for as long as it takes, so an agent left running overnight stops at
the first one. Before you walk away, create the switch file; every call the guard would ask about is then denied
instead, with a message telling the agent to put it on the human-work list (or in its final report) and carry on.
Two-step actions are denied before any confirmation is recorded. Remove the file to be asked again. The guard
reads it on every call, so it takes effect in sessions that are already running. Setting `SORRY_MATT_UNATTENDED=on`
in the `env` of your settings does the same for new sessions. This only makes the guard stricter; prompts that
come from your own permission settings are not the guard's and still appear (in `auto` mode the classifier decides
those instead).

```bash
touch ~/.claude/sorry-matt-unattended   # going to bed
rm ~/.claude/sorry-matt-unattended      # back
```

To turn the guard off, set it in the `env` of your Claude Code settings:

```json
{
  "env": { "SORRY_MATT_GUARD": "off" }
}
```

Whether `gh pr merge` goes ahead otherwise is up to your permission settings, and sorry-matt sends the aggregate PR's
merge only when a rule allows it or you told it to merge in that run. To let it merge aggregate PRs without a
prompt, add these rules to `.claude/settings.local.json` (one repo) or `~/.claude/settings.json` (every project),
merging them into an existing `permissions.allow` if there is one; to be asked every time put them under `ask`,
and to never allow it put them under `deny`:

```json
{
  "permissions": {
    "allow": ["Bash(gh pr merge:*)", "PowerShell(gh pr merge:*)"]
  }
}
```

## Compaction reminder

The plugin also ships a SessionStart hook with matcher `compact` (`hooks/hooks.json` → `hooks/reread.mjs`). After a
compaction it looks for run ledgers in progress under `<git common dir>/sorry-matt/runs/` (first line
`<!-- sorry-matt:run active -->`) and prints each ledger with the rule files it lists, so the host re-reads them
instead of working from the summary. Outside a git repo, or with no run in progress, it prints nothing.

## Run budget

While a run is in progress, two more hooks share one entry (`hooks/hooks.json` → `hooks/spawns.mjs`):

- **SubagentStart** counts each new subagent in `<run>.counters.json` next to the run ledger (a resumed subagent keeps
  its `agent_id` and is not counted again). Only the hook writes that file, under an exclusive lock file and through
  a temporary file and a rename, so it never races with the host writing the ledger. SubagentStart cannot block a
  spawn; it only counts.
- **PreToolUse** on `Agent` denies the spawn once the count reaches the ledger's `budget: spawns <N>` line (field 9:
  200 when the ledger is created, rewritten to `30 × tickets + 50` once the ticket count is known, or to the spawns
  already used plus `30 × tickets` when that is higher). It is a last
  resort; a single stuck agent is caught by `get-to-work`'s stage time limits first. The limit is re-read on every
  call, so editing that line takes effect immediately.

With no run in progress, or no `budget: spawns` line, neither hook counts against anything or blocks anything. While
a run is in progress, know how far it reaches:

- **Every session in the repo counts.** The hooks cannot tell which session a subagent belongs to, so any session
  working in the same repository (any worktree) adds to an active run's count, not just the run's own host.
- **A run at its limit blocks every session in the repo.** With several runs in progress, each one counts every
  spawn, and any one at its limit denies spawns everywhere in that repo.
- **A run that ended abnormally keeps blocking.** If a run stops without reaching its handoff (a crash, a closed
  terminal), its ledger still starts with `<!-- sorry-matt:run active -->`. Change that first line to
  `<!-- sorry-matt:run ended -->` by hand; the deny message names the ledger.
- **Parallel spawns can overshoot.** Agent calls sent in one message are each checked before any of them starts, so
  a batch can take the count past the limit; the next spawn after it is denied.
- **Failures.** A counters file that is not JSON, or not in the counters format, denies spawns until it is fixed (the
  deny says so). A read still blocked by a file lock (antivirus, indexer) after the retries lets the spawn through
  with a warning; the count itself is still kept.

The other limits (`rounds`, which counts dispatch points — 40 when the ledger is created, rewritten to
`3 × tickets + 1` alongside `spawns` — `hours`, `no-progress`) and the no-progress breaker are enforced by
`get-to-work` itself at every dispatch point. The stage time limits (`budget: timeout-implement 30`,
`timeout-fix 20`, `timeout-expand 15`, `timeout-merge 15`, in minutes) are checked by `get-to-work` at every
wake-up: an overdue agent whose worktree moved is extended once, otherwise it is stopped with `TaskStop` and the
ticket is reassigned, sent back for a redo (an overdue merge agent), marked stuck or left awaiting ruling; a
red-light fix agent that is stopped counts as one failed fix round. The spawn-budget check has its own opt-out, separate from the guard's, so turning one off leaves the other on:

```json
{
  "env": { "SORRY_MATT_BUDGET": "off" }
}
```

### Hard caps for headless runs

The ledger limits are counted by the run itself. When you run sorry-matt headless, also give Claude Code a hard cap
that holds whatever the run does — `--max-turns` limits agentic turns, and `--max-budget-usd` stops the run once the
estimated API spend reaches the amount (subagent spend counts; spend can overshoot, so leave headroom). Both apply
in print mode only:

```bash
claude -p --max-turns 400 --max-budget-usd 50 "/have-it-all-done <task>"
```

## Updating

Update sorry-matt:

```bash
claude plugin marketplace update sorry-matt
claude plugin update sorry-matt@sorry-matt
```

Update the upstream mattpocock skills separately:

```bash
claude plugin marketplace update mattpocock
claude plugin update mattpocock-skills@mattpocock
```

Restart Claude Code after updating so the new skill definitions are loaded.

## Repository structure

- `src/skills/` contains the Traditional Chinese source files and is the single source of truth.
- `skills/` contains the rewritten English distribution loaded by the managed Claude plugin.
- Each dist skill includes `agents/openai.yaml` for OpenAI-compatible display metadata, prompts, and invocation policy.
- Pinned verbatim workflows and MIT notices live under the owning skill's `references/upstream/` directory;
  `SKILL.md` reads those references directly at runtime, and the same files serve as upgrade-diff baselines.
  `docs/matt-skills.md` records how each mattpocock skill is used: as-is, replaced by a sorry-matt flow, or with
  parameters only.
- `scripts/` holds the repository checks, run on every pull request by `.github/workflows/check.yml`:
  `check-structure.mjs` reconciles `src/` with `skills/`, and `check-vendored.mjs` verifies each vendored file's
  SHA-256 against its `NOTICE.md`.
- `hooks/` holds the guard hook, the compaction reminder, and the run budget hooks; `scripts/guard.test.mjs`,
  `scripts/deploy-on-merge.test.mjs`, `scripts/reread.test.mjs`, and `scripts/budget.test.mjs` test them in the
  same CI run.
- Skill scripts live in the owning skill's `scripts/` directory, byte-identical in `src/` and `skills/`; their tests
  (`scripts/frontier.test.mjs`, `scripts/mutate.test.mjs`,
  `scripts/acceptance.test.mjs`, `scripts/overlap.test.mjs`, `scripts/review-guide.test.mjs`) run in the same CI run.
- `.claude-plugin/` remains the Claude Code marketplace and plugin distribution manifest.

Edit skills in `src/skills/`, then rewrite the corresponding English version in `skills/`. Do not edit the
distribution as the only copy: the next rewrite from `src/` will overwrite it.
