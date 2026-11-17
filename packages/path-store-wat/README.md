# @pierre/path-store-wat

`@pierre/path-store-wat` is a private engine package: the same `PathStore` API
as `@pierre/path-store`, with the tree built and mutated inside WebAssembly
memory. `@pierre/trees` exposes it as `wasmEngine` from `@pierre/trees/wasm`;
nothing else should import it directly.

## Why

Ingestion of large presorted path lists is the metric. The JS builder pays for a
string slice, a `Map` lookup, and an object allocation per path segment; the
wasm engine scans the input bytes once, interns names in an open addressing
hash, and appends to struct-of-arrays tables.

Build time, p50, `initialExpansion: 'open'`, presorted input
(`moonx path-store-wat:bench`):

| dataset   | paths     | JS store (V8) | wasm from `string[]` | wasm from bytes |
| --------- | --------- | ------------- | -------------------- | --------------- |
| linux-10x | 929,140   | 243 ms        | 114 ms               | 52 ms           |
| AOSP      | 1,592,568 | 728 ms        | 287 ms               | 177 ms          |

From `string[]` the remaining cost is the copy of every path into wasm memory.
`PathStore.preparePresortedBytes(bytes)` accepts newline-delimited UTF-8 paths
already in store order and skips that copy, as well as the `JSON.parse` the
caller would otherwise run.

## Layout

- `src/*.wat` — the engine. `memory.wat` owns the heap (bump allocation,
  relocating growth, `$compact`), `segments.wat` the name table, `ingest.wat`
  the presorted ingest and CSR child lists, `state.wat` expansion and counts,
  `lookup.wat` path resolution and canonical listing, `projection.wat` the
  visible-row walks, `mutate.wat` add/remove/move, and `compare.wat` the natural
  sort order.
- `lib/engine.ts` — typed wrapper over the instance: table views that are
  rebuilt when a block moves, string encode/decode.
- `lib/store.ts` — `PathStore`: turns node ids into rows, paths, and events.
  Prepared inputs, the sort comparator for non-ASCII names, and the public types
  come from `@pierre/path-store`, so prepared inputs work with either engine.

## Verification

```bash
moonx path-store-wat:test        # smoke tests + path-store's suites against this engine
moonx path-store-wat:typecheck
moonx path-store-wat:bench       # both engines, Bun
moonx path-store-wat:bench-node  # both engines, Node/V8
```

`test/conformance.test.ts` runs `@pierre/path-store`'s own suites with the
`PathStore` export swapped for this engine, so the two stay behaviourally
identical.

## Known differences

- `StaticPathStore`, the scheduler, and `createVisibleTreeProjection` are not
  reimplemented; `@pierre/trees` does not use them.
- Benchmark instrumentation (`withBenchmarkPhase`) is not wired.
