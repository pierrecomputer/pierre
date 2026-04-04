# @pierre/path-store

Underlying data structure to be used to power a file tree UI.

For the detailed architecture and implementation plan, see
[IMPLEMENTATION.md](./IMPLEMENTATION.md).

Current limitation:

- `flattenEmptyDirectories` flattens single-child directory chains in the
  visible projection while leaving canonical topology unchanged. It defaults to
  `true`; pass `false` to disable it when you want one row per canonical
  directory.

Current useful API:

- `initialExpansion` can seed directory visibility as `'closed'`, `'open'`, or a
  numeric depth, with `initialExpandedPaths` acting as explicit overrides on
  top.
- `store.on(...)` now emits typed semantic events with:
  - `canonicalChanged`
  - `projectionChanged`
  - `visibleCountDelta`
  - operation-specific canonical paths like `path`, `from`, and `to`
- Phase 7A async primitives now exist for explicit child-state / patching:
  - `markDirectoryUnloaded(path)`
  - `beginChildLoad(path)`
  - `applyChildPatch(attempt, patch)`
  - `completeChildLoad(attempt)`
  - `failChildLoad(attempt, errorMessage?)`
  - `getDirectoryLoadState(path)`
- `PathStoreChildPatch.metadata` is currently reserved for future async/count
  hints and is intentionally ignored in Phase 7A.
- `markDirectoryUnloaded(path)` is intentionally narrow in 7A: it only works for
  directories that do not currently have known children.
- Visible rows now expose async state sparsely:
  - `isLoading` is the fast convenience flag
  - `loadState` only appears when a directory row is not in the default loaded
    state
- Phase 7A covers store-owned async semantics only. Scheduler/worker strategy,
  placeholder reservation, and `knownChildCount` product behavior remain
  deferred to later work.
- Phase 7B adds an **optional** cooperative scheduler helper on the root export:
  - `createPathStoreScheduler({ store, ... })`
  - caller-supplied priority/order only
  - no built-in viewport priority, prefetch policy, or count-hint strategy
  - `chunkBudgetMs` is wall time between yields, so awaited `createPatch()` work
    also counts against the same slice budget
  - worker mode remains a documented future seam, not a public first-pass
    runtime
- Phase 8A adds a **manual** cleanup API:
  - `store.cleanup()` defaults to stable mode and preserves IDs
  - `store.cleanup({ mode: 'aggressive' })` is explicit and may reset IDs for
    denser compaction
  - cleanup throws while directory loads are active or while a batch is open
  - stable cleanup only reclaims **trailing** tombstone slots; aggressive mode
    is the path for fully dense node-array compaction
  - stable cleanup clears path caches, so the next visible read may
    rematerialize path strings
- Phase 8B adds a **public** `StaticPathStore`:
  - keeps the current read/query surface
  - `list()`, `getVisibleCount()`, `getVisibleSlice()`, `expand()`, `collapse()`
  - omits topology mutation methods and the mutable event emitter
  - ships because its read benchmarks beat the mutable baseline on the
    representative `linux-5x` scenarios
  - expand/collapse currently recomputes static visible counts globally, and the
    benchmark suite now measures that path explicitly

Benchmark workflow:

- `bun ws path-store benchmark -- --filter '^visible-middle/linux-5x/200$'`
- `bun ws path-store benchmark -- --filter '^visible-middle/linux-5x/200$' --json --samples`
- `bun ws path-store benchmark -- --compare baseline.json candidate.json`

Chrome profiler workflow:

- `bun ws path-store profile:demo`
- `bun ws path-store profile:demo -- --all-actions`
- `bun ws path-store profile:demo -- --action rename-visible-folder --runs 5`
- `bun ws path-store profile:demo -- --workload demo-small --action collapse-folder-above-viewport --visible-count 30 --offset 8`
- `bun ws path-store profile:demo -- --workload demo-small --action cooperative-apply-async-patch-yieldy --runs 1`

Cooperative helper benchmark workflow:

- `bun ws path-store benchmark -- --preset full --filter '^(async/apply-child-patch/linux-5x/200|cooperative/apply-child-patch/linux-5x/200|cooperative/apply-child-patch-yieldy/linux-5x/200|cooperative/cancel-mid-queue/linux-5x/200)$'`
- `bun ws path-store benchmark -- --preset async`
- `bun ws path-store benchmark -- --preset mutation`
- `bun ws path-store benchmark -- --preset cleanup`
- `bun ws path-store benchmark -- --preset static`

