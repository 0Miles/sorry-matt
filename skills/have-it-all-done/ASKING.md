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
| `Sensitive paths` | The sensitive paths review grading uses, one repo-relative path per line, directories ending in `/`: places where a change affects permissions, guards, CI, releases or deploys. |

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
first, then list the risks item by item. When you do recommend reducing, name which action needing
confirmation (section 5) or project exception it hits, and attach that item's evidence.

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
- Only the user changes the run-level limits and the stage time limits (section 7, field 9). `budget: spawns` and
  `budget: rounds` scale with the ticket count:
  - `spawns` = max(`20 × tickets + 50`, spawns used + `20 × tickets`). A ticket typically takes about 12 spawns —
    expansion, implementation, one review host agent each for the initial review and the recheck, the two finders of a
    standard-tier `prove-it`, up to three verifiers and one fix round's Fix Verifier, merging — and 20 per ticket
    leaves close to double that as a last-resort margin; the
    constant 50 covers planning and finishing the run; when planning has already used more than 50, the spawns used
    plus 20 per ticket keep planning from eating into the tickets' share. Spawns used come from field 9's usage.
  - `rounds` = `3 × tickets + 1`: each ticket brings at most three dispatch points (its own integration, one
    send-back, one stuck / revert / red-to-green), plus the first one.

  Rewrite both lines before the ruling point from the number of tickets the kickoff published; a standalone
  `get-to-work` has no ruling point and rewrites them when it freezes the ticket set. Limits and time limits are not
  asked about by default; when there is a concrete reason to expect a default to fall short
  (a long data migration or a large test suite the ticket names, say), make the change one question, sorted by cost
  to reverse with the others. When one runs short mid-run, never answer on the user's behalf to raise it: a limit
  stops the run as `get-to-work` section 1, budget and breaker, says, and a time limit is extended once or stopped
  as the same section's time limits say.
- Eyes-on acceptance (`have-it-all-done` step 5) is an acceptance procedure, not a ruling, and this section does not
  limit it.

Done when: exactly one ruling point sits between the risk gate and the final review pass, with no questions after
it; every mid-run item lands in the self-answer log, awaiting ruling, or the human-work list; `budget: spawns` and
`budget: rounds` were rewritten from the ticket count before the ruling point (at the freeze when running
standalone), unless the user set a value at the ruling point.

## 5. Authority and actions needing confirmation

The agent does not judge authority, and no file the agent reads records it: whether an action that needs
authority is let through is up to Claude Code's permission settings, and the plugin's hook raises a confirmation
prompt before an action needing confirmation runs.

### Actions that need authority

