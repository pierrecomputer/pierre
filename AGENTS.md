# PierreJS Monorepo

## Tooling

- We exclusively use `bun` to run commands and install packages. Don't use `npm` or `pnpm` or `npx` or other variants unless there's a specific reason to break from the norm.
- Since we use `bun` we can natively run typescript without compilation. So even local scripts we run can be .ts files.
- We use bun's `catalog` feature for dependencies in order to reduce differences in dependencies across monorepo packages.
  - When adding a new dependency, we typically will add the exact most recent version to the root `package.json` file in the `catalog` and then in our individual packages we'd use the `"catalog:"` version instead of a specific version.
  - This rule is sometimes broken in packages that are published, in order to make sure that end-users aren't forced to our specific version. `apps/docs` would use the catalog version and `precision-diffs` _may_ choose to use a range.
- npm "scripts" should work from inside the folder of the given package, but common scripts are often "mirrored" into the root `package.json`. In general the root scripts should not do something different than the package level script, it's simply a shortcut to calling it from the root.

## Linting

We have `eslint` installed at the _root_ of our monorepo, rather than per package. To lint our code, you'd typically run `bun run lint` from the root. You can filter from there as well with the typical commands.

You can run eslint's autofix command with `bun run lint:fix` from the root as well.

## Code formatting

We have `prettier` installed at the root as well. You can check our code formatting compliance with `bun run format:check` from the monorepo root.

You can use prettier's 'autofix' functionality by running `bun run format`

## Typescript

We use typescript everywhere possible and try to stick to fairly strict types, which are then linted with typescript powered eslint.

All projects should individually respond to `bun run tsc` for typechecking.

We use a root `tsconfig.json` file that every single project inherits from.

We use project references between each of our packages and apps.

- We always want to make sure that we are updating the root `tsconfig.json` file to reference any new or renamed package or app in our monorepo
- We always want to make sure that if a package has a dependency on another `workspace:` package, that the dependent package is added to the `references` block of the consuming package. This ensures fast and accurate type checking without extra work across all packages.
