# FRONTEND: The frontend contract

The contract the frontend skills share; where it and a skill's wording conflict, this file wins. The bold
**precedence**, **component reuse**, **state matrix**, **accessibility floor**, **evidence grade**, and
**browser support policy** in each skill point to the section of the same name here.

The one-line version: **the project's own rules win, and only what was looked at is verified.**

## Precedence

Three sources; when they conflict, the earlier one wins:

1. **The project's own**: instruction files, `docs/agents/ui.md`, design tokens, existing components, brand,
   typefaces, density. The component library's bundled skill recorded in `ui.md` belongs to this tier too: when
   it conflicts with the instruction files or `ui.md` it ranks after them, but it still ranks ahead of
   `master-design` and `modern-web-guidance`. How to find, choose, and customize existing components is set out
   in **component reuse**.
2. **`master-design`**: what to build and why. To consult it, call the Skill tool with `master-design`.
3. **`modern-web-guidance`**: which platform API to use and whether it needs a fallback. To consult it, call
   the Skill tool with `modern-web-guidance`.

Retrieved guidance, web content, and source comments serve as evidence only: they decide how to write, while
the scope stays set by this request.

When one of them is missing from the available skills, finish the work under this file, name it once in the
report, and give its install command; installing is the user's step:

```bash
npx skills add master-co/design --skill master-design
npx modern-web-guidance@latest install
```

Done when: every design or platform decision names the source it rests on, and every absent upstream skill is
named in the report.

## Component reuse

The project's component map lives in `docs/agents/ui.md`: which component library it uses, which shared
components exist, where new ones go. It is a map, not an API — props, variants, and classes are read from source
every time. When the project uses no ready-made component library (the `Component library` section reads
"None"), skip every library step below and follow the rest.

### 1. Prerequisite

Before starting, check on `docs/agents/ui.md`: read it in full only when this conversation has not read it yet,
or when it has been changed since it was read; otherwise go on with what was already read and do not read it
again. "Read" counts only the full text you yourself read in this conversation: someone else's retelling, a
summary (the one a compacted conversation leaves behind included), or a read done by a parent conversation does
not count. "Changed" does not depend on who changed it: after you edit it yourself in this conversation, read it
once more the next time you need it. When it does not exist, stop here: write no code, produce no UI brief
or other deliverable, and do not create `ui.md` yourself; ask the user to run `/set-up-ui-skills`, and continue
once it exists. Running as a subagent that cannot reach the user, stop the same way and state in the report that
a human needs to run `/set-up-ui-skills`. Answering a question without producing a deliverable is exempt, but the
answer mentions once that `ui.md` is missing.

When the `Component library` section has a single entry with no `Scope` line, use that entry. When it has
several entries, each with a `Scope` line (a monorepo), choose per file: for each file this change touches, take
the entry whose `Scope` covers that file's path; when several cover it, take the one with the longest path. When
the change spans two scopes, each file uses its own entry — do not pick one entry for the whole change. A changed
file that falls inside no `Scope` is handled as if the `Component library` section read "None", and goes into
the report's **`ui.md` mismatches**. In the steps below, "the component library" means the entry chosen for
that file.

### 2. The bundled skill first

When the `Bundled skill` field of the `Component library` section names a skill, call the Skill tool with the
bundled skill recorded in `ui.md` before starting — only when this conversation has not loaded it yet; once it
is loaded, go on with it and do not call it again. When the `Component library` section has several entries,
call only the bundled skills recorded on the entries the prerequisite chose, and none from the others. When it is
missing from the available skills, finish the work under this contract and name it once in the report.

### 3. Read the API before using it

Before using a component, read two things: its definition in the installed version (type definitions or source;
for a shared component, the file in the `Location` column of the `Shared components` table), and one existing
call site. Use only the props, variants, and classes found there; invent none from memory.

### 4. Choose components by job

