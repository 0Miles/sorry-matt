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
| `get-to-work` | Clear a prepared ticket set round by round, implementing and reviewing in blocker order before delivering one aggregate GitHub PR or local integration branch per line |
| `have-it-all-done` | Take over one complete task, carrying prior grilling through planning and implementation to something a human can merge |
| `issue-chain` | Build a chain from tracker and local evidence, establish blocker edges, and choose exactly one immediately executable next action |
| `review-pr` | Review a GitHub PR and publish evidenced, directly applicable feedback to it. Use when a user asks to review a PR, post review findings to the PR, or re-review it after fixes. |
| `prove-it` | Ticket-level independent review for the sorry-matt workflow: an evidence chain, a live run, and mutation limited to the ticket's diff, ending in a pass / fix / stuck verdict in the ticket's status record. Called by `get-to-work`; posts no PR comments. |
| `speak-human` | Rewrite stiff, bureaucratic, ambiguous, translated, or AI-sounding text into clear, natural language for the target locale without semantic drift. |
| `no-bullshit` | Cut the crap. Get to the point. |
| `clean-it-up` | Safely remove merged local branches and obsolete worktrees after a Git task is finished; remote branches require explicit opt-in. |

The tracker-aware workflows support both GitHub Issues and Matt's Local Markdown tracker. The repository's
`docs/agents/issue-tracker.md` selects the active provider and defines its conventions.

## Installation

Install the upstream mattpocock skills first, then install this plugin:

```bash
claude plugin marketplace add mattpocock/skills
claude plugin install mattpocock-skills@mattpocock
claude plugin marketplace add 0Miles/sorry-matt
claude plugin install sorry-matt@sorry-matt
```

You can also use the `/plugin` interface in Claude Code.

## Guard hook

The plugin ships a PreToolUse hook (`hooks/hooks.json` → `hooks/guard.mjs`, needs Node.js 20+ on `PATH`). It runs
in **every session where the plugin is enabled**, not only sorry-matt runs, and denies:

- the permanent exceptions — force-pushes, outgoing messages, installing new packages (including `npx`,
  `pnpm dlx`, `uvx` downloads) or cloning, touching credentials or secrets, irrecoverable deletes, payments,
  permission changes (Claude Code's settings files included), and production changes;
- every route that lands changes on `main`, `master`, or the remote's default branch without `gh pr merge`
  (direct pushes, `gh api` merge and ref endpoints, `gh pr merge --admin`, MCP merge tools);
- `gh pr merge` itself in `bypassPermissions` and `auto` mode, where nobody would confirm it.

Restoring dependencies from a lockfile (`npm ci`, `pnpm install --frozen-lockfile`) and running a project-local bin
with `npx` are allowed. To run a blocked command, run it in your own terminal. To turn the guard off, set it in the
`env` of your Claude Code settings (the agent cannot write those files):

```json
{
  "env": { "SORRY_MATT_GUARD": "off" }
}
```

In other modes, whether `gh pr merge` goes ahead is up to your permission settings. To let sorry-matt merge
aggregate PRs without a prompt, add these rules to `.claude/settings.local.json` (one repo) or
`~/.claude/settings.json` (every project), merging them into an existing `permissions.allow` if there is one; to be
asked every time put them under `ask`, and to never allow it put them under `deny`:

```json
{
  "permissions": {
    "allow": ["Bash(gh pr merge:*)", "PowerShell(gh pr merge:*)"]
  }
}
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
- `hooks/` holds the guard hook; `scripts/guard.test.mjs` tests it in the same CI run.
- Skill scripts live in the owning skill's `scripts/` directory, byte-identical in `src/` and `skills/`; their tests
  (`scripts/frontier.test.mjs`, `scripts/mutate.test.mjs`,
  `scripts/acceptance.test.mjs`) run in the same CI run.
- `.claude-plugin/` remains the Claude Code marketplace and plugin distribution manifest.

Edit skills in `src/skills/`, then rewrite the corresponding English version in `skills/`. Do not edit the
distribution as the only copy: the next rewrite from `src/` will overwrite it.
