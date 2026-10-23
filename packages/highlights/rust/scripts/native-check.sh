#!/usr/bin/env bash
# Check one native lexer module against the translated lexer, and measure
# it. Prints one line per step and ends with PASS or FAIL; exits nonzero on
# FAIL.
#
#   scripts/native-check.sh <module> [--fuzz N] [--target-dir DIR] [--no-perf]
#                           [--update-lock] [--corpus DIR]
#
# <module> is a src/langs/<module>.wat name (scripts/native-modules.ts lists
# them with their languages). Steps:
#   0. the drift lock: the module's `//! WAT sources:` line names the WAT
#      files it mirrors, and highlights/src/native/<module>.lock holds their
#      SHA-256 from the last sync. A changed or missing hash fails the check
#      and names the files to port; --update-lock rewrites the lock once
#      every other step passes;
#   1. build the bench with the module's `native-<module>` feature;
#   2. parity on every file of target/parity/<lang>/ for each language
#      (scripts/parity-corpus.ts builds it, with each language's test
#      sample; --corpus uses another directory built the same way);
#   3. fuzz: N mutated inputs (default 20000) from those files, lexed as
#      each of the module's languages;
#   4. instructions and cycles per record, native against translated, on
#      the language's benchmark input and its training corpus.
#
# Instruction counts are steady under machine load; cycles are not.
set -euo pipefail
cd "$(dirname "$0")/.."

module="${1:?usage: native-check.sh <module> [--fuzz N] [--target-dir DIR] [--no-perf]}"
shift
fuzz=20000
target="target/native-$module"
perf=1
update_lock=0
corpus=target/parity
while [ $# -gt 0 ]; do
  case "$1" in
    --corpus) corpus="$2"; shift 2 ;;
    --update-lock) update_lock=1; shift ;;
    --fuzz) fuzz="$2"; shift 2 ;;
    --target-dir) target="$2"; shift 2 ;;
    --no-perf) perf=0; shift ;;
    *) echo "unknown argument $1"; exit 2 ;;
  esac
done

langs=$(bun scripts/native-modules.ts "$module")
if [ -z "$langs" ]; then
  echo "unknown module $module (see scripts/native-modules.ts)"
  exit 2
fi
if [ "$module" = js ] || [ "$module" = ts ]; then
  feature=native-core
else
  feature="native-$module"
fi
if [ ! -d "$corpus" ]; then
  bun scripts/parity-corpus.ts "$corpus"
fi

fail() {
  echo "FAIL: $1"
  exit 1
}

echo "module $module: languages $langs"

# Step 0: the drift lock.
case "$module" in
  js | ts) source_file=highlights/src/native/fast.rs; lock=highlights/src/native/fast.lock ;;
  *) source_file="highlights/src/native/${module//-/_}.rs"; lock="highlights/src/native/${module//-/_}.lock" ;;
esac
[ -f "$source_file" ] || fail "no $source_file"
wat_sources=$(sed -n 's|^//! WAT sources: ||p' "$source_file")
[ -n "$wat_sources" ] || fail "$source_file has no '//! WAT sources:' line"
# Paths are relative to packages/highlights.
for f in $wat_sources; do
  [ -f "../$f" ] || fail "WAT source $f does not exist"
done
current_lock=$(cd .. && shasum -a 256 $wat_sources)
if [ "$update_lock" = 0 ]; then
  if [ ! -f "$lock" ]; then
    fail "no $lock: run with --update-lock once the module passes"
  fi
  drift=$(diff <(echo "$current_lock") "$lock" | sed -n 's/^< [0-9a-f]*  //p' || true)
  if [ -n "$drift" ]; then
    since=$(git log -1 --format=%h -- "$lock" 2>/dev/null || true)
    fail "WAT changed since the last sync: $(echo $drift); see git diff ${since:-<lock commit>} -- $(echo $drift)"
  fi
  echo "drift lock: in sync"
fi
cargo build --quiet --release -p bench --features "$feature" --target-dir "$target" ||
  fail "build"
bench="$target/release/bench"

for lang in $langs; do
  "$bench" --native-parity "$corpus/$lang"/* | tail -3 || fail "parity ($lang)"
done

files=()
for lang in $langs; do
  files+=("$corpus/$lang"/*)
done
"$bench" --native-fuzz "$(echo "$langs" | tr ' ' ',')" "$fuzz" "${files[@]}" | tail -6 ||
  fail "fuzz"

if [ "$perf" = 1 ]; then
  perf_dir="$target/perf"
  mkdir -p "$perf_dir"
  for lang in $langs; do
    inputs=()
    if [ -f "gen/bench/$lang.sample.txt" ]; then
      cp "gen/bench/$lang.sample.txt" "$perf_dir/bench.$lang"
      inputs+=("$perf_dir/bench.$lang")
    fi
    if [ -f "target/train/corpus.$lang" ]; then
      inputs+=("target/train/corpus.$lang")
    fi
    for input in "${inputs[@]}"; do
      line="$lang $(basename "$input" | cut -d. -f1):"
      for engine in wasm native; do
        out=$(/usr/bin/time -l "$bench" --profile-core "$engine" "$input" 2 2>&1)
        line+=$(echo "$out" | python3 -c "
import re, sys
s = sys.stdin.read()
iters = int(re.search(r'iters (\d+)', s).group(1))
recs = int(re.search(r'recs (\d+)', s).group(1))
ins = int(re.search(r'(\d+)\s+instructions retired', s).group(1))
cyc = int(re.search(r'(\d+)\s+cycles elapsed', s).group(1))
print(f'  $engine {ins / iters / recs:.1f} instr {cyc / iters / recs:.1f} cycles per record', end='')
")
      done
      echo "$line"
    done
  done
fi
if [ "$update_lock" = 1 ]; then
  echo "$current_lock" >"$lock"
  echo "drift lock: updated $lock"
fi
echo "PASS"
