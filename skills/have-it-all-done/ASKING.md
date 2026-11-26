# ASKING: the shared contract for asking and run state

`have-it-all-done`, `get-to-work`, and `take-this` read this file in full when they open, and it applies throughout.

In one line: **if you can write a recommendation, answer on their behalf; ask everything that genuinely needs a
human in one go.**

## 0. Opening

After this file, read three more, in order:

1. `docs/agents/issue-tracker.md`: the provider and its conventions. If it is missing, ask the user to run
   `/setup-matt-pocock-skills`, and continue once it is set up.
2. `docs/agents/environment.md`, for the environment facts already on record. Skip it when missing.
3. `docs/agents/commands.md`: the **project command contract**, defined below. When it is missing, follow "When the
   file is missing" below.

The **project command contract** is the repo's own check commands, written once, so that implementation, review and
local verification all read the same file instead of each digging them out of the manifest and the CI
configuration. It is Markdown with five fixed English `##` headings in a fixed order; the headings are the keys
skills match on, so they are never translated or renamed. The prose under each heading is in the project's own
language; commands sit in fenced code or backticks and run as written from the repo root. A field with nothing to
say reads `none`.

| Heading | What goes in it |
| --- | --- |
| `Full checks` | The repo's complete automated checks: test, typecheck, lint and whatever else CI runs, one command per line. Green means every command exits 0. |
| `Targeted checks` | How to narrow the checks to a single file or a single package: the command form, and which checks go with which changed files. |
| `Coverage` | The command that produces lcov, and where the lcov file lands. |
| `Failures only` | This project's way to print only the failing lines and the closing summary. Pass or fail is still the check command's own exit code, taken before any filtering. |
| `Sensitive paths` | The sensitive paths review grading uses, one repo-relative path per line, directories ending in `/`: places where a change affects permissions, guards, CI, releases or deploys. A line can also be `path#symbol` (written as in predicted files); only a change that touches that symbol is sensitive. |

**When the file is missing.** The `get-to-work` host generates it before freezing the ticket set (`get-to-work`
section 0); no other skill generates it. The readers — the implementation agent's targeted checks, the `prove-it`
live run, and `get-to-work`'s local verification — find the commands themselves from the manifest and the CI
configuration, as they did before, when the file is not there. When the file exists but the field a reader needs
reads `none`, that field is treated like a missing file: the reader finds the commands itself and reports
`self-found`; `none` never means there is nothing to run. Every reader states in its report which one it
used: `commands.md` or `self-found`.

**Generation rules.** The content is read out of the repo and nowhere else: the manifest's scripts, the run steps
in the CI configuration, any coverage setup already present; the sensitive paths are the paths that actually exist
in the repo for CI configuration, hooks and guards, release and deploy configuration, permission settings and
database migrations. Every field cites its source file paths. A field that cannot be read reads `none`: do not ask
the user, and do not write a command you did not see in the repo. Record the generation in the run-level
self-answer log (section 3).

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
where the repo's own `CLAUDE.md` or generic `AGENTS.md` rules differently (a **project exception**), the repo wins.

### (a) How far to go

Scope and stopping points are the user's ruling. **Open the proposal at full scope:** give the complete range
first, then list the risks item by item. When you do recommend reducing, name which action that needs
authority, catastrophic action (section 5) or project exception it hits, and attach that item's evidence.

### (b) Product-behavior correctness

The default is: **fix defects the customer can see, fix every instance of the same shape at once, and register
the deviation once fixed.** "Copy the upstream defect, register a deviation, change no code" saves process cost
rather than reaching an engineering conclusion, so it is not the recommended option. Find the other places that
share the failure shape and put them in the options.

### (c) Another repo, or someone else's area

