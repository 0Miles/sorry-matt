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

When the project uses no ready-made component library, the "Component library" section is the single line "None".

When different packages each use one component library (a monorepo), the "Component library" section has one entry
per library, each with a "Scope" line giving the package path it covers; every one is active. When one package has
two at once, "Existing, not for new use" goes under that package's entry:

```markdown
## Component library

- `<package A>@<version the lockfile resolves>`
  - Scope: `<path of package A>`
  - Loading: <package A's import route, and where styles and providers are loaded>
  - Bundled skill: <the skill that belongs to package A; "none" if there is none>
- `<package B>@<version the lockfile resolves>`
  - Scope: `<path of package B>`
  - Loading: <package B's import route, and where styles and providers are loaded>
  - Bundled skill: <the skill that belongs to package B; "none" if there is none>
```

A single-package project writes no "Scope" line and follows the first template; its format is unchanged.

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
