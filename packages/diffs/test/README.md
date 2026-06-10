# @pierre/diffs tests

Run from this package directory:

```bash
AGENT=1 bun test
```

## Conventions

- Shared DOM bootstrap lives in `domHarness.ts` (`installDom` always installs
  the same superset of globals — per-file subsets drifted in the past).
- Shared assertion/projection helpers live in `testUtils.ts`. Prefer asserting
  behavioral projections (`projectColumn`, `rowDigests`, `hunkDigest`,
  `annotationProjection`) over snapshotting whole render results.
- Snapshot policy: `FileRenderer.test.ts` holds the suite's single full-fidelity
  highlighted-AST snapshot (the token/style canary). Every other snapshot should
  be a compact projection of just the behavior its test owns, small enough to
  review line by line. When a snapshot fails, read the diff — do not reflexively
  `bun test -u`.

## Known coverage gaps (confirmed by the 2026-06 test audit)

Important behaviors that currently have no direct tests, in rough priority
order. If you touch one of these areas, consider adding the missing coverage:

- **WorkerPoolManager pipeline** (`src/worker/WorkerPoolManager.ts`): task
  routing, result caching by cacheKey, stale-response gating after
  `setRenderOptions`, error fallback freeing the worker, init-failure fallback
  to the shared highlighter. Only the terminate-during-initialize paths are
  tested.
- **SSR → hydrate round trip** (`src/ssr/preloadDiffs.ts`): none of the five
  preload entry points is imported by any test, and `hydrate()` never runs
  against real prerendered HTML (hydration.test.ts uses purpose-built fakes).
- **ScrollSyncManager**: split-diff horizontal scroll synchronization.
- **Virtualizer / ReducedVirtualizer** (`src/managers/`): the real scroll
  window, visibility, and height-reconciliation anchoring (component tests stub
  the virtualizer).
- **Mouse-driven line selection** (`src/managers/InteractionManager.ts`): drag,
  shift-click extension, single-line unselect.
- **getFiletypeFromFileName**: filename → language detection and the custom
  extension registry.
- **shiki-stream** (`src/shiki-stream/`): publicly exported streaming tokenizer
  with chunk-boundary/grammar-state logic, zero tests.
- **UnresolvedFile** merge-conflict click-to-resolve wiring.
- **Interaction option updates, disable direction**: only the enable direction
  of `setOptions` interaction toggles is covered.
- **getMeasuredScrollbarGutter**: the namesake measurement function of the
  scrollbar-gutter CSS helpers.
- **createFileHeaderElement**: diff metadata counts and change-type rendering
  branches.
- **DOM virtualization buffers** (`data-virtualizer-buffer`): created by
  File/FileDiff `applyBuffers` on live DOM; no test asserts them anywhere.
