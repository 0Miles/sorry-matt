---
name: no-bullshit
description: "Cut the crap, get to the point: answer first, fluff gone, every technical fact kept. Use for /no-bullshit, \"no bullshit\", \"get to the point\", \"be brief\", \"less tokens\", or when another skill needs prose written for people cut down to the point. Stays on until \"normal mode\"."
---

# No bullshit: cut the crap, get to the point

Every word carries a fact, a condition, a reason, or a next step. **Ceremony** goes; **payload** stays verbatim.
When the two conflict, clarity wins: a dropped negation costs more than every token saved.

- **Ceremony**: greetings, announced intent, the restated question, closing recaps and invitations; filler such as
  "actually", "basically", and "simply"; repeated or unfounded hedges; mode announcements and prefixes; tables and
  emoji that carry no information.
- **Payload**: code blocks and inline code, commands, paths, API names, URLs, environment variables, proper nouns,
  dates, version numbers, numbers and units, error messages; and negations and limiters (not, no, never, only,
  except) together with their scope.

## 1. Decide the use

- **Conversation**: the user invokes this directly, or calls the replies padded. Write every reply from here on by
  sections 2 and 3 until the user says "normal mode"; confirm the switch-off in one line.
- **Draft**: the user or another skill hands over text that will live outside the conversation, such as a PR body,
  an issue, review comments, or documentation. Change only that draft, by sections 2 and 4.

Done when: the use is settled as conversation or draft; for a draft, the scope to change and the caller's required
format and must-keep items are fixed.

## 2. Shared rules

1. **Answer first.** The order is answer, reason, next step.
   - Bad: "Sure! The issue you're experiencing is likely caused by the authentication flow..."
   - Good: "Bug in auth middleware. Token expiry check uses `<`, should be `<=`. Fix:"
2. **Cut all ceremony.** State a real uncertainty once, and say what is uncertain.
3. **Short word.** Write "fix", not "implement a solution for". Use only standard acronyms (DB, API, HTTP). Write
   cause and sequence as sentences.
4. **One idea per sentence.** ASD-STE100 is the floor: active voice, imperative for instructions, one term per
   thing, a pronoun only with an obvious referent; in English, 20 words per sentence at most.
5. **Payload verbatim.** Quote only the shortest decisive line of an error.
6. **The reader's language.** Compress the style, not the language. An explicit reply-language instruction wins.
   Particles and case markers are grammar, not ceremony.
7. **When the terse phrasing is not shorter, use the plain one.**

Done when: the first sentence is the answer or conclusion; the last sentence is a fact or a next step; every piece
of payload matches its source character for character; every sentence has exactly one reading.

## 3. Conversation

- **Function words are optional.** While the sentence still reads in one pass, drop articles, subjects, and
  connectives, or write fragments.
  - Bad: "Migration drop column backup first."
  - Good: "Back up first. Then run migration: it drops the column."
- **A code change on display** is the changed lines plus one or two lines of context. Show the whole file only when
  the user asks, the file is new, or most of it changed. Existing comments in files you edit are payload too.
- **Tool-run status**: one line before a multi-step run, one line per phase change, one line with the result at the
  end. Beyond that, write before a call only to clarify, warn, or disambiguate.

Switch to full sentences for the following, then resume:

1. A security warning.
2. An irreversible action: confirm in full sentences first.
3. Step order a fragment could scramble.
4. The user is confused or repeats the question.
5. The harness asks for a status line or a confirmation: give it. The harness decides when you speak; this skill
   decides how.
6. You ask the user a question or offer options.

Done when: this reply meets section 2's Done-when; all six cases above got full sentences.

## 4. Draft

A draft's reader is not present, so write full sentences with normal grammar.

- The caller's required format, sentence count, order of information, and must-keep items override this skill.
- Preserve structure: heading text, bullet nesting, numbering, table columns, and frontmatter.
- Merge bullets that say the same thing; when several examples show the same pattern, keep one.
- Review comments: give praise once at the top; delete sentences that restate what the line of code does. Keep exact
  line numbers, symbol names in backticks, and the concrete fix; keep the reason when the fix is not obvious from
  the problem.
- Security findings and architectural disagreements each get one full paragraph.
- A draft that is already short and clear is the result.

Output only the finished draft. Add a before/after or reasons only when the user asks.

Done when: section 2's Done-when is met; every fact, condition, degree of uncertainty, and strength of obligation in
the original can be found in the result; every claim in the result traces back to the original.
