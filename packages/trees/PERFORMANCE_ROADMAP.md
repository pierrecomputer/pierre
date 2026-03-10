# Trees Performance Roadmap (Steps 3-6)

This roadmap captures the concrete next implementation path after the completed
step 1 (single-build sync path) and step 2 (lazy ancestor derivation).

## Step 3: True Lazy Loader (`generateLazyDataLoaderV2`)

- Add a new loader implementation that avoids eager full-tree preprocessing.
- Defer flatten-chain discovery and ID assignment to the branches that are
  actually opened.
- Keep branch-level caches for children and flattened endpoints.
- Keep `generateLazyDataLoader` as fallback until parity and perf checks pass.

Acceptance:

- Collapsed first render is faster than the current lazy loader.
- Visible tree output matches sync loader for the same expansion/search state.

## Step 4: Async Loader Mode

- Add a new top-level option: `loaderMode?: 'sync' | 'lazy' | 'async'` (default
  `'sync'`).
- Keep `useLazyDataLoader` as compatibility shorthand for now.
- When `loaderMode === 'async'`, wire `asyncDataLoaderFeature` and use
  incremental data fetching with in-memory adapters for local file arrays.
- Ensure loading states do not regress keyboard navigation and selection.

Acceptance:

- Initial collapsed render is near-instant with progressive branch hydration.
- Async mode produces equivalent final visible structure.

## Step 5: Progressive Expansion Strategy

- Add `initialExpansionStrategy?: 'immediate' | 'progressive'` (default
  `'immediate'`).
- In progressive mode, expand large initial sets in chunked rebuild cycles.
- Keep deterministic final state and expose completion via callback/event.

Acceptance:

- `initialExpandedItems` with huge sets does not block the main thread for a
  single long frame.
- Final expanded state exactly matches immediate mode.

## Step 6: O(1) Focus Index Lookup

- Replace per-render `findIndex` lookup for focused item in virtualized mode
  with an `itemId -> index` map for the current `items` array.
- Rebuild the map only when `items` identity changes.

Acceptance:

- Focus scroll targeting remains correct.
- Render hot path no longer includes O(n) focus index scans.

## Measurement and Guardrails

- Keep demo perf logging enabled for: `tree-model-build`, `path-map-build`,
  `data-loader-build`, `core-rebuild`, `virtualized-first-render`.
- Add repeatable benchmark scripts around linux dataset medians before flipping
  defaults for steps 3-5.
