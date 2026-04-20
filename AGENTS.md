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
- Since we use `bun` we can natively run TypeScript without compilation. So even
  local scripts we run can be `.ts` files.
- We use Bun's `catalog` feature for dependencies in order to reduce differences
  in dependencies across monorepo packages.
  - **CRITICAL: NEVER add a version number directly to a package's**
    `package.json`. Always follow this two-step process:
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
  the root scripts should not do something different than the package-level
  script, it's simply a shortcut to calling it from the root.

## Worktrees

We use `git worktree` to parallelize work. Each worktree lives at
`~/pierre/pierre-worktrees/<slug>/` and owns a **port offset** so dev servers,
E2E fixtures, and the Chrome remote-debug instance don't collide across
worktrees. The main clone keeps the historical default ports; only worktrees
shift.

The `bun run wt` command suite (defined in `scripts/wt.ts`) manages worktrees:

```bash
bun run wt new <slug>    # create a worktree, allocate offset, bun install
bun run wt rm <slug>     # kill its processes, remove the worktree
bun run wt clean         # kill zombie servers on all worktrees' ports
bun run wt ps            # show per-worktree port status (LISTEN / —)
bun run wt list          # summary of all worktrees (managed + external)
```

Dev scripts inside a worktree automatically pick up the offset through
`scripts/ws.ts`, which reads `<worktree>/.env.worktree` when invoked. Before
starting, they run `scripts/run-dev.sh` to kill any stale process bound to the
target port (zombies survive uncleanly-closed terminals, which is common under
AI agents).

**Cleanup contract for agents.** If you spin up dev servers, Playwright
fixtures, or Chrome debug instances inside a worktree, **you must run
`bun run wt clean` (or `bun run wt rm <slug>` if the worktree itself is being
torn down) before completing your turn.** This releases ports and kills spawned
processes so they don't accumulate across runs. Running `wt clean` with no
arguments cleans every managed worktree; prefer the targeted `wt clean <slug>`
when you know which worktree you were working in.

## Linting

We use `oxlint` at the root of the monorepo rather than per-package lint setups.

Run linting from the monorepo root:

```bash
bun run lint
bun run lint:fix
```

For CSS, we use `stylelint`:

```bash
bun run lint:css
bun run lint:css:fix
```

## Code formatting

We use `oxfmt` at the root of the monorepo.

Check formatting from the monorepo root:

```bash
bun run format:check
```

Apply formatting from the monorepo root:

```bash
bun run format
```

**Important:** Always run `bun run format` from the monorepo root after making
changes to ensure consistent formatting.

- Always preserve trailing newlines at the end of files.

## TypeScript

We use TypeScript everywhere possible and prefer fairly strict compiler
settings.

All projects should individually respond to `bun run tsc` for typechecking, but
many of those scripts are implemented with `tsgo` rather than plain `tsc`.

Shared compiler options live in the root `tsconfig.options.json` file.

The root `tsconfig.json` file is used to manage project references across the
monorepo.

We use project references between packages and apps.

- When adding a new package or app, update the root `tsconfig.json` references.
- When a package depends on another `workspace:` package, add the dependency to
  the consuming package's `references` block when needed for accurate and fast
  typechecking.

## Code readability

- When adding non-trivial helper functions, prefer a short comment directly
  above the function declaration that explains, in plain language, what the
  helper does and why it exists.
- Write these comments as if the reader is new to the codepath. Avoid vague
  shorthand like "snapshot" unless you immediately explain what data is being
  captured or derived.
- Prefer function-level comments over a lot of inline comments. Use inline
  comments only when a specific step inside the function is still non-obvious.
- Keep comments concrete and behavior-focused. Good comments usually explain
  what data is being transformed, what invariant is being checked, or what the
  helper is protecting against.

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

`bun ws <project> <task>` `bun ws <project> <task> --some --flag`

`bun ws` forwards arguments through to the target script and does **not
require** a standalone `--` to separate its own options from task arguments. You
may still use `--` when a downstream tool expects it (for example, when using
`bun run` with glob filters). The only special handling is that `-v` /
`--verbose` is consumed by `ws.ts` itself and not forwarded on.

Note that a few scripts exist at the root and usually operate against all
packages. e.g. `bun run lint`

## Testing

We use Bun's built-in test runner for unit and integration tests. Tests usually
live in a `test/` folder within each package, separate from the source code.

Some packages also include browser-level tests. In particular, `packages/trees`
has Playwright E2E coverage for browser-specific behavior.

### Test Strategy

- Prefer unit/integration tests (`bun test`) by default.
- Add Playwright/browser E2E tests only when behavior cannot be validated
  without a real browser engine.
- Good Playwright candidates include computed style checks, shadow DOM
  encapsulation boundaries, and browser-only rendering behavior.
- Keep E2E coverage intentionally small and high-value.
- Prefer explicit assertions over broad snapshots.
- Avoid snapshot tests unless they are shallow and narrowly scoped to the exact
  behavior under test.

### Running Tests

Examples (run these from the package directory):

```bash
# diffs
cd packages/diffs && bun test

# trees
cd packages/trees && bun test
cd packages/trees && bun run coverage
cd packages/trees && bun run test:e2e

# truncate
cd packages/truncate && bun test
```

### Updating Snapshots

Update snapshots from the package directory:

```bash
bun test -u
```

### Test Structure

- Tests use Bun's native `describe`, `test`, and `expect` from `bun:test`
- Snapshot testing is supported natively via `toMatchSnapshot()`
- Test helpers and fixtures usually live alongside each package's tests
- For example, `packages/diffs/test/mocks.ts` contains shared mocks for diffs
  tests

## Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all
commands.

Core workflow:

1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes
