# scripts/

This folder contains the small set of scripts that drive day-to-day development
in the monorepo. Tasks (build/dev/test/lint) are run by moon —
`moon run <project>:<task>` / `moonx <project>:<task>` from anywhere in the repo
— and the scripts here cover what a task runner doesn't:

- `wt.ts` — manage `git worktree`s and their port isolation (exposed as the
  `root:wt` moon task).
- `run-dev.sh` — kill-before-start preamble for dev-server tasks.
- `chrome-remote-debug.sh` — launches Chrome Dev with the DevTools protocol
  enabled, worktree-aware (exposed as `root:chrome`).
- `load-worktree-env.mjs` — `.env.worktree` loader for configs that run outside
  a moon task (Next/Playwright configs).
- `build-sprite.js`, `assert-pnpm-version.ts` — codegen/publish helpers behind
  the `root:icons` task and the publishable packages' `prepublish` chain.

The rest of this document explains `wt` in detail and walks through the most
common workflows.

## `wt` — the worktree command suite

`wt` manages sibling worktrees of the main clone so you can work on multiple
branches in parallel without port collisions, zombie dev servers piling up, or
browser tabs you can't tell apart.

Every worktree managed by `wt` lives at:

```
~/pierre/pierre-worktrees/<dir>/
```

where `<dir>` is the slug with any `/` characters replaced by `-`. Worktrees the
tool didn't create (e.g. agent-spawned ones under `.omx/worktrees/` or
`/private/tmp/`) are left alone.

### Subcommands at a glance

```bash
moonx root:wt -- new <slug> [--branch <name>] [--base <ref>]
moonx root:wt -- setup [<slug>]
moonx root:wt -- rm  <slug> [--keep-branch] [--force]
moonx root:wt -- clean [<slug>|--all]
moonx root:wt -- ps
moonx root:wt -- list
```

### `wt new <slug>` — create a worktree

Creates a new worktree rooted at `~/pierre/pierre-worktrees/<slug>/`, on a fresh
branch, with ports that won't collide with any other worktree's.

By default:

- Branch name is `$USER/<slug>` (e.g. `alex/fix-drag-drop`).
- Base ref is `main`.
- A port offset is picked (see "Ports" below), deterministic from the slug but
  bumped if it collides with an existing worktree.
- `.env.worktree` is written at the worktree root with the offset and slug.
  Configs that need those keys outside of a moon task (Next's `next.config.mjs`,
  each Playwright config, `chrome-remote-debug.sh`) load the file themselves via
  `scripts/load-worktree-env.mjs` / the inlined bash walk-up. The browser tab
  title prefix reads `NEXT_PUBLIC_WORKTREE_SLUG`, which `next.config.mjs`
  bridges from `PIERRE_WORKTREE_SLUG` so `.env.worktree` stays the single source
  of truth.
- `pnpm install` runs automatically so the worktree's `node_modules` is ready;
  moon syncs its git hooks on the first moon command in the worktree.
- A summary of the worktree's URLs and the `cd` command is printed.

Internally, `wt new` creates the git worktree and then runs the same post-add
setup as `wt setup`.

Flags:

- `--branch <name>` — attach an **existing** branch to the new worktree, rather
  than creating a new one named `$USER/<slug>`.
- `--base <ref>` — when creating a fresh branch, root it at `<ref>` instead of
  `main`.

Examples:

```bash
moonx root:wt -- new drag-drop-fix
# → creates branch alex/drag-drop-fix from main
#   in ~/pierre/pierre-worktrees/drag-drop-fix/

moonx root:wt -- new trees/perf --base alex/trees/main-current-work
# → creates branch alex/trees/perf from alex/trees/main-current-work
#   in ~/pierre/pierre-worktrees/trees-perf/   (slash → dash in dir name)

moonx root:wt -- new resume --branch mdo/wip-feature
# → attaches existing branch mdo/wip-feature to a new worktree at
#   ~/pierre/pierre-worktrees/resume/
```

**Why `wt new` cannot `cd` for you.** A child process cannot change its parent
shell's working directory. The script prints the `cd` command at the end;
copy-paste it. If you want true auto-cd, wrap `wt new` in a shell function of
your own (out of scope for this repo, deliberately — we don't force anyone to
install anything).

### `wt setup [<slug>]` — initialize an existing worktree

Runs the post-add setup that `wt new` runs automatically:

- Resolves the target worktree.
- Writes or reuses `.env.worktree` with `PIERRE_WORKTREE_SLUG` and
  `PIERRE_PORT_OFFSET`.
- Runs `pnpm install` in the target worktree.
- Prints the worktree's URLs and `cd` command.

With a slug, `wt setup` targets the managed worktree path:

```bash
moonx root:wt -- setup drag-drop-fix
# → initializes ~/pierre/pierre-worktrees/drag-drop-fix/
```

Without a slug, it targets the current linked worktree. This is intended for
scripts that create or enter a worktree themselves before running setup:

```bash
git worktree add ~/pierre/pierre-worktrees/manual-branch manual-branch
cd ~/pierre/pierre-worktrees/manual-branch
moonx root:wt -- setup
```

