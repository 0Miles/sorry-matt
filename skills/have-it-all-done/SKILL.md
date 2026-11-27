---
name: have-it-all-done
description: Take over one complete task, carrying prior grilling through planning and implementation to something a human can merge
disable-model-invocation: true
---

# have-it-all-done: Handle the whole task and report back

Optional argument: a task description, or an explicit pointer to prior grilling output or documents.

Secure implementation authority once, then run planning and implementation autonomously, recording every decision
answered on the user's behalf.

## 0. Autonomy

Once the risk gate clears it (step 1), this run aims to reach the handoff, calling the user back only at step 2's
ruling point and step 5's eyes-on acceptance; the next question after that is the review at the handoff. Seven
rules hold throughout:

- **Make reversible internal decisions yourself.** Local files, commits on local branches, worktrees, tests, and
  merges or deploys the permission settings let through: decide, record it per `ASKING.md` section 3, and continue.
- **A gate's refusal is an instruction.** When a process or quality gate denies a call and says how to proceed,
  follow that text and retry. It counts as stuck only when no such route exists, or following it still gets
  denied.
- **Hard stops go on the list; keep working on everything else.** Put each action the permissions block or
  refuse, and each catastrophic action from `ASKING.md` section 5 (the hook denies it, and one it misses is not
  run either), on the **human-work list**, then carry on with every other thing that can be done. An action that
  raises a permission prompt is not itself a hard stop: send it as a prompting call, per the next rule.
- **Run prompting calls last, back to back.** A call that raises a confirmation prompt by itself — a permission
  prompt, the built-in delete check — is a **prompting call**, and it waits for the end even when the user approved it
  long ago ("send it when it's done"), so the interruption lands once, at the end.
- **Expand needs-triage tickets in two stages.** What freezes is the ticket set's membership, not how deep each
  ticket goes. When an in-scope ticket carries nothing beyond its needs-triage marker, fill it only far enough to
  order it before the freeze: one line of scope, the blocker edges, marked ready-for-agent the way the tracker
  does. **Full expansion** — acceptance criteria and implementation-level rulings — waits for the moment that
  ticket enters the frontier, where `get-to-work`'s expansion agent completes it at dispatch, before the
  implementation agent starts; whoever writes the criteria is not the one who has to pass them. Upstream
  implementation rewrites the facts the downstream tickets rest on; the rulings made early are the ones that get
  redone. Mark it awaiting ruling only when a fact the expansion needs cannot be found anywhere; a needs-triage
  ticket filed during the run is background, held to the handoff. **A ticket whose design is not settled goes to
  the ruling point at the first stage:** when it has to define a new set of permissions, trigger conditions or an
  external interface, and neither the ticket nor the spec settles that design, it is a design decision under
  `ASKING.md` section 2(d) — list it as one question at the ruling point with a recommendation; one that does not
  make the four questions is settled by an **on-behalf ruling** per `ASKING.md` section 4, and the ticket is
  dispatched as usual.
- **After the gate clears, whatever needs a ruling mid-run is ruled on the user's behalf.** A section 2(a), (b) or
  (d) matter that comes up after the ruling point — something an implementation or fix agent reports as awaiting
  ruling, acceptance criteria that cannot be met or contradict each other, a design not yet settled — is settled by
  the host with an on-behalf ruling per `ASKING.md` section 4 whenever a recommendation can be written, and the ticket
  keeps going: no question, no stop. Only when no recommendation can be written, the matter is (c), or what it needs
  is an action requiring authority or a catastrophic action does it take one of the three exits, awaiting ruling or
  the human-work list. A fix an in-scope ticket needs to pass its acceptance is that ticket's work: it goes back to
  the ticket's agent under the ruling, not into a new ticket for the next run.
- **The host's context has a budget**, per `ASKING.md` section 7.

Whatever a subagent receives must be self-contained: every rule it has to follow is written into what it is
handed, and every file it has to read comes as an absolute path. It cannot ask the user, so nothing handed to it
may tell it to.

Done when: between the risk gate and the handoff, only the ruling point and the eyes-on acceptance called the
user back; every hard stop is on the human-work list; every prompting call ran after the other steps,
consecutively; every in-scope needs-triage ticket has cleared its first expansion stage, or is marked awaiting
ruling with the fact that could not be found; every section 2(a), (b) or (d) matter after the ruling point has an
on-behalf ruling, or says why no recommendation could be written.