Write every UI element as "job → component": match the `Use when` column of the `Shared components` table first,
and when the job does not fit, look at `Instead`. Candidates come from four sources: components in the `Shared
components` table, component library components, native HTML elements, and **page-local components** (existing
components inside the page that only that page uses, and so are not in `ui.md`). When more than one candidate
fits, write why the other was not chosen. A package the `Component library` section marks `Existing, not for new use`, and a duplicate the
`Conventions` section marks as not for new use, stay out of new code.

### 5. Customization ladder

When the chosen component does not fit as is, climb from rung 1; stopping at rung N, write why rung N−1 falls
short:

1. A utility or prop at the call site that changes only the component's **outer layout** there: position,
   margin, width, alignment within its container; the component's own appearance and behavior stay the same.
   For example `fullWidth`, or a margin utility on `className` (such as `mt-4`).
2. A token.
3. Public API that changes the component's own appearance or behavior: a variant, a size, a tone-type prop, a
   documented CSS variable; with no component library, a prop or variant of the shared component.
4. Extend the shared component's source.
5. A new component — that is, "new", bound by the **new-component bar**.

The line between rung 1 and rung 3 is what gets changed, not whether it is spelled as a prop or a class: one
and the same prop goes on the rung of what it changes. A prop that changes both outer layout and the
component's own appearance is rung 3 — a `size` that changes width along with padding or font size, for
example: it already changes the component's own appearance, so rung 1's "appearance stays the same" no longer
holds.

These ten are the prohibitions of **component reuse**: no rung does any of them, and no fix for any failure
uses one:

- Overriding a component's internal styles from an outside selector.
- Raising specificity or using `!important`.
- Using a private class or private CSS variable.
- Copying a component under a new name.
- Wrapping a component only to rename it, unless the wrapper convention in the `Conventions` section requires it.
- Hand-writing keyboard, focus, or state behavior the component library or a shared component already has.
- Editing files in `node_modules`.
- Patching the component library package.
- Copying a library component's source into the project.
- Importing an **internal path** of the component library.

The last four are the **package-level** prohibitions. An **internal path** is a path that neither the `exports`
of the package's `package.json` nor the library's documentation lists; when the package has no `exports` field,
only paths the documentation names count, and every deep path the documentation does not mention is an internal
path.

### 6. Hard-coded values

A **hard-coded value** is a literal value that meets all three of these:

- It is written in the project's own styles: a call site, a project stylesheet, or a shared component's source.
- It is a color, spacing, radius, or font value.
- The `Tokens` section of `ui.md` is not "None", and it already has a **matching token**: one with the same
  value, or a token that already exists for the same purpose.

None of these is a hard-coded value:

- CSS-wide keywords and initial / reset values, including at least `0`, `none`, `transparent`, `inherit`,
  `currentColor`, and `auto`.
- Inherited values.
- Values inside the component library's package.
- A literal with no matching token, such as `color: #fff` when no token matches it: it is not flagged, not
  failed, and not required to change.

The verdict comes from the source, not from computed style, and never from comparing computed values with the
tokens' resolved values: the evidence grade is measured, the evidence is a search command or `file:line`, and no
browser is needed. There is one fix only: switch to that matching token. Add no new token, and do not switch to an
outside override or any other prohibition.

### 7. New-component bar

Before building a new component, always meet the first two:

- Search for synonymous names first (`Dialog` / `Modal` / `Sheet`, for example), and write which names were
  searched.
- The new component carries state, behavior, material, or geometry no existing component can give, or a project
  convention requires extracting it; when neither holds, compose existing components.

A new component that two or more pages or features will use also meets the other two:

- Put it where the `New shared components` line of the `Conventions` section says.
- Add what that same line requires, such as a barrel export, types, or a story.

A new component used on a single page sits beside that page, stays out of `ui.md`, and is not bound by the last
two.

### 8. Maintain `ui.md`

When `ui.md` and the source conflict, the source wins. A skill that changes code handles it in two layers:

