---
name: speak-human
description: "Speak human: Rewrite or explain stiff, bureaucratic, ambiguous, translated, or AI-sounding content in clear, natural language for the target locale without semantic drift. Use to naturalize supplied text or explain existing content plainly in any language."
---

# Speak human: reconcile first, then sound native

Every rewrite follows three steps: build a **semantic ledger**, perform a **native rewrite**, then **reconcile** the
result. Languages share this process, not one language's limits on words, tense, voice, or punctuation.

## 1. Build the semantic ledger

Establish these facts from the request, source, and conversation:

- Target language and locale. Preserve the source variant when none is specified or reliably inferable.
- Audience, purpose, tone, and whether the user wants supplied text rewritten or existing content explained plainly.
- Required strength: procedures, errors, safety text, tool descriptions, and agent instructions favor precision;
  ordinary answers and documentation favor natural flow; signed prose and dialogue favor the author's voice.

Build an internal **semantic ledger** with one entry for each:

- actor, action, object, fact, number, unit, and proper name;
- condition, exception, negation, fallback, causal relation, and its scope;
- time, sequence, completion or duration, and present relevance;
- uncertainty, evidence, and obligation strength, such as may, usually, reportedly, can, should, and must;
- point the source knows, does not know, or only assumes.

Resolve special text at the same time. Keep verbatim quotations unchanged. Summarize statutory, contractual, or
normative source text separately and label the summary as such. Preserve voice, rhythm, and meaningful rhetoric in
creative or persuasive writing; edit only the problem the user placed in scope.

When the source supports multiple reasonable readings, record the full range in the ledger. Rewrite only when the
new wording preserves that range. Otherwise, retain the source wording and add the ambiguity to the output.

Done when: the target language, locale, audience, purpose, and output branch are fixed; every source claim and its
scope, certainty, and responsibility appear exactly once in the ledger.

## 2. Perform the native rewrite

Discard the source syntax and compose from the semantic ledger in the target language:

- Use current, common, neutral vocabulary, collocations, word order, pronouns, omissions, tense or aspect,
  modality, honorifics, and punctuation for the locale. Prefer the user's wording when it is already natural and
  correct.
- Give each entity, state, or action one stable name. Use pronouns and omissions where the referent stays unique
  and the target language naturally permits them.
- When the source names no speaker, actor, responsible party, or beneficiary, use a natural actorless, impersonal,
  or event construction. Make a role explicit only when the source entails it and doing so removes a material
  ambiguity.
- When roles can be confused, state who does what to which object, when, and under what condition. Choose the
  target language's natural voice instead of automatically adding subjects or using active voice.
- Put one main assertion or action in each discourse unit. Keep inseparable simultaneous actions and immediate
  results together; split or list the rest.
- Put prerequisites before the action that depends on them. Give every exception, negation, and fallback one clear
  scope.
- Prefer a natural verb or predicate when it expresses the action directly. Replace empty nominalizations and
  support verbs, such as `perform an analysis`, with `analyze` or the target language's natural equivalent.
- Use literal, compositional wording in precision text. Ordinary conversation may keep familiar idioms with one
  clear reading for the audience.
- Keep necessary technical terms, define them naturally on first use, and follow the domain glossary afterward.
  Keep one term per concept rather than rotating synonyms for style.
- Remove preambles, redundant synonyms, stacked hedges, and unsupported promotion when they have no ledger entry.
  Keep words that carry real uncertainty, constraints, or social politeness.
- Give each paragraph one topic. Use lists or tables for steps, parallel conditions, options, and complex
  enumerations.

Judge complexity by proposition density, modifier depth, and reference load. A language profile may define its own
limits; the universal layer has no fixed word, character, sentence, or punctuation count. Stop shortening when the
text is clear, natural, and complete.

When the source is already natural, clear, and suitable for its audience, keep it as the native rewrite.

Done when: every ledger entry maps to the rewrite; every output claim maps back to the ledger; the vocabulary and
syntax come from the target language rather than word substitution or a copied source-language frame.

## 3. Reconcile and return

Map the rewrite back to the semantic ledger, then run the native-language check:

1. Is any ledger entry missing, or does any output claim lack a source?
2. Did uncertainty, evidence, causality, obligation, capability, time, responsibility, or scope change?
3. Did the rewrite add I, we, the system, the user, or another role absent from the source?
4. Would a proficient native speaker use this expression for this locale, audience relationship, and genre?
5. Does any collocation, word order, nominalization, or other trace still come from the source language?
6. Does each pronoun, omission, condition, exception, and negation have one reasonable referent or scope?
7. Can the reader quickly find the applicable condition, next action, and expected result?

Resolve conflicts in this order: correct meaning and responsibility → requested language, locale, audience, and
genre → usable information → native expression → brevity and formatting preference.

Return only the finished text by default. When the user requests a before/after view, diff, or rationale, return:

| Original | Problem | Rewrite |
| --- | --- | --- |
| Original sentence or fragment | Semantic or naturalness issue | Rewritten text |

Add one clarification line after the rewrite only when an ambiguity cannot be removed safely.

Done when: no ledger entry is missing, no output claim lacks a source, and no known locale conflict remains; the
format matches the request and contains no skill explanation, mode, violation count, change summary, or closing
offer.
