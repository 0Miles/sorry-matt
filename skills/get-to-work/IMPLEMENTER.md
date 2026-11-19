# IMPLEMENTER: the implementation agent's spawn file

`scripts/brief.mjs` fills in the `{…}` placeholders and writes the values below the rule to a spawn file; the host
spawns the implementation agent as `sorry-matt:implementer`, with a prompt that only tells it to read that file. The
implementation agent's fixed rules are in the body of the plugin's agent definition file: `../../agents/implementer.md`,
two levels up from this skill's base directory (source `src/agents/implementer.md`). The definition body and this
file's values together cover every rule; this file holds values only, never rules. When that agent type is not
available, the spawn file `brief.mjs` also writes for a general-purpose agent is the definition's body below its
frontmatter followed by this file's values.

Change this file's placeholders together with what `brief.mjs` fills in. Where the definition's rules overlap
`ASKING.md` sections 3 and 5, the report limit in `ASKING.md` section 7, or `have-it-all-done` section 0, change them
together. Change the definition's section 2 commit message format together with the aggregate PR body in
[`FINISH.md`](FINISH.md), finishing the run. Change the definition's section 1 read-only acceptance criteria together
with the acceptance snapshot in `SKILL.md`'s dispatch, the expansion block format in the expansion agent's
definition, and the acceptance diff in `prove-it` section 1. Change this file's send-back record placeholder and the
definition's section 1 redo rule together with the send-back for a redo in [`SEND-BACK.md`](SEND-BACK.md). The
definition's sections 1 and 2 are adapted from `mattpocock/skills` `implement` and `tdd` (MIT; source and license in
[`../take-this/references/upstream/NOTICE.md`](../take-this/references/upstream/NOTICE.md)).

---

Spawn file: this ticket's values. The rules you follow are in the body of the implementation agent's definition.

- Ticket: {provider-native identifier} (tracker: {GitHub or Local Markdown})
- Ticket worktree: {absolute path} (branch {ticket branch})
- Integration branch: {integration branch}
- Ticket text: {full ticket text}
- Expansion block: {the full `expansions[].text` from the acceptance snapshot, or none}
- Project command contract: {the absolute path of `docs/agents/commands.md` in the ticket worktree, or none}
- Send-back record: {the previous attempt's ref and SHA, the conflicting files, the integration branch's SHA at the
  time, and the files the old attempt touched that the predicted files did not cover, or none}