Use `--json --samples` when you want confidence-aware comparisons for an
automated optimization loop. Compare mode accepts a candidate when the p50
improvement clears the configured threshold and its bootstrap confidence
interval stays on the improvement side.

## Goals

- Fast ingestion of very large simple string path inputs
- Non-linear complexity of modification operations (add/remove/rename/move)
  - When possible, these operations should be constant time
- Modification functions
  - `store.add`
  - `store.remove`
  - `store.move`
- Modification events
  - `store.on(modification, …)`
- Lazy computation where possible
- Increase performance by owning expansion state and a visible range of items
  - e.g. if you wire this into a file tree, but virtualization is turned on, you
    can provide the range of paths that is actually being rendered
- Trade memory usage for speed, but no leaks
- Runtime agnostic
- No dependencies
- Extreme performance
  - Willing to sacrifice some code readability for speed
- Collision callbacks so you can decide how to handle
  - defaults to error

## Usage

```ts
import {
  PathStore,
  StaticPathStore,
  createPathStoreScheduler,
} from '@pierre/path-store';

const paths = [
  'src/components/index.ts',
  'src/components/Button.tsx',
  'src/components/Checkbox.tsx',
  'src/index.ts',
  'tmp/', // empty folders end with `/`
  'package.json',
  'README.md',
];

// Create a new store
const store = new PathStore({
  paths,
});

// Listen for modifications
store.on('*', (event) => {
  console.log('modification:', {
    operation: event.operation,
    projectionChanged: event.projectionChanged,
    visibleCountDelta: event.visibleCountDelta,
  });
});

// Perform modifications
store.add('src/components/Card.tsx');
// log: modification: {
//   operation: 'add',
//   path: 'src/components/Card.tsx',
//   canonicalChanged: true,
//   projectionChanged: true,
//   visibleCountDelta: 0,
// }

store.remove('README.md');
// log: modification: {
//   operation: 'remove',
//   path: 'README.md',
//   recursive: false,
//   canonicalChanged: true,
//   projectionChanged: true,
//   visibleCountDelta: -1,
// }

store.move('package.json', 'src/package.json');
// log: modification: {
//   operation: 'move',
//   from: 'package.json',
//   to: 'src/package.json',
//   canonicalChanged: true,
//   projectionChanged: true,
//   visibleCountDelta: 0,
// }

// Rename is just a move
store.move('src/index.ts', 'src/index.mjs');
// log: modification: {
//   operation: 'move',
//   from: 'src/index.ts',
//   to: 'src/index.mjs',
//   canonicalChanged: true,
//   projectionChanged: true,
//   visibleCountDelta: 0,
// }

// Compute just the subtree of paths below here and return
store.list('src/components/');
/*
// Note: I haven't decided if it's better to return full paths or relative paths here
[
  'index.ts',
  'Button.tsx',
  'Card.tsx',
  'Checkbox.tsx',
];
*/

// Compute the entire tree and list paths
store.list();

/*
[
  'src/components/index.ts',
  'src/components/Button.tsx',
  'src/components/Card.tsx',
  'src/components/Checkbox.tsx',
  'src/index.mjs',
  'src/package.json',
  'tmp/',
];
*/

store.getVisibleSlice(0, 9);

const scheduler = createPathStoreScheduler({
  chunkBudgetMs: 8,
  maxTasksPerSlice: 1,
  store,
});

scheduler.enqueue({
  completeOnSuccess: false,
  createPatch() {
    return {
      operations: [{ path: 'tmp/file.txt', type: 'add' }],
    };
  },
  path: 'tmp/',
  priority: 100,
});

const cleanupResult = store.cleanup();
console.log(cleanupResult.idsPreserved); // true

const aggressiveCleanupResult = store.cleanup({ mode: 'aggressive' });
console.log(aggressiveCleanupResult.idsPreserved); // false

const staticStore = new StaticPathStore({
  initialExpansion: 'open',
  paths,
});

staticStore.collapse('src/components/');
staticStore.expand('src/components/');
staticStore.getVisibleSlice(0, 9);
```

## Acknowledgements

Inspired by [@headless-tree/core](https://github.com/lukasbach/headless-tree) by
[@lukasbach](https://github.com/lukasbach).
