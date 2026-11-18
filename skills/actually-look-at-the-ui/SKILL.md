---
name: actually-look-at-the-ui
description: Use after a frontend change and before reporting it done. Look at each claim in a real browser and leave evidence. With no browser available, use it anyway and mark what was not seen as unverified.
---

# Actually look at the UI: Only what was looked at is verified

Break "it is right" into individual **claims**; a claim is verified once it was looked at in a real browser
and left evidence behind.

When this conversation has not yet read the **frontend contract**, first take the base directory shown when
this skill loaded and read the sibling
[`../build-the-ui-right/FRONTEND.md`](../build-the-ui-right/FRONTEND.md) in full; it defines the bold
**component reuse**, **state matrix**, **evidence grade**, and **eyes-on list** below, while the **component
choice table** is what step 1 of `build-the-ui-right` produces.

Then read `docs/agents/ui.md` per the prerequisite of **component reuse**; when it does not exist, stop: list no
claims, produce no evidence table, and ask the user to run `/set-up-ui-skills` (running as a subagent, put that
in the report as the prerequisite says).

## 1. List the claims

Collect them from five sources: this change's acceptance criteria, the UI brief, the **component choice table**,
the affected cells of the **state matrix**, and the diff itself. Write each as a sentence that can be seen to be
true or false: on which screen, in which state, what should appear or happen.

Every row of the component choice table yields two claims:

- (a) That UI element renders from the library component or shared component named in the row's
  `Component (location)`, not from a hand-rolled lookalike.
- (b) Its computed style matches the tokens; for the exception, see step 3.

When no component choice table was handed over (called on its own, or called by `make-the-ui-fast`), (a) and (b)
instead cover every UI element the diff adds or changes: the expected component comes from the diff's imports,
or, with no import, from the `Use when` column of the `Shared components` table in `ui.md`.

Done when: every screen the diff touches, every affected state cell, and every row of the component choice
table maps to at least one claim.

## 2. Get it running

Start the UI the project's own way (follow `docs/agents/environment.md` when it records one) and open it with
a browser tool already present in the environment. Record the **viewing conditions**: browser and version,
viewport width, device pixel ratio, theme.

When that cannot be done, check each claim against source and tests as far as those hold, mark every claim
unverified, and go straight to step 5. The two component claims (a) and (b) are likewise always marked
unverified with a reason; having read the source does not mark them passed.

Done when: the UI is open in a browser with the viewing conditions recorded, or the reason it could not be is
recorded.

## 3. Look, claim by claim

For each claim, bring the screen into that state by actually operating it, then leave evidence:

- Save screenshots to the scratchpad and give their full paths in the report.
- Read sizes, spacing, colors, and type from computed style and DOM bounds, measuring once fonts have loaded.
- Walk interactions end to end: input, validation, failure, retry, leaving.
- Console errors and failed network requests count as failures.
- When a view from before the change is on hand, set the two side by side as a **before/after pair**.
- Claim (a): read the element's rendered DOM (tag, role, the classes or data attributes the component
  generates) or the framework's component tree, and compare it with what the same component renders at one
  existing call site; a mismatch is a failure — a `div role="button"` styled to look like `Button`, for
  example. This claim is graded measured.
- Claim (b): take the files recorded in the `Location` line of the `Tokens` section of `ui.md` as the basis,
  read those tokens' resolved runtime values on the same page, then compare them one by one with the element's
  color, background, border, spacing (margin / padding / gap), radius, and font computed styles. It passes only
  when every one equals some token's resolved value; any one that equals no token is a failure. This claim is
  graded derived. When the `Tokens` section reads "None", no (b) claim is produced, and the report says so once.

Give each claim one result — pass, fail, or unverified — and one **evidence grade**.

Done when: every claim has exactly one result, one grade, and one evidence location that can be pointed to.

## 4. Fix what failed

Fix each failure to a pass under the rules of `build-the-ui-right`, then look again at that claim and the
neighboring claims the fix touched. Failures outside this change's scope go into the report as they stand.

Where the fix touches a spot on which `ui.md` and the source disagree, the source wins: correct `ui.md` in the
same change as that fix. A mismatch the fix does not touch leaves `ui.md` alone and goes into the report.

Done when: every failure was looked at again and passed, or is listed in the report with why it remains.

## 5. Report

- The **evidence table** `claim | grade | evidence | result`.
- The **eyes-on list**.
- The viewing conditions.
- **`ui.md` mismatches**: every mismatch found along the way and not corrected in step 4, naming the `ui.md`
  section and row and the source location; "none" when there are none.

Done when: the evidence table covers every claim from step 1 exactly once; every "pass" is graded measured or
derived; the `ui.md` mismatches are listed one by one, or stated as "none".