Send actions like merging the aggregate PR or deploying to a non-production environment with their canonical
command — a merge is always `gh pr merge` — as a prompting call, run last. Claude Code's permission settings decide
whether it is let through; do not ask separately and do not decide from any record the agent wrote itself. Send
the aggregate PR's merge only with **standing authority** (a `permissions.allow` rule in the permission settings
that covers `gh pr merge`) or when the user said to merge during this run; otherwise leave it for a human to
merge. When an action is blocked or refused, put it on the human-work list with the permission rule that would
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
    "allow": ["Bash(gh pr merge:*)", "PowerShell(gh pr merge:*)"]
  }
}
```

Choosing "don't ask again" at a permission prompt does the same, written by Claude Code itself.

### Actions needing confirmation

The agent may run the actions below, but only after the user confirms them at a permission prompt; the plugin's
`hooks/hooks.json` raises that prompt in PreToolUse before they run:

- **Two-step confirmation**
  - Catastrophic actions: a recursive delete of a home directory, a root, a drive root, a parent directory or a path
    outside the project; formatting or overwriting a disk; dropping a database, schema or table; deleting a GitHub
    repo; tearing down whole infrastructure (`terraform`/`pulumi destroy`, deleting a cloud project or resource
    group, deleting a prod namespace, bucket or stack); force-pushing to or deleting a protected branch (main,
    master, the remote's default branch).
  - Outgoing messages and third-party communication: mail (`git send-email` included), chat, social posts,
    third-party messaging APIs.
  - Payments.
- **Single confirmation**
  - Releases and production deploys: package publishes, `gh release create`, `terraform apply`,
    `fly`/`wrangler`/`firebase` deploy, other deploy tools and SQL writes aimed at production.
  - Writes to settings that change how Claude Code behaves: settings files, hooks, MCP config, `~/.claude.json`,
    `.claude/sorry-matt.json`.
  - A merge that deploys to production right away: `gh pr merge` or a direct write to a protected branch, when a
    workflow the merge leaves there deploys or releases on every push to it.

For a two-step action, the hook first swaps the command for `confirm.mjs`, which records the confirmation, and asks
with a description of the consequences; once allowed, resend the original command unchanged and the hook asks a
second time; only that second yes runs it. A tool whose input cannot be swapped (MCP) is denied the first time,
and the denial carries the confirm command to run first. Only the exact line the hook hands out may run
`confirm.mjs`; never rewrite it, chain it, or write the confirmation records.

Subagents do not run these actions; they report them to the host. The host sends them as **prompting calls**,
back to back after every other step (`have-it-all-done` section 0); a two-step resend follows right after its
first confirmation. When the user refuses at the prompt, or the hook denies the call — in `bypassPermissions`
mode nothing guarantees a prompt, so every two-step action is denied; while the user has unattended mode on, every
action needing confirmation is denied outright, with no prompt — put it on the human-work list with the command to
run and the consequences the hook described; do not retry with another spelling, and do not stop to wait: carry on
with everything else you can do. Only the user switches unattended mode; never touch its switch file.

The hook matches command text; it is not a security boundary. It does not recognize an interpreter wrapper
(`node -e`, `python -c`), variable expansion, or commands like `find / -delete`; without managed settings, another
hook returning allow can keep the prompt from appearing; `dontAsk` mode, or settings that turn prompts into
denials, turn an ask into a deny; in `bypassPermissions` mode single-confirmation actions mostly run without a
prompt. When the hook does not catch an action above, no prompt appears, or the user has turned the hook off, do
not run it yourself either; list it on the human-work list. Force-pushing an ordinary branch, cloning, installing
packages, reading or writing credential files, permission commands, and deletes inside the project are not on this
list; the permission settings decide them.

Done when: every action this run that needed authority went out as its canonical command, with its outcome in
ledger field 5; every action needing confirmation ran only after the user confirmed it at the prompt, or is on the
human-work list with the command to run; every blocked action is on the human-work list with a permission rule
snippet or the command to run; nothing this run wrote a settings file.

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
   `get-to-work` section 1, reading CI); the base SHA `get-to-work` synced in when finishing the run (when
   unsynced, the base SHA it tried and "unsynced"); the **per-SHA local verification records** (format and rules:
   `get-to-work`'s `SKILL.md`, section 1, reading CI, "local verification"). A record line starts with `local:`, never with `rule:` or `budget:`.
5. Authorization outcomes: every action needing authority or confirmation (section 5) that was sent, and the
   permission verdict or confirmation result, with a permission rule snippet or the command to run for each
   blocked one.
6. The run-level self-answer log.
7. The human-work list.
8. **Reconciliation table:** one row per ticket — ticket ID, stage, deliverable, verification result, where that
   ticket's status record lives, the `sha256` of its acceptance snapshot (recorded by `get-to-work` at dispatch),
   its responsible agent's id, its **assignment record** (agent type, assigned time, stage time limit, deadline, whether it was
   extended, progress fingerprint; `get-to-work` section 1, time limits, recorded at every assignment), its timeout
   reassignment count per stage, its send-back count, and its merge SHAs (recorded by `get-to-work` at integration, red-light fix merges included).
   The stage is candidate, expanding, implementing, in review, fixing, queued or integrating, or one of the end
   states delivered, stuck and awaiting ruling (`get-to-work` section 1); resuming relies on it and the agent id to
   pick back up every ticket short of an end state, and on the deadlines to keep scanning time limits.
9. **Run metrics and budget**, in five parts:
   - **Limits:** one per line as `budget: <name> <integer>`, written with their defaults when the ledger is created,
     and added when taking over a ledger that lacks them: `budget: spawns 200` (spawns), `budget: rounds 40` (dispatch points,
     `get-to-work` section 1, dispatch; `rounds` means dispatch points, not review or fix rounds), `budget: hours 12`
     (elapsed time, computed as under usage), and `budget: no-progress 3` (the consecutive count for the no-progress
     breaker). `spawns` and `rounds` are rewritten per section 4 once the ticket count is known.
   - **Stage time limits:** in the same format, in minutes: `budget: timeout-implement 30` (implementing),
     `budget: timeout-fix 20` (fixing, red-light fixes included), `budget: timeout-expand 15` (expanding), and
     `budget: timeout-merge 15` (the merge agent). How they are judged is in `get-to-work` section 1, time limits.
     For changing a limit or a time limit, see section 4. The plugin's hook collects every `budget:` line in the
     whole ledger and blocks spawns on `spawns` alone, so no other field starts a line with `budget:`.
   - **Usage:** the start time (ISO 8601, recorded at the first dispatch point, so time spent waiting on the user
     before the ruling point does not count; when taking over a ledger without one, record the takeover time and
     note that earlier time is not counted), waiting time (from then on, the total from sending each question to the
     user to receiving the answer), elapsed time (now minus the start time, minus waiting time), spawns, dispatch
     points run, the consecutive no-progress count with the progress snapshot from the last dispatch point (judged
     per `get-to-work` section 1, budget and breaker), review rounds, fix rounds, full verification runs (one per
     verdict `get-to-work` reaches while finishing the run, from CI or local alike; CI triggered by close-out
     pushes does not count), send-backs for a redo, timeout extensions, timeout stops, compactions and handovers, and the task id of
     the background `sleep` still running (the fallback wake-up in `get-to-work` section 1, time limits; "none" when
     there is none). Spawns come from `spawns` in
     `<run>.counters.json`, which the hook writes next to the ledger; the host reads it and never writes it. The file
     also holds a `log`, one entry per spawn with its agent type, the Agent call's `description` and the time; the
     host only reads that too, and `get-to-work` reports the spawn breakdown from it when finishing. No
     such file means the hook is not loaded, and the host keeps the count itself. Token counts are unknown unless
     the runtime itself reports them; never estimate them from duration or agent count. For when to update usage, see
     `get-to-work` section 1, budget and breaker.
   - **Stop reason:** when the run stops on a limit or the no-progress breaker, which one, the usage at the time,
     and where the run is stuck; "none" when it has not stopped.
   - **Host session:** one line `session: <id>`, the value of the environment variable `CLAUDE_CODE_SESSION_ID` in
     the host's own shell commands (read it with `node -e "console.log(process.env.CLAUDE_CODE_SESSION_ID || '')"`,
     which runs in any shell). Write it when the ledger is created; read it again when taking over a ledger and on
     every resume (except a `/loop` wake-up: same session, the value cannot change), and rewrite the line when the
     value differs. The plugin's hook counts against this run only the spawns whose `session_id` matches this line,
     and blocks only the matching session; when the value cannot be read (an empty string), leave the line out and
     the hook falls back to counting and blocking every session in the repo. The hook reads only the first
     `session:` line, so no other field starts a line with `session:`.
10. **Rule files:** every rule file the host reads in and must follow for the whole run, one per line as
    `rule: <absolute path>`, filled in when the ledger is created and completed when an existing ledger is taken
    over (for example, `have-it-all-done` taking over a ledger that a standalone `get-to-work` created). List the
    `SKILL.md` loaded through the Skill tool too: compaction re-attaches only its first 5,000 tokens. Files read only
    at one step to fill in a hand-off (`EXPANDER.md`, `IMPLEMENTER.md`, `TEMPLATES.md`, and the like) are not
    listed: the step that uses one reads it again anyway. `get-to-work`'s `RED-LIGHT.md`, `TIMEOUTS.md`, `SEND-BACK.md` and `FINISH.md` are not listed in field 10 either: the step that reaches that branch reads the file again. The hook collects every `rule: <absolute path>` line in
    the whole ledger, so no other field starts a line with `rule:`.

When the common directory is not writable, or the current directory is not inside a git repo, there is no ledger —
the final report becomes the source of truth; say so in the report, and do not stop over it. Write the ledger
current at the end of every step and every `get-to-work` wake-up.

**Resuming:** after a compaction, a `/loop` wake-up, or any other resuming, the first action is to re-read the
ledger, then every rule file its field 10 lists, in full, and only then follow field 1 — never infer from a summary
in context. After a compaction the plugin's SessionStart hook prints the in-progress ledger and its rule file paths
into context; the rule applies whether or not that reminder appears.

**The host's context has a budget.** Diffs, test logs, agent reports, and full ticket bodies stay in the subagents
and files that hold them; the host takes fixed-format summaries (fifteen lines at most) and evidence paths, and
when it needs detail, it pulls just those lines with a command. Review is hosted by the review host agent spawned at
close-out, and the host takes only its review report of six lines at most (`get-to-work/REVIEWER.md`); the reports of
`prove-it`'s finders, verifiers and Fix Verifiers stay with the review host agent, their fields and line counts in
`prove-it`'s own rules. A task the host hands a subagent is bounded by that
subagent's brief: a check the brief does not name becomes a raw ticket for a later run.

Done when: the ledger's first line is the marker matching the run's state, all ten fields hold content or say
"none", field 9 has the four `budget:` limits, the four stage time limits, current usage and, when a session id
can be read, a `session:` line matching the current session, and field 10 has listed the rule files' absolute
paths since creation; resuming always starts by re-reading the ledger and the rule files it lists; where there is
no common directory, the report says the source of truth moved to it; the host's context holds no raw diffs, test
logs, or agent reports.
