#!/usr/bin/env bash
set -euo pipefail

# Resolve tools and build paths from the docs app, regardless of Vercel's root.
cd "$(dirname "${BASH_SOURCE[0]}")/.."
export PATH="$PWD/node_modules/.bin:$PWD/../../node_modules/.bin:$PATH"

moon run docs:build-deps
bun scripts/generate-llms-txt.ts
next build
bun scripts/check-prerender-size.ts
