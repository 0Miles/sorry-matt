---
name: make-this-shit-pretty
description: Rework an existing piece of UI in small verified steps, with behavior unchanged
disable-model-invocation: true
---

# Make this shit pretty: Rework existing UI, behavior unchanged

Arguments name the page, component, route, or flow to rework. With no argument, ask the user to name the scope.

Before starting, take the base directory shown when this skill loaded and read the sibling
[`../build-the-ui-right/FRONTEND.md`](../build-the-ui-right/FRONTEND.md) in full. It is the **frontend
contract**; it defines the bold **component reuse**, **hard-coded value**, **state matrix**, **accessibility
floor**, **evidence grade**, and **eyes-on list** below.

Then read `docs/agents/ui.md` per the prerequisite of **component reuse**; when it does not exist, stop before
step 1: create no branch, produce no findings, and ask the user to run `/set-up-ui-skills`.

**Hard rail — behavior stays unchanged.** The **behavior baseline** is these six: routes, data flow, fields
and validation rules, the requests sent, event tracking, and keyboard operation; they are the same before and
after. "Keyboard operation" means every action is triggered by the same keys before and after the rework, and
triggered only once. What may change is structure, hierarchy, semantic markup, styling, and the filling-in of
missing states. A functional defect found along the way is recorded as a finding and handed back in the report
for a separate change.

Replacing a hand-rolled lookalike, or code that bypasses the component library, with a library component or a
shared component from `ui.md` counts as "filling in missing states or semantics" and does not break "behavior
stays unchanged"; the six **behavior baseline** items are still compared one by one. A migration moves only the
business logic over to the new component: submits, requests, event tracking, navigation. Keyboard, focus, and
state handlers the target component already provides do not move — the Enter / Space key handler on a
hand-rolled button, for example, or self-managed focus and disabled state; moving them makes one key press fire
twice, and breaks the **component reuse** prohibition on hand-writing behavior a component already has.

## 1. Fix the scope and the behavior baseline

Confirm the working tree is clean, list the screens and component files in scope, then record three things:

- The current state and code location of each of the six behavior-baseline items; for keyboard operation, which
  keys trigger each action and how many times each fires.
- The results of one run each of the project's existing tests, typecheck, and lint; pre-existing red lights
  are pinned down now.
- A screenshot of every screen in each applicable cell of the **state matrix**, saved to the scratchpad as the
  **before**.

Done when: every file in scope is listed; all six behavior-baseline items have a record of their current
state; the check results and the paths of the "before" screenshots are recorded.

## 2. Walk the whole journey

Walk it for real from entry through the primary action to the outcome, then add one genuine **interruption**:
a failed validation, a failed request, leaving midway, or a double submit. Record each problem seen as a
finding with five fields:

`location (screen and file:line) | user-visible consequence | rule violated | evidence grade | evidence location`

Sweep once with each of five lenses: purpose and hierarchy, blank cells in the **state matrix**, the
**accessibility floor**, decoration without a reason, bypassing the component library. When
`modern-web-guidance` is among the available skills, additionally call the Skill tool with
`modern-web-guidance` to find outdated platform patterns in scope.

"Bypassing the component library" checks against the `Component library`, `Shared components`, and `Tokens`
sections of `ui.md`, and catches three kinds:

- **Hand-rolled lookalike**: a home-made element imitating a library component or a shared component. The
  finding names the component it imitates, and that component's location or package in `ui.md`.
- **Outside override**: the prohibitions spelled out in the customization ladder of **component reuse** —
  overriding a component's internal styles from an outside selector, raising specificity or using
  `!important`, a private class or private CSS variable.
- **Hard-coded value**: judged by the **hard-coded value** definition in **component reuse**, with no criterion
  of its own; the finding names the token that matches it. A literal outside the definition gets no finding.

The **evidence grade** of these findings: hand-rolled lookalikes and outside overrides are measured (the DOM and
computed style read in the browser), and with no browser they are unverified, with the source `file:line`
attached; hard-coded values are measured as the definition says, with a search command or `file:line` as the
evidence, and are judged the same way with no browser.

Done when: every step of the journey and the interruption were walked; every lens has findings or an explicit
"nothing found"; every finding has all five fields.

## 3. Settle it and get one ruling from the user

Call the Skill tool with `figure-out-the-ui`, handing it the findings, to obtain a new UI brief. Then cut the
rewrite into steps: each can be verified on its own and leaves the UI working; structure and hierarchy come
first, states second, craft detail last.

Next comes the only **ruling point** of the run: hand the user the findings, the UI brief, and the step list in
one go, and ask them to rule on which to do. Mark each judged finding as a matter of taste and attach your
recommendation. A "bypassing the component library" finding is not judged and is never marked a matter of taste.

Done when: every finding maps to a step or is marked "not addressed" with a reason, and the user has ruled on
the scope.

## 4. Rewrite in small steps

When currently on the default branch, create a new branch first. For each step, in order:

1. Call the Skill tool with `build-the-ui-right` to carry out this step's rewrite.
2. Call the Skill tool with `actually-look-at-the-ui`, using the step 1 screenshots as the "before" for a
   **before/after pair**.
3. Rerun the automated checks; the step passes when the results match step 1.
4. Make one commit containing this step alone.

When a step migrates to a shared component (extracting one, switching to one, or changing what one is for) or
merges duplicate implementations, the matching edit to `ui.md` goes into that step's own commit:
`git show --name-only` lists both the code and `docs/agents/ui.md`. A mismatch between `ui.md` and the source
found along the way and not caused by any step leaves `ui.md` alone, goes into the **`ui.md` mismatches** of
step 5, and gets no commit of its own.

When a step still fails after two fixes, revert it, record it as unfinished, and move on to the next.

Done when: every step is exactly one of "finished with one commit" or "reverted with a reason", and every
finished step has a before/after pair and check results matching step 1.

## 5. Deliver

- **Findings reconciliation table**: one row per finding, with a result of fixed, not addressed, or out of
  scope, each with its commit or reason.
- **Behavior baseline recheck**: the six items compared before and after, one by one, with the "keyboard
  operation" row giving each action's keys and fire count before and after; check results set beside those from
  step 1.
- **Before/after pairs**: one set per screen, with full screenshot paths.
- **State of `ui.md`**: which rows this run updated and in which commit each, or why no update was needed.
- **`ui.md` mismatches**: every mismatch found along the way, not caused by any step, and not fixed (including
  those `actually-look-at-the-ui` reports), naming the `ui.md` section and row and the source location; "none"
  when there are none.
- The **eyes-on list**, and the functional defects recorded along the way.

Done when: the reconciliation table covers every finding from step 2 exactly once; all six behavior-baseline
items are marked "same"; check results match step 1; every "it looks better" in the report points to a
before/after pair; `ui.md` matches this change, or is explicitly recorded as needing no update; the `ui.md`
mismatches are listed one by one, or stated as "none".
