# ASKING: the shared contract for asking and run state

`have-it-all-done`, `get-to-work`, and `take-this` read this file in full when they open, and it applies throughout.

In one line: **if you can write a recommendation, answer on their behalf; ask everything that genuinely needs a
human in one go.**

## 0. Opening

After this file, read two more, in order:

1. `docs/agents/issue-tracker.md`: the provider and its conventions. If it is missing, ask the user to run
   `/setup-matt-pocock-skills`, and continue once it is set up.
2. `docs/agents/environment.md`, for the environment facts already on record. Skip it when missing.

## 1. Pre-ask check

Every question clears three gates first, and asks only once all three pass:

1. **Is it discoverable?** Can a command, a repo file, or git history answer this? Then go and find out.
2. **Have they used this word?** Is every proper noun in the question one the user coined or has used? If not,
   explain it first, or switch to a term they have used.
3. **Does it ask them to recall state?** Delete every option shaped like "do you remember whether…" or "did you
   already configure…". What they would remember, the agent can look up.

The reciprocal obligation: every environment artifact the agent creates — domains, hosts, proxy rules,
allowlists, credential locations, test-store identifiers, preview sites — goes into
`docs/agents/environment.md` in the same round. Unrecorded, it will be asked again next round.

Done when: every question sent clears all three gates; every environment artifact created this round is recorded.

## 2. What to ask

Only matters that fall into the four classes below **and** clear section 1 may be asked. Their defaults follow;
where the repo's own `CLAUDE.md` or generic `AGENTS.md` rules differently, the repo wins.

### (a) How far to go

Scope and stopping points are the user's ruling. **Open the proposal at full scope:** give the complete range
first, then list the risks item by item. When you do recommend reducing, name which permanent exception
(section 5) or project exception it hits, and attach that item's evidence.

### (b) Product-behavior correctness

The default is: **fix defects the customer can see, fix every instance of the same shape at once, and register
the deviation once fixed.** "Copy the upstream defect, register a deviation, change no code" saves process cost
rather than reaching an engineering conclusion, so it is not the recommended option. Find the other places that
share the failure shape and put them in the options.

### (c) Another repo, or someone else's area

Do not ask, and do not offer to fix it. File a ticket, link back to the source evidence, and keep it out of this
round's schedule.

### (d) Design rulings

Keep asking these, but do not make the most restrictive option the default. Where permissions, trigger surface,
or an external interface are involved, every proposal carries rate limiting and an audit record.

Done when: every question maps to one of the four classes; everything outside them was answered on their behalf
per section 3.

## 3. What to answer on their behalf

**Being able to write a recommendation means being able to answer.** Anything outside the four classes in
section 2 is answered on their behalf, not asked first. Record each one as a row:

| # | Decision | Rationale | Cost to reverse | Evidence location |
| --- | --- | --- | --- | --- |

Cost to reverse states which files have to change, what has to be re-run, and whether anything already delivered
is affected; where a count exists, give the count. It is the ordering key for the ruling point and the review pass,
not an adjective.

Each self-answer is written once, in one of two layers: an implementation detail that affects one ticket only and
is reversible inside that ticket's worktree goes in that ticket's status record (or, when made while expanding the
ticket before work starts, in its expansion block); only the self-answers whose cost
to reverse crosses tickets or deliveries enter the run-level **self-answer log**. Decisions the user made in person
during an earlier grilling are requirements, not self-answers.

Done when: every non-class decision after the risk gate is recorded in one of the layers, with all five columns
filled.

## 4. The ruling point and throttling

- After the risk gate, the whole run has **exactly one ruling point**, placed after planning is delivered and
  before implementation starts.
- The ruling point **asks everything at once**: one question call, several questions or multi-select, each with a
  recommendation. The tool caps it at four questions; with more than four pending, sort by cost to reverse
  descending, ask the top four, and answer the rest on their behalf.
- Between the ruling point and the final report, anything that comes up mid-run takes one of these three exits,
  and there is no fourth:
  1. Answerable → answer it, log it, keep going.
  2. Not answerable → mark it **awaiting ruling**, let that ticket go stuck, keep going on the others.
  3. Only a human can do it → put it on the **human-work list**, keep going on the others.
- The final report runs one **review pass**: a single multi-select, "which of these self-answers do you want
  flipped?", offering the four in the run-level log with the highest cost to reverse; the complete log goes in the
  report body.
- Only the user changes the run-level limits (section 7, field 9). Before the ruling point, estimate spawns from
  the number of tickets the kickoff published — about 15 per ticket: implementation, expansion, `prove-it`'s
  finders and verifiers, merging. When that exceeds the default, make the change one question, sorted by cost to
  reverse with the others; when it does not make the cut, or a standalone `get-to-work` has no ruling point, run on
  the defaults. When a limit runs short mid-run, never answer on the user's behalf to raise it; stop as
  `get-to-work` section 1, budget and breaker, says.
- Eyes-on acceptance (`have-it-all-done` step 5) is an acceptance procedure, not a ruling, and this section does not
  limit it.

Done when: exactly one ruling point sits between the risk gate and the final review pass, with no questions after
it; every mid-run item lands in the self-answer log, awaiting ruling, or the human-work list.

## 5. Authority and permanent exceptions

The agent does not judge authority, and no file the agent reads records it: whether an action that needs
authority is let through is up to Claude Code's permission settings, and the plugin's hook blocks permanent
exceptions.

### Actions that need authority

Send actions like merging the aggregate PR or deploying to a non-production environment with their canonical
command — a merge is always `gh pr merge` — as a prompting call, run last. Claude Code's permission settings decide
whether it is let through; do not ask separately and do not consult any record to decide. In `bypassPermissions`
or `auto` mode nobody confirms anything, so the hook blocks every merge. When an action is blocked or refused, put
it on the human-work list with the permission rule that would let it through; never route around it with another
command. Record every such action sent, and its outcome, in ledger field 5.

### From now on

When the user says an action should always go ahead, print a permission rule snippet and ask the user to add it to
their settings themselves. This skill writes no settings file, and the hook blocks it anyway. For this repo only,
it goes in `.claude/settings.local.json` (Claude Code keeps it out of git when it creates it); for every project,
in `~/.claude/settings.json`. When the file already has `permissions.allow`, merge the rules into that array rather
than replacing the block:

```json
{
  "permissions": {
    "allow": ["Bash(gh pr merge:*)", "PowerShell(gh pr merge:*)"]
  }
}
```

Choosing "don't ask again" at a permission prompt does the same, written by Claude Code itself.

### Permanent exceptions

Force-pushes, outgoing messages (mail, chat, social posts) and third-party communication, installing new packages
or cloning, anything touching credentials or secrets, deleting data that cannot be recovered, payments, permission
changes (Claude Code's permission settings included), and production changes to config, rules or permissions or
that delete production data. No instruction can grant them; every one goes on the human-work list.

Installing new packages includes adding a dependency to a manifest and downloading a package to run it with tools
like `npx`, `pnpm dlx`, or `uvx`. Restoring dependencies from a lockfile does not count; always use the frozen form,
such as `npm ci` or `pnpm install --frozen-lockfile`.

The plugin's `hooks/hooks.json` blocks these calls in PreToolUse, along with every route that lands changes on a
protected branch without `gh pr merge`. When the hook blocks a call, put it on the human-work list; do not retry
with another spelling. A spelling the hook fails to recognize, or a hook the user has turned off, changes nothing:
do not do it either.

Done when: every action this run that needed authority went out as its canonical command, with its outcome in
ledger field 5; every blocked action and every permanent exception is on the human-work list with a permission
rule snippet or the command to run; nothing this run wrote a settings file.

## 6. Language and outbound text

- Questions, options, and closing questions all use the language the user is writing in this conversation.
- **The polish pass is for the two kinds of text a human reads:** the aggregate PR body, and issues waiting for a
  human to triage or act on (raw issues filed along the way, raw issues recording a stuck ticket). Call the Skill
  tool with `speak-human`, then call the Skill tool with `no-bullshit`.
- Everything else written to the tracker or to Git — specs, tickets, commit messages, status records, tracker
  comments — and the run ledger are read by the next agent and skip the polish pass.
- All outbound text states the conclusion and the direction only: no asking the reader for their preferences, no
  pleasantries, no closing invitation.

Done when: every question and every piece of outbound text this run follows all four rules.

## 7. The run ledger and the context budget

The **run ledger** is this run's source of truth for state, at `sorry-matt/runs/<run>.md` under the **common
directory** (`git rev-parse --path-format=absolute --git-common-dir`). When the same task already has one, take it
over rather than rebuilding from the conversation's compaction summary; otherwise create one.

Its first line is a state marker: `<!-- sorry-matt:run active -->` when created, changed to
`<!-- sorry-matt:run ended -->` when the run's last step ends — when composed, after `have-it-all-done`'s handoff
(if step 5 does not run) or its eyes-on acceptance; after the wrap-up when `get-to-work` runs standalone. Each of
those steps spells this out. The plugin's SessionStart hook only recognizes a ledger whose first line (a BOM aside)
is exactly the active marker, with no blank line before it. Ten fields:

1. **Next action:** one line to follow on resuming.
2. The task scope and where the adopted grilling source lives.
3. The risk gate's three lights and the clearance record.
4. Lines, integration branches, and tip SHAs, with the latest CI result read and its SHA (classified per
   `get-to-work` section 1, reading CI); the base SHA `get-to-work` merged in when finishing the run (when
   unsynced, the SHA it tried and "unsynced").
5. Authorization outcomes: every action sent and Claude Code's verdict on it, with a permission rule snippet for
   each blocked one.
6. The run-level self-answer log.
7. The human-work list.
8. **Reconciliation table:** one row per ticket — ticket ID, deliverable, verification result, where that
   ticket's status record lives, and the `sha256` of its acceptance snapshot (recorded by `get-to-work` at
   open-round).
