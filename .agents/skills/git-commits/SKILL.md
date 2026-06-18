---
name: git-commits
description:
  Use when preparing, splitting, reviewing, or creating git commits in this
  repo, especially after larger implementations that should be broken into
  independently verified commits.
---

# Git Commits

## Message Style

Use the following commit message template:

```
<type>(<scope>): <subject>

<description>
```

- The <type> can be: agents, chore, ci, docs, feat, fix, perf, refactor, test,
  tool.
- The <scope> can be a project, package, or app name; omit the scope and its
  wrapped parens if none is clear.
- Write the <subject> and the first paragraph in plain, concrete language a
  teammate could understand without knowing the internals. Keep jargon and
  implementation detail for later in the body.
- For `fix` and `feat` commits, structure the body so a reviewer can picture and
  reproduce the change before the technical explanation. See "Writing the
  description".
- Include a description body for every commit unless the staged change is truly
  mechanical or trivial and the subject fully explains it.
- Keep every commit message line 72 characters or fewer. Hard-wrap body text to
  72 columns before committing; do not leave long single-line descriptions.
- Use imperative mood; be concise
- Include user-provided context when it improves the message
- Do not include AI attribution in or after the description
- Do not narrate your own process or verification. Leave out test results, pass
  counts, and "verified with ..." notes.

## Writing the Description

For a `fix` or `feat`, lead with the flow, then explain the code:

1. **The flow.** The concrete situation in plain language — for a bug, the steps
   to reproduce and the wrong behavior; for a feature, what someone does and can
   now see or do.
2. **The cause and the change.** What was wrong or missing, and how this commit
   fixes it.

Skip step 1 when there is no flow, such as a refactor or dependency bump.

## Commit Boundaries

Each commit should be independently understandable and shippable.

- Split unrelated behavior, package areas, generated artifacts, and dependency
  bumps into separate commits.
- For larger implementations, commit in vertical slices: tests or fixtures,
  implementation, docs/examples, and follow-up polish can be separate only when
  each commit still makes sense on its own.
- Do not mix mechanical formatting with behavioral changes unless the formatter
  only touched the files required for that change.
- Do not include local artifacts from `.agents/ignore/`, `.context/`, logs,
  build outputs, or editor files.
- Before committing, inspect staged changes with `git diff --cached` and make
  sure every staged file belongs to the commit's stated purpose.

If two changes would need different test commands or different reviewers, they
usually deserve different commits.

## Verification Before Each Commit

Verify every commit before creating it. Keep verification out of the message —
status, test output, and pass counts go in the handoff, not the commit body.

If the full baseline fails for unrelated pre-existing issues, say that in the
commit handoff and include the first relevant failure. Do not describe the
commit as fully verified unless the required commands actually passed.

## Creating Commits

Use non-interactive commands where possible:

```bash
git status --short
git diff -- <paths>
git add <paths>
git diff --cached
git commit -m "<message>"
```

Include a wrapped commit body for ordinary source changes:

```bash
git commit -F - <<'COMMIT'
fix(diffs): Keep scroll focus stable

Scroll a long diff with the keyboard, then press an arrow key: the
selection jumps to a row other than the one highlighted.

Track the active item by stable id instead of screen position so it
survives row recycling.
COMMIT
```

Use a subject-only commit only for changes where no useful description exists,
such as a typo fix or a purely mechanical formatting commit.
