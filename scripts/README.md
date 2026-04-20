# scripts/

This folder contains the small set of scripts that drive day-to-day development
in the monorepo. Most of the time you'll interact with them through root
`package.json` entries:

- `bun ws …` — run an npm script in a specific workspace package.
- `bun run wt …` — manage `git worktree`s and their port isolation.

The other two scripts are helpers the above invoke internally:

- `run-dev.sh` — kill-before-start preamble for dev servers.
- `chrome-remote-debug.sh` — launches Chrome Dev with the DevTools protocol
  enabled, worktree-aware.
- `build-sprite.js`, `precommit-tsc.ts` — build/CI helpers, unrelated to the
  worktree workflow below.

The rest of this document explains `ws` and `wt` in detail and walks through the
most common workflows.

---

## `bun ws` — the workspace script runner

`bun ws <package> <script> [args…]` runs an npm script inside a specific
workspace. It exists for three reasons:

1. You can run it from anywhere in the monorepo — you don't have to `cd` into
   the package first.
2. It accepts a short package name (`diffs` resolves to `@pierre/diffs` in
   `packages/diffs`) or a path (`packages/diffs`) or a glob (`packages/*`).
3. It loads a worktree's `.env.worktree` so per-worktree port offsets propagate
   into the script automatically (see "Worktrees" below).

### Syntax

```bash
bun ws <package> <script> [args...]
bun ws <package> <script> --verbose        # don't elide lines in output
bun ws 'packages/*' <script>                # fan out across a glob
bun ws '*' <script>                         # every workspace (apps + packages)
```

`ws` forwards every argument after the script name to the underlying `bun run`
invocation. You do **not** need `--` to separate them unless a downstream tool
requires it. The only flag `ws` itself eats is `-v` / `--verbose`.

### Package name resolution

In priority order:

1. **Exact path** (`packages/diffs`, `apps/docs`) — filesystem directory, used
   verbatim.
2. **Short name** (`diffs`) — tried as `packages/diffs`, then `apps/diffs`.
3. **Glob** (`packages/*`, `*`) — delegated to `bun run -F <filter>`.

### Examples

```bash
bun ws diffs build           # build packages/diffs
bun ws docs trees:dev        # run the docs trees dev server
bun ws trees test            # bun test in packages/trees
bun ws 'packages/*' build    # build every package
bun ws '*' tsc               # typecheck everything
```

### How `ws` interacts with worktrees

When invoked, `ws` walks up from your current directory looking for a
`.env.worktree` file. If it finds one (which happens only inside a worktree
created by `wt new`), it merges those keys into the spawned child's env. In
practice this means `PIERRE_PORT_OFFSET` reaches your dev scripts without you
having to think about it.

In the main clone, there is no `.env.worktree`, nothing is merged, and every
script sees its historical default ports.

---

## `bun run wt` — the worktree command suite

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
bun run wt new <slug> [--branch <name>] [--base <ref>]
bun run wt rm  <slug> [--keep-branch] [--force]
bun run wt clean [<slug>|--all]
bun run wt ps
bun run wt list
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
  Configs that need those keys outside of a `bun ws` chain (Next's
  `next.config.mjs`, each Playwright config, `chrome-remote-debug.sh`) load the
  file themselves via `scripts/load-worktree-env.mjs` / the inlined bash
  walk-up. The browser tab title prefix reads `NEXT_PUBLIC_WORKTREE_SLUG`, which
  `next.config.mjs` bridges from `PIERRE_WORKTREE_SLUG` so `.env.worktree` stays
  the single source of truth.
- `bun install` runs automatically so husky hooks regenerate and the worktree's
  `node_modules` is ready.
- A summary of the worktree's URLs and the `cd` command is printed.

Flags:

- `--branch <name>` — attach an **existing** branch to the new worktree, rather
  than creating a new one named `$USER/<slug>`.
- `--base <ref>` — when creating a fresh branch, root it at `<ref>` instead of
  `main`.

Examples:

