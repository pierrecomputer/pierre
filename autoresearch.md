# Autoresearch: speed up `fileListToTree`

## Objective
Reduce runtime of `fileListToTree` in `@pierre/trees` under the existing benchmark workload (`bun ws trees benchmark`).

## Metrics
- **Primary**: `total_ms` (ms, lower is better) — sum of per-case median runtime from benchmark JSON output
- **Secondary**:
  - `worst_case_ms` — slowest case median
  - `buildPathGraph_ms` — total stage median across cases
  - `buildFlattenedNodes_ms` — total stage median across cases
  - `buildFolderNodes_ms` — total stage median across cases
  - `hashTreeKeys_ms` — total stage median across cases

## How to Run
`./autoresearch.sh` — runs benchmark + emits structured `METRIC` lines.

## Files in Scope
- `packages/trees/src/utils/fileListToTree.ts` — primary target function and stage implementations.
- `packages/trees/src/utils/createLoaderUtils.ts` — flattening helper routines used by `fileListToTree`.
- `packages/trees/src/utils/sortChildren.ts` — child sorting hot path used by folder/flattened node construction.
- `packages/trees/test/fileListToTree.test.ts` and related `packages/trees/test/**` files — update expectations only if output shape intentionally changes.
- `packages/trees/scripts/benchmarkFileListToTree.ts` — benchmark instrumentation only when needed for better optimization signal.

## Off Limits
- Any package outside `packages/trees`.
- Dependency/version changes.

## Constraints
- Keep all changes inside `packages/trees`.
- It is acceptable to change `fileListToTree` output shape/ordering if the trees package is updated consistently.
- `bun ws trees test` must pass for kept runs.
- Prefer simpler/maintainable code for tiny or noisy gains.

## What's Been Tried
- Baseline pending.
