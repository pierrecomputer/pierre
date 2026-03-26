# Autoresearch: speed up `fileListToTree`

## Objective

Reduce runtime of `fileListToTree` in `@pierre/trees` under the existing
benchmark workload (`bun ws trees benchmark`).

## Metrics

- **Primary**: `total_ms` (ms, lower is better) — sum of per-case median runtime
  from benchmark JSON output
- **Secondary**:
  - `worst_case_ms` — slowest case median
  - `buildPathGraph_ms` — total stage median across cases
  - `buildFlattenedNodes_ms` — total stage median across cases
  - `buildFolderNodes_ms` — total stage median across cases
  - `hashTreeKeys_ms` — total stage median across cases

## How to Run

`./autoresearch.sh` — runs benchmark + emits structured `METRIC` lines.

## Files in Scope

- `packages/trees/src/utils/fileListToTree.ts` — primary target function and
  stage implementations.
- `packages/trees/src/utils/createLoaderUtils.ts` — flattening helper routines
  used by `fileListToTree`.
- `packages/trees/src/utils/sortChildren.ts` — child sorting hot path used by
  folder/flattened node construction.
- `packages/trees/test/fileListToTree.test.ts` and related
  `packages/trees/test/**` files — update expectations only if output shape
  intentionally changes.
- `packages/trees/scripts/benchmarkFileListToTree.ts` — benchmark
  instrumentation only when needed for better optimization signal.

## Off Limits

- Any package outside `packages/trees`.
- Dependency/version changes.

## Constraints

- Keep all changes inside `packages/trees`.
- It is acceptable to change `fileListToTree` output shape/ordering if the trees
  package is updated consistently.
- `bun ws trees test` must pass for kept runs.
- Prefer simpler/maintainable code for tiny or noisy gains.

## What's Been Tried

- **Baseline** (`total_ms=251.52`): `buildPathGraph` + `hashTreeKeys` dominate.
- ✅ **Kept**: fast-path for already-normalized input paths in `buildPathGraph`
  (initially with fallback normalization), plus lower-overhead remapping loops
  in `hashTreeKeys`.
- ✅ **Kept**: switched `hashId` to a lightweight FNV-1a variant.
- ✅ **Kept**: made reverse lookup optional in `createIdMaps` and disabled it
  for `fileListToTree` hash pass (`includeReverseMap: false`).
- ✅ **Kept**: removed key sorting in `hashTreeKeys` (uses deterministic object
  key insertion order for fixed inputs).
- ✅ **Kept**: removed normalize fallback from path ingestion and instead
  skipped empty path segments inline while scanning.
- ✅ **Kept**: mutated node children/flattens arrays in-place during hash remap
  instead of allocating replacement arrays/objects.
- ✅ **Kept**: stability rerun with no code changes confirmed lower noise-floor
  best.
- ✅ **Kept**: default comparator fast path in `sortChildren` using
  decorate-sort-undecorate with precomputed sort keys.
- ✅ **Kept**: cached/reused root child set lookup in `buildPathGraph`.
- ✅ **Kept**: charCode-based flattened/dot detection in `sortChildren` hot
  path.
- ✅ **Kept**: inlined hashTreeKeys-specific key→id mapper (mirrors createIdMaps
  without reverse-map/generalized overhead).
- ✅ **Kept**: threaded active parent `Set` through `buildPathGraph` segment
  scan to avoid repeated parent-path Map lookups.
- **Current best:** `total_ms=132.77`.
- ❌ **Discarded**: micro-optimizations (template/string/object-spread tweaks).
- ❌ **Discarded**: caching sorted children between flatten/folder stages.
- ❌ **Discarded**: `path.split('/')` based parsing.
- ❌ **Discarded**: replacing `localeCompare` with raw lexical compare.
- ❌ **Discarded**: object-based mapped-key cache in `hashTreeKeys`.
- ❌ **Discarded**: trimming trailing slash in preprocessing.
- ❌ **Discarded**: null-prototype tree records (`Object.create(null)`).
- ❌ **Discarded**: replacing `Object.keys` iteration with `for..in` in
  `hashTreeKeys`.
- ❌ **Discarded**: array-first child accumulation with post-build dedupe (in
  place of `Set.add` per edge).
- ❌ **Discarded**: pre-hashing references during folder/flatten stages to
  shrink `hashTreeKeys` (made `buildFolderNodes` much slower).
- ❌ **Discarded**: additional root-branch restructuring in `buildPathGraph`.
- ❌ **Discarded**: swapping FNV-1a `hashId` for a shift-add rolling hash.
- ❌ **Discarded**: heavier flattened-chain cache object in `createLoaderUtils`.
- ❌ **Discarded**: single-pass inlined flattened/name detection rewrite inside
  `sortChildren` fast path.
- ❌ **Discarded**: reusing cached children arrays in flattened/folder node
  sorting (consistently regressed, sometimes severely).
- ❌ **Discarded**: two-pass hashTreeKeys remap (precompute all key IDs, then
  remap by lookup).
- ❌ **Discarded**: null-prototype object dictionary for hashTreeKeys key→id map
  (slower than Map).
