---
name: actually-look-at-the-ui
description: Use after a frontend change and before reporting it done. Look at each claim in a real browser and leave evidence. With no browser available, use it anyway and mark what was not seen as unverified.
---

# Actually look at the UI: Only what was looked at is verified

Break "it is right" into individual **claims**; a claim is verified once it was looked at in a real browser
and left evidence behind.

When this conversation has not yet read the **frontend contract**, first take the base directory shown when
this skill loaded and read the sibling
[`../build-the-ui-right/FRONTEND.md`](../build-the-ui-right/FRONTEND.md) in full; it defines the bold **state
matrix**, **evidence grade**, and **eyes-on list** below.

## 1. List the claims

Collect them from four sources: this change's acceptance criteria, the UI brief, the affected cells of the
**state matrix**, and the diff itself. Write each as a sentence that can be seen to be true or false: on which
screen, in which state, what should appear or happen.

Done when: every screen the diff touches and every affected state cell maps to at least one claim.

## 2. Get it running

Start the UI the project's own way (follow `docs/agents/environment.md` when it records one) and open it with
a browser tool already present in the environment. Record the **viewing conditions**: browser and version,
viewport width, device pixel ratio, theme.

When that cannot be done, check each claim against source and tests as far as those hold, mark every claim
unverified, and go straight to step 5.

Done when: the UI is open in a browser with the viewing conditions recorded, or the reason it could not be is
recorded.

## 3. Look, claim by claim

For each claim, bring the screen into that state by actually operating it, then leave evidence:

- Save screenshots to the scratchpad and give their full paths in the report.
- Read sizes, spacing, colors, and type from computed style and DOM bounds, measuring once fonts have loaded.
- Walk interactions end to end: input, validation, failure, retry, leaving.
- Console errors and failed network requests count as failures.
- When a view from before the change is on hand, set the two side by side as a **before/after pair**.

Give each claim one result — pass, fail, or unverified — and one **evidence grade**.

Done when: every claim has exactly one result, one grade, and one evidence location that can be pointed to.

## 4. Fix what failed

Fix each failure to a pass under the rules of `build-the-ui-right`, then look again at that claim and the
neighboring claims the fix touched. Failures outside this change's scope go into the report as they stand.

Done when: every failure was looked at again and passed, or is listed in the report with why it remains.

## 5. Report

The **evidence table** `claim | grade | evidence | result`, the **eyes-on list**, and the viewing conditions.

Done when: the evidence table covers every claim from step 1 exactly once, and every "pass" is graded measured
or derived.
