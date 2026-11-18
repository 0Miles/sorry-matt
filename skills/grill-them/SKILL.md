---
name: grill-them
description: Run an autonomous iterative interview between two agents to refine a plan or design
---

# grill-them: Let two agents duel while the human sees only the conclusions

Hand the griller/respondent exchange from `/grill-me` to two subagents. **agent-griller**, the griller, presses the
questions. **agent-grillee**, the respondent, inspects the project and answers. The two exchange questions and answers
through files in an **exchange directory**. You are the moderator: prepare the topic card, pass file paths, open side
quests, and assemble the conclusions. Do not answer for either side or make the human's final ruling.

Optional argument: the plan, decision, or idea to grill. With no argument, use the current subject of the conversation.

## 1. Make the topic card and the exchange directory

Turn the subject into a **self-contained topic card** containing only:

- The question to clarify
- Background required to understand it
- Known hard constraints, such as the repository path, deadline, and fixed technology choices

State the information neutrally without implying an answer. Start both agents in clean contexts that do not inherit the
current conversation, and give each only this card.

Create one **exchange directory** for this duel, outside the repository, and keep it after the close:

- When the environment provides a scratchpad directory (for example, a path the harness lists in the system prompt),
  create `grill-them-<timestamp>/` inside it.
- Otherwise create it in the system temp directory. POSIX: `mktemp -d "${TMPDIR:-/tmp}/grill-them-XXXXXX"`; Windows
  PowerShell: `New-Item -ItemType Directory -Path (Join-Path ([IO.Path]::GetTempPath()) "grill-them-$([guid]::NewGuid())")`.

Assume nothing about where any subagent's own scratchpad lives: the moderator creates the directory and hands its
**absolute path** to both sides and to every side-quest agent. Write the topic card to `topic.md` in that directory.

File names (`<r>` is the two-digit round, starting at `01`; `<n>` is the question's number in that round's question
file):

| File | Written by | Contents |
| --- | --- | --- |
| `topic.md` | moderator | The topic card |
| `round-<r>-questions.md` | agent-griller | Every question on round `<r>`'s frontier, numbered, each with a recommended answer |
| `round-<r>-answers.md` | agent-grillee | Answers numbered to match the question file; a parked question states its gap and side-quest type |
| `side-<r>-<n>/` | side-quest agent | The worked instance, its output, or the fact-check findings; the conclusion goes in `side-<r>-<n>/result.md` |
| `round-<r>-answer-<n>.md` | agent-grillee | The completed answer to a parked question |
| `verdict.md` | agent-griller | The final verdict, contents in Step 4 |

A file is never rewritten once written, and the moderator never edits a file either side wrote.

Done when: the card is understandable without the current conversation, includes every essential fact and hard
constraint, and contains no answer-leading or partisan wording; the exchange directory is outside the repository and
expressed as an absolute path, and `topic.md` is written.

## 2. Seat both sides

Spawn agent-griller first, then agent-grillee. Each receives only the exchange directory's absolute path, the file-name
rules above, and its own role instructions, and reads the topic card from `topic.md`. Neither changes the repository or
external state; each writes only its own files in the exchange directory. The moderator may write to the repository only
during the distillation in Step 4.

What either side sends back to the moderator is only the paths it wrote and its status, never the content: agent-griller
reports a question file's path, or that it has finished; agent-grillee reports an answer file's path and, when any
question is parked, those question numbers with their side-quest types.

- **agent-griller, the griller**: instruct it to call the Skill tool with `grilling`, treating "the user" in that
  workflow as agent-grillee: asking agent-grillee means writing `round-<r>-questions.md`, and the replies are in the
  answer files the moderator hands over. Leave `grilling`'s own behavior intact: it asks every question on the
  **frontier** in a single round, numbered, each carrying a recommended answer, and it dispatches its own sub-agents to
  establish facts. The moderator interferes with neither.
- **agent-grillee, the respondent**: instruct it to read the applicable `CLAUDE.md` or general `AGENTS.md`, then inspect
  relevant docs, code, and git state before answering from the whole-project perspective, writing its answers to the
  same round's `round-<r>-answers.md`. It cites every factual claim, explains the tradeoff behind every decision,
  identifies information gaps, and calls out conflicts between a question's premise and the evidence.

The duel has exactly one division of labor: **decisions and tradeoffs** are always agent-grillee's to answer. **Facts**
either side may establish for itself — agent-griller through `grilling` for the questions it is about to ask,
agent-grillee across the whole project — and where the two sides' facts conflict, agent-grillee names the conflict and
cites its source.

Done when: agent-griller has written `round-01-questions.md` from the topic card; agent-grillee has completed the
necessary inspection and can answer with evidence and tradeoffs; both received only the exchange directory, the
file-name rules, and their role instructions; and neither changed the repository or external state.

