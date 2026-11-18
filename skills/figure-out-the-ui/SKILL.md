---
name: figure-out-the-ui
description: Use before writing a new interface. When adding a page, component, form, or flow, or changing an existing interface's structure or information hierarchy, first settle who it is for and what it solves. Produces a UI brief, no code.
---

# Figure out the UI: Settle it, then build it

Produce a **UI brief**: a short document that answers, before any code exists, who this interface is for, what
it solves, and in what order it reads. Before starting, take the base directory shown when this skill loaded
and read the sibling [`../build-the-ui-right/FRONTEND.md`](../build-the-ui-right/FRONTEND.md) in full; it is
the **frontend contract**.

Look up every fact that can be looked up: the request, the ticket, the spec, the existing code, and the
project's instruction files. Write what cannot be found as an **assumption**, label it, and proceed on it;
collect the assumptions at the end of the brief so a reader can overturn them at a glance.

## 1. Purpose

Write down three things: who uses it, the task they are completing, and what counts as a **useful outcome**.
Components are chosen after the purpose.

Done when: each of the three is one sentence that names its source or is labeled an assumption.

## 2. Familiar behavior

Find the closest existing pattern in the project and on the platform, and reuse it: links for going somewhere,
buttons for doing something, forms keeping their native semantics. Tabs that change the URL and panels that
switch in place are different things. One visual state means one thing across the whole product. For detail,
consult `master-design` as section 1 of the contract sets out.

Done when: every interactive element maps to an existing pattern or a native element, and every newly invented
pattern is listed with why the existing ones fall short.

## 3. Hierarchy

Explain the interface through content, grouping, and order first; decoration comes after:

- Write the reading order; the narrow layout keeps the same order.
- Related items sit close together, unrelated ones apart.
- Each decision emphasizes one **primary action**, with the other options still readable and reachable.
- Advanced options may be tucked away; important settings and task state stay visible.

Done when: the reading order is an ordered list, and every decision point has exactly one primary action.

## 4. States

From the **state matrix** in section 2 of the contract, pick the cells that apply to this interface. For each,
write what the screen shows in that state and what the user can do next.

Done when: every applicable cell has "what it shows" and "what comes next", and every inapplicable cell has a
reason.

## 5. Tradeoffs

Name the needs that pull against each other — compact rows help comparison and hurt touch, for example. Compare
the options using the same content, choose the one that preserves the useful outcome, and write down what was
given up. Agreeing, declining, and canceling are equally visible.

Done when: every tradeoff states both sides, which side was chosen, and what was given up.

## 6. Deliver the UI brief

Keep the brief to one screen, in six parts and this order: user and task, useful outcome, existing patterns
reused, reading order and primary actions, states, tradeoffs and assumptions. When implementation follows, call
the Skill tool with `build-the-ui-right`.

Done when: all six parts are present, every assumption sits in the last part, and the brief contains no code.
