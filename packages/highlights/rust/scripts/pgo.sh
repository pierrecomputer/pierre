#!/usr/bin/env bash
# Build the benchmark and the `hl` app with profile-guided optimization,
# then compare every language: the published wasm in JSC and V8, the
# translated Rust, and the translated Rust with PGO. Arguments (a label
# filter, --budget-ms N, --no-js) pass through to `bench`; `build` as the
# only argument stops after building, leaving target/pgo-use/release/hl.
#
# Profiles train on target/train (real source files from this machine, built by
# train-corpus.ts), never on the benchmark inputs, except for languages with
# no files on disk; the report marks those.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f target/train/sources.json ]; then
  bun scripts/train-corpus.ts
fi

profiles="$(pwd)/target/pgo-profiles"
rm -rf "$profiles" && mkdir -p "$profiles"
RUSTFLAGS="-Cprofile-generate=$profiles -Cllvm-args=-vp-counters-per-site=8" \
  cargo build --quiet --release -p bench --target-dir target/pgo-gen
./target/pgo-gen/release/bench --train target/train
profdata="$(echo "$(rustc --print sysroot)"/lib/rustlib/*/bin/llvm-profdata)"
"$profdata" merge -o "$profiles/merged.profdata" "$profiles"/*.profraw
# Languages in pgo-exclude.txt build without profile data (see that file).
if [ -f pgo-exclude.txt ]; then
  "$profdata" merge --text -o "$profiles/merged.txt" "$profiles/merged.profdata"
  bun scripts/pgo-filter.ts "$profiles/merged.txt" "$profiles/filtered.txt" pgo-exclude.txt
  "$profdata" merge -o "$profiles/merged.profdata" "$profiles/filtered.txt"
fi
RUSTFLAGS="-Cprofile-use=$profiles/merged.profdata -Cllvm-args=-pgo-warn-missing-function=false" \
  cargo build --quiet --release -p bench -p hl --target-dir target/pgo-use
if [ "${1:-}" = "build" ]; then
  echo "built $(pwd)/target/pgo-use/release/hl"
  exit 0
fi
cargo build --quiet --release -p bench

# Rust-only args for the PGO run; the report run also measures JS.
rust_args=()
for a in "$@"; do [ "$a" != "--no-js" ] && rust_args+=("$a"); done
./target/pgo-use/release/bench --no-js --json gen/bench-pgo.json "${rust_args[@]+"${rust_args[@]}"}"
./target/release/bench --pgo gen/bench-pgo.json "$@"