9. **Run metrics and budget**, in three parts:
   - **Limits:** one per line as `budget: <name> <integer>`, written with their defaults when the ledger is
     created, and added when taking over a ledger that lacks them: `budget: spawns 200` (spawns),
     `budget: rounds 30` (attempts; each open-round is one), `budget: hours 12` (elapsed time, counted from the
     start time), and `budget: no-progress 3` (consecutive no-progress rounds before the breaker trips). Changing a
     limit is the user's call; the host never answers on their behalf to raise one (see section 4). The plugin's
     hook collects every `budget:` line in the whole ledger, so no other field starts a line with `budget:`.
   - **Usage:** the start time (ISO 8601, recorded at creation), spawns, open-rounds run, elapsed time, the
     consecutive no-progress count with the progress snapshot from the last open-round (judged per `get-to-work`
     section 1, budget and breaker), review rounds, fix rounds, full verification runs (one per verdict
     `get-to-work` reaches while finishing the run, from CI or local alike; CI triggered by close-the-round pushes
     does not count), compactions and handovers. Spawns come from `spawns` in `<run>.counters.json`, which the hook
     writes next to the ledger; the host reads it and never writes it. No such file means the hook is not loaded,
     and the host keeps the count itself. Token counts are unknown unless the runtime itself reports them; never
     estimate them from duration or agent count. Update usage at every open-round and at the end of every closed
     round.
   - **Stop reason:** when the run stops on a limit or the no-progress breaker, which one, the usage at the time,
     and where the run is stuck; "none" when it has not stopped.
10. **Rule files:** every rule file the host reads in and must follow for the whole run, one per line as
    `rule: <absolute path>`, filled in when the ledger is created and completed when an existing ledger is taken
    over (for example, `have-it-all-done` taking over a ledger that a standalone `get-to-work` created). List the
    `SKILL.md` loaded through the Skill tool too: compaction re-attaches only its first 5,000 tokens. Files read only
    at one step to fill in a hand-off (`EXPANDER.md`, `IMPLEMENTER.md`, `TEMPLATES.md`, and the like) are not
    listed: the step that uses one reads it again anyway. The hook collects every `rule: <absolute path>` line in
    the whole ledger, so no other field starts a line with `rule:`.

When the common directory is not writable, or the current directory is not inside a git repo, there is no ledger —
the final report becomes the source of truth; say so in the report, and do not stop over it. Write the ledger
current at the end of every step and every closed round.

**Resuming:** after a compaction, a `/loop` wake-up, or any other resuming, the first action is to re-read the ledger,
then every rule file its field 10 lists, in full, and only then follow field 1 — never infer from a summary in
context. After a compaction the plugin's SessionStart hook prints the in-progress ledger and its rule file paths into
context; the rule applies whether or not that reminder appears.

**The host's context has a budget.** Diffs, test logs, agent reports, and full ticket bodies stay in the subagents
and files that hold them; the host takes fixed-format summaries (fifteen lines at most) and evidence paths, and
when it needs detail, it pulls just those lines with a command.

Done when: the ledger's first line is the marker matching the run's state, all ten fields hold content or say
"none", field 9 has the four `budget:` limits and current usage, and field 10 has listed the rule files' absolute
paths since creation; resuming always starts by re-reading
the ledger and the rule files it lists; where there is no common directory, the report says the source of truth
moved to it; the host's context holds no raw diffs, test logs, or agent reports.
