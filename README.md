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
| `get-to-work` | Clear a prepared ticket set as a per-ticket pipeline: ready tickets whose files do not overlap are implemented at once, each one reviewed and integrated as soon as it is done: on GitHub every ticket is its own PR (stacked with `gh stack` on its one unmerged upstream), merged once reviewed and green on CI; under Local Markdown each line delivers one local integration branch |
| `have-it-all-done` | Take over one complete task, carrying prior grilling through planning and implementation to something a human can merge |
| `issue-chain` | Build a chain from tracker and local evidence, establish blocker edges, and choose exactly one immediately executable next action |
| `review-pr` | Review a GitHub PR and publish evidenced, directly applicable feedback to it. Use when a user asks to review a PR, post review findings to the PR, or re-review it after fixes. |
| `prove-it` | Ticket-level independent review for the sorry-matt workflow: an evidence chain, a live run, and mutation limited to the ticket's diff, ending in a pass / fix / stuck verdict in the ticket's status record. Called by the review host agent `get-to-work` spawns at close-out; posts no PR comments. |
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
`Bash` and `PowerShell`. It runs in **every session where the plugin is enabled**, not only sorry-matt runs. It does
not decide what an agent may do — your permission settings do. It never asks: it **denies outright** three classes of
catastrophic command, read from plain, common command text, and says nothing about everything else:

