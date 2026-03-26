#!/bin/bash
set -euo pipefail

export AGENT=1

log_file="$(mktemp)"
if bun ws trees test >"$log_file" 2>&1; then
  rm -f "$log_file"
  exit 0
fi

tail -80 "$log_file"
rm -f "$log_file"
exit 1
