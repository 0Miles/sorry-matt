---
name: actually-look-at-the-ui
description: Use after a frontend change and before reporting it done. Open the changed screens in a real browser, record evidence for each claim, and grade it. Use whenever a change alters what renders or how it behaves; with no browser available, use it anyway and mark what was not seen as unverified.
---

# Actually look at the UI: What nobody looked at was not verified

Break "it is right" into individual **claims**. A claim counts as verified only after it was looked at in a
real browser and left evidence behind. Before starting, take the base directory shown when this skill loaded
and read the sibling [`../build-the-ui-right/FRONTEND.md`](../build-the-ui-right/FRONTEND.md) in full; the
three grades of evidence are in its section 4.

## 1. List the claims

Collect them from four sources: this change's acceptance criteria, the **UI brief**, the affected cells of the
**state matrix** in section 2 of the contract, and the diff itself. Write each as a sentence that can be seen
to be true or false: on which screen, in which state, what should appear or happen.

Done when: every screen the diff touches and every affected state cell maps to at least one claim.

## 2. Get it running

Find how the project starts its UI from the `package.json` scripts, the README, and
`docs/agents/environment.md`, start it, and open it with a browser tool already present in the environment.
Record the browser and version, viewport width, device pixel ratio, and theme.

When the environment has no browser tool, or the UI will not run: check each claim against source and tests as
far as those can support it, mark every claim **unverified** with the reason, and go straight to step 5.

Done when: the UI is open in a browser with the viewing conditions recorded, or the reason it could not be is
recorded.

## 3. Look, claim by claim

For each claim, bring the screen into that state by actually operating it, then leave evidence:

- Save screenshots to the scratchpad and give their full paths in the report.
- Read sizes, spacing, colors, and type from computed style and DOM bounds; measure only after fonts have
  loaded.
- Walk interactions end to end: input, validation, failure, retry, leaving. Then walk them again by keyboard
  alone.
- Look once in each affected theme; once at 320 CSS px wide and once with the longest content; look at motion
  once more under reduced motion, and reverse it midway once.
- Console errors and failed network requests count as failures.
- When a view from before the change is on hand, set the two side by side as a **before/after pair**.

Give each claim one result — pass, fail, or unverified — and grade it measured, derived, or judged under the
contract.

Done when: every claim has exactly one result, one grade, and one evidence location that can be pointed to.

## 4. Fix what failed

Fix each failure until it passes, following the rules of `build-the-ui-right` while fixing. After a fix, look
again at that claim and at the neighboring claims the fix touched. Failures outside this change's scope go
into the report as they stand.

Done when: every failure was looked at again and passed, or is listed in the report with why it remains.

## 5. Report

- **Evidence table**: `claim | grade | evidence | result`.
- **Eyes-on list**: one row per judged item, with a directly openable URL and the steps to reach it.
- **Unverified**: each item with its reason.
- **Viewing conditions**: browser and version, viewport width, device pixel ratio, theme.

Done when: the evidence table covers every claim from step 1 exactly once, and every "pass" in the report
rests on measured or derived evidence.
