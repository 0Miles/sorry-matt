---
name: build-the-ui-right
description: Use when writing or changing user-visible frontend code. Consult guidance first, fill in the state matrix, and reuse the project's existing tokens and components.
---

# Build the UI right: Consult, cover every state, then hand it to the eyes

When this conversation has not yet read [FRONTEND.md](FRONTEND.md) in this directory, read it in full first.
It is the **frontend contract**, and it defines the bold terms below.

When adding an interface or restructuring an existing one while the conversation holds no **UI brief**, first
call the Skill tool with `figure-out-the-ui`.

## 1. Reuse what the project has

Choose components under **component reuse**; when `docs/agents/ui.md` does not exist, stop at its prerequisite
step. New code reuses the naming, structure, and styling approach of the chosen components and tokens. When
adding or extracting a shared component, update `ui.md` in the same commit.

Produce a component choice table, one row per UI element:

| UI element | Component (location) | Customization rung | Rationale |
| --- | --- | --- | --- |

"Customization rung" takes exactly one of three values: "reused", "customized, rung N" (N is 1–4, the rung of
the **component reuse** customization ladder), or "new". A native HTML element takes "reused", with
`Component (location)` written "native `<tag>`" ("native `<p>`", "native `<button>`", for example), and does not
go through the **new-component bar**; a **page-local component** takes "reused", with its file path as the
location.

Done when: every row of the table falls into exactly one category and has a location and a rationale, and every
"new" row also states the knowledge it brings and why existing components fall short.

## 2. Consult before writing

Look up every UI mechanism this change uses — dialogs, popovers, form validation, tables, layout, theming,
motion, scrolling — once each before writing it, following the **precedence**, and decide on a fallback under
the **browser support policy**.

Done when: every UI mechanism in use maps to guidance that was consulted, or is recorded as "not covered by
guidance".

## 3. Fill in the state matrix

Complete the **state matrix** for each affected screen or component, holding the **accessibility floor** while
implementing.

Done when: every cell of the matrix has an answer, and every "implemented" points to a code location.

## 4. Hand it to the eyes

Call the Skill tool with `actually-look-at-the-ui`, giving it the state matrix and this change's acceptance
criteria as the claims to check. Report its evidence table, the component choice table, the existing tokens
reused, the guidance consulted, and the state of `ui.md`: which rows this change updated, or why it needs no
update.

Done when: every claim has a result from `actually-look-at-the-ui`, the report includes the component choice
table, and `ui.md` matches this change or is explicitly recorded as needing no update.
