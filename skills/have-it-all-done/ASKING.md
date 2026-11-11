# ASKING: the contract for asking the user

`have-it-all-done`, `get-to-work`, and `take-this` read this file in full when they open. Where it conflicts with
the asking language already in those skills, this file wins; it changes none of their deliverables.

In one line: **if you can write a recommendation, answer on their behalf; ask everything that genuinely needs a
human in one go.**

## 1. Pre-ask check

Every question clears three gates first. Fail any one and you may not ask:

1. **Is it discoverable?** Can a command, a repo file, or git history answer this? Then go and find out — asking
   is not allowed.
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
first, then list the risks item by item. Never make "reduce scope" the recommended option; to recommend
reducing, name which permanent exception (section 5) or project exception it hits, and attach that item's
evidence.

### (b) Product-behavior correctness

The default is: **fix defects the customer can see, fix every instance of the same shape at once, and register
the deviation once fixed.** Never make "copy the upstream defect, register a deviation, change no code" the
recommended option — that saves process cost, it is not an engineering conclusion. Find the other places that
share the failure shape and put them in the options; do not handle only the one that was pointed at.

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
section 2 is answered on their behalf, not asked first. Record each one in the **self-answer log**:

| # | Decision | Rationale | Cost to reverse | Evidence location |
| --- | --- | --- | --- | --- |

Cost to reverse states which files have to change, what has to be re-run, and whether anything already delivered
is affected. It is the ordering key for the review pass, not an adjective; where a count exists, give the count.

Answering on their behalf covers **judgment**, never **authority**. Actions that need authority follow section 5
and are never self-answered.

Done when: every non-class decision after the risk gate is in the self-answer log with all five columns filled.

## 4. The ruling point and throttling

- After the risk gate, the whole run gets **exactly one ruling point**, placed after planning is delivered and
  before implementation starts.
- The ruling point **asks everything at once**: one question call, several questions or multi-select, each with a
  recommendation.
- The tool caps it at four questions. With more than four pending, sort by **cost to reverse** descending, ask the
  top four, and answer the rest on their behalf.
- Between the ruling point and the final report, **no further questions**. Anything that comes up mid-run has
  three exits and no fourth:
  1. Answerable → answer it, log it, keep going.
  2. Not answerable → mark it **awaiting ruling**, let that ticket go stuck, keep going on the others.
  3. Only a human can do it → put it on the **human-work list**, keep going on the others.
- The final report runs one **review pass**: a single multi-select, "which of these self-answers do you want
  flipped?", offering the four with the highest cost to reverse. The complete self-answer log goes in the report
  body.

**Eyes-on acceptance is the only exception.** When a ticket's acceptance criterion cannot be verified
mechanically, confirm them one at a time while closing the round: one item per turn, with the operating steps and
a URL or window the user can open directly, and wait for the response before the next one. It is an acceptance
procedure, not a ruling, so the one-ruling-point limit does not apply; where no such criterion exists, record
that it does not apply.

Done when: exactly one ruling point sits between the risk gate and the final review pass, with no questions after
it; every mid-run item lands in the self-answer log, awaiting ruling, or the human-work list.

## 5. The three layers of authority

Authority is **never version-controlled** and never self-answered. It has three layers, and the default is the
shortest-lived one.

### L2 this run (the default)

Authority obtained at the ruling point applies to this run only. Every authority option is split into "this time"
and "from now on"; without "from now on", it counts for this time only.

### L1 project (written only when the user says "from now on")

It lands in git's **common directory**, not the working tree:

```bash
git rev-parse --path-format=absolute --git-common-dir
```

Write the grant to `sorry-matt/authority.md` under that directory. From any linked worktree this path resolves to
the same file, and it is outside the working tree — invisible to `git status`, absent from diffs, never pushed,
and not carried by `git clone`.

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
2. **Every run's final report prints the authority actually used**, with the absolute path of that file.
3. **A new row may only come from what the user said this round.** Never derive one from the other rows, never
   widen an existing row's reach, never add one because "we did it last round".
4. **Permanent exceptions, ungrantable at any layer:** outgoing messages (mail, chat, social posts) and
   third-party communication, installing packages or cloning, anything touching credentials or secrets, deleting
   data that cannot be recovered, payments, permission changes, and production changes to config, rules or
   permissions or that delete production data. Every one goes on the human-work list; none stops the run to ask.

Done when: every action this run that needed authority points at one source in L0, L1, or L2; every row written to
L1 carries the user's own words from this round; the final report prints the authority table and the file's
absolute path.

## 6. Language and outbound register

- Questions, options, and closing questions all use the language the user is writing in this conversation.
- Outbound text — tracker comments, issue bodies, PR bodies, a query sent to a third party — goes through the
  Skill tool with `speak-human`, then through the Skill tool with `no-bullshit`. State the conclusion and the
  direction only: no asking the reader for their preferences, no pleasantries, no closing invitation.

Done when: every question and every piece of outbound text this run follows both rules.
