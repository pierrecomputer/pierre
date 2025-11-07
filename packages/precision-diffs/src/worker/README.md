# Shiki Web Worker Infrastructure

This module provides infrastructure for offloading Shiki's syntax highlighting to Web Worker threads, preventing main thread blocking during rendering.

## Architecture

```
┌─────────────────┐
│   Main Thread   │
│                 │
│  worker-api.ts  │ ← Public API
│       ↓         │
│  worker-pool.ts │ ← Pool Manager
│       ↓         │
└────────┬────────┘
         │ postMessage
         ↓
┌────────────────────────────────┐
│      Worker Threads (4x)       │
│                                │
│  shiki-worker.ts               │
│    - Initializes Shiki         │
│    - Calls codeToHast()        │
│    - Returns HAST              │
└────────────────────────────────┘
```

## Files

- **types.ts** - Message protocol types for worker communication
- **shiki-worker.ts** - Worker script (runs in worker thread)
- **worker-pool.ts** - Pool manager (creates/manages workers)
- **worker-api.ts** - Public API (clean interface)
- **index.ts** - Module exports

## Usage

### Basic Example

```typescript
import { createShikiWorkerAPI } from '@pierre/precision-diffs/worker';

// Create a worker API instance
const workerAPI = createShikiWorkerAPI('/path/to/shiki-worker.js', {
  poolSize: 4, // Number of worker threads
  initOptions: {
    themes: ['github-dark', 'github-light'],
    langs: ['typescript', 'javascript', 'python'],
  },
});

// Render a single file
const file = {
  name: 'example.ts',
  contents: `
    function greet(name: string) {
      console.log(\`Hello, \${name}!\`);
    }
  `,
};

const hast = await workerAPI.renderFileToHast(file, {
  theme: 'github-dark',
  lang: 'typescript',
});

// Render a diff
const oldFile = {
  name: 'example.ts',
  contents: 'const x = 1;',
};

const newFile = {
  name: 'example.ts',
  contents: 'const x = 2;',
};

const diffHast = await workerAPI.renderDiffToHast(oldFile, newFile, {
  theme: 'github-dark',
});

// Check pool status
console.log(workerAPI.getStats());
// { totalWorkers: 4, busyWorkers: 0, queuedTasks: 0, pendingTasks: 0 }

// Clean up when done
workerAPI.terminate();
```

### Integration with Bundlers

The worker script needs to be bundled separately as a worker entry point.

#### Vite

```typescript
// Usage
import ShikiWorkerUrl from './worker/shiki-worker?worker&url';

// In your vite.config.ts
export default {
  worker: {
    format: 'es',
  },
};

const workerAPI = createShikiWorkerAPI(ShikiWorkerUrl);
```

#### Webpack

```typescript
// Usage with webpack 5
const workerAPI = createShikiWorkerAPI(
  new URL('./worker/shiki-worker.ts', import.meta.url)
);
```

#### Manual Setup

If your bundler doesn't have special worker support, you'll need to:

1. Build the worker separately
2. Serve it as a static file
3. Reference it by URL

```typescript
const workerAPI = createShikiWorkerAPI('/static/workers/shiki-worker.js');
```

## API Reference

### `createShikiWorkerAPI(workerUrl, poolOptions?)`

Creates a new worker API instance.

**Parameters:**

- `workerUrl` - URL or path to the worker script
- `poolOptions` - Optional pool configuration
  - `poolSize` - Number of workers (default: 4)
  - `initOptions` - Initial themes/langs to load

**Returns:** `ShikiWorkerAPI`

### `ShikiWorkerAPI.renderFileToHast(file, options?)`

Render a single file to HAST.

**Parameters:**

- `file` - FileContents object with `name` and `contents`
- `options` - Render options (theme, lang, etc.)

**Returns:** `Promise<Root>` - HAST tree

### `ShikiWorkerAPI.renderDiffToHast(oldFile, newFile, options?)`

Render a diff to HAST.

**Parameters:**

- `oldFile` - Old FileContents
- `newFile` - New FileContents
- `options` - Render options

**Returns:** `Promise<Root>` - Composite HAST tree with both sides

### `ShikiWorkerAPI.initialize()`

Explicitly initialize the worker pool (optional - auto-initializes on first use).

### `ShikiWorkerAPI.terminate()`

Terminate all workers and clean up resources.

### `ShikiWorkerAPI.getStats()`

Get pool statistics.

**Returns:**

```typescript
{
  totalWorkers: number;
  busyWorkers: number;
  queuedTasks: number;
  pendingTasks: number;
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
- [ ] Support for streaming/incremental rendering
- [ ] Worker warmup strategies
- [ ] Smarter work distribution (load balancing)
- [ ] Worker-side caching of parsed grammars
