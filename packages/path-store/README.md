# @pierre/path-store

Underlying data structure to be used to power a file tree UI.

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
- Trade memory usage for speed, but no leaks
- Runtime agnostic
- No dependencies
- Extreme performance
  - Willing to sacrifice some code readability for speed
- Collision callbacks so you can decide how to handle
  - defaults to override

## Usage

```ts
import { PathStore } from '@pierre/path-store';

const paths = [
  'src/components/index.ts',
  'src/components/Button.tsx',
  'src/components/Checkbox.tsx',
  'src/index.ts',
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
//   operation: 'remove',
//   changeset: { path: 'README.md' }
// }

// Rename is just a move
store.move('src/index.ts', 'src/index.mjs');
// log: modification: {
//   operation: 'move',
//   changeset: { from: 'src/index.ts', to: 'src/index.mjs' }
// }

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
];
*/
```

## Acknowledgements

Inspired by [@headless-tree/core](https://github.com/lukasbach/headless-tree) by
[@lukasbach](https://github.com/lukasbach).
