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
| `get-to-work` | Clear a prepared ticket set round by round, implementing and reviewing in blocker order before delivering GitHub PRs or local integration branches |
| `have-it-all-done` | Take over one complete task behind a single risk gate, carrying prior grilling through take-this and get-to-work; use issue-chain only when no task context exists |
| `issue-chain` | Build a chain from tracker and local evidence, establish blocker edges, and choose exactly one immediately executable next action |
| `review-pr` | Review a GitHub PR and publish evidenced, directly applicable feedback to it. Use when a user asks to review a PR, post review findings to the PR, or re-review it after fixes. |
| `speak-human` | Rewrite stiff, bureaucratic, ambiguous, translated, or AI-sounding text into clear, natural language for the target locale without semantic drift. |
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
- `skills/` contains the rewritten English distribution loaded by the plugin.

Edit skills in `src/skills/`, then rewrite the corresponding English version in `skills/`. Do not edit the
distribution as the only copy: the next rewrite from `src/` will overwrite it.
