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

- **agent-griller, the griller**: give it the topic card and instruct it to resolve and read
  `~/.claude/plugins/cache/mattpocock/mattpocock-skills/*/skills/productivity/grilling/SKILL.md` in full, using the
  wildcard for the version directory. Have it follow those rules with “me” referring to agent-grillee. It asks one
  question at a time, includes a recommended answer with every question, and targets ambiguous terms, overloaded words,
  and hard-to-reverse decisions.
- **agent-grillee, the respondent**: give it the same topic card and instruct it to read the applicable `CLAUDE.md` or
  general `AGENTS.md`, then inspect relevant docs, code, and git state before answering from the whole-project
  perspective. It cites every factual claim, explains the tradeoff behind every decision, identifies information gaps,
  and calls out conflicts between a question's premise and the evidence.

The duel follows one division of labor: the agents investigate environmental **facts** directly; the respondent answers
only **decisions and tradeoffs**.

Done when: agent-griller has produced its first question from the topic card; agent-grillee has completed the necessary
inspection and can answer with evidence and tradeoffs; both received only the topic card and their role instructions;
and neither changed the workspace or external state.

## 3. Run the duel

Run every round in this exact order:

1. Relay agent-griller's question verbatim to agent-grillee.
2. Relay agent-grillee's complete answer verbatim to agent-griller.
3. Let agent-griller choose whether to follow up, move to another facet, or end the interrogation.

The moderator relays the original text without summarizing, polishing, or adding a position.

When existing evidence cannot answer a question, have agent-grillee identify the gap before the moderator opens a
**side quest** that does not count as a round:

- **Executable check**, such as a state model, business rule, or visible UI: spawn a subagent to follow the mattpocock
  `prototype` skill. Put the prototype in an isolated, disposable worktree and branch without touching the base branch.
  Retrieve its verdict and the original question it answers, then remove the worktree.
- **External fact**, such as API behavior or package documentation: spawn an agent to follow `research`. Write findings
  to a scratchpad rather than the repository. Return the conclusion and sources to agent-grillee, then let it complete
  the original answer.

A side quest supplies evidence; it does not decide for agent-grillee. Once the original answer is complete, relay it
verbatim to agent-griller in the normal order.

There is no round limit. End only when agent-griller finds consensus with no new material concern.

Done when: every round contains one complete question and one complete answer; every side quest returned through
agent-grillee and is reflected in the original answer; the moderator never spoke for either side; and agent-griller
recorded the reason for stopping.

## 4. Close and distill

First ask agent-griller for a **final verdict**: which claims held, which were punctured, and how the proposal should
change. The moderator then delivers exactly four sections:

- **Topic card**: the original question and hard constraints.
- **Duel summary**: one row per round with the question, agent-grillee's final position, and agent-griller's ruling—
  accepted, punctured, or uncertain.
- **Verdict**: the surviving claims, exposed weaknesses, and revised decision.
- **Awaiting ruling**: matters where the agents still disagree or only a human can decide.

When the topic involves a repository, the moderator performs **distillation**: resolve and read
`skills/engineering/domain-modeling/SKILL.md` under the same mattpocock cache directory, add agreed vocabulary to the
glossary in `CONTEXT.md`, and record hard-to-reverse decisions as ADRs according to its conventions. If nothing merits
distillation, mark it not applicable.

Done when: the report contains exactly those four sections; the duel summary reconciles every round; every conclusion
in the verdict traces back to the exchange; every unresolved matter remains under Awaiting ruling; and every agreed term
and hard-to-reverse decision has been distilled or marked not applicable.
