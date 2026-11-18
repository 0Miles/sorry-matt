---
name: build-the-ui-right
description: Use when writing or changing user-visible frontend code — HTML, CSS, components, forms, interactions, motion. Consult design and platform guidance first, fill in the state matrix, and reuse the project's own tokens and components.
---

# Build the UI right: Consult, cover every state, then hand it to the eyes

Before starting, read [FRONTEND.md](FRONTEND.md) in this directory in full. It is the **frontend contract**:
source precedence, the **state matrix**, the accessibility floor, the three grades of evidence, and the browser
support policy all defer to it. This file only sets the order.

When this change adds a page, component, form, or flow, or changes an existing interface's structure or
information hierarchy, and the conversation holds no **UI brief** yet, first call the Skill tool with
`figure-out-the-ui` and continue once you have the brief.

## 1. Know the project

Read the project's instruction files and the code around this change. Identify the framework, design tokens,
typefaces, density, themes, component library, and browser support policy. Then find the existing component
closest to this change: new code reuses its tokens, naming, structure, and styling approach.

Done when: every token and component to be reused has a file location, and everything with no counterpart in
the project — everything that must be newly built — is listed item by item.

## 2. Consult before writing

Look up every UI mechanism this change uses — dialogs, popovers, form validation, tables, layout, theming,
motion, scrolling — once each before writing it, split as section 1 of the contract sets out: ask
`master-design` what to build and why, and ask `modern-web-guidance` which platform API to use and whether it
needs a fallback. When retrieved guidance conflicts with the project's established approach, the project wins.

Done when: every UI mechanism in use maps to guidance that was consulted, or is recorded as "not covered by
guidance".

## 3. Fill in the state matrix

For each affected screen or component, answer every cell of the **state matrix** in section 2 of the contract
with "implemented" or "not applicable". While implementing, hold the accessibility floor in section 3 and the
browser support policy in section 5.

Done when: the matrix has no blank cell; every "implemented" points to a code location; every "not applicable"
has a reason.

## 4. Hand it to the eyes

Call the Skill tool with `actually-look-at-the-ui`, giving it the state matrix and this change's acceptance
criteria as the claims to check. Fix the failures it reports until they pass; when a fix touches other states,
have those cells looked at again.

Report four things: the existing tokens and components reused, the state matrix, the guidance consulted, and
the evidence table from `actually-look-at-the-ui`.

Done when: every claim has a result from `actually-look-at-the-ui`, and every failure is either fixed to a pass
or written into the report as it stands.
