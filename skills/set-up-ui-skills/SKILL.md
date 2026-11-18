---
name: set-up-ui-skills
description: Create docs/agents/ui.md for a frontend project (component library, tokens, shared components, conventions, mechanical checks) and add a UI subsection to the instructions file's Agent skills block. Run once before the frontend skills.
disable-model-invocation: true
---

# Set up UI skills: Build the component map the frontend skills read

Create the project parameters the frontend skills read, `docs/agents/ui.md`: the **component library** the
project uses (which may be "none"), tokens, **shared components**, conventions, and mechanical checks. Then add a
`### UI` subsection pointing to it under the `## Agent skills` block of the project's **instructions file**
(`CLAUDE.md` or `AGENTS.md`).

`ui.md` is a map, not an API: it records only what exists, where it lives, when to use it, and what to use
instead. It never copies props or variants — those are read from source every time.

Five steps: explore → present findings and questions at once → confirm the draft → write → report. Only steps 2
and 3 wait on the user.

## 1. Explore

Assume nothing: read every item from the repo, and record "none" for anything not found. In a monorepo, check
each frontend package separately.

- **Dependencies and versions**: dependencies and devDependencies in `package.json`, and the versions the lockfile
  actually resolves. Find the **component library** among them — any package that ships ready-made components,
  headless ones included (for example MUI, Ant Design, Radix, Headless UI, Vuetify, Master UI). A package that
  ships only utility classes or icons is not one; record it as a tokens or conventions finding.
- **Component library config**: for example `components.json`, a theme provider, or the library's own config
  file. Read the loading route from it (the import path, and where styles and providers are loaded).
- **Agent skills bundled with the library**: for each library detected, check the current list of available
  skills for one that belongs to it (its name or description points at the library, such as Master UI's
  `master-ui`). Decide this from the available-skills list only.
- **Shared component directories**: common locations such as `src/components/`, `components/ui/`,
  `src/shared/`, `app/components/`, `packages/ui/`; go by what actually exists in the repo.
- **Barrel exports**: which components the shared directories' `index.ts` or `index.js` re-export.
- **Import counts**: for each candidate component, how many distinct files import it, spread over how many pages
  or features.
- **Duplicate implementations**: components with the same name or purpose in two or more places (for example two
  `Button`s).
- **Storybook**: whether `.storybook/` exists, and which components have `*.stories.*`.
- **Tokens and theme files**: design tokens, theme objects, files defining CSS custom properties, a utility
  framework's theme config; record their location and naming rule.
- **Wrapper convention**: whether shared components wrap library components, and how the wrapper layer is named
  and where it lives.
- **Lint rules restricting imports**: for example `no-restricted-imports`, `no-restricted-syntax`, or
  boundaries-style rules that forbid deep imports or importing the library directly.
- **Mechanical checks**: the lint, typecheck, test, and storybook commands in the `package.json` scripts.
- **Existing output**: whether `docs/agents/ui.md` exists; whether `CLAUDE.md` and `AGENTS.md` exist at the repo
  root, which one has an `## Agent skills` block, and whether that block already has a `### UI` subsection.

Done when: every item above has a finding or an explicit "none"; every shared component candidate has an import
count; every finding cites its source file path.

## 2. Present findings and questions at once

Put the findings and the questions in one message for the user to rule on at once: findings first, then
questions. Every question carries a **recommended answer** with a one-line basis, so the user can reply "as
recommended". Questions come only from the rules below; where a rule says not to ask, do not ask.

**A. Component library.**

- None detected → record "none"; do not ask.
- One detected → record it as the evidence shows; do not ask.
- Two or more detected → ask which one new code uses. Recommended answer: the one a lint rule restricting imports
  or a migration note points to; otherwise the one with more imports. Record the others as "existing, not for new
  use".

**B. Shared components.** List the candidates by import count; this is a finding, not a question. Include only the
truly shared: components used by two or more different pages or features; one used on a single page is not
listed. The only question is about duplicate implementations: one question per group, "which copy is the source
of truth, and which one wins", unless an existing `ui.md` already records the ruling for that group and the
evidence still matches it. Recommended answer: the one with more imports; when the counts are close, the one in
a shared directory, with a story, or with a barrel export.

**C. Conventions.** Wrapper convention, where new shared components go, what they must come with (barrel export,
types, story), and the mechanical check commands: where there is evidence, write what it shows and do not ask. Ask
only when the evidence disagrees with itself (for example two shared directories both gaining new components, or
half the components with stories and half without); the recommended answer is the practice recent commits follow.

**Existing `ui.md`.** On a re-run, use it as the base for comparison: content that matches the evidence, or that
the evidence does not speak to (usually a manual edit), stays as written and raises no question. Content the
evidence contradicts (for example a recorded component whose file no longer exists) gets one question per spot,
with the evidence in the recommended answer.

**Instructions file.** When neither `CLAUDE.md` nor `AGENTS.md` exists, ask which one to create; the recommended
answer is the one the current runtime reads natively. When either exists, do not ask.

When there are no questions at all, say "no questions need a ruling" and show the step 3 drafts in the same
message.

Done when: the findings and every question go out in one message; every question has a recommended answer and its
basis; the question list holds none that a rule says not to ask (no library or only one, no duplicated
component or one an existing `ui.md` already ruled on, no conflicting convention, an instructions file that already exists).

## 3. Confirm the draft

Using [`UI-TEMPLATE.md`](UI-TEMPLATE.md) and the user's rulings, show two drafts:

- The full text of `docs/agents/ui.md`; on a re-run, also the diff against the existing version.
- The `### UI` subsection for the instructions file, naming which file it goes into and whether it is added or
  updated in place:

```markdown
### UI

<one-line summary: the component library (or "none") and where shared components live>. See `docs/agents/ui.md`.
```

The user may edit the drafts directly; an edited version replaces the draft and is shown again, until the user
approves.

Done when: the user has explicitly approved the final version of both drafts.

## 4. Write

**`ui.md`**: write it to `docs/agents/ui.md`, creating the directory if needed. When the file already exists,
update it in place: change only the sections and table rows that changed in the draft, leave all other text
(manual edits included) exactly as it was, and never append a second copy at the end.

**Instructions file**:

- If `CLAUDE.md` exists, edit it.
- Otherwise, if `AGENTS.md` exists, edit it.
- If neither exists, create the one the user chose in step 2.

When one exists, never create the other. Inside the chosen file's `## Agent skills` block: if a `### UI`
subsection exists, update it in place; otherwise add it at the end of the block. When there is no
`## Agent skills` block, add the block and the subsection at the end of the file. Leave everything outside the
block, and the block's other subsections, untouched.

Do not commit; when to commit is the user's call.

Done when: `docs/agents/ui.md` has all five sections and matches the approved draft; the instructions file has
exactly one `## Agent skills` block holding exactly one `### UI` subsection; all pre-existing content outside the
drafts is unchanged, word for word.

## 5. Report

- Which files were written or updated, and which instructions file was edited.
- The frontend skills that read `ui.md`: `figure-out-the-ui`, `build-the-ui-right`, `actually-look-at-the-ui`,
  `make-the-ui-fast`, `make-this-shit-pretty`.
- `ui.md` can be edited directly from now on; re-running this skill is only needed to start over.

Done when: the report lists the paths written and those five frontend skills, and says that `ui.md` can be edited
directly and that a re-run is only needed to start over.