## 3. Run the duel

A round is one frontier of agent-griller's. Run every round in this exact order:

1. agent-griller writes `round-<r>-questions.md` and reports its path.
2. The moderator gives agent-grillee the question file's path and the round, plus the answer file's path,
   `round-<r>-answers.md`.
3. agent-grillee answers every question, numbering its answers to match the question file, and reports the answer file's
   path.
4. The moderator gives agent-griller the answer file's path and the round, together with any `round-<r>-answer-<n>.md`
   completed since the last hand-back.
5. agent-griller recomputes the frontier and writes the next question file; when it decides to stop, it writes
   `verdict.md` instead and reports that it has finished.

Every message the moderator sends either side holds only paths and the round: no paraphrase, summary, polish, or added
position, and no cherry-picking — question and answer files go across whole. During the duel the moderator does not read
either side's files; it sees only the paths and statuses they report.

When existing evidence cannot answer one question, agent-grillee marks that question **parked** in the answer file and
states the gap and the side-quest type. A parked question does not hold up its round: the round's answer file still goes
back through step 4, and following the reported type the moderator opens a **side quest** that does not count as a
round. The side-quest agent receives only the question and answer file paths, the question number, and its output
directory, `side-<r>-<n>/`:

- **Executable check**, such as a state model, business rule, or visible UI: spawn a subagent and have it write a
  **worked instance** — the smallest thing that actually runs and exercises only the point in dispute — and then run it.
  Write the instance and its output to `side-<r>-<n>/`, not the repository; no worktree, no branch.
  `side-<r>-<n>/result.md` records the instance path, what running it actually produced, and its verdict on the original
  question.
- **External fact**, such as API behavior or package documentation: spawn an agent to check it against primary sources
  (official docs, source code, specs, first-party APIs), tracing every claim back to the source that owns it and citing
  it. Write the findings, conclusion, and sources to `side-<r>-<n>/result.md`, not the repository.

The side-quest agent reports only the path of `side-<r>-<n>/result.md`. The moderator gives agent-grillee that path and
the completed answer's path, `round-<r>-answer-<n>.md`, and agent-grillee completes the answer; the completed answer goes
to agent-griller with the next step 4. A side quest supplies evidence; it does not decide for agent-grillee. To
agent-griller a parked question is an unsettled prerequisite: only the questions that depend on it wait, while the rest
of the frontier proceeds.

Run by a human directly, there is no round limit: end only when the frontier is empty and agent-griller finds
consensus with no new material concern.

**Composed by an automated workflow, there are caps.** Called in by `take-this` or `have-it-all-done`, the moderator
states the caps up front in both sides' role instructions: three rounds (three question files), two side quests in total
(two `side-*` directories). At the cap, the moderator gives agent-griller the last answer file's path and the path of
`verdict.md`, and agent-griller writes the final verdict; a question still unsettled goes straight back to the caller as
**awaiting ruling** instead of earning another round — an interrogation exists to kill disagreement, not to exhaust the
questions.

Done when: every question in every question file has a complete answer under the same number in that round's answer
file, or was parked and has a matching `round-<r>-answer-<n>.md`; every side quest's `side-<r>-<n>/result.md` reached
agent-grillee and is reflected in the completed answer; every message the moderator sent either side held only paths and
the round, and during the duel the moderator neither read nor edited either side's files nor cherry-picked;
agent-griller recorded the reason for stopping in `verdict.md`; and where an automated workflow composed this skill,
rounds and side quests stayed within the caps, with anything past them sent to awaiting ruling.

## 4. Close and distill

`verdict.md` is agent-griller's **final verdict**: the reason for stopping; a ruling on each question, identified by
round and number, as accepted, punctured, or uncertain; which claims held, which were punctured, and how the proposal
should change. The moderator then reads every file in the exchange directory and delivers exactly four sections:

- **Topic card**: the original question and hard constraints.
- **Duel summary**: one row per question, labeled with its round, giving the question, agent-grillee's final position,
  and agent-griller's ruling—accepted, punctured, or uncertain.
- **Verdict**: the surviving claims, exposed weaknesses, and revised decision.
- **Awaiting ruling**: matters where the agents still disagree or only a human can decide.

When the topic involves a repository, the moderator performs **distillation**: call the Skill tool with
`domain-modeling`, add agreed vocabulary to the glossary in `GLOSSARY.md`, and record hard-to-reverse decisions as ADRs
according to its conventions. If nothing merits distillation, mark it not applicable.

Done when: the report contains exactly those four sections; the duel summary reconciles every question in every question
file; every conclusion in the verdict traces back to a question file, answer file, or `verdict.md` in the exchange
directory; every unresolved matter remains under Awaiting ruling; and every agreed term and hard-to-reverse decision has
been distilled or marked not applicable.
