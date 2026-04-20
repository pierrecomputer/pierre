#!/bin/bash
#
# Launches Google Chrome Dev with the DevTools remote-debugging protocol
# enabled so agents / scripts can attach.
#
# Per-worktree isolation (opt-in via env):
#   - PIERRE_PORT_OFFSET shifts the debug port by that many units (default 0).
#   - PIERRE_WORKTREE_SLUG names the user-data-dir so each worktree has its own
#     isolated Chrome profile and the worktrees don't fight over a shared dir.
#
# Main clone (neither var set) keeps the historical port 9222 and the
# "/tmp/chrome-devtools-codex" user-data-dir so nothing changes for users not
# running out of a worktree.
#
# After launching, this script waits for the debug port to accept connections
# before returning, so callers can attach immediately without racing the
# first-launch macOS permissions dialog.

set -euo pipefail

OFFSET="${PIERRE_PORT_OFFSET:-0}"
SLUG="${PIERRE_WORKTREE_SLUG:-codex}"
PORT=$((9222 + OFFSET))
USER_DATA_DIR="/tmp/chrome-devtools-${SLUG}"

open -g -n -a "Google Chrome Dev" --args \
  --remote-debugging-port="${PORT}" \
  --user-data-dir="${USER_DATA_DIR}"

# Wait up to ~6s for the debug port to start accepting connections.
for _ in $(seq 1 30); do
  if nc -z 127.0.0.1 "${PORT}" 2>/dev/null; then
    echo "chrome debug port listening on ${PORT} (user-data-dir ${USER_DATA_DIR})"
    exit 0
  fi
  sleep 0.2
done

echo "chrome debug port ${PORT} never opened (user-data-dir ${USER_DATA_DIR})" >&2
exit 1