```bash
bun run wt new drag-drop-fix
# → creates branch alex/drag-drop-fix from main
#   in ~/pierre/pierre-worktrees/drag-drop-fix/

bun run wt new trees/perf --base alex/trees/main-current-work
# → creates branch alex/trees/perf from alex/trees/main-current-work
#   in ~/pierre/pierre-worktrees/trees-perf/   (slash → dash in dir name)

bun run wt new resume --branch mdo/wip-feature
# → attaches existing branch mdo/wip-feature to a new worktree at
#   ~/pierre/pierre-worktrees/resume/
```

**Why `wt new` cannot `cd` for you.** A child process cannot change its parent
shell's working directory. The script prints the `cd` command at the end;
copy-paste it. If you want true auto-cd, wrap `wt new` in a shell function of
your own (out of scope for this repo, deliberately — we don't force anyone to
install anything).

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
closed shell, an agent crash, `concurrently` children getting reparented to
launchd, etc.). When that happens, subsequent starts either collide or silently
launch a duplicate. `wt clean` fixes this on demand.

- `bun run wt clean` — scans every managed worktree's expected ports and kills
  any process listening on them. (Agent-spawned worktrees without a
  `.env.worktree` are skipped — `wt` doesn't know their ports.)
- `bun run wt clean <slug>` — same, but only for that worktree.

Agents in particular should run `bun run wt clean` before ending their turn
(this is documented in `AGENTS.md`).

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

| Service                   | Base port |
| ------------------------- | --------- |
| `apps/docs` diffs dev     | 3690      |
| `apps/docs` trees dev     | 3691      |
| `apps/docs` E2E           | 4174      |
| `packages/trees` E2E      | 4173      |
| `packages/path-store` E2E | 4176      |
| Chrome remote debug       | 9222      |

Every worktree owns a **port offset** (0, 10, 20, 30, …). Its actual ports are
`base + offset`. Main clone is always offset 0 — its ports are unchanged.

### How the offset is chosen

`wt new` picks an offset deterministically from the slug's hash (so recreating a
worktree with the same slug tends to give you the same ports and preserve your
browser bookmarks). If that candidate collides with another live worktree's
offset, it bumps by 10 until it finds a free slot. Discovery of live offsets is
stateless — `git worktree list` + each worktree's `.env.worktree` is the source
of truth. There is no central registry file.

### How the offset reaches your dev scripts

1. `wt new` writes `.env.worktree` at the worktree root:
   ```
   PIERRE_WORKTREE_SLUG=drag-drop-fix
   PIERRE_PORT_OFFSET=30
   ```
2. When you run `bun ws docs trees:dev`, `ws` walks up from your cwd, finds
   `.env.worktree`, and injects its keys into the child env.
3. The package.json script itself uses shell arithmetic to derive the final
   port:
   ```json
   "trees:dev": "export NEXT_PUBLIC_SITE=trees PORT=$((${PIERRE_PORT_OFFSET:-0} + 3691)) && …"
   ```
   In the main clone `PIERRE_PORT_OFFSET` is unset, so PORT is 3691. In a
   worktree with offset 30, PORT is 3721.

If you're adding a new dev script that binds a port, follow the same pattern:
`PORT=$((${PIERRE_PORT_OFFSET:-0} + <your_base>))`.

---

## `run-dev.sh` — kill-before-start

`scripts/run-dev.sh <PORT> -- <command> [args…]` is a tiny preamble that every
dev script in the repo uses. It:

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

`bun run chrome` launches Chrome Dev with the DevTools remote-debugging protocol
on port 9222 (main clone) or `9222 + offset` (worktree). Each worktree gets its
own `--user-data-dir` (e.g. `/tmp/chrome-devtools-<slug>`) so Chromes launched
from different worktrees don't fight over a shared profile.

After launching, the script waits until the debug port actually accepts
connections before returning. This prevents a race where an agent runs the
script, sees it exit, immediately tries to attach, and fails because the macOS
permissions dialog hadn't finished resolving yet.

---

## Common workflows

### Start a new parallel feature