## 1. Pick up the handoff and pass the risk gate

Starting from the base directory stated when this skill was loaded, read the sibling [`ASKING.md`](ASKING.md) in
full, run its section 0 opening, and take over or create the run ledger per its section 7. Whether creating or
taking it over, field 10 must list the absolute paths of this skill's `SKILL.md`, `ASKING.md`, and the sibling
`../get-to-work/SKILL.md`; add whichever is missing. `ASKING.md` is the contract shared with `take-this` and
`get-to-work`, and it applies throughout.

Select exactly one task in this order:

1. With an argument, use its task and any grilling output or documents it explicitly supplies.
2. Without an argument, when the current session contains one completed `grill-me`, `grill-with-docs`, or
   `grill-them` result that clearly belongs to a single task, pick up that task, its decisions, and its
   documents as a handoff.
3. Otherwise, call the Skill tool with `issue-chain` and no arguments. Include the executable links, plus any
   needs-triage ticket expanded yourself per section 0, and reserve the remaining **awaiting ruling** items for
   the final report.

After selecting the task, open the risk gate exactly once. Judge each light:

- **Excessive change surface:** multiple modules, a broad refactor, data migration, deployment, or a security
  boundary.
- **Ambiguous requirements:** branches remain that would change implementation direction, completion is not
  verifiable, or the grilling result to carry forward is unclear.
- **Weak acceptance evidence:** the task is both large and vague without a dependable test net, or success
  rests primarily on subjective UI or copy judgment.

When grilling output exists, use its decisions and evidence in the assessment. On any red light, report all three
lights and open the proposal at full scope per `ASKING.md` section 2(a), listing each red light's specific reason
and evidence. The alternatives stay available but are not the recommendation: ask the user to run `/take-this` to
take part in planning, `/grill-me`, `/grill-with-docs`, or `/grill-them` to clarify first, or `/wayfinder` for a
large unresolved task. Continue after explicit approval; proceed directly when all are green.

Done when: the tracker configuration, one task, and the grilling source are recorded; the run ledger is picked up
or created; all three lights have a red-or-green result; if any light was red, the user's explicit approval is on
record and the proposal opened at full scope.

## 2. Complete the kickoff and run the ruling point

When tickets already exist, skip the kickoff agent (the next two paragraphs) and start from the freeze trial; the
ruling point runs either way.

The whole opening goes to a **kickoff agent**. Resolve the absolute paths of the sibling `../take-this/SKILL.md`
and `ASKING.md` from this skill's base directory, hand them over with the ledger path, and have it read both in
full and follow `take-this`'s complete sequence. When step 1 picked up a grilling result, first write where that
result landed (path or URL) and the decisions already settled in this session into the ledger's second field; the
kickoff agent takes the requirements context from there rather than from the host retelling it. It reports the
spec identifier, the ticket list with blocker edges, the frontier, and the run-level self-answers, within the
context budget; the spec and the ticket bodies stay on the tracker.

One run opens one kickoff agent. When it stops short or reports incompletely, start another from the ledger's
next action instead of re-running what is already published.

After the kickoff agent delivers (when tickets already exist, after step 1) and before step 3, run the single
**ruling point** from `ASKING.md` section 4. The three items below are done before it; what they need to ask joins
the ruling point's one round of questions.

**Freeze trial**: follow `get-to-work`'s `SKILL.md` section 0, freeze steps 2–4, for this run's tickets — run
`frontier.mjs`, write the predicted files, run `freeze.mjs` — and only read its output; do not run `state.mjs init`.
Tickets another line's holds keep out must show up here, not first at the freeze. Write the predicted files per
that file's section 2, "Predicted files", with **index files left out** (the build list, the test list, a README
table, a manifest array that every ticket adds one line to): an index file in the list makes every line touching it
exclude the others. When `excluded` or `stalled` is not empty, list one question at the ruling point, "<these
tickets> change the same files as <holder>: go ahead, with the conflicts resolved at integration; or wait for it to
release them", with each excluded and stalled ticket, the overlapping paths and the release conditions; it falls
under section 2(a), so recommend "go ahead". When the four-question limit cuts it, answer "go ahead" on the user's
behalf and log it in the self-answer log. Record the outcome in ledger field 2: the holders chosen "go ahead" go into
the plan file's `ignore` at `get-to-work`'s freeze; those chosen "wait" are excluded as before and marked awaiting
ruling. When `preflight.ok` is false, fix what `checks` lists and run it again; what cannot be fixed goes on the
human-work list.