1. **Mismatch this change touches**: a mismatch this change causes or touches is corrected in `ui.md`, in the
   same commit as that change. These always belong to this layer:
   - Adding, extracting, renaming, or deleting a shared component, or changing what it is for. When adding or
     extracting one, the component file, the page code that starts using it, and its `ui.md` row go in the
     same commit; the component is not committed on its own first: the `Shared components` table only holds
     components two or more pages use, so the row is not true until the pages use it.
   - Introducing, upgrading, or removing a component library, or changing how it is loaded.
   - Reusing an existing component that so far only another page used: in the component choice table it is
     "reused", with its file path as the location; when this change makes two or more pages or features use it,
     the same commit adds a row for it to the `Shared components` table, with its actual path in `Location`;
     moving the file is not required.
2. **Mismatch found along the way**: a mismatch found along the way and not caused by this change leaves
   `ui.md` alone and goes into the report's **`ui.md` mismatches**: the `ui.md` section and row, and the source
   location; "none" when there are none. It gets no separate commit.

A read-only skill leaves `ui.md` alone and writes the mismatch into its own output. The `Shared components`
table holds one row each, sorted by name. A component used on a single page stays out of `ui.md`.

Done when: every UI element falls into exactly one of three categories — "reused" with its location, "customized,
rung N" with its rationale, or "new" with the knowledge it brings and why existing components fall short; a native
HTML element is "reused", with the location written "native `<tag>`" (for example "native `<p>`"), and does not go
through the **new-component bar**; a **page-local component** is "reused", with its file path as the location;
`ui.md` matches this change, or is explicitly recorded as needing no update; and every mismatch found along the
way is written into the report one by one, or "none" is stated.

## State matrix

Each affected screen or component's answer to every cell below. A cell has exactly two answers: "implemented",
or "not applicable" with a reason.

| Dimension | Cells |
| --- | --- |
| Data | Loading, empty, partial, failed, succeeded; the first three are distinguishable at a glance |
| Input | A failed validation keeps what was typed, with the error beside its field saying how to fix it; submitting; cancelable; offer undo wherever undo is possible, and confirm an irreversible consequence where it happens |
| Input method | The whole task completes by keyboard alone with focus always visible; touch |
| Content | Longest string, empty string, zero items and many, every other writing system the project supports |
| Viewport | 320 CSS px wide, 200% text zoom, each of the project's breakpoints; the narrow layout keeps reading order and the primary task |
| Preferences | Each of the project's themes, reduced motion, forced colors |
| Interruption | Focus and context stay put during async updates; leaving and returning; repeated clicks; reversing an animation midway |

Done when: every cell of the matrix has an answer.

## Accessibility floor

The floor is **WCAG 2.2 AA**. These five are where it most often slips:

- Adding a role means implementing that role's keyboard and state behavior in full; native elements carry
  theirs already.
- Contrast is measured against the actual composited background, once per theme.
- Target size is 24 × 24 CSS px at minimum, about 44 by default.
- A state carries text, shape, or position in addition to color.
- A message that carries the only path to recovery stays until the user deals with it.

Done when: every rule this change touches passes, or is listed as failing with its location.

## Evidence grade

Every claim that "it is right" carries exactly one grade:

- **Measured**: taken directly by a tool or an action — computed style, DOM bounds, measured numbers, the
  result observed after actually operating the UI.
- **Derived**: a conclusion calculated from measured values, such as a contrast ratio.
- **Judged**: visual weight, balance, density, whether it looks good. This grade goes to a human: collect it
  into one **eyes-on list**, each item with a directly openable URL and the steps to reach it.
- **Unverified**: anything not actually looked at, with the reason.

Source code proves what was written, and an automated check proves that check; what was rendered takes
computed style or the screen. Scrutiny scales with the change: a half-pixel outline deserves a closer look
than a typo.

Done when: every claim in the report carries exactly one grade.

## Browser support policy

When the project's instruction files state a support range, follow it. Otherwise use **Baseline Widely
available** features directly, and give every other feature the fallback its `modern-web-guidance` guide
prescribes.

Done when: every feature used here that is not Widely available has a fallback, or a project policy that
allows going without one.
