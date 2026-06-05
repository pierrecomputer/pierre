---
name: worktrees-and-dev-servers
description:
  Use when working with the repo's bun run wt helper, Pierre-managed worktrees,
  dev-server port offsets, stale server cleanup, Playwright fixtures, or Chrome
  debug instances. Do not use this as a substitute for host-provided workspace
  isolation.
---

# Worktrees and Dev Servers

Pierre includes a repo-specific `git worktree` helper for local/manual
parallelization outside host-managed agent workspaces. Managed Pierre worktrees
live at:

```text
~/pierre/pierre-worktrees/<slug>/
```

Each managed Pierre worktree owns a port offset so dev servers, E2E fixtures,
and the Chrome remote-debug instance do not collide. The main clone keeps
historical default ports; linked Pierre worktrees shift ports.

If you are already inside a Conductor, Codex, Claude, or other host-provided
workspace, do not create another worktree unless the user explicitly asks for a
Pierre-managed worktree. Still use this skill when you start repo dev servers or
E2E fixtures, because the cleanup and port-offset rules apply to those scripts.

## Worktree Commands

The `bun run wt` suite is defined in `scripts/wt.ts` and manages only
Pierre-managed worktrees:

```bash
bun run wt new <slug>    # create a worktree, allocate offset, bun install
bun run wt rm <slug>     # kill its processes, remove the worktree
bun run wt clean         # kill zombie servers on all managed worktree ports
bun run wt clean <slug>  # clean one managed worktree
bun run wt ps            # show per-worktree port status (LISTEN / -)
bun run wt list          # summary of managed + external worktrees
```

Dev scripts pick up the offset through `scripts/ws.ts`, which reads
`<worktree>/.env.worktree`. Before starting, they run `scripts/run-dev.sh` to
kill any stale process bound to the target port.

## Cleanup Contract

If you start dev servers, Playwright fixtures, or Chrome debug instances inside
a worktree, run cleanup before completing your turn:

```bash
bun run wt clean <slug>
```

Use `bun run wt clean` when you do not know the slug or need to clean every
managed worktree. Use `bun run wt rm <slug>` only when intentionally tearing
down the worktree itself.
