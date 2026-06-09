# PierreJS Monorepo

## Agent Environment

Set `AGENT=1` at the start of every terminal session so Bun's test runner emits
AI-friendly output:

```bash
export AGENT=1
```

## Core Rules

- Use `bun` for commands and dependency work. Do not use `npm`, `pnpm`, `npx`,
  or similar tools unless there is a specific reason.
- Dependencies use Bun's root `workspaces.catalog`. Never add dependency
  versions directly to package-level `package.json` files unless a published
  package intentionally needs its own range.
- Run commands from the monorepo root when they operate across the repo. Use
  package directories for package-local scripts, or use
  `bun ws <project> <task>` as the root shortcut when that fits the task.
- Preserve trailing newlines at the end of files.

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
the monorepo root:

```bash
bun run format
bun run lint
```

Also run the relevant package-level `bun run tsc` and focused tests for the
changed area. For docs-only or AGENTS/skill-only changes, formatting and linting
are sufficient unless the edit touches executable code or package config.

## Code Readability

- When adding non-trivial helpers, prefer a short comment directly above the
  function explaining what the helper does and why it exists.
- Write comments for readers new to the codepath. Avoid vague shorthand like
  "snapshot" unless you immediately explain what data is captured or derived.
- Prefer function-level comments over many inline comments. Use inline comments
  only when a specific step is still non-obvious.
- Keep comments concrete and behavior-focused.
