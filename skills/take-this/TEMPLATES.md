# TEMPLATES: the spec and ticket templates

Used when `take-this` publishes in steps 3 and 4. Template headings stay in English, because `issue-chain`,
`get-to-work`, and the tracker conventions read them. Adapted from `mattpocock/skills` `to-spec` and `to-tickets` (MIT; source
and license in [`references/upstream/NOTICE.md`](references/upstream/NOTICE.md)).

## Spec

```markdown
## Problem Statement

The problem the user is facing, from the user's perspective.

## Solution

The solution, from the user's perspective.

## User Stories

A long, numbered list covering every aspect of the feature, each in the form:

1. As an <actor>, I want a <feature>, so that <benefit>

## Implementation Decisions

The implementation decisions made: modules to build or modify, interface changes to those modules, architectural
decisions, schema changes, API contracts, specific interactions. No specific file paths or code snippets.

## Testing Decisions

- What makes a good test: only external behavior, never implementation details
- Seams: which seams to test at (the result of `take-this` step 3)
- Modules to test, and prior art for similar tests in the codebase

## Out of Scope

What this spec does not cover.

## Further Notes

Anything else.
```

## GitHub issue

```markdown
## Parent

A reference to the parent issue (omit this section when the source was not an existing issue).

## What to build

The end-to-end behavior this ticket makes work, from the user's perspective, not layer by layer.

## Seams

The seams this ticket tests at, taken from the spec's Testing Decisions. Omit this section when there are none; the implementation agent then decides and records them.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Blocked by

- A reference to each blocking ticket, or "None (can start immediately)". Omit this section when blockers were set as native edges.
```

## Local Markdown ticket

```markdown
# <NN>: <Ticket title>

**What to build:** the end-to-end behavior this ticket makes work, from the user's perspective.

**Seams:** the seams to test at, taken from the spec's Testing Decisions; "decided by the implementer" when there are none.

**Blocked by:** the numbers/titles of the blocking tickets, or "None (can start immediately)".

**Status:** ready-for-agent

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2
```
