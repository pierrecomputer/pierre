# Shiki Web Worker Infrastructure

This module provides infrastructure for offloading Shiki's syntax highlighting to Web Worker threads, preventing main thread blocking during rendering.

## Architecture

```
┌───────────────────┐
│    Main Thread    │
│                   │
│  ShikiPoolManager │ ← Public API
│         ↓         │
│   WorkerPool.ts   │ ← Pool Manager
│         ↓         │
└─────────┬─────────┘
          │  postMessage
          ↓
┌──────────────────────────┐
│  Worker Threads (4x)     │
│                          │
│  shiki-worker.ts         │
│    - Initializes Shiki   │
│    - Calls codeToHast()  │
│    - Returns HAST        │
└──────────────────────────┘
```

## Files

- **types.ts** - Message protocol types for worker communication
- **shiki-worker.ts** - Worker script (runs in worker thread)
- **WorkerPool.ts** - Pool manager (creates/manages workers)
- **ShikiPoolManager.ts** - Public API (clean interface)
- **index.ts** - Module exports

## Usage

### Recommended Pattern

The recommended approach is to create a small helper in your application that
uses your bundler's worker syntax:

```typescript
// utils/createWorkerAPI.ts
import {
  ShikiPoolManager,
  type WorkerPoolOptions,
} from '@pierre/precision-diffs/worker';
import ShikiWorkerUrl from '@pierre/precision-diffs/worker/shiki-worker.js?worker&url';

export function createWorkerAPI(
  poolOptions?: WorkerPoolOptions
): ShikiPoolManager {
  return new ShikiPoolManager(
    () => new Worker(ShikiWorkerUrl, { type: 'module' }),
    poolOptions
  );
}
```

Then use it in your app:

```typescript
import { createWorkerAPI } from './utils/createWorkerAPI';

// Create worker pool with 5 workers
const workerAPI = createWorkerAPI({
  poolSize: 5,
  initOptions: {
    themes: ['pierre-dark', 'pierre-light'],
    langs: ['typescript', 'javascript'],
  },
});

// Initialize the pool (optional - auto-initializes on first use)
await workerAPI.ensureInitialized();

// Render a single file
const file = {
  name: 'example.ts',
  contents: 'const x = 42;',
};

const result = await workerAPI.renderFileToHast(file, {
  theme: 'pierre-dark',
});

console.log(result.lines); // Array of ElementContent

// Render a diff from two files
const oldFile = { name: 'example.ts', contents: 'const x = 1;' };
const newFile = { name: 'example.ts', contents: 'const x = 2;' };

const diffResult = await workerAPI.renderDiffToHast(oldFile, newFile, {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
});
console.log(diffResult.oldLines, diffResult.newLines);

// Render a diff from metadata (FileDiffMetadata from parsed patch)
const diffMetadata = {
  /* FileDiffMetadata object */
};
const metadataResult = await workerAPI.renderDiffMetadataToHast(diffMetadata, {
  theme: 'pierre-dark',
});

// Check pool status
console.log(workerAPI.getStats());
// { totalWorkers: 5, busyWorkers: 0, queuedTasks: 0, pendingTasks: 0 }

// Clean up when done
workerAPI.terminate();
```

### Integration with Different Bundlers

Create a helper specific to your bundler that handles worker creation.

#### Vite

```typescript
// utils/createWorkerAPI.ts
import {
  ShikiPoolManager,
  type WorkerPoolOptions,
} from '@pierre/precision-diffs/worker';
import ShikiWorkerUrl from '@pierre/precision-diffs/worker/shiki-worker.js?worker&url';

export function createWorkerAPI(
  poolOptions?: WorkerPoolOptions
): ShikiPoolManager {
  return new ShikiPoolManager(
    () => new Worker(ShikiWorkerUrl, { type: 'module' }),
    poolOptions
  );
}
```

#### Next.js

```typescript
// utils/createWorkerAPI.ts
'use client';

// Workers only work on the client side
import {
  ShikiPoolManager,
  type WorkerPoolOptions,
} from '@pierre/precision-diffs/worker';

// utils/createWorkerAPI.ts

export function createWorkerAPI(
  poolOptions?: WorkerPoolOptions
): ShikiPoolManager {
  return new ShikiPoolManager(
    () =>
      new Worker(
        new URL(
          '@pierre/precision-diffs/worker/shiki-worker.js',
          import.meta.url
        ),
        { type: 'module' }
      ),
    poolOptions
  );
}
```

Then use it in a client component:

```typescript
'use client';

import { createWorkerAPI } from '@/utils/createWorkerAPI';
import { useEffect, useState } from 'react';

export function CodeViewer() {
  const [workerAPI] = useState(() =>
    createWorkerAPI({
      poolSize: 4,
      initOptions: {
        themes: ['github-dark', 'github-light'],
      },
    })
  );

  useEffect(() => {
    return () => workerAPI.terminate();
  }, [workerAPI]);

  // Use workerAPI.renderFileToHast() etc.
}
```

