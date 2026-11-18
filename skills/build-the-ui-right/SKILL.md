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

Find the existing component closest to this change; new code reuses its tokens, naming, structure, and
styling approach.

Done when: every reused token and component has a file location, and everything that must be newly built is
listed item by item.

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
criteria as the claims to check. Report its evidence table, plus the existing tokens and components reused and
the guidance consulted.

Done when: every claim has a result from `actually-look-at-the-ui`.
