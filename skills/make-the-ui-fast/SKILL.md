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
**precedence** and **browser support policy** below.

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

Done when: the hypothesis points to one piece of evidence in the measured data and states what result would
overturn it.

## 4. Change one thing

Look up the approach for this bottleneck following the **precedence**, decide on a fallback under the
**browser support policy**, then make one change.

Done when: the diff holds one change aimed at this bottleneck, traceable to consulted guidance or to a piece of
measured evidence.

## 5. Measure again and decide

Measure five more times under the same measurement conditions. Keep the change when the improvement exceeds
the noise; otherwise revert it and record the hypothesis as overturned. While the target is unmet, return to
step 3 for the next bottleneck.

Done when: every attempted change has before-and-after medians and a verdict of "kept" or "reverted", and the
working tree holds only the kept changes.

## 6. Confirm the UI still works

Call the Skill tool with `actually-look-at-the-ui`, giving it the screens each kept change touches: deferred
loading, splitting, and containment are the changes that most often buy blank areas, layout jumps, or dead
interactions.

Done when: every screen touched by a kept change has a result from `actually-look-at-the-ui`.

## 7. Report

- **Before-and-after table**: `metric | baseline median | current median | noise range | target`.
- **Change list**: every kept and reverted change, each with its bottleneck and its numbers.
- The measurement conditions, noting that these are lab numbers and real-user numbers come from field data.

Done when: every "current" number in the table comes from the last measurement in step 5, and every kept change
maps to an improvement in the table.