`wt setup` refuses to initialize the main clone, because the main clone should
not have a `.env.worktree` and should keep offset 0.

Other TypeScript scripts can call the path-first setup function directly:

```ts
import { setupWorktree } from './wt.ts';

await setupWorktree({ path: process.cwd(), slug: 'manual-branch' });
```

### `wt rm <slug>` — tear down a worktree

Runs `wt clean <slug>` first (kills any processes bound to the worktree's
ports), then `git worktree remove`, then tries to delete the branch with
`git branch -d` (which refuses to delete unmerged branches — safe by default).

Flags:

- `--force` — passes `--force` through to `git worktree remove` (needed when the
  worktree has uncommitted changes).
- `--keep-branch` — skip the branch deletion step.

### `wt clean` — nuke zombies

Dev servers sometimes outlive the terminal that started them (an uncleanly
closed shell, an agent crash, dev-server children getting reparented to launchd,
etc.). When that happens, subsequent starts either collide or silently launch a
duplicate. `wt clean` fixes this on demand.

- `moonx root:wt -- clean` — scans every managed worktree's expected ports and
  kills any process listening on them. (Agent-spawned worktrees without a
  `.env.worktree` are skipped — `wt` doesn't know their ports.)
- `moonx root:wt -- clean <slug>` — same, but only for that worktree.

Agents in particular should run `moonx root:wt -- clean` before ending their
turn.

### `wt ps` — see what's listening

Prints a table with one row per worktree and one column per service (diffs/trees
dev, docs/trees/path-store E2E, chrome debug). Each cell is either the port
number + PID if something is listening, or just the port number if it's free.
Great for answering "wait, which worktree is on 3711 again?"

### `wt list` — summary

One line per worktree showing slug, offset, branch, and path. Includes the main
clone (shown as `(main)`, offset `—`) and unmanaged/agent worktrees (shown as
`(unmanaged)`).

---

## Ports: how the offset system works

Each of our dev/test services has a **base port**:

| Service                       | Base port |
| ----------------------------- | --------- |
| `apps/docs` diffs dev         | 3690      |
| `apps/docs` trees dev         | 3691      |
| `apps/docs` diffshub dev/prod | 3692      |
| `apps/docs` E2E               | 4174      |
| `packages/trees` E2E          | 4173      |
| `packages/diffs` E2E          | 4175      |
| `packages/path-store` E2E     | 4176      |
| Chrome remote debug           | 9222      |

Every worktree owns a **port offset** (0, 10, 20, 30, …). Its actual ports are
`base + offset`. Main clone is always offset 0 — its ports are unchanged.

### How the offset is chosen

`wt setup` picks an offset deterministically from the slug's hash (so recreating
a worktree with the same slug tends to give you the same ports and preserve your
browser bookmarks). `wt new` runs `wt setup` after adding the worktree. If that
candidate collides with another live worktree's offset, it bumps by 10 until it
finds a free slot. Discovery of live offsets is stateless: `git worktree list`
combined with each worktree's `.env.worktree` is the source of truth. There is
no central registry file.

### How the offset reaches your dev tasks

1. `wt setup` writes `.env.worktree` at the worktree root. `wt new` runs setup
   automatically after adding the worktree:
   ```
   PIERRE_WORKTREE_SLUG=drag-drop-fix
   PIERRE_PORT_OFFSET=30
   ```
2. Port-binding moon tasks declare `envFile: '/.env.worktree'`, so moon loads
   those keys before the task's shell runs (the file is workspace-root relative
   and silently skipped in the main clone, which has none).
3. The task script uses shell arithmetic to derive the final port, e.g. in
   `apps/docs/moon.yml`:
   ```yaml
   dev-trees:
     script:
       'export NEXT_PUBLIC_SITE=trees PORT=$(( ${PIERRE_PORT_OFFSET:-0} + 3691
       )) && …'
   ```
   In the main clone `PIERRE_PORT_OFFSET` is unset, so PORT is 3691. In a
   worktree with offset 30, PORT is 3721.

If you're adding a new dev task that binds a port, follow the same pattern:
`PORT=$(( ${PIERRE_PORT_OFFSET:-0} + <your_base> ))`.

---

## `run-dev.sh` — kill-before-start

`scripts/run-dev.sh <PORT> -- <command> [args…]` is a tiny preamble that every
dev-server task in the repo uses. It:

1. Runs `lsof -ti :$PORT -sTCP:LISTEN` to find any process currently bound to
   the port.
2. Sends SIGTERM, waits 300ms, sends SIGKILL to anything still bound.
3. Execs the downstream command.

This means **running a dev script always replaces the prior run on that port**.
You never hit "port already in use" errors. Zombies from uncleanly closed
terminals or crashed agents are automatically cleaned up on the next start.

Because the port offset guarantees no two live worktrees share a port,
`run-dev.sh` can never accidentally kill another worktree's server.

---

## `chrome-remote-debug.sh`