Do not ask, and do not offer to fix it. File a ticket, link back to the source evidence, and keep it out of this
run's schedule.

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
ticket before work starts, in its expansion block); only the self-answers whose cost to reverse crosses tickets or
deliveries enter the run-level **self-answer log**. Decisions the user made in person during an earlier grilling
are requirements, not self-answers, and are not listed.

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
- **The run profile**: whether this run relaxes the flow — review depth, fix rounds, the recheck, where findings that
  stay open go, expansion, how tickets are integrated, whether CI is read, the simplify pass — is settled at the ruling
  point (a standalone `get-to-work` settles it at the freeze) and written once with `get-to-work`'s
  `scripts/state.mjs profile`; it cannot change afterwards. Its fields, defaults and the guards each one relaxes are in
  that script's header. The default is the strict flow and is not asked about; write a profile only when the user asks
  for a relaxed flow or a project exception rules a field out, and log the reason in the self-answer log. A profile
  cannot relax section 5's authority rules or catastrophic actions, nor the limits of the next point.
- Only the user changes the run-level limits and the stage time limits (section 7, field 9). `budget: spawns` and
  `budget: rounds` scale with the ticket count:
  - `spawns` = max(`20 × tickets + 50`, spawns used + `20 × tickets`). A ticket typically takes about 12 spawns —
    expansion, implementation, one review host agent each for the initial review and the recheck, the two finders of a
    standard-tier `prove-it`, up to three verifiers and one fix round's Fix Verifier, merging — and 20 per ticket
    leaves close to double that as a last-resort margin; the constant 50 covers planning and finishing the run; when
    planning has already used more than 50, the spawns used plus 20 per ticket keep planning from eating into the
    tickets' share.
  - `rounds` = `3 × tickets + 1`: each ticket brings at most three dispatch points (its own integration, one
    send-back, one stuck / revert / red-to-green), plus the first one.

  Rewrite both lines before the ruling point from the number of tickets the kickoff published; a standalone
  `get-to-work` has no ruling point and rewrites them when it freezes the ticket set. Limits and time limits are not
  asked about by default; when there is a concrete reason to expect a default to fall short (a long data migration or
  a large test suite the ticket names, say), make the change one question, sorted by cost to reverse with the others.
  When one runs short mid-run, never answer on the user's behalf to raise it: at a limit dispatching stops, and at a
  time limit an agent is extended once or stopped, both decided by `get-to-work`'s scripts.
- Eyes-on acceptance (`have-it-all-done` step 5) is an acceptance procedure, not a ruling, and this section does not
  limit it.

Done when: exactly one ruling point sits between the risk gate and the final review pass, with no questions after
it; every mid-run item lands in the self-answer log, awaiting ruling, or the human-work list; a run with a relaxed flow
wrote its profile before the ruling point (at the freeze when running standalone); `budget: spawns` and
`budget: rounds` were rewritten from the ticket count before the ruling point (at the freeze when running
standalone), unless the user set a value at the ruling point.

## 5. Authority and catastrophic actions

The agent does not judge authority, and no file the agent reads records it: whether an action that needs
authority is let through is up to Claude Code's permission settings, and the plugin's hook denies the three classes
of catastrophic actions outright.

### Actions that need authority

