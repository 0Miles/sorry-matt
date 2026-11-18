---
name: make-this-shit-pretty
description: Rework an existing piece of UI in small verified steps, with behavior unchanged
disable-model-invocation: true
---

# Make this shit pretty: Rework existing UI, behavior unchanged

Arguments name the page, component, route, or flow to rework. With no argument, ask the user to name the scope.

Before starting, take the base directory shown when this skill loaded and read the sibling
[`../build-the-ui-right/FRONTEND.md`](../build-the-ui-right/FRONTEND.md) in full. It is the **frontend
contract**; it defines the bold **state matrix**, **accessibility floor**, **evidence grade**, and **eyes-on
list** below.

**Hard rail — behavior stays unchanged.** The **behavior baseline** is these five: routes, data flow, fields
and validation rules, the requests sent, and event tracking; they are the same before and after. What may
change is structure, hierarchy, semantic markup, styling, and the filling-in of missing states. A functional
defect found along the way is recorded as a finding and handed back in the report for a separate change.

## 1. Fix the scope and the behavior baseline

Confirm the working tree is clean, list the screens and component files in scope, then record three things:

- The current state and code location of each of the five behavior-baseline items.
- The results of one run each of the project's existing tests, typecheck, and lint; pre-existing red lights
  are pinned down now.
- A screenshot of every screen in each applicable cell of the **state matrix**, saved to the scratchpad as the
  **before**.

Done when: every file in scope is listed; all five behavior-baseline items have a record of their current
state; the check results and the paths of the "before" screenshots are recorded.

## 2. Walk the whole journey

Walk it for real from entry through the primary action to the outcome, then add one genuine **interruption**:
a failed validation, a failed request, leaving midway, or a double submit. Record each problem seen as a
finding with five fields:

`location (screen and file:line) | user-visible consequence | rule violated | evidence grade | evidence location`

Sweep once with each of four lenses: purpose and hierarchy, blank cells in the **state matrix**, the
**accessibility floor**, decoration without a reason. When `modern-web-guidance` is among the available
skills, additionally call the Skill tool with `modern-web-guidance` to find outdated platform patterns in
scope.

Done when: every step of the journey and the interruption were walked; every lens has findings or an explicit
"nothing found"; every finding has all five fields.

## 3. Settle it and get one ruling from the user

Call the Skill tool with `figure-out-the-ui`, handing it the findings, to obtain a new UI brief. Then cut the
rewrite into steps: each can be verified on its own and leaves the UI working; structure and hierarchy come
first, states second, craft detail last.

Next comes the only **ruling point** of the run: hand the user the findings, the UI brief, and the step list in
one go, and ask them to rule on which to do. Mark each judged finding as a matter of taste and attach your
recommendation.

Done when: every finding maps to a step or is marked "not addressed" with a reason, and the user has ruled on
the scope.

## 4. Rewrite in small steps

When currently on the default branch, create a new branch first. For each step, in order:

1. Call the Skill tool with `build-the-ui-right` to carry out this step's rewrite.
2. Call the Skill tool with `actually-look-at-the-ui`, using the step 1 screenshots as the "before" for a
   **before/after pair**.
3. Rerun the automated checks; the step passes when the results match step 1.
4. Make one commit containing this step alone.

When a step still fails after two fixes, revert it, record it as unfinished, and move on to the next.

Done when: every step is exactly one of "finished with one commit" or "reverted with a reason", and every
finished step has a before/after pair and check results matching step 1.

## 5. Deliver

- **Findings reconciliation table**: one row per finding, with a result of fixed, not addressed, or out of
  scope, each with its commit or reason.
- **Behavior baseline recheck**: the five items compared before and after, one by one; check results set
  beside those from step 1.
- **Before/after pairs**: one set per screen, with full screenshot paths.
- The **eyes-on list**, and the functional defects recorded along the way.

Done when: the reconciliation table covers every finding from step 2 exactly once; all five behavior-baseline
items are marked "same"; check results match step 1; every "it looks better" in the report points to a
before/after pair.
