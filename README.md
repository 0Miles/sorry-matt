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
| `have-it-all-done` | Take over one complete task, carrying prior grilling through planning and implementation to something a human can merge |
| `issue-chain` | Build a chain from tracker and local evidence, establish blocker edges, and choose exactly one immediately executable next action |
| `review-pr` | Review a GitHub PR and publish evidenced, directly applicable feedback to it. Use when a user asks to review a PR, post review findings to the PR, or re-review it after fixes. |
| `speak-human` | Rewrite stiff, bureaucratic, ambiguous, translated, or AI-sounding text into clear, natural language for the target locale without semantic drift. |
| `no-bullshit` | Cut the crap. Get to the point. |
| `clean-it-up` | Safely remove merged local branches and obsolete worktrees after a Git task is finished; remote branches require explicit opt-in. |
| `figure-out-the-ui` | Before writing a new interface, settle who it is for and what it solves. Produces a UI brief, no code. |
| `build-the-ui-right` | While writing user-visible frontend code, consult design and platform guidance, cover every state, and reuse the project's own tokens and components. |
| `actually-look-at-the-ui` | After a frontend change, open it in a real browser, record evidence for each claim, and mark what was not seen as unverified. |
| `make-the-ui-fast` | When the UI is slow, measure first, name the bottleneck, change one thing, and measure again. |
| `make-this-shit-pretty` | Rework an existing piece of UI in small verified steps, with behavior unchanged. |

The tracker-aware workflows support both GitHub Issues and Matt's Local Markdown tracker. The repository's
`docs/agents/issue-tracker.md` selects the active provider and defines its conventions.

## Frontend skills

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
- `.claude-plugin/` remains the Claude Code marketplace and plugin distribution manifest.

Edit skills in `src/skills/`, then rewrite the corresponding English version in `skills/`. Do not edit the
distribution as the only copy: the next rewrite from `src/` will overwrite it.