`moonx root:chrome` launches Chrome Dev with the DevTools remote-debugging
protocol on port 9222 (main clone) or `9222 + offset` (worktree). Each worktree
gets its own `--user-data-dir` (e.g. `/tmp/chrome-devtools-<slug>`) so Chromes
launched from different worktrees don't fight over a shared profile.

After launching, the script waits until the debug port actually accepts
connections before returning. This prevents a race where an agent runs the
script, sees it exit, immediately tries to attach, and fails because the macOS
permissions dialog hadn't finished resolving yet.

---

## Common workflows

### Start a new parallel feature

```bash
moonx root:wt -- new drag-drop-fix
cd ~/pierre/pierre-worktrees/drag-drop-fix
moonx docs:dev-trees
# → serves on http://localhost:<3691 + offset>, tab title prefixed with
#   an emoji + "[drag-drop-fix]"
```

### Work on two features at once

```bash
moonx root:wt -- new feature-a
moonx root:wt -- new feature-b
# Each has its own port set. Open their dev servers in separate terminals.
moonx root:wt -- ps    # see what's bound where
```

### I don't know which worktree is running on which port

```bash
moonx root:wt -- ps
```

### Agent left zombies behind / `port already in use`

```bash
moonx root:wt -- clean           # nuke every managed worktree's stale servers
moonx root:wt -- clean <slug>    # only a specific worktree
```

You should never actually need the `clean` command mid-flow — every dev task
already kills its predecessor on start. Use it when zombies are eating RAM
between runs, or when an agent that doesn't know about `run-dev.sh` spawned a
server directly.

### Finished with a feature, PR merged

```bash
moonx root:wt -- rm drag-drop-fix
# kills the servers, removes the worktree, deletes the (merged) branch.
```

If you have uncommitted work you're ready to throw away:

```bash
moonx root:wt -- rm drag-drop-fix --force
```

### Need to attach to an existing branch someone else pushed

```bash
git fetch
moonx root:wt -- new review-mdos-pr --branch mdo/new-feature
cd ~/pierre/pierre-worktrees/review-mdos-pr
```

### Need to initialize a worktree another script already created

```bash
cd ~/pierre/pierre-worktrees/generated-by-script
moonx root:wt -- setup
```

---

## Constraints and gotchas

- **`wt new` cannot auto-`cd`.** Copy the `cd` line it prints, or wrap it in
  your own shell function.
- **The main clone is always offset 0.** Nothing reserves this — there's just no
  `.env.worktree` to load, so `${PIERRE_PORT_OFFSET:-0}` resolves to 0. Don't
  drop a `.env.worktree` in the main clone; it's in `.gitignore` but a stray
  copy there would shift your main-clone ports.
- **Direct invocations bypass moon's env loading.** If you run `next dev` (or
  similar) by hand instead of through the moon task, nothing injects
  `PIERRE_PORT_OFFSET` into the shell that computes `PORT`, so the server binds
  the main clone's port. Configs that run _after_ the shell (Next's
  `next.config.mjs`, Playwright configs) still pick up `.env.worktree` via
  `load-worktree-env.mjs` — but `PORT` arithmetic lives in the task script's
  shell, so always prefer the moon task from the worktree.
- **Port offsets can't be manually re-used between worktrees.** If you want two
  worktrees on deterministic sibling ports, let `wt setup` pick — `wt new` runs
  setup automatically, and the hash is stable per slug.
- **Unmanaged worktrees are visible but ignored for offset accounting.** Agent
  worktrees under `.omx/worktrees/` or `/private/tmp/pierre-*` show up in
  `wt list` and `wt ps`, but they don't claim offsets and `wt clean --all`
  doesn't try to guess their ports.
- **Hooks / generated files.** Fresh worktrees don't have `.moon/hooks/` until a
  moon command runs (any `moon run`/`moonx`/`moon sync hooks` regenerates them
  and points the worktree-local `core.hooksPath` at them). `wt setup` runs
  `pnpm install` automatically, so the toolchain is ready immediately.

---

## Adding a new port-bound service

If you add a dev or E2E server with a fixed port, do three things:

1. Define the moon task with `envFile: '/.env.worktree'`, write the port as
   `PORT=$(( ${PIERRE_PORT_OFFSET:-0} + <your_base> ))`, and wrap the command in
   `scripts/run-dev.sh`:

   ```yaml
   dev-myservice:
     script:
       'PORT=$(( ${PIERRE_PORT_OFFSET:-0} + 4321 )) && bash
       ../../scripts/run-dev.sh "$PORT" -- my-server --port "$PORT"'
     preset: 'server'
     options:
       envFile: '/.env.worktree'
   ```

2. If a config file reads the port (e.g. playwright configs), read from
   `process.env.PIERRE_PORT_OFFSET` and add it to your base:

   ```ts
   const portOffset = Number(process.env.PIERRE_PORT_OFFSET ?? 0);
   const e2ePort = 4321 + portOffset;
   ```

3. Add the new service to `PORT_BASES` in `scripts/wt.ts` so `wt ps` and
   `wt clean` know about it.
