#!/usr/bin/env bash
#
# Kill-before-start preamble for dev servers that bind a fixed port.
#
# Usage: scripts/run-dev.sh <PORT> -- <command> [args...]
#
# Finds any process currently listening on <PORT>, SIGTERMs it, waits briefly,
# then SIGKILLs survivors. Then execs the provided command, which should start
# a new server on the same port.
#
# This exists because terminals close uncleanly (especially under AI agents),
# which can leave `concurrently` / `next dev` children reparented to launchd
# and still bound to the port. Rather than require manual cleanup, every dev
# script nukes whatever stale process owns its port before starting fresh.
#
# Worktree port offsets (see scripts/wt.ts) guarantee that no two live
# worktrees share a port, so this never clobbers another worktree's work.

set -euo pipefail

if [ $# -lt 3 ] || [ "$2" != "--" ]; then
  echo "usage: run-dev.sh <PORT> -- <command> [args...]" >&2
  exit 2
fi

PORT="$1"
shift 2

# lsof -ti exits non-zero if nothing is listening; that's fine.
PIDS=$(lsof -ti ":${PORT}" -sTCP:LISTEN 2>/dev/null || true)
if [ -n "${PIDS}" ]; then
  echo "[run-dev] killing stale process on port ${PORT}: ${PIDS}" >&2
  # shellcheck disable=SC2086
  kill -TERM ${PIDS} 2>/dev/null || true
  sleep 0.3
  SURVIVORS=$(lsof -ti ":${PORT}" -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "${SURVIVORS}" ]; then
    # shellcheck disable=SC2086
    kill -KILL ${SURVIVORS} 2>/dev/null || true
    sleep 0.1
  fi
fi

exec "$@"