Send actions like merging a PR (a per-ticket PR under `integrate: ticket-pr`, or the aggregate PR) or deploying to
a non-production environment with their canonical command — a merge is always `gh pr merge`, and `gh stack merge`
for a per-ticket PR stacked with `gh stack` — as a prompting call, run last. Claude Code's permission settings decide
whether it is let through; do not ask separately and do not decide from any record the agent wrote itself. Send a
merge only with **standing authority** (a `permissions.allow` rule in the permission settings that covers the
`gh pr merge` or `gh stack merge` being sent) or when the user said to merge during this run; otherwise leave it for
a human to merge. Under `ticket-pr` without standing authority, ask once at the start whether this run may merge
(`get-to-work`'s `SKILL.md` section 0, freeze step 5; when composed, at the ruling point of section 4): reading the
settings at the start decides only whether to ask, and does not replace the permission settings' decision at the
prompting call. When an action is blocked or refused, put it on the human-work list with the permission rule that would
let it through; never route around it with another command. Record every such action sent, and its outcome, in
ledger field 5.

### From now on

When the user says an action should always go ahead, print a permission rule snippet and ask the user to add it to
their settings themselves. This skill writes no settings file, and the hook raises a confirmation before any write
to one anyway. For this repo only, it goes in `.claude/settings.local.json` (Claude Code keeps it out of git when
it creates it); for every project, in `~/.claude/settings.json`. When the file already has `permissions.allow`,
merge the rules into that array rather than replacing the block:

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

Choosing "don't ask again" at a permission prompt does the same, written by Claude Code itself.

### Catastrophic actions

The plugin's `hooks/hooks.json` checks Bash and PowerShell commands in PreToolUse and denies the three classes below
outright (deny, no prompt), with the matching in `hooks/classify.mjs`:

- a recursive delete of the filesystem root, a system directory or the home directory (e.g. `rm -rf /`, `rm -rf ~`,
  `Remove-Item -Recurse C:\Windows`);
- deleting the remote main or master branch;
- force-pushing the remote main or master branch.

The hook matches only the common spelling of the command text and is not a security boundary: a form hidden behind a
variable, an interpreter wrapper (`bash -c`, `pwsh -Command`, `eval`), a subshell or a pipe is invisible to it. Never
run a catastrophic action: when one is denied, do not retry it another way, do not try to get around it and do not
stop to wait; one of the same kind the hook does not catch is not run either. A subagent puts it in its report for the
host; the host puts it on the human-work list with the command to run and the consequences, and keeps doing what can
be done.

Other risky actions — publishing a release, deploying to production, writing Claude Code settings, outgoing
messages, payments, force-pushing an ordinary branch, deletions inside the project — are not judged by the hook;
whether they are let through is up to the user's own Claude Code permission settings, and the permission prompt itself
makes such a call a **prompting call** (`have-it-all-done` section 0). One blocked by the permissions or refused by
the user at the prompt goes on the human-work list as in the previous subsection.

Done when: every action this round that needs authority was sent with its canonical command and its outcome is in
ledger field 5; no catastrophic action was run, and each one that was needed is on the human-work list with the
command to run; every blocked action is on the human-work list with a permission rule snippet
or the command to run; no settings file was written this round.

## 6. Language and outbound text

- Questions, options, and closing questions all use the language the user is writing in this conversation.
- **The polish pass is for the two kinds of text a human reads:** the aggregate PR body, and issues waiting for a
  human to triage or act on (raw issues filed along the way, raw issues recording a stuck ticket). Call the Skill
  tool with `no-bullshit`.
- Everything else written to the tracker or to Git — specs, tickets, commit messages, status records, tracker
  comments — and the run ledger are read by the next agent and skip the polish pass.
- All outbound text states the conclusion and the direction only: no asking the reader for their preferences, no
  pleasantries, no closing invitation.

Done when: every question and every piece of outbound text this run follows all four rules.

## 7. The run ledger and the context budget

The **run ledger** is the source of truth for this run's narrative state, kept in the **common directory**
(`git rev-parse --path-format=absolute --git-common-dir`) at `sorry-matt/runs/<run>.md`. When the same task already has
a ledger, take it over directly, never rebuilding it from the conversation's compaction summary; otherwise create
one. `get-to-work`'s machine state — lines, the reconciliation table, usage and the stop reason — is
`<run>.state.json` next to the ledger, written only by its scripts, with its schema in the header of `get-to-work`'s
`scripts/state.mjs`.

The first line is a state marker: `<!-- sorry-matt:run active -->` when created; when the whole run's last step ends
it becomes `<!-- sorry-matt:run ended -->` — when composed, at `have-it-all-done`'s hand-off (when step 5 does not run)
or after eyes-on acceptance; for a standalone `get-to-work`, after the finish. Nothing may come before the marker: the
plugin's hooks read only the first line (a BOM aside). Ten fields:

1. **Next action**: one line, followed after resuming.
2. The task scope and where the adopted grilling source lives.
3. The risk gate's three lights and their release record.
4. Lines and integration branches: the state file's path; lines, tips, CI results, per-SHA local verification
   records and the synced base are in the state.
5. Authorization outcomes: every action sent that needs authority (section 5) and whether it was let through; blocked ones with a permission rule snippet or the command to run.
6. The run-level self-answer log.
7. The human-work list.
8. **Reconciliation table**: the state file's path (`state.mjs show`; one row per ticket with its stage, assignment
   record, counts and merge SHAs).
