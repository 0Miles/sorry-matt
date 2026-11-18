# ASKING: the shared contract for asking and run state

`have-it-all-done`, `get-to-work`, and `take-this` read this file in full when they open, and it applies throughout.

In one line: **if you can write a recommendation, answer on their behalf; ask everything that genuinely needs a
human in one go.**

## 0. Opening

After this file, read three more, in order:

1. `docs/agents/issue-tracker.md`: the provider and its conventions. If it is missing, ask the user to run
   `/setup-matt-pocock-skills`, and continue once it is set up.
2. `sorry-matt/authority.md` under the **common directory** that
   `git rev-parse --path-format=absolute --git-common-dir` reports, for the **standing authority** (section 5).
   When it is missing, run on the defaults — do not stop.
3. `docs/agents/environment.md`, for the environment facts already on record. Skip it when missing.

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
is reversible inside that ticket's worktree goes in that ticket's status record; only the self-answers whose cost
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
- Eyes-on acceptance (`have-it-all-done` step 5) is an acceptance procedure, not a ruling, and this section does not
  limit it.

Done when: exactly one ruling point sits between the risk gate and the final review pass, with no questions after
it; every mid-run item lands in the self-answer log, awaiting ruling, or the human-work list.

## 5. The three layers of authority <!-- pending #8 -->

Authority is **never version-controlled** and never self-answered. It has three layers, and the default is the
shortest-lived one.

### L2 this run (the default)

Authority obtained at the ruling point applies to this run only. Every authority option is split into "this time"
and "from now on"; without "from now on", it counts for this time only.

### L1 project (written only when the user says "from now on")

Write it on the spot to `sorry-matt/authority.md` under the common directory: from any linked worktree the path
resolves to the same file, and it sits outside the working tree, so it is never committed or pushed.

Five columns per row; a row missing any one of them does not exist:

| Action | Level | Source (the user's own words) | Date | Session |
| --- | --- | --- | --- | --- |

When the common directory is not writable, or the current directory is not inside a git repo, there is no L1:
authority is asked once per run at the ruling point. Delete the whole file when the user revokes it.

### L0 global

Rules that hold across projects stay in the user's own global `CLAUDE.md`, which already loads into every
session. **Read it, never write it:** when something should be added, print the suggested lines and let the user
paste them.

### Hard rails

Nothing under `.git` shows up in a diff, so nobody reviews it. Therefore:

1. **Every row carries its source:** the user's own words, the date, and the session. A row without a source does
   not exist — ask again.
2. **Every run's final report prints this run's authority table:** each grant actually used, one row each with the
   action, level, the user's own words, and the date, plus the absolute path of that file; where no standing
   authority was used, say "none".
3. **A new row may only come from what the user said this round.** Never derive one from the other rows, never
   widen an existing row's reach, never add one because "we did it last round".
4. **Permanent exceptions, ungrantable at any layer:** force-pushes, outgoing messages (mail, chat, social posts)
   and third-party communication, installing packages or cloning, anything touching credentials or secrets,
   deleting data that cannot be recovered, payments, permission changes, and production changes to config, rules
   or permissions or that delete production data. Every one goes on the human-work list.

Done when: every action this run that needed authority points at one source in L0, L1, or L2; every row written to
L1 carries the user's own words from this round; the final report prints the authority table and the file's
absolute path.

## 6. Language and outbound text

- Questions, options, and closing questions all use the language the user is writing in this conversation.
- **The polish pass is for the two kinds of text a human reads:** the aggregate PR body, and issues waiting for a
  human to triage or act on (raw issues filed along the way, raw issues recording a stuck ticket). Call the Skill
  tool with `speak-human`, then call the Skill tool with `no-bullshit`.
- Everything else written to the tracker — specs, tickets, ticket PR bodies, status records, tracker comments — and
  the run ledger are read by the next agent and skip the polish pass.
- All outbound text states the conclusion and the direction only: no asking the reader for their preferences, no
  pleasantries, no closing invitation.

Done when: every question and every piece of outbound text this run follows all four rules.

## 7. The run ledger and the context budget

The **run ledger** is this run's source of truth for state, at `sorry-matt/runs/<run>.md` under the common
directory. When the same task already has one, take it over rather than rebuilding from the conversation's
compaction summary; otherwise create one. Nine fields:

1. **Next action:** one line to follow on resuming.
2. The task scope and where the adopted grilling source lives.
3. The risk gate's three lights and the clearance record.
4. Lines, integration branches, and tip SHAs.
5. This run's authority table.
6. The run-level self-answer log.
7. The human-work list.
8. **Reconciliation table:** one row per ticket — ticket ID, deliverable, verification result, and where that
   ticket's status record lives.
9. **Run metrics:** spawns, review rounds, fix rounds, full verification runs, compactions and handovers. Token
   counts are unknown unless the runtime itself reports them; never estimate them from duration or agent count.
   <!-- pending #16 -->

When the common directory is not writable, or the current directory is not inside a git repo, there is no ledger —
the final report becomes the source of truth; say so in the report, and do not stop over it. Write the ledger
current at the end of every step and every closed round; after a compaction, a `/loop` wake-up, or any resumption,
the first action is to re-read it rather than inferring from a summary in context.

**The host's context has a budget.** Diffs, test logs, agent reports, and full ticket bodies stay in the subagents
and files that hold them; the host takes fixed-format summaries (fifteen lines at most) and evidence paths, and
when it needs detail, it pulls just those lines with a command.

Done when: all nine ledger fields hold content or say "none", and where there is no common directory, the report
says the source of truth moved to it; the host's context holds no raw diffs, test logs, or agent reports.