**Base CI**: before the ruling point, in the repo, read the CI of the base's latest SHA with
`node <base directory>/../get-to-work/scripts/ci.mjs base [--repo <owner>/<repo>] <base branch>` (its output fields are in
that script's header). The CI comes from the git remote, not from the tracker: when the tracker is GitHub, pass
`--repo` for the repo the tickets live in; under Local Markdown leave it out and `gh` finds the GitHub repo from the
repo's remotes. A repo with no `origin` remote has no CI to read: do not run it, and list no question. When `verdict` is `red`, list one question at the ruling point, "continue, or fix the base
first", with the branch, the SHA and the run ids in `failed`; it falls under section 2(a), so recommend "continue",
stating that every line's CI will carry this red and that red-light handling judges a red the base brought in as
mapping to no ticket. On `query-failed` run it once more; if it still fails, list no question, answer "continue" on
the user's behalf and log it, with the error message, in the self-answer log. Any other verdict lists no question.
Record the question's outcome (branch, SHA, choice) in ledger field 2; `get-to-work` follows it at the freeze. On
"fix the base first", do not go on to step 3: the base's red goes on the human-work list, every ticket is awaiting
ruling, released when the base turns green, and the run goes straight to the handoff.

**Merge authority**: when this run's `integrate` is `ticket-pr` (the profile the ruling point will write; when none
is written, the default the header of `get-to-work`'s `scripts/state.mjs` gives for the tracker), before the ruling
point read the permission settings as `get-to-work`'s `SKILL.md` section 0, freeze step 5, says, and see whether
`permissions.allow` covers `gh pr merge` and `gh stack merge`. Covered is standing authority: list no question.
Reading the settings decides only whether to ask; whether a merge goes through is still decided by the permission
settings at the prompting call (`ASKING.md` section 5). When not covered, list one question at the ruling point,
"for the tickets frozen in this run, once a ticket's PR has passed review and its CI is green, may I send the
merge?", recommending "yes", with the permission rule snippet from `ASKING.md` section 5, "From now on"; it goes
through the pre-ask check and is ordered by cost to reverse together with the ruling point's other questions.
Record the outcome in ledger field 5: "yes" counts as "the user said to merge during this run"; when refused,
unanswered, or cut by the four-question limit (a cut is logged in the self-answer log), every merge is left for a
human, and PRs are still opened and stacked as usual. `get-to-work` follows field 5 at the freeze and does not ask
again.

Done when: tickets are published to the configured tracker and every blocker edge is explicit; the kickoff
agent's requirements context points to the same grilling result selected in step 1 (neither applies when tickets
already existed); the ruling point ran exactly once; the freeze trial ran, with no index file in the predicted files,
and when `excluded` or `stalled` is not empty the ruling point has the "go ahead or wait" question, or the
self-answer log has "go ahead" answered on the user's behalf, with the outcome recorded in ledger field 2; when the
base is red, the ruling point has the question "continue, or fix the base first" and its outcome is
recorded in ledger field 2; when `integrate` is `ticket-pr` and the permission settings do not cover both merge
commands, the ruling point has the merge authority question and its outcome is recorded in ledger field 5.

## 3. Clear the tickets

Starting from this skill's base directory, read the sibling `../get-to-work/SKILL.md` and follow it, giving it the
tickets created in step 2, or the executable links selected in step 1, as its explicit argument in tracker-native
identifiers (GitHub issue numbers or URLs, or Local Markdown paths), and keeping this run's ledger. Anything that
comes up meanwhile takes only the three exits in `ASKING.md` section 4; what an implementation or fix agent reports
as awaiting ruling becomes an on-behalf ruling per section 0, handed back to the same agent with tick's `ruled`
(`get-to-work` section 3).

Done when: `get-to-work` has stopped; every supplied ticket appears in its reconciliation table with a
delivered, stuck, or awaiting-ruling result and supporting evidence; no question was asked while it ran; every
ticket awaiting ruling says why no recommendation could be written.

## 4. Hand off

The final report is the ledger brought to a close, with **one source of truth per finding**: written once where
it belongs, with the other sections citing identifiers and paths — no embedded diffs, test logs, or agent reports.
It includes:

