#!/usr/bin/env bash
# Compare two bench binaries' native lexers on one input, alternating runs
# so machine load affects both alike. Prints instructions and cycles per
# record for each run, then each binary's median.
#
#   scripts/native-ab.sh <bench A> <bench B> <input> [rounds, default 5]
#
# Keep a copy of the bench binary before a change (`cp <target>/release/bench
# /tmp/bench-a`), rebuild, and compare it with the new one. The input's
# language comes from its file name or extension.
set -euo pipefail
a="$1"
b="$2"
input="$3"
rounds="${4:-5}"

measure() {
  /usr/bin/time -l "$1" --profile-core native "$input" 1 2>&1 | python3 -c "
import re, sys
s = sys.stdin.read()
iters = int(re.search(r'iters (\d+)', s).group(1))
recs = int(re.search(r'recs (\d+)', s).group(1))
ins = int(re.search(r'(\d+)\s+instructions retired', s).group(1))
cyc = int(re.search(r'(\d+)\s+cycles elapsed', s).group(1))
print(f'{ins / iters / recs:.1f} {cyc / iters / recs:.2f}')
"
}

results_a=()
results_b=()
for _ in $(seq "$rounds"); do
  ra=$(measure "$a")
  rb=$(measure "$b")
  echo "A $ra   B $rb   (instructions, cycles per record)"
  results_a+=("$ra")
  results_b+=("$rb")
done
python3 -c "
import statistics, sys
a = [tuple(map(float, r.split())) for r in sys.argv[1].split(';')]
b = [tuple(map(float, r.split())) for r in sys.argv[2].split(';')]
for name, rows in (('A', a), ('B', b)):
    print(f'{name} median: {statistics.median(r[0] for r in rows):.1f} instructions, {statistics.median(r[1] for r in rows):.2f} cycles per record')
" "$(IFS=';'; echo "${results_a[*]}")" "$(IFS=';'; echo "${results_b[*]}")"