```bash
bun run wt new drag-drop-fix
cd ~/pierre/pierre-worktrees/drag-drop-fix
bun ws docs trees:dev
# → serves on http://localhost:<3691 + offset>, tab title prefixed with
#   an emoji + "[drag-drop-fix]"
```

### Work on two features at once

```bash
bun run wt new feature-a
bun run wt new feature-b
# Each has its own port set. Open their dev servers in separate terminals.
bun run wt ps    # see what's bound where
```

### I don't know which worktree is running on which port

```bash
bun run wt ps
```

### Agent left zombies behind / `port already in use`

```bash
bun run wt clean           # nuke every managed worktree's stale servers
bun run wt clean <slug>    # only a specific worktree
```

You should never actually need the `clean` command mid-flow — every dev script
already kills its predecessor on start. Use it when zombies are eating RAM
between runs, or when an agent that doesn't know about `run-dev.sh` spawned a
server directly.

### Finished with a feature, PR merged

```bash
bun run wt rm drag-drop-fix
# kills the servers, removes the worktree, deletes the (merged) branch.
```

If you have uncommitted work you're ready to throw away:

```bash
bun run wt rm drag-drop-fix --force
```

### Need to attach to an existing branch someone else pushed

```bash
git fetch
bun run wt new review-mdos-pr --branch mdo/new-feature
cd ~/pierre/pierre-worktrees/review-mdos-pr
bun install
```

---

## Constraints and gotchas

- **`wt new` cannot auto-`cd`.** Copy the `cd` line it prints, or wrap it in
  your own shell function.
- **The main clone is always offset 0.** Nothing reserves this — there's just no
  `.env.worktree` for `ws` to find, so `${PIERRE_PORT_OFFSET:-0}` resolves to 0.
  Don't drop a `.env.worktree` in the main clone; it's in `.gitignore` but a
  stray copy there would shift your main-clone ports.
- **Direct invocations bypass `ws`.** If you `cd apps/docs && bun run trees:dev`
  (without going through `bun ws`), `ws` is not in the call chain and won't
  inject `PIERRE_PORT_OFFSET` into the shell that computes `PORT`. The
  package.json script still resolves `${PIERRE_PORT_OFFSET:-0}` to `0` and the
  dev server binds the main clone's port. Configs that run _after_ the shell
  (Next's `next.config.mjs`, Playwright configs) will still pick up
  `.env.worktree` on their own — but `PORT` arithmetic in a package.json script
  is resolved by the shell, so always prefer `bun ws …` from the worktree root
  (this is already the convention in `AGENTS.md`).
- **Port offsets can't be manually re-used between worktrees.** If you want two
  worktrees on deterministic sibling ports, just let `wt new` pick — the hash is
  stable per slug.
- **Unmanaged worktrees are visible but ignored for offset accounting.** Agent
  worktrees under `.omx/worktrees/` or `/private/tmp/pierre-*` show up in
  `wt list` and `wt ps`, but they don't claim offsets and `wt clean --all`
  doesn't try to guess their ports.
- **Hooks / generated files.** Fresh worktrees don't have `.husky/_/` (it's
  regenerated by husky's `prepare` script on install). `wt new` runs
  `bun install` automatically so this is usually invisible.

---

## Adding a new port-bound service

If you add a dev or E2E server with a fixed port, do three things:

1. In the package.json script, write the port as
   `PORT=$((${PIERRE_PORT_OFFSET:-0} + <your_base>))` and wrap the command in
   `scripts/run-dev.sh`:

   ```json
   "myservice:dev": "PORT=$((${PIERRE_PORT_OFFSET:-0} + 4321)) bash ../../scripts/run-dev.sh \"$PORT\" -- bun run _myservice"
   ```

2. If a config file reads the port (e.g. playwright configs), read from
   `process.env.PIERRE_PORT_OFFSET` and add it to your base:

   ```ts
   const portOffset = Number(process.env.PIERRE_PORT_OFFSET ?? 0);
   const e2ePort = 4321 + portOffset;
   ```

3. Add the new service to `PORT_BASES` in `scripts/wt.ts` so `wt ps` and
   `wt clean` know about it.