- Task scope, selected grilling source, and all three risk-light results.
- **Authorization outcomes** (ledger field 5): every action sent and whether it went through, with a permission
  rule snippet for each blocked one.
- **The run-level self-answer log**, or an explicit `none`; ticket-level self-answers are cited by location. Each
  on-behalf ruling is marked, and one that amended acceptance also names its ticket and where its ruling file is.
  Then the **review pass** from `ASKING.md` section 4.
- **The human-work list:** every item carries steps someone can follow to completion. Where the steps are many or
  run through a third-party interface, call the Skill tool with `wizard` to generate an interactive wizard and
  point the list at it.
- The delivery (GitHub: each ticket's PR and its merge state, or each line's aggregate PR under `aggregate-pr`;
  Local Markdown: each line's integration branch and tip SHA) and the **reconciliation table**, with each ticket's
  send-back count and where its send-back records are.
- Raw tickets created through filing along the way, a recommendation that the user run `/triage`, and every
  awaiting-ruling item.
- **This run's metrics and budget** (the limits in the ledger's ninth field, `usage` and `stop` in `get-to-work`'s
  state): limits and usage; when the run stopped on a limit or the no-progress breaker, which one stopped it and
  where it is stuck.

Once the report is out, if step 5 will not run, change the ledger's first line to `<!-- sorry-matt:run ended -->`.

Done when: all seven categories are present; the authorization outcomes match the actions actually sent, row by row;
every line has a traceable deliverable and acceptance evidence that lets someone outside the run decide whether
to merge a PR left for a person, an aggregate PR or a local integration branch; every human-work item has followable steps or a wizard; no
section of the report duplicates text that is of record elsewhere; when step 5 does not run, the ledger's first
line is the ended marker.

## 5. Eyes-on acceptance (conditional)

Run this only when a ticket's acceptance criterion cannot be verified mechanically, and only after step 4 — the
handoff report goes out first, so the user knows what each item is being checked against. One item per turn, with
the operating steps and a URL or window the user can open directly, waiting for the response before the next one.
It is an acceptance procedure rather than a ruling, so the one-ruling-point limit does not apply.

Feed each result back into the reconciliation table. A ticket that fails is marked stuck under `get-to-work`'s
rules; no code changes here. After the last result is fed back, change the ledger's first line to
`<!-- sorry-matt:run ended -->`.

Done when: every criterion that cannot be verified mechanically has the user's per-item response and a landing
place, or is explicitly recorded as not applicable; the ledger's first line is the ended marker.

## 6. "Continue" after the handoff

When the ledger's first line is already the ended marker and the user says "continue", or the like, about the same
task, it carries on the original approval; it is not a new task: no new risk gate, no second ruling point, no
question; the next question is still the review at the handoff. Take over the same ledger per `ASKING.md` section 7,
change its first line back to `<!-- sorry-matt:run active -->`, then:

1. Go through the tickets awaiting ruling in the reconciliation table. One whose reason allows a recommendation gets
   an on-behalf ruling per section 0; one held by another line gets step 2's freeze trial again, and "go ahead"
   answered on the user's behalf when the hold is still there; the tickets those block come back with them. One with
   no recommendation, under (c), or needing an action that requires authority stays awaiting ruling. A ticket the
   previous run filed along the way for one of these blocks has its work folded back into the ticket it blocks, per
   section 0, not dispatched on its own.
2. When tickets come back, go to step 3 again with them as the explicit argument: `get-to-work` opens a continuation
   run (the run name with `-c<n>` appended, a new state file, ledger fields 4 and 8 listing the old and new state
   paths side by side), with each on-behalf ruling written where the ticket's spawn file can reach it: its status
   record, and its acceptance on the tracker when the ruling amends it. The branches and commits the previous run left
   are in the status record, and the implementation agent picks up from there instead of redoing them. Delivered
   tickets are not dispatched again. When no ticket comes back, go straight to the handoff, with the report saying for
   each remaining ticket why a recommendation still cannot be written.
3. Then finish with steps 4 and 5; the review pass covers both runs' self-answers.

Done when: no question was asked between "continue" and the handoff; every ticket that was awaiting ruling is either
back in the continuation run or says why a recommendation still cannot be written; ledger fields 4 and 8 list every
run's state path.
