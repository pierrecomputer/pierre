#!/bin/bash

open -g -n -a "Google Chrome Dev" --args \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-devtools-codex