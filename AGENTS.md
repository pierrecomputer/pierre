# PierreJS Monorepo

## Agent Environment

You must set `AGENT=1` at the start of any terminal session to enable
AI-friendly output from Bun's test runner:

```bash
export AGENT=1
```

## Tooling

- We exclusively use `bun` to run commands and install packages. Don't use `npm`
  or `pnpm` or `npx` or other variants unless there's a specific reason to break
  from the norm.
- Since we use `bun` we can natively run typescript without compilation. So even
  local scripts we run can be .ts files.
- We use bun's `catalog` feature for dependencies in order to reduce differences
  in dependencies across monorepo packages.
  - **CRITICAL: NEVER add a version number directly to a package's
    package.json.** Always follow this two-step process:
    1. First, add the dependency with its exact version to the root
       `package.json` file inside `workspaces.catalog` (e.g.,
       `"new-package": "1.2.3"`)
    2. Then, in the individual package's `package.json`, reference it using
       `"catalog:"` (e.g., `"new-package": "catalog:"`)
  - **NEVER run `bun add <package>` inside a package directory** - this will add
    a version number directly which breaks our catalog pattern.
  - This rule is sometimes broken in packages that are published, in order to
    make sure that end-users aren't forced to our specific version. `apps/docs`
    would use the catalog version and `diffs` _may_ choose to use a range.
- npm "scripts" should work from inside the folder of the given package, but
  common scripts are often "mirrored" into the root `package.json`. In general
  the root scripts should not do something different than the package level
  script, it's simply a shortcut to calling it from the root.

## Linting

We have `eslint` installed at the _root_ of our monorepo, rather than per
package. To lint our code, you'd typically run `bun run lint` from the root. You
can filter from there as well with the typical commands.

You can run eslint's autofix command with `bun run lint:fix` from the root as
well.

## Code formatting

We have `prettier` installed at the root as well. You can check our code
formatting compliance with `bun run format:check` from the monorepo root.

You can use prettier's 'autofix' functionality by running `bun run format`

**Important:** Always run `bun run format` from the monorepo root after making
changes to ensure consistent formatting.

- Always preserve trailing newlines at the end of files.

## Typescript

We use typescript everywhere possible and try to stick to fairly strict types,
which are then linted with typescript powered eslint.

All projects should individually respond to `bun run tsc` for typechecking.

We use a root `tsconfig.json` file that every single project inherits from.

We use project references between each of our packages and apps.

- We always want to make sure that we are updating the root `tsconfig.json` file
  to reference any new or renamed package or app in our monorepo
- We always want to make sure that if a package has a dependency on another
  `workspace:` package, that the dependent package is added to the `references`
  block of the consuming package. This ensures fast and accurate type checking
  without extra work across all packages.

## Performance

**CRITICAL: Avoid nested loops and O(n²) operations.**

- When iterating over collections, calculate expensive values ONCE before the
  loop, not inside it
- Never nest loops unless absolutely necessary - it's expensive and usually
  there's a better way
- If you need to check conditions on remaining elements, scan backwards once
  upfront instead of checking inside the main loop

Example of BAD code:

```typescript
for (let i = 0; i < items.length; i++) {
  // DON'T DO THIS - nested loop on every iteration
  let hasMoreItems = false;
  for (let j = i + 1; j < items.length; j++) {
    if (items[j].someCondition) {
      hasMoreItems = true;
      break;
    }
  }
}
```

Example of GOOD code:

```typescript
// Calculate once upfront
let lastMeaningfulIndex = items.length - 1;
for (let i = items.length - 1; i >= 0; i--) {
  if (items[i].someCondition) {
    lastMeaningfulIndex = i;
    break;
  }
}

// Now iterate efficiently
for (let i = 0; i <= lastMeaningfulIndex; i++) {
  const isLast = i === lastMeaningfulIndex;
  // ...
}
```

## Running scripts

We use a custom workspace script runner to make typing things out a little
easier.

`bun ws <project> <task>` `bun ws <project> <task> -- --some --flag`

Note that a few scripts exist at the root and usually operate against all
packages. e.g. `bun run lint`

## Testing

We use Bun's built-in testing framework for unit tests. Tests are located in a
`test/` folder within each package, separate from the source code.

### Running Tests

For the diffs package:

```bash
# From the package directory
bun test

# From the monorepo root
bun ws diffs test
```

### Updating Snapshots

When test snapshots need to be updated:

```bash
# From the package directory
bun test -u

# From the monorepo root
bun ws diffs update-snapshots
```

### Test Structure

- Tests use Bun's native `describe`, `test`, and `expect` from `bun:test`
- Snapshot testing is supported natively via `toMatchSnapshot()`
- Shared test fixtures and mocks are located in `test/mocks.ts`
- Test files are included in TypeScript type checking via `tsconfig.json`

## Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all
commands.

Core workflow:

1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes
