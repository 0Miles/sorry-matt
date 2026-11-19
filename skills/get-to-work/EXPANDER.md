# EXPANDER: the expansion agent's spawn file

At a dispatch point `scripts/brief.mjs` fills in the `{…}` placeholders and writes the values below the rule to a
spawn file; the host spawns the expansion agent as `sorry-matt:expander`, with a prompt that only tells it to read
that file. The expansion agent's fixed rules, model and tools are in the plugin's agent definition file:
`../../agents/expander.md`, two levels up from this skill's base directory (source `src/agents/expander.md`). The
definition body and this file's values together cover every rule; this file holds values only, never rules. When that
agent type is not available, the spawn file `brief.mjs` also writes for a general-purpose agent is the definition's
body below its frontmatter followed by this file's values.

Change this file's placeholders together with what `brief.mjs` fills in. When the tools the definition's rules need
change, its `tools:` changes with them. Where the definition's rules for answering on the user's behalf overlap the
implementation agent definition's section 3 or `ASKING.md` section 3, change them together; change the expansion
block format together with the header of `scripts/acceptance.mjs`, the implementation agent definition's section 1,
and `prove-it` section 1; change how criteria are written together with the ticket templates in
[`../take-this/TEMPLATES.md`](../take-this/TEMPLATES.md).

---

Spawn file: this expansion's values. The rules you follow are in the body of the expansion agent's definition.

- Run: {run name}; dispatch point: {its number, written into the block's `round`}
- Tracker: {GitHub (owner/repo) or Local Markdown}
- Integration worktrees: {each line's integration branch and absolute path}
- Spec: {identifier or path, or none}
- Tickets to expand: {each ticket's identifier, line, and full text}
