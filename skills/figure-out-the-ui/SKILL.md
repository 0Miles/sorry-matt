---
name: figure-out-the-ui
description: Use before adding an interface or restructuring an existing one's structure and hierarchy. Write the UI brief first — who it is for, what it solves, and how it is ordered.
---

# Figure out the UI: Settle it, then build it

Produce a **UI brief**: a short document of prose and lists, one screen at most, that answers who this is for,
what it solves, and how it is ordered before any code exists.

When this conversation has not yet read the **frontend contract**, first take the base directory shown when
this skill loaded and read the sibling
[`../build-the-ui-right/FRONTEND.md`](../build-the-ui-right/FRONTEND.md) in full; it defines the bold
**precedence**, **component reuse**, and **state matrix** below.

Then read `docs/agents/ui.md` per the prerequisite of **component reuse**; when it does not exist, stop, produce
no UI brief, and ask the user to run `/set-up-ui-skills`. This skill only reads `ui.md`: when it finds `ui.md`
and the source disagreeing, it proceeds on the source and writes the mismatch into the brief's assumptions part.

Write any fact that cannot be found as an **assumption** and proceed on it; collect the assumptions at the end
of the brief so a reader can overturn them at a glance.

## 1. Purpose

Write down three things: who uses it, the task they are completing, and what counts as a **useful outcome**.
Components are chosen after the purpose.

Done when: each of the three is one sentence that names its source or is labeled an assumption.

## 2. Familiar behavior

Every interactive element maps to a named component: one from the `Shared components` table in `ui.md`, a
component library component, or a native element, chosen under "choose components by job" in **component
reuse**. Links for going somewhere, buttons for doing something, forms keeping their native semantics. Tabs that
change the URL and panels that switch in place are different things. One visual state means one thing across
the whole product. Look up detail following the **precedence**.

Done when: every interactive element is written as "element → named component", the component being a shared
component, a component library component, or a native element, and every new one is listed separately with why
existing components fall short.

## 3. Hierarchy

Explain the interface through content, grouping, and order; decoration comes after:

- Write the reading order; the narrow layout keeps the same order.
- Related items sit close together, unrelated ones apart.
- Each decision emphasizes one **primary action**, with the other options still readable and reachable.
- Advanced options may be tucked away; important settings and task state stay visible.

Done when: the reading order is an ordered list, and every decision point has exactly one primary action.

## 4. States

From the **state matrix**, pick the cells that apply to this interface. For each, write what the screen shows
in that state and what the user can do next.

Done when: every applicable cell has "what it shows" and "what comes next", and every other cell has a reason
it does not apply.

## 5. Tradeoffs

Name the needs that pull against each other — compact rows help comparison and hurt touch, for example. Compare
the options using the same content and choose the one that preserves the useful outcome. Agreeing, declining,
and canceling are equally visible.

Done when: every tradeoff states both sides, which side was chosen, and what was given up.

## 6. Deliver the UI brief

Write one part per step above, in the same order, with the assumptions as the last part. When implementation
follows, call the Skill tool with `build-the-ui-right`.

Done when: all six parts are present and together fit on one screen.
