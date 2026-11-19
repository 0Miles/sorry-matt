---
name: make-the-ui-fast
description: Use for frontend performance problems — slow loads (LCP), laggy interactions (INP), layout jumps (CLS), or an oversized bundle. Measure, change one thing, measure again.
---

# Make the UI fast: Measure, change, measure again

Performance work is a loop: **baseline** → **bottleneck** → one change → measure again. Every change that
stays has before-and-after numbers.

When this conversation has not yet read the **frontend contract**, first take the base directory shown when
this skill loaded and read the sibling
[`../build-the-ui-right/FRONTEND.md`](../build-the-ui-right/FRONTEND.md) in full; it defines the bold
**precedence**, **component reuse**, **internal path**, and **browser support policy** below.

Then handle `docs/agents/ui.md` per the prerequisite of **component reuse**, which decides whether to read it;
when it does not exist, stop before
step 1: measure no baseline, change no code, and ask the user to run `/set-up-ui-skills` (running as a subagent,
put that in the report as the prerequisite says).

## 1. Fix the target and the method

Write down which page or interaction is slow, which metric tracks it, the target value, and the fixed
**measurement conditions**: production build, network and CPU throttling, viewport size, cache state. When the
project sets no target of its own, use the Core Web Vitals "good" thresholds. Measure with tools already in
the environment.

Done when: the subject, metric, target value, and measurement conditions are written down, and the conditions
can be rerun as written.

## 2. Measure the baseline

Measure at least five times under the same measurement conditions and record the median, minimum, and maximum.
That range is the **noise**: a later improvement counts once it exceeds it.

Done when: every metric has a median and a range, and the measuring command or steps are recorded.

## 3. Name the bottleneck

Use the measured data to point at one bottleneck, written as a hypothesis that can be overturned:

- **LCP**: which element; whether the time goes to TTFB, the delay before the resource starts loading, the
  load itself, or render delay.
- **INP**: which interaction; whether the time goes to input delay, handler execution, or the next paint.
- **CLS**: which elements move, and what pushes them.
- **Bundle**: which modules, and which import chain pulls them into the first screen.

A bottleneck already recorded as a component library finding is not taken up again as a new hypothesis. When
every remaining bottleneck hypothesis is a component library finding, follow the **loop stop** of step 5 and
look for no next one.

Done when: the hypothesis points to one piece of evidence in the measured data and states what result would
overturn it; or the **loop stop** has led on to step 6.

## 4. Change one thing

Look up the approach for this bottleneck following the **precedence**, decide on a fallback under the
**browser support policy**, then make one change.

When the bottleneck involves the component library, first sort out where its cost comes from:

- It comes from how the project loads or uses the library (a barrel import, loading the whole package, providers
  or styles it does not use), and the library has a **public alternative**: this is one change inside the
  project. Switch to that alternative, and update the `Loading` line of the `Component library` section in
  `ui.md` in the same diff. A public alternative is an import path that is not an **internal path**, or an approach
  the library's documentation describes.
- There is no public alternative, and the cost sits in the library's own code: record it as a component library
  finding as the next paragraph says, and leave the diff untouched.

When the bottleneck sits in the component library package's own code (the project's shared components do not
count), record it as a component library finding and do not fork in place: do none of the
**package-level** prohibitions of **component reuse**. There is
then no change to measure: skip the measuring in step 5 and go straight to its "Decide what comes next".

Done when: the diff holds one change aimed at this bottleneck, traceable to consulted guidance or to a piece of
measured evidence; when `Loading` changed, that line of `ui.md` counts as part of the same change. When the
bottleneck is in the library itself, instead: it is recorded as a component library finding and the diff is
untouched.

## 5. Measure again and decide

Measure five more times under the same measurement conditions. Keep the change when the improvement exceeds
the noise; otherwise revert it and record the hypothesis as overturned; when the reverted change carries an
edit to `ui.md`, revert that too.

Decide what comes next:

- Target met: go to step 6.
- Target unmet, with a bottleneck hypothesis left that is not a component library finding: return to step 3 for
  the next bottleneck.
- Target unmet, and every remaining bottleneck hypothesis is a component library finding: **loop stop**. Do not
  return to step 3; go to step 6, and the step 7 report states that the target was not met.

Done when: every attempted change has before-and-after medians and a verdict of "kept" or "reverted"; the
working tree holds only the kept changes; what comes next was decided as one of the three above.

## 6. Confirm the UI still works

When there are kept changes, call the Skill tool with `actually-look-at-the-ui`, giving it the screens each kept
change touches, and covering only the kept changes: deferred loading, splitting, and containment are the changes
that most often buy blank areas, layout jumps, or dead interactions. On a **loop stop** this runs the same way.
When no change was kept, do not call `actually-look-at-the-ui`: with no change, there is no screen to check.

Done when: every screen touched by a kept change has a result from `actually-look-at-the-ui`; with no kept
change, the report states "no change was kept; `actually-look-at-the-ui` was not called".

## 7. Report

- **Target**: met; or a statement that the target was not met, listing the remaining bottlenecks and the
  component library finding each maps to.
- **Before-and-after table**: `metric | baseline median | current median | noise range | target`.
- **Change list**: every kept and reverted change, each with its bottleneck and its numbers.
- **Component library findings**: `package and version | bottleneck and measured evidence | why not changed in
  the project | suggested destination`; these findings stay out of the change list. "None" when there are none.
- **UI check**: the results from `actually-look-at-the-ui`, or "no change was kept; `actually-look-at-the-ui`
  was not called".
- **State of `ui.md`**: which line this run changed, or why no update was needed.
- **`ui.md` mismatches**: every mismatch found along the way and not fixed (including those
  `actually-look-at-the-ui` reports), naming the `ui.md` section and row and the source location; "none" when
  there are none.
- The measurement conditions, noting that these are lab numbers and real-user numbers come from field data.

Done when: every "current" number in the table comes from the last measurement in step 5; every kept change
maps to an improvement in the table; an unmet target is stated, with the remaining bottlenecks and their
component library findings listed; `ui.md` matches this change, or is explicitly recorded as needing no update;
the `ui.md` mismatches are listed one by one, or stated as "none".
