# PierreJS Monorepo

## Agent Environment

Set `AGENT=1` at the start of every terminal session so Bun's test runner emits
AI-friendly output:

```bash
export AGENT=1
```

Most local moon tasks (formatters, benchmarks, worktree management) are
configured with `runInCI: 'always'` so they keep working in CI-marked shells
like agent harnesses. Tasks connected to the build graph (dev servers, prod
serves, e2e variants, publish guards) stay CI-skipped — run those with
`moonx <target> --ignore-ci-checks`, e.g.
`moonx docs:dev-diffs --ignore-ci-checks`. For non-moon commands that CI-gate
themselves, unset the var: `CI= pnpm publish --dry-run`.

## Toolchain

- Tool versions (bun, pnpm, node, moon, gh) are pinned in `.prototools` and
  managed by [proto](https://moonrepo.dev/docs/proto); run `proto use` if a tool
  is missing or a pin changed. Never install toolchain versions globally; bump
  pins only in `.prototools`.
- [moon](https://moonrepo.dev/docs) is the task runner; `package.json` scripts
  are npm lifecycle hooks only.

## Core Rules

- Use `pnpm` for install/add/remove/dedupe/package-manager and publishing work.
  Do not use `bun`, `npm`, `yarn`, `npx`, or similar tools for package
  operations unless there is a specific reason.
- Dependencies use the `catalog` in `pnpm-workspace.yaml`. Never add dependency
  versions directly to package-level `package.json` files unless a published
  package intentionally needs its own range.
- Run tasks through moon: `moon run <project>:<task>` (or the `moonx` shorthand)
  works from anywhere in the repo. `moonx <project>:<task> -- args` forwards
  arguments. Discover tasks with `moon tasks <project>`.
- Preserve trailing newlines at the end of files.
- Setup steps for a fresh clone live in `CONTRIBUTING.md`.

## Licensing

Every package in this repo is licensed under Apache 2.0. When adding a new
package under `packages/*` or `apps/*`:

- Set `"license": "apache-2.0"` in its `package.json`.
- Add an Apache 2.0 `LICENSE.md` at the package root — copy one from an existing
  package (e.g. `packages/trees/LICENSE.md`).

Vendored third-party code keeps its original license; record that attribution in
a `NOTICE.md` next to the package rather than changing its LICENSE.

`moon run root:check-licenses` enforces both requirements and runs in CI on
every PR.

## Skills

Domain-specific context and conventions live in `.agents/skills/`. Before
starting any task:

1. List `.agents/skills/*/SKILL.md`
2. Read only each skill's frontmatter description to identify relevant skills
3. Read only the full `SKILL.md` files relevant to your task

Do not load skills that are not relevant to the task.

## Agent Artifacts

Write agent-only planning and scratch artifacts under `.agents/ignore/` by
default:

- Plans: `.agents/ignore/plans/YYYY-MM-DD-<topic>.md`
- Specs: `.agents/ignore/specs/YYYY-MM-DD-<topic>.md`

`.agents/ignore/` is gitignored. Do not put source files, tests, or committed
documentation there.

## Verification Baseline

After code changes, verification is not complete until you have run these from
anywhere in the repo:

```bash
moon run root:format root:lint
```

Also run the affected typecheck and focused tests for the changed area, e.g.
`moonx <project>:typecheck` and `moonx <project>:test` (or
`moonx :typecheck --affected`). For docs-only or AGENTS/skill-only changes,
formatting and linting are sufficient unless the edit touches executable code or
package config.

## Code Readability

- When adding non-trivial helpers, prefer a short comment directly above the
  function explaining what the helper does and why it exists.
- Write comments for readers new to the codepath. Avoid vague shorthand like
  "snapshot" unless you immediately explain what data is captured or derived.
- Prefer function-level comments over many inline comments. Use inline comments
  only when a specific step is still non-obvious.
- Keep comments concrete and behavior-focused.
