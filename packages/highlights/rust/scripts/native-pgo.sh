#!/usr/bin/env bash
# Build a PGO bench with one native module, trained on that module's
# training corpora, the way scripts/native-report.sh builds every module.
# Prints the binary's path. Compare two of them (before and after a change)
# with scripts/native-ab.sh: without PGO, a change's cost can hide in
# register allocation noise.
#
#   scripts/native-pgo.sh <module> [out dir, default target/native-pgo/<module>]
set -euo pipefail
cd "$(dirname "$0")/.."
module="$1"
out="${2:-target/native-pgo/$module}"

if [ ! -f target/train/sources.json ]; then
  bun scripts/train-corpus.ts
fi

mkdir -p "$out"
out="$(cd "$out" && pwd)"
rm -rf "$out/train" "$out/profiles"
mkdir -p "$out/train" "$out/profiles"
for lang in $(bun scripts/native-modules.ts "$module"); do
  if [ -f "target/train/corpus.$lang" ]; then
    ln -s "$(pwd)/target/train/corpus.$lang" "$out/train/"
  fi
done

features="native-core,native-$module"
RUSTFLAGS="-Cprofile-generate=$out/profiles -Cllvm-args=-vp-counters-per-site=8" \
  cargo build --quiet --release -p bench --features "$features" --target-dir "$out/gen"
"$out/gen/release/bench" --train "$out/train" >/dev/null
profdata="$(echo "$(rustc --print sysroot)"/lib/rustlib/*/bin/llvm-profdata)"
"$profdata" merge -o "$out/profiles/merged.profdata" "$out/profiles"/*.profraw
RUSTFLAGS="-Cprofile-use=$out/profiles/merged.profdata -Cllvm-args=-pgo-warn-missing-function=false" \
  cargo build --quiet --release -p bench --features "$features" --target-dir "$out/use"
cp "$out/use/release/bench" "$out/bench"
echo "$out/bench"
