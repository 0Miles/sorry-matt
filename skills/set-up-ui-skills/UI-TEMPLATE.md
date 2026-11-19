# ui.md template

Step 3 of `set-up-ui-skills` produces `docs/agents/ui.md` from this. All five sections are required; a section
with nothing to say reads "None" instead of being removed. Angle brackets mark what to replace.

```markdown
# UI

## Component library

- Package and version: `<package>@<version the lockfile resolves>`
- Loading: <the one import route, and where styles and providers are loaded>
- Bundled skill: <the skill in the available-skills list that belongs to it; "none" if there is none>
- Existing, not for new use: <the other library's package and version in the same package; delete this line when there is only one>

## Tokens

- Location: <path>
- Naming rule: <rule and one example>

## Shared components

| Component | Location | Use when | Instead | Wraps |
| --- | --- | --- | --- | --- |
| `<Name>` | `<path>` | <the job this component does> | <the component or approach to use when the job does not fit> | <the wrapped library component, or "—"> |

## Conventions

- Wrappers: <whether library components are wrapped, and the wrapper layer's naming and location>
- New shared components: go in `<path>`; come with <barrel export, types, story, or whatever the project requires>
- Duplicates: `<Name>` in `<losing path>` is not for new use; use `<source-of-truth path>` instead

## Mechanical checks

- lint: `<command>`
- typecheck: `<command>`
- test: `<command>`
- storybook: `<command>`
```

When the whole project uses no ready-made component library (no frontend package has one), the "Component
library" section is the single line "None".

When the frontend packages' libraries are not all the same (a monorepo; a package with no library counts), each
entry of the "Component library" section is one active library, with a "Scope" line giving the package paths it
covers; the packages with no library get one "None" entry holding only a "Scope" line.

- A library entry's "Scope" line lists only the packages where that library is **active** (new code uses it); a
  package that has it only as "Existing, not for new use" is not listed.
- When a "Scope" line lists several paths, each path gets its own backticks, separated by commas.
- Only packages with the same active library (or equally none) and the same "Existing, not for new use" marking
  merge into one entry, whose "Scope" line lists those packages' paths; packages whose marking differs each get
  their own entry, so one active library can have two entries.
- When one package has two libraries at once, "Existing, not for new use" is nested under the entry for the
  active one whose "Scope" is exactly the packages that have that old library; it applies only inside that
  entry's "Scope" and leaves the other entries alone.

```markdown
## Component library

- `<package A>@<version the lockfile resolves>`
  - Scope: `<path of package A>`
  - Loading: <package A's import route, and where styles and providers are loaded>
  - Bundled skill: <the skill that belongs to package A; "none" if there is none>
  - Existing, not for new use: `<package B>@<version the lockfile resolves>`
- `<package B>@<version the lockfile resolves>`
  - Scope: `<path of package B>`, `<path of package C>`
  - Loading: <package B's import route, and where styles and providers are loaded>
  - Bundled skill: <the skill that belongs to package B; "none" if there is none>
- None
  - Scope: `<path of the package with no component library>`
```

When every package's library is different and none repeats, each entry's "Scope" line holds one path; when no
package lacks a library, leave out the "None" entry.

A single-package project, or a monorepo where every frontend package's library is the same, writes no "Scope"
line and follows the first template; its format is unchanged.

The "Tokens" section, the "New shared components" line of "Conventions", the "Shared components" table, and the
"Mechanical checks" section are each judged on their own: one whose content is the same in every package follows
the first template and writes no "Scope"; one whose content differs between packages is written as below.
"Scope" is written the same way as in the "Component library" section.

- **Tokens**: one entry per distinct value: the top level is "Location: `<path>`", with "Scope" and "Naming rule"
  indented under it; the packages with no tokens get one "None" entry holding only a "Scope" line. Files of
  different packages never share one "Location" line.
- **New shared components**: one "New shared components" line per distinct value, each with a "Scope" line
  indented under it; the packages with no shared directory get one "New shared components: None" line holding
  only a "Scope" line.
- **Shared components table**: when some component cannot be used from every package, add a "Scope" column at
  the end of the table, each row giving the paths of the packages that can use that component; it is still one
  table, one row each, sorted by name.
- **Mechanical checks**: when one check's command differs between packages, write one line per distinct
  command, each with a "Scope" line indented under it; a package that lacks that check is not listed.

```markdown
## Tokens

- Location: `<path of the token file package A and package B share>`
  - Scope: `<path of package A>`, `<path of package B>`
  - Naming rule: <rule and one example>
- None
  - Scope: `<path of the package with no tokens>`

## Shared components

| Component | Location | Use when | Instead | Wraps | Scope |
| --- | --- | --- | --- | --- | --- |
| `<Name>` | `<path>` | <the job this component does> | <the component or approach to use when the job does not fit> | <the wrapped library component, or "—"> | `<path of package A>`, `<path of package B>` |

## Conventions

- Wrappers: <whether library components are wrapped, and the wrapper layer's naming and location>
- New shared components: go in `<package A's shared directory>`; come with <what package A requires>
  - Scope: `<path of package A>`
- New shared components: go in `<package B's shared directory>`; come with <what package B requires>
  - Scope: `<path of package B>`
- New shared components: None
  - Scope: `<path of the package with no shared directory>`
- Duplicates: `<Name>` in `<losing path>` is not for new use; use `<source-of-truth path>` instead

## Mechanical checks

- lint: `<the command every package shares>`
- typecheck: `<package A's command>`
  - Scope: `<path of package A>`
- typecheck: `<package B's command>`
  - Scope: `<path of package B>`
```

## Rules

- **One row each, sorted by name**: every row of the shared component table holds exactly one component, sorted
  alphabetically by name. When two tickets update it at once, a conflict lands only on the row of a component both
  actually touched.
- **Only the truly shared**: a component goes in the table only when two or more different pages or features use
  it; one used on a single page does not. The losing copy of a duplicate stays out of the table and goes in
  "Conventions".
- **A map, not props**: no props, variants, or class names; those are read from source every time.
- **Use when / Instead**: these map to `use` / `instead` in the component contract of master-co/ui's `master-ui`
  — the first is the job the component does, the second is the component or approach to switch to when the job
  does not fit.
- **Wraps**: the library component a wrapper wraps; "—" when it is not a wrapper.
- **Evidence first**: every line must trace to source, a config file, or the user's ruling, never a guess.
- **No checks that do not exist**: "Mechanical checks" lists only commands the project actually has.