| Denied | Examples |
| --- | --- |
| a recursive delete of the filesystem root, a system directory or the home directory | `rm -rf /`, `rm -rf /*`, `rm -rf ~`, `rm -rf $HOME`, `sudo rm -rf /etc`, `Remove-Item -Recurse -Force C:\Windows`, `Remove-Item -Recurse C:\`, `rd /s /q C:\` |
| deleting the remote `main` or `master` branch | `git push origin --delete main`, `git push origin :main`, `git push -d origin master` |
| force-pushing the remote `main` or `master` branch | `git push --force origin main`, `git push -f origin master`, `git push --force-with-lease origin main`, `git push origin +main` |

Everything else is left to your permission settings: deletes inside the project or under a system directory
(`rm -rf node_modules`, `rm -rf /tmp/build`), force-pushing a feature branch, a plain push to `main`, `npm publish`,
`gh pr merge`, `gh stack merge`, deploys, writes to Claude Code settings, outgoing messages and payments.

**What it is not.** The guard matches command text; it is not a security boundary and does not try to be one. It
does not handle a command hidden behind a variable (`T=/; rm -rf $T`), an interpreter wrapper (`bash -c`,
`pwsh -Command`, `node -e`, `eval`), a subshell (`$( )`, backticks), a pipe (`echo / | xargs rm -rf`), a script that
does the work for it, `find / -delete`, or a force-push with no refspec while `main` is checked out. It guards
against a slip on the obvious line, not against an agent set on getting around it.

To turn the guard off, set it in the `env` of your Claude Code settings:

```json
{
  "env": { "SORRY_MATT_GUARD": "off" }
}
```

`get-to-work`'s `integrate` decides how a run delivers: `ticket-pr` (the default on GitHub) opens one PR per ticket,
stacks a ticket with one unmerged upstream on it with `gh stack` (install it with `gh extension install
github/gh-stack`; without it such a ticket waits for its upstream to merge), and merges each once it is reviewed and
green on CI; `aggregate-pr` (the default under Local Markdown) delivers one aggregate PR or integration branch per
line; `direct` merges straight into the base branch.

Whether `gh pr merge` and `gh stack merge` go ahead is up to your permission settings. sorry-matt sends a merge —
a per-ticket PR under `integrate: ticket-pr` (`gh stack merge` for one in a stack), or the aggregate
PR — only when a rule allows it or you told it to merge in that run. Under `ticket-pr`, when your rules do not
cover both commands, it asks you once at the start of the run whether the frozen tickets may be merged; say no, or
do not answer, and the PRs are still opened and stacked, but every merge is left to you. Reading the settings only
decides whether to ask: the merge itself still goes through your permission settings. To let it merge without a
prompt, add these rules to `.claude/settings.local.json` (one repo) or `~/.claude/settings.json` (every project),
merging them into an existing `permissions.allow` if there is one; to be asked every time put them under `ask`,
and to never allow it put them under `deny`:

```json
{
  "permissions": {
    "allow": [
      "Bash(gh pr merge:*)",
      "PowerShell(gh pr merge:*)",
      "Bash(gh stack merge:*)",
      "PowerShell(gh stack merge:*)"
    ]
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
  spawn; it only counts. Each counted spawn is also logged there with its agent type, the `description` of the Agent
  call that caused it (paired by agent type, oldest first, since the two events share no id) and the time;
  `get-to-work`'s `scripts/spawns.mjs` sums that log by kind of agent and by ticket when a run finishes.
- **PreToolUse** on `Agent` denies the spawn once the count reaches the ledger's `budget: spawns <N>` line (field 9:
  200 when the ledger is created, rewritten to `20 × tickets + 50` once the ticket count is known, or to the spawns
  already used plus `20 × tickets` when that is higher). It is a last
  resort; a single stuck agent is caught by `get-to-work`'s stage time limits first. The limit is re-read on every
  call, so editing that line takes effect immediately.

With no run in progress, or no `budget: spawns` line, neither hook counts against anything or blocks anything. While
a run is in progress, know how far it reaches:

- **Only the run's host session counts.** The host writes its Claude Code session id (`CLAUDE_CODE_SESSION_ID`) into
  field 9 as `session: <id>` when it creates the ledger and again whenever it takes it over or resumes. Both hooks
  then count and block only events whose `session_id` matches — the host's own spawns and those of its subagents.
  Another session working in the same repository (any worktree) is neither counted against the run nor blocked by
  it, and with several runs in progress each one counts and blocks only its own host. This was checked live with
  `scripts/host-session.live.mjs` (Claude Code 2.1.328): the hook events carry the host's id, also for a subagent's
  own Agent call, and `--resume` and compaction keep it.
- **A ledger without a `session:` line counts every session.** Ledgers from older versions, or written by a host
  that could not read its id, fall back to the repo-wide rule: every session in the repo adds to the run's count,
  and the run at its limit denies spawns everywhere in that repo. So does a hook event without a `session_id`.
- **A run that ended abnormally.** If a run stops without reaching its handoff (a crash, a closed terminal), its
  ledger still starts with `<!-- sorry-matt:run active -->`: the compaction reminder keeps pointing at it, a resumed
  host session is still held to its limit, and a ledger without a `session:` line keeps blocking every session. End
  it with `node hooks/end-run.mjs <ledger>` (from the plugin's directory; the deny message gives the full command),
  run from inside the repository. It changes only the first line to `<!-- sorry-matt:run ended -->`, and changes
  nothing — saying why — when the file is not a ledger directly in the repo's `<git common dir>/sorry-matt/runs/` or
  its first line is not the active marker.
- **Parallel spawns can overshoot.** Agent calls sent in one message are each checked before any of them starts, so
  a batch can take the count past the limit; the next spawn after it is denied.
- **Failures.** A counters file that is not JSON, or not in the counters format, denies spawns until it is fixed (the
  deny says so). A read still blocked by a file lock (antivirus, indexer) after the retries lets the spawn through
  with a warning; the count itself is still kept.

The other limits (`rounds`, which counts dispatch points — 40 when the ledger is created, rewritten to
`3 × tickets + 1` alongside `spawns` — `hours`, `no-progress`) and the no-progress breaker are enforced by
`get-to-work` itself at every dispatch point. The stage time limits (`budget: timeout-implement 30`,
`timeout-fix 20`, `timeout-expand 15`, `timeout-merge 15`, `timeout-review 60`, in minutes) are checked by
`get-to-work` at every wake-up: an overdue agent whose worktree moved is extended once, otherwise it is stopped with `TaskStop` and the
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
- `hooks/` holds the guard hook, the compaction reminder, the run budget hooks, and `end-run.mjs`, the command
  that ends an abnormally stopped run; `scripts/guard.test.mjs`,
  `scripts/reread.test.mjs`, `scripts/budget.test.mjs`, and `scripts/end-run.test.mjs` test them in the same CI run.
- Skill scripts live in the owning skill's `scripts/` directory, byte-identical in `src/` and `skills/`; their tests
  (`scripts/frontier.test.mjs`, `scripts/mutate.test.mjs`,
  `scripts/acceptance.test.mjs`, `scripts/overlap.test.mjs`, `scripts/review-guide.test.mjs`, `scripts/ci.test.mjs`,
  `scripts/deadline.test.mjs`) run in the same CI run.
- `.claude-plugin/` remains the Claude Code marketplace and plugin distribution manifest.

Edit skills in `src/skills/`, then rewrite the corresponding English version in `skills/`. Do not edit the
distribution as the only copy: the next rewrite from `src/` will overwrite it.
