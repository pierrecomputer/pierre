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

Benchmark workflow:

- `bun ws path-store benchmark -- --filter '^visible-middle/linux-5x/200$'`
- `bun ws path-store benchmark -- --filter '^visible-middle/linux-5x/200$' --json --samples`
- `bun ws path-store benchmark -- --compare baseline.json candidate.json`

Chrome profiler workflow:

- `bun ws path-store profile:demo`
- `bun ws path-store profile:demo -- --all-actions`
- `bun ws path-store profile:demo -- --action rename-visible-folder --runs 5`
- `bun ws path-store profile:demo -- --workload demo-small --action collapse-folder-above-viewport --visible-count 30 --offset 8`

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
import { PathStore } from '@pierre/path-store';

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
store.on('*', ({ operation, changeset }) => {
  console.log('modification:', { operation, changeset });
});

// Perform modifications
store.add('src/components/Card.tsx');
// log: modification: {
//   operation: 'add',
//   changeset: { path: 'src/components/Card.tsx' }
// }

store.remove('README.md');
// log: modification: {
//   operation: 'remove',
//   changeset: { path: 'README.md' }
// }

store.move('package.json', 'src/package.json');
// log: modification: {
//   operation: 'move',
//   changeset: { from: 'package.json', to: 'src/package.json' }
// }

// Rename is just a move
store.move('src/index.ts', 'src/index.mjs');
// log: modification: {
//   operation: 'move',
//   changeset: { from: 'src/index.ts', to: 'src/index.mjs' }
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
```

## Acknowledgements

Inspired by [@headless-tree/core](https://github.com/lukasbach/headless-tree) by
[@lukasbach](https://github.com/lukasbach).
