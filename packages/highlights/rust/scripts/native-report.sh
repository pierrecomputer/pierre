#!/usr/bin/env bash
# Compare every native lexer with the translated one, both PGO-built in one
# binary: instructions and cycles per record on each language's benchmark
# input and training corpus. Builds every module present in
# highlights/src/native/, trains the profile on target/train (never the
# benchmark inputs), and writes the table to target/native-report.md.
#
#   scripts/native-report.sh [seconds per measurement, default 1]
#
# Run it on a quiet machine: cycles are only as good as the load allows.
set -euo pipefail
cd "$(dirname "$0")/.."
secs="${1:-1}"

if [ ! -f target/train/sources.json ]; then
  bun scripts/train-corpus.ts
fi

features=native-core
modules=(js ts)
while read -r module _; do
  if [ -f "highlights/src/native/${module//-/_}.rs" ]; then
    features+=",native-$module"
    modules+=("$module")
  fi
done < <(bun scripts/native-modules.ts)

profiles="$(pwd)/target/native-report-profiles"
rm -rf "$profiles" && mkdir -p "$profiles"
RUSTFLAGS="-Cprofile-generate=$profiles -Cllvm-args=-vp-counters-per-site=8" \
  cargo build --quiet --release -p bench --features "$features" --target-dir target/native-report-gen
./target/native-report-gen/release/bench --train target/train >/dev/null
profdata="$(echo "$(rustc --print sysroot)"/lib/rustlib/*/bin/llvm-profdata)"
"$profdata" merge -o "$profiles/merged.profdata" "$profiles"/*.profraw
if [ -f pgo-exclude.txt ]; then
  "$profdata" merge --text -o "$profiles/merged.txt" "$profiles/merged.profdata"
  bun scripts/pgo-filter.ts "$profiles/merged.txt" "$profiles/filtered.txt" pgo-exclude.txt
  "$profdata" merge -o "$profiles/merged.profdata" "$profiles/filtered.txt"
fi
RUSTFLAGS="-Cprofile-use=$profiles/merged.profdata -Cllvm-args=-pgo-warn-missing-function=false" \
  cargo build --quiet --release -p bench --features "$features" --target-dir target/native-report-use
bench=target/native-report-use/release/bench

perf_dir=target/native-report-use/perf
mkdir -p "$perf_dir"
report=target/native-report.md
{
  echo "| language | input | translated instr | native instr | instr ratio | translated cycles | native cycles | cycles ratio |"
  echo "|---|---|---|---|---|---|---|---|"
} >"$report"
for module in "${modules[@]}"; do
  for lang in $(bun scripts/native-modules.ts "$module"); do
    inputs=()
    if [ -f "gen/bench/$lang.sample.txt" ]; then
      cp "gen/bench/$lang.sample.txt" "$perf_dir/bench.$lang"
      inputs+=("$perf_dir/bench.$lang")
    fi
    if [ -f "target/train/corpus.$lang" ]; then
      inputs+=("target/train/corpus.$lang")
    fi
    for input in "${inputs[@]}"; do
      row="| $lang | $(basename "$input" | cut -d. -f1) |"
      measure() {
        /usr/bin/time -l "$bench" --profile-core "$1" "$input" "$secs" 2>&1 | python3 -c "
import re, sys
s = sys.stdin.read()
iters = int(re.search(r'iters (\d+)', s).group(1))
recs = int(re.search(r'recs (\d+)', s).group(1))
ins = int(re.search(r'(\d+)\s+instructions retired', s).group(1))
cyc = int(re.search(r'(\d+)\s+cycles elapsed', s).group(1))
print(ins / iters / recs, cyc / iters / recs)
"
      }
      read -r wi wc <<<"$(measure wasm)"
      read -r ni nc <<<"$(measure native)"
      row+=$(python3 -c "
wi, wc, ni, nc = $wi, $wc, $ni, $nc
print(f' {wi:.1f} | {ni:.1f} | {wi / ni:.2f}x | {wc:.1f} | {nc:.1f} | {wc / nc:.2f}x |')")
      echo "$row" | tee -a "$report"
    done
  done
done
echo "wrote $report"
