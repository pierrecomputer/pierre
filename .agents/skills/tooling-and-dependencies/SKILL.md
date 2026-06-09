---
name: tooling-and-dependencies
description:
  Use when running repo scripts, adding or changing dependencies, editing
  package.json files, installing packages, or deciding how Bun workspace
  commands should be invoked in this monorepo.
---

# Tooling and Dependencies

## Bun

- Use `bun` exclusively for commands and package operations.
- Do not use `npm`, `pnpm`, `npx`, or other package runners unless there is a
  specific reason and you explain it.
- Bun can run TypeScript directly, so local scripts may be `.ts` files without a
  separate compile step.

## Dependency Catalog

This monorepo uses Bun's `workspaces.catalog` in the root `package.json`.

- Never add a version directly to an individual package's `package.json` by
  default.
- To add a dependency:
  1. Add the exact version to the root `package.json` under
     `workspaces.catalog`, for example `"new-package": "1.2.3"`.
  2. Reference it from the package with `"new-package": "catalog:"`.
- Do not run `bun add <package>` inside a package directory; it writes direct
  versions and breaks the catalog pattern.
- Published packages may intentionally use ranges for end-user compatibility.
  `apps/docs` should use catalog versions; published packages such as
  `packages/diffs` may use ranges only when that is intentional.

## Scripts

- Package scripts should work from the package directory.
- Common scripts may be mirrored at the root as shortcuts. A root mirror should
  not behave differently from the package script it wraps.
- Use the workspace runner when convenient:

```bash
bun ws <project> <task>
bun ws <project> <task> --some --flag
```

`bun ws` forwards arguments to the target script and does not require a
standalone `--` separator. The only special handling is that `-v` and
`--verbose` are consumed by `scripts/ws.ts`.
