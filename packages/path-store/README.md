# @pierre/path-store

`@pierre/path-store` is a private engine package. It powers `@pierre/trees`;
`@pierre/trees` owns the public product API.

Use this package from the tree implementation, package-local tests, benchmarks,
and profiles. Do not document it as an installable product surface.

## Engine invariants

- Callers use canonical slash-delimited path strings at the package boundary.
  The store keeps numeric node IDs internal.
- The engine is runtime agnostic and has no runtime dependencies.
- Visible reads are slice-first. Optimize `getVisibleCount()`,
  `getVisibleSlice(start, end)`, and `createVisibleTreeProjection()` before
  full-list materialization.
- `flattenEmptyDirectories` changes only the visible projection. It does not
  rewrite canonical topology or mutation paths.
- Mutation events report semantic invalidation data, including canonical path
  fields, `canonicalChanged`, `projectionChanged`, and `visibleCountDelta` when
  the store can compute it honestly.
- Async child loading stays explicit: callers mark directories unloaded, begin a
  load attempt, apply child patches, then complete or fail the attempt.
- Cleanup is explicit. Stable cleanup preserves IDs; aggressive cleanup may
  compact IDs.
- `StaticPathStore` keeps the read/query surface for read-heavy cases and omits
  mutable topology APIs.

## Internal facade

`src/index.ts` exports the engine surface used by tests, scripts, benchmarks,
and `@pierre/trees`:

- `PathStore`
- `StaticPathStore`
- `createPathStoreScheduler`
- `createVisibleTreeProjection`
- public-looking path-store types from `public-types.ts`
- scheduler types from `scheduler.ts`

Private engine types stay in `internal-types.ts` or implementation files.

## Verification and profiling

Run these commands from the repository root:

```bash
bun ws path-store test
bun ws path-store tsc
bun ws path-store benchmark -- --preset mutation
bun ws path-store benchmark -- --preset cleanup
bun ws path-store benchmark -- --preset static
bun ws path-store benchmark:visible-tree-projection
bun ws path-store profile:demo
bun ws path-store profile:visible-tree-projection
```
