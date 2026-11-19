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
**component reuse**, **hard-coded value**, **state matrix**, **evidence grade**, and **eyes-on list** below, while the **component
choice table** is what step 1 of `build-the-ui-right` produces.

Then read `docs/agents/ui.md` per the prerequisite of **component reuse**; when it does not exist, stop: list no
claims, produce no evidence table, and ask the user to run `/set-up-ui-skills` (running as a subagent, put that
in the report as the prerequisite says).

## 1. List the claims

Collect them from five sources: this change's acceptance criteria, the UI brief, the **component choice table**,
the affected cells of the **state matrix**, and the diff itself. Write each as a sentence that can be seen to be
true or false: on which screen, in which state, what should appear or happen.

Every row of the component choice table yields two claims:

- (a) That UI element renders from the library component, shared component, or page-local component named in
  the row's `Component (location)`, not from a hand-rolled lookalike; for a row whose location reads
  "native `<tag>`", what renders is that native tag.
- (b) Its own style source contains no **hard-coded value**; for how, see step 3.

When no component choice table was handed over (called on its own, or called by `make-the-ui-fast`), (a) and (b)
instead cover every UI element the diff adds or changes: the expected component comes from the diff's imports,
or, with no import, from the `Use when` column of the `Shared components` table in `ui.md`.

Done when: every screen the diff touches, every affected state cell, and every row of the component choice
table maps to at least one claim.

## 2. Get it running

Start the UI the project's own way (follow `docs/agents/environment.md` when it records one) and open it with
a browser tool already present in the environment. Record the **viewing conditions**: browser and version,
viewport width, device pixel ratio, theme.

When that cannot be done, check every claim other than claim (b) against source and tests as far as those hold,
and mark them all unverified; claim (a) is likewise always marked unverified with a reason, and having read the
source does not mark it passed. Claim (b) is a source check to begin with: judge it pass or fail as step 3 says,
fix its failures under step 4, then go to step 5.

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
- Claim (b): under the **hard-coded value** definition in **component reuse**, search the UI element's own style
  source (the classes and inline style at the call site, the project stylesheet rules that apply to it, and, for
  a shared component, its source) for hard-coded values, taking the matching tokens from the files recorded in
  the `Location` line of the `Tokens` section of `ui.md`. It passes only when there is none; finding one is a
  failure, with its `file:line`. For a library component already verified by (a), the attributes the library
  puts on its root node are exempt; only the styles the project adds at the call site are checked. Do not read
  computed style, and do not compare computed values with the tokens' resolved values. This claim is graded
  measured, with a search command or `file:line` as the evidence. When the `Tokens` section reads "None", no (b)
  claim is produced, and the report says so once.

Give each claim one result — pass, fail, or unverified — and one **evidence grade**.

Done when: every claim has exactly one result, one grade, and one evidence location that can be pointed to.

## 4. Fix what failed

Fix each failure to a pass under the rules of `build-the-ui-right`, then look again at that claim and the
neighboring claims the fix touched. Failures outside this change's scope go into the report as they stand. A
(b) failure is fixed the way **hard-coded value** prescribes, by switching to the matching token; never fix it
with a prohibition of **component reuse** — an outside override, raised specificity or `!important`, a private
class or private CSS variable, for example.

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
