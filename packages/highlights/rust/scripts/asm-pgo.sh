#!/bin/bash
# PGO build of the bench with the native-asm feature, comparing the assembly
# lexer with the Rust core: train on target/train (the same corpus
# pgo.sh uses, never the benchmark files), covering the translated lexers
# (bench --train) and the native core (parity runs over the JS/TS corpus).
set -euo pipefail
cd "$(dirname "$0")/.."
profiles="$(pwd)/target/asm-pgo-profiles"
rm -rf "$profiles" && mkdir -p "$profiles"
RUSTFLAGS="-Cprofile-generate=$profiles -Cllvm-args=-vp-counters-per-site=8 ${EXTRA:-}" \
  cargo build --quiet --release -p bench --features native-asm --target-dir target/asm-pgo-gen
./target/asm-pgo-gen/release/bench --train target/train >/dev/null
for i in 1 2 3 4 5; do
  ./target/asm-pgo-gen/release/bench --native-parity target/train/corpus.js target/train/corpus.ts >/dev/null
  ./target/asm-pgo-gen/release/bench --asm-parity target/train/corpus.js target/train/corpus.ts >/dev/null
done
profdata="$(echo "$(rustc --print sysroot)"/lib/rustlib/*/bin/llvm-profdata)"
"$profdata" merge -o "$profiles/merged.profdata" "$profiles"/*.profraw
if [ -f pgo-exclude.txt ]; then
  "$profdata" merge --text -o "$profiles/merged.txt" "$profiles/merged.profdata"
  bun scripts/pgo-filter.ts "$profiles/merged.txt" "$profiles/filtered.txt" pgo-exclude.txt
  "$profdata" merge -o "$profiles/merged.profdata" "$profiles/filtered.txt"
fi
RUSTFLAGS="-Cprofile-use=$profiles/merged.profdata -Cllvm-args=-pgo-warn-missing-function=false ${EXTRA:-}" \
  cargo build --quiet --release -p bench --features native-asm --target-dir target/asm-pgo-use
echo built target/asm-pgo-use/release/bench