**Important**: Workers only work in client components. Make sure your component has the `'use client'` directive if using App Router.

#### Webpack 5

```typescript
// utils/createWorkerAPI.ts
import {
  ShikiPoolManager,
  type WorkerPoolOptions,
} from '@pierre/precision-diffs/worker';

export function createWorkerAPI(
  poolOptions?: WorkerPoolOptions
): ShikiPoolManager {
  return new ShikiPoolManager(
    () =>
      new Worker(
        new URL(
          '@pierre/precision-diffs/worker/shiki-worker.js',
          import.meta.url
        ),
        { type: 'module' }
      ),
    poolOptions
  );
}
```

#### Rollup / Other Bundlers

If your bundler doesn't have special worker support:

1. Build and serve the worker file statically
2. Reference it by URL

```typescript
// utils/createWorkerAPI.ts
import {
  ShikiPoolManager,
  type WorkerPoolOptions,
} from '@pierre/precision-diffs/worker';

export function createWorkerAPI(
  poolOptions?: WorkerPoolOptions
): ShikiPoolManager {
  return new ShikiPoolManager(
    () => new Worker('/static/workers/shiki-worker.js', { type: 'module' }),
    poolOptions
  );
}
```

## API Reference

### `new ShikiPoolManager(workerFactory, poolOptions?)`

Creates a new worker pool manager.

**Parameters:**

- `workerFactory` - Function that creates a Worker instance
- `poolOptions` - Optional pool configuration
  - `poolSize` - Number of workers (default: 4)
  - `initOptions` - Initial themes/langs to load
    - `themes` - Array of theme names to preload
    - `langs` - Array of languages to preload (optional)
    - `preferWasmHighlighter` - Use WASM highlighter if available (optional)

**Returns:** `ShikiPoolManager`

### `ShikiPoolManager.renderFileToHast(file, options?)`

Render a single file to HAST.

**Parameters:**

- `file` - FileContents object with `name` and `contents`
- `options` - Optional render options
  - `theme` - Theme name or `{ dark: string, light: string }`
  - `lang` - Language override (auto-detected from filename if not provided)
  - `preferWasmHighlighter` - Use WASM highlighter (optional)
  - `hastOptions` - Additional CodeToHast options (optional)

**Returns:** `Promise<RenderFileResult>` - Object with `lines: ElementContent[]`

### `ShikiPoolManager.renderDiffToHast(oldFile, newFile, options?)`

Render a diff from two file contents.

**Parameters:**

- `oldFile` - Old FileContents
- `newFile` - New FileContents
- `options` - Optional render options (same as above)

**Returns:** `Promise<RenderDiffResult>` - Object with `oldLines` and `newLines` arrays

### `ShikiPoolManager.renderDiffMetadataToHast(diff, options?)`

Render a diff from parsed diff metadata (FileDiffMetadata).

**Parameters:**

- `diff` - FileDiffMetadata object from parsed patch
- `options` - Optional render options (same as above)

**Returns:** `Promise<RenderDiffResult>` - Object with `oldLines` and `newLines` arrays

### `ShikiPoolManager.ensureInitialized()`

Explicitly initialize the worker pool. Optional - the pool auto-initializes on first use.

**Returns:** `Promise<void>`

### `ShikiPoolManager.terminate()`

Terminate all workers and clean up resources.

### `ShikiPoolManager.getStats()`

Get pool statistics.

**Returns:**

```typescript
{
  totalWorkers: number; // Total workers in pool
  busyWorkers: number; // Workers currently processing tasks
  queuedTasks: number; // Tasks waiting for available worker
  pendingTasks: number; // Tasks sent to workers, awaiting response
}
```

## Performance Considerations

- **Worker Overhead**: Creating workers has overhead. Pre-initialize if possible.
- **Serialization Cost**: Large files have serialization cost when posting to workers.
- **Pool Size**: More workers = more parallelism but more memory. 4 is a good default.
- **Language/Theme Loading**: Pre-load common languages/themes in `initOptions`.

## Troubleshooting

### Worker not found

Make sure the worker script is properly bundled and served. Check browser console for 404 errors.

### "Highlighter not initialized" error

The worker needs to initialize before handling requests. The API handles this automatically, but custom usage might need explicit initialization.

### Memory usage increasing

Make sure to call `terminate()` when done to free worker resources.

## Future Improvements

- [ ] Automatic worker restart on failure
- [ ] Better error recovery
- [ ] Smarter work distribution (load balancing)
- [ ] Worker-side caching of parsed grammars
