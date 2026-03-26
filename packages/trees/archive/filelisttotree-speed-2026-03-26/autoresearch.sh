#!/bin/bash
set -euo pipefail

export AGENT=1

# Fast pre-check: ensure target source compiles syntactically before timing.
bun --eval "await import('./packages/trees/src/utils/fileListToTree.ts')" >/dev/null

benchmark_json=$(bun ws trees benchmark -- --json)

total_ms=$(printf '%s' "$benchmark_json" | bun --eval '
const data = JSON.parse(await Bun.stdin.text());
const total = data.cases.reduce((sum, c) => sum + c.medianMs, 0);
console.log(total.toFixed(6));
')

worst_case_ms=$(printf '%s' "$benchmark_json" | bun --eval '
const data = JSON.parse(await Bun.stdin.text());
const worst = data.cases.reduce((max, c) => Math.max(max, c.medianMs), 0);
console.log(worst.toFixed(6));
')

stage_metrics=$(printf '%s' "$benchmark_json" | bun --eval '
const data = JSON.parse(await Bun.stdin.text());
const totals = {
  buildPathGraph: 0,
  buildFlattenedNodes: 0,
  buildFolderNodes: 0,
  hashTreeKeys: 0,
};
for (const s of data.stages) {
  totals.buildPathGraph += s.stages.buildPathGraph.medianMs;
  totals.buildFlattenedNodes += s.stages.buildFlattenedNodes.medianMs;
  totals.buildFolderNodes += s.stages.buildFolderNodes.medianMs;
  totals.hashTreeKeys += s.stages.hashTreeKeys.medianMs;
}
for (const [k, v] of Object.entries(totals)) {
  console.log(`${k}=${v.toFixed(6)}`);
}
')

echo "METRIC total_ms=${total_ms}"
echo "METRIC worst_case_ms=${worst_case_ms}"
while IFS='=' read -r name value; do
  echo "METRIC ${name}_ms=${value}"
done <<< "$stage_metrics"