9. **Run metrics and budget**:
   - **Limits**: one `budget: <name> <integer>` line each, written with the defaults when the ledger is created and
     added when taking over a ledger without them: `budget: spawns 200`, `budget: rounds 40` (dispatch points, not
     review or fix rounds), `budget: hours 12`, `budget: no-progress 3`. `spawns` and `rounds` are rewritten per
     section 4 once the ticket count is known.
   - **Stage time limits**: the same format, in minutes: `budget: timeout-implement 30`, `budget: timeout-fix 20`
     (red-light fixes included), `budget: timeout-expand 15`, `budget: timeout-merge 15`, `budget: timeout-review 60`
     (the review host agent). One more line may be left out: `budget: wake-check 20`, the most minutes the fallback
     wake-up waits (20 without it), so an agent whose turn ended without its report is looked at before its stage time
     limit.
   - **Usage and the stop reason** are the state's `usage` and `stop`. The spawn count comes from
     `<run>.counters.json`, which the hook writes; read it, never write it. When you ask the user something, add the
     seconds from sending to the answer to the waiting time with `state.mjs usage --wait`. Token counts are unknown
     unless the environment itself reports them; never estimate them from time or agent counts.
   - **Host session**: one `session: <id>` line, the value of the environment variable `CLAUDE_CODE_SESSION_ID` in the
     host's own shell commands (read with `node -e "console.log(process.env.CLAUDE_CODE_SESSION_ID || '')"`). Written
     when the ledger is created; re-read when taking over a ledger and at every resume (not at a `/loop` wake-up), and
     rewritten when it differs. When no value can be read, leave the line out.
10. **Rule files**: every rule file the host reads in for this run and must follow throughout, one
    `rule: <absolute path>` line each, filled in when the ledger is created; when taking over a ledger, add the missing
    ones. The `SKILL.md` loaded through the Skill tool is listed too: compaction re-attaches only its first 5,000
    tokens. Files read only at one step (brief templates, `get-to-work`'s `RED-LIGHT.md`, `TIMEOUTS.md`,
    `SEND-BACK.md`, `FINISH.md`) are not listed: the step that uses them reads them anyway.

The plugin's hooks read every `budget:` and `rule:` line of the whole ledger and its first `session:` line, so no other
field starts a line with those words.

When the common directory is not writable, or the current directory is not inside a git repo, there is no
ledger — the final report becomes the source of truth instead, said so in the report, and work does not stop for it.
Bring it up to date at the end of every step and at the end of every `get-to-work` wake-up.

**Resuming**: after a compaction, a `/loop` wake-up, or any resume, the first action is to re-read the ledger, then
re-read in full every rule file field 10 lists, and only then follow field 1, never inferring from a summary in
context. After a compaction, the plugin's SessionStart hook prints the active ledger and its rule-file paths into
context; this rule applies whether or not that notice appears.

**The host's context has a budget.** Diffs, test logs, agent reports and full ticket text stay with subagents and in
files; the host takes fixed-format summaries (at most fifteen lines) and evidence paths, and fetches just the lines
it needs by command when it needs detail. Reviews are hosted by the review host agent spawned at close-out; the host
takes only its review report of at most six lines (`get-to-work/REVIEWER.md`); the reports of `prove-it`'s finders,
verifiers and Fix Verifier stay with the review host agent. What the host hands a subagent is bounded by its
brief: a check the brief does not name becomes a raw ticket for the next run if it should be done.

Done when: a `get-to-work` run ran `state.mjs check <state> ledger --ledger <path>` after the freeze and again after the
ended marker (with `--ended`), and it passed; the first action of every resume was re-reading the ledger and the rule
files it lists; without a common directory, the final report says it is the source of truth; the host's context holds
no raw diffs, test logs, or agent reports.
