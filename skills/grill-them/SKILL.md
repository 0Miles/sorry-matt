---
name: grill-them
description: Run an autonomous iterative interview between two agents to refine a plan or design
---

# grill-them: Let two agents duel while the human sees only the conclusions

Hand the griller/respondent exchange from `/grill-me` to two subagents. **agent-griller**, the griller, presses the
questions. **agent-grillee**, the respondent, inspects the project and answers. You are the moderator: prepare the topic
card, relay messages verbatim, open side quests, and assemble the conclusions. Do not answer for either side or make the
human's final ruling.

Optional argument: the plan, decision, or idea to grill. With no argument, use the current subject of the conversation.

## 1. Make the topic card

Turn the subject into a **self-contained topic card** containing only:

- The question to clarify
- Background required to understand it
- Known hard constraints, such as the repository path, deadline, and fixed technology choices

State the information neutrally without implying an answer. Start both agents in clean contexts that do not inherit the
current conversation, and give each only this card.

Done when: the card is understandable without the current conversation, includes every essential fact and hard
constraint, and contains no answer-leading or partisan wording.

## 2. Seat both sides

Spawn agent-griller first, then agent-grillee. Both remain read-only throughout; the moderator may write to the repository
only during the distillation in Step 4.

- **agent-griller, the griller**: give it the topic card and instruct it to call the Skill tool with `grilling`, treating
  "the user" in that workflow as agent-grillee. Leave `grilling`'s own behavior intact: it asks every question on the
  **frontier** in a single round, numbered, each carrying a recommended answer, and it dispatches its own sub-agents to
  establish facts. The moderator interferes with neither; it only asks that ambiguous terms, overloaded words, and
  hard-to-reverse decisions be the primary targets.
- **agent-grillee, the respondent**: give it the same topic card and instruct it to read the applicable `CLAUDE.md` or
  general `AGENTS.md`, then inspect relevant docs, code, and git state before answering from the whole-project
  perspective. It cites every factual claim, explains the tradeoff behind every decision, identifies information gaps,
  and calls out conflicts between a question's premise and the evidence.

The duel has exactly one division of labor: **decisions and tradeoffs** are always agent-grillee's to answer. **Facts**
either side may establish for itself — agent-griller through `grilling` for the questions it is about to ask,
agent-grillee across the whole project — and where the two sides' facts conflict, agent-grillee names the conflict and
cites its source.

Done when: agent-griller has produced its first round of questions from the topic card; agent-grillee has completed the
necessary inspection and can answer with evidence and tradeoffs; both received only the topic card and their role
instructions; and neither changed the workspace or external state.

## 3. Run the duel

A round is one frontier of agent-griller's. Run every round in this exact order:

1. Relay **every question in the round** verbatim to agent-grillee, preserving the original numbering and recommended
   answers.
2. agent-grillee answers each one, numbering its answers to match.
3. Relay the complete set of answers verbatim to agent-griller.
4. Let agent-griller recompute the frontier and open the next round or end the interrogation.

The moderator relays the original text without summarizing, polishing, adding a position, or cherry-picking questions.

When existing evidence cannot answer one question, agent-grillee marks that question **parked** and states the gap. A
parked question does not hold up its round: the rest of the round's answers go back through step 3, and the moderator
opens a **side quest** that does not count as a round:

- **Executable check**, such as a state model, business rule, or visible UI: spawn a subagent and have it write a
  **worked instance** — the smallest thing that actually runs and exercises only the point in dispute — and then run it.
  Write the instance and its output to a scratchpad rather than the repository; no worktree, no branch. Retrieve the
  instance path, what running it actually produced, and its verdict on the original question.
- **External fact**, such as API behavior or package documentation: spawn an agent and have it call the Skill tool with
  `research` and follow it. Write findings to a scratchpad rather than the repository. Return the conclusion and sources
  to agent-grillee, then let it complete that answer.

A side quest supplies evidence; it does not decide for agent-grillee. The completed answer returns on the next relay
under its original question number. To agent-griller a parked question is an unsettled prerequisite: only the questions
that depend on it wait, while the rest of the frontier proceeds.

There is no round limit. End only when the frontier is empty and agent-griller finds consensus with no new material
concern.

Done when: every question in every round has a numbered answer to match, or was parked and completed in a later round;
every side quest returned through agent-grillee and is reflected in that answer; the moderator never spoke for either
side, cherry-picked, or rewrote; and agent-griller recorded the reason for stopping.

## 4. Close and distill

First ask agent-griller for a **final verdict**: which claims held, which were punctured, and how the proposal should
change. The moderator then delivers exactly four sections:

- **Topic card**: the original question and hard constraints.
- **Duel summary**: one row per question, labeled with its round, giving the question, agent-grillee's final position,
  and agent-griller's ruling—accepted, punctured, or uncertain.
- **Verdict**: the surviving claims, exposed weaknesses, and revised decision.
- **Awaiting ruling**: matters where the agents still disagree or only a human can decide.

When the topic involves a repository, the moderator performs **distillation**: call the Skill tool with
`domain-modeling`, add agreed vocabulary to the glossary in `CONTEXT.md`, and record hard-to-reverse decisions as ADRs
according to its conventions. If nothing merits distillation, mark it not applicable.

Done when: the report contains exactly those four sections; the duel summary reconciles every question; every conclusion
in the verdict traces back to the exchange; every unresolved matter remains under Awaiting ruling; and every agreed term
and hard-to-reverse decision has been distilled or marked not applicable.
