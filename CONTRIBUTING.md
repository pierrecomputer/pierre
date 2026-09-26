# Contributing

This monorepo uses [proto](https://moonrepo.dev/docs/proto) to manage the
toolchain and [moon](https://moonrepo.dev/docs) to run tasks. Every tool version
(bun, pnpm, node, moon, gh) is pinned in `.prototools`, so once proto is
installed, everything else resolves to the right version automatically when you
are inside the repo.

## Setup

1. **Install proto**
   ([official guide](https://moonrepo.dev/docs/proto/install)):

   ```bash
   curl -fsSL https://moonrepo.dev/install/proto.sh | bash
   ```

   Restart your shell afterwards so proto's shims are on your `PATH`.

2. **Install git-lfs** ([git-lfs.com](https://git-lfs.com)) — the repo stores
   large fixtures in LFS and the pre-push hook enforces it:

   ```bash
   brew install git-lfs   # or your platform's package manager
   git lfs install
   ```

3. **Clone and install the toolchain** — from the repo root, proto reads
   `.prototools` and installs the pinned bun, pnpm, node, moon, and gh:

   ```bash
   git clone git@github.com:pierrecomputer/pierre.git
   cd pierre
   proto use
   ```

   (`.prototools` has `auto-install = true`, so simply running `pnpm`, `bun`, or
   `moon` also installs them on demand.)

4. **Install dependencies**:

   ```bash
   pnpm install
   ```

   Dependency versions live in the `pnpm-workspace.yaml` catalog; packages
   reference them with `"catalog:"`. Don't add versions directly to
   package-level manifests.

5. **Git hooks** are managed by moon (`vcs.hooks` in `.moon/workspace.yml`) and
   are generated automatically by the first moon command you run — no install
   step. Pre-commit typechecks the projects affected by your staged files and
   runs lint-staged; pre-push runs the git-lfs guard.

## Running tasks

moon is the only task runner; `package.json` scripts exist solely for npm
lifecycle hooks. Tasks run from anywhere in the repo:

```bash
moon run <project>:<task>      # e.g. moon run trees:build
moonx <project>:<task>         # shorthand
moonx trees:benchmark -- -h    # forward arguments after --
moon run :test                 # run a task across every project that has it
moon tasks <project>           # discover a project's tasks
moon project <project>         # inspect a project's config and dependencies
```

moon builds dependency projects first, caches outputs, and skips tasks whose
inputs haven't changed.

Common entry points:

| Task                                            | What it does                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------ |
| `moonx docs:dev-diffs` / `moonx docs:dev-trees` | Docs site dev server (diffs/trees variant) with dependency watchers            |
| `moonx demo:dev` / `moonx diffshub:dev`         | Demo / diffshub dev servers                                                    |
| `moonx <package>:test`                          | Unit tests for one package                                                     |
| `moonx <project>:typecheck`                     | Typecheck (builds workspace deps first)                                        |
| `moonx trees:test-e2e`                          | Trees Playwright suite                                                         |
| `moon run root:format root:lint`                | Repo-wide format + type-aware lint                                             |
| `moonx root:wt -- new <slug>`                   | Create a git worktree with isolated dev-server ports (see `scripts/README.md`) |

## Diffshub GitHub sign-in

Diffshub posts file and line comments to GitHub without approvals or general
pull request comments. Pull requests accept file comments and line ranges.
Commit pages accept single-line comments.

1. Register a GitHub OAuth app for your Diffshub server.
2. Set its callback URL to `<origin>/api/auth/github?callback=1`. The default
   local origin is `http://localhost:3692`. Worktrees use their assigned port.
3. Set these variables in `apps/diffshub/.env.local`, or in the deployment
   environment:

   | Variable                     | Value                                                      |
   | ---------------------------- | ---------------------------------------------------------- |
   | `GITHUB_OAUTH_CLIENT_ID`     | OAuth app client ID                                        |
   | `GITHUB_OAUTH_CLIENT_SECRET` | OAuth app client secret                                    |
   | `GITHUB_SESSION_SECRET`      | A random secret with at least 32 characters                |
   | `GITHUB_OAUTH_ORIGIN`        | Public origin when a reverse proxy changes the request URL |

4. Generate the session secret with `openssl rand -hex 32`.
5. Restart the server after changes to these variables.

GitHub OAuth uses the `repo` scope for comments on public and private
repositories. Diffshub stores the token in an encrypted, HttpOnly session
cookie. Production requires HTTPS. A different session secret signs out existing
users. Without OAuth credentials, users can still view diffs.

For a remote development preview, set `DIFFSHUB_DEV_HOST` to the permitted
hostname without a protocol or port. This variable controls Next.js development
asset access, not OAuth redirects.

## Before you push

```bash
moon run root:format root:lint
moon exec :typecheck --affected
```

plus the focused tests for whatever you changed (`moonx <project>:test`). CI
runs the affected portion of the graph (`moon ci --include-relations`), so a
green local baseline usually means a green PR.

## Repo conventions

- Agent-facing rules and the verification baseline live in `AGENTS.md`; deeper
  domain conventions live in `.agents/skills/`.
- Worktrees, dev-server port offsets, and stale-server cleanup are documented in
  `scripts/README.md`.
- Publishing `@pierre/trees` goes through its release script — see
  `packages/trees/PUBLISHING.md`. Other published npm packages use
  `pnpm publish`, which runs their moon `prepublish` guard chain automatically.
- Vercel deploys read each app's `vercel.json` from the deploying commit; CI
  configuration lives in `.github/workflows/ci.yml`.
