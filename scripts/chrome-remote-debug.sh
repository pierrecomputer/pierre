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

# Neither bash nor `bun run` auto-load `.env.worktree`, so when this script is
# launched outside of a `bun ws` chain (e.g. `bun run chrome` from the worktree
# root) the `PIERRE_*` vars would otherwise be missing and chrome would open on
# the main clone's debug port. Walk up from $PWD until we find `.env.worktree`
# or hit a `.git` entry (worktree root marker) and source the file so its keys
# are exported for the remainder of this script. Pre-existing env vars win.
load_worktree_env() {
  local dir="$PWD"
  local env_file=""
  while [[ "$dir" != "/" ]]; do
    if [[ -f "$dir/.env.worktree" ]]; then
      env_file="$dir/.env.worktree"
      break
    fi
    if [[ -e "$dir/.git" ]]; then
      return
    fi
    dir="$(dirname "$dir")"
  done
  [[ -z "$env_file" ]] && return

  local line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    # Trim leading/trailing whitespace and skip blanks / comments.
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" || "${line:0:1}" == "#" ]] && continue
    [[ "$line" != *"="* ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    # Strip matching surrounding single or double quotes if present.
    if [[ ${#value} -ge 2 ]]; then
      local first="${value:0:1}"
      local last="${value: -1}"
      if { [[ "$first" == '"' && "$last" == '"' ]] || [[ "$first" == "'" && "$last" == "'" ]]; }; then
        value="${value:1:-1}"
      fi
    fi
    # Preserve anything already set by the caller / ws.
    if [[ -z "${!key+x}" ]]; then
      export "$key=$value"
    fi
  done < "$env_file"
}
load_worktree_env

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
