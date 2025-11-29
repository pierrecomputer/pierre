import type { PreloadFileOptions } from '@pierre/precision-diffs/ssr';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
} as const;

export const WORKER_POOL_HELPER_VITE: PreloadFileOptions<undefined> = {
  file: {
    name: 'createWorkerAPI.ts',
    contents: `// utils/createWorkerAPI.ts
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
}`,
  },
  options,
};

export const WORKER_POOL_HELPER_NEXTJS: PreloadFileOptions<undefined> = {
  file: {
    name: 'createWorkerAPI.ts',
    contents: `// utils/createWorkerAPI.ts
'use client';

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
}`,
  },
  options,
};

export const WORKER_POOL_HELPER_WEBPACK: PreloadFileOptions<undefined> = {
  file: {
    name: 'createWorkerAPI.ts',
    contents: `// utils/createWorkerAPI.ts
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
}`,
  },
  options,
};

export const WORKER_POOL_HELPER_ESBUILD: PreloadFileOptions<undefined> = {
  file: {
    name: 'createWorkerAPI.ts',
    contents: `// utils/createWorkerAPI.ts
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
}`,
  },
  options,
};

export const WORKER_POOL_HELPER_STATIC: PreloadFileOptions<undefined> = {
  file: {
    name: 'createWorkerAPI.ts',
    contents: `// utils/createWorkerAPI.ts
// For Rollup or bundlers without special worker support:
// 1. Copy shiki-worker.js to your static/public folder
// 2. Reference it by URL

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
}`,
  },
  options,
};

export const WORKER_POOL_HELPER_VANILLA: PreloadFileOptions<undefined> = {
  file: {
    name: 'worker-setup.js',
    contents: `// No bundler / Vanilla JS
// 1. Include precision-diffs as a script or use import maps
// 2. Host shiki-worker.js on your server

import {
  ShikiPoolManager,
} from '@pierre/precision-diffs/worker';

// Create worker pool pointing to your hosted worker file
const workerAPI = new ShikiPoolManager(
  () => new Worker('/path/to/shiki-worker.js', { type: 'module' }),
  {
    poolSize: 8,
    initOptions: {
      themes: ['pierre-dark', 'pierre-light'],
    },
  }
);

// Use the API
async function highlightCode() {
  const result = await workerAPI.renderFileToHast(
    { name: 'example.ts', contents: 'const x = 42;' },
    { theme: 'pierre-dark' }
  );
  console.log(result.lines);
}`,
  },
  options,
};

export const WORKER_POOL_USAGE: PreloadFileOptions<undefined> = {
  file: {
    name: 'example.ts',
    contents: `import { createWorkerAPI } from './utils/createWorkerAPI';

// Create worker pool with 8 workers
const workerAPI = createWorkerAPI({
  poolSize: 8,
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

// Check pool status
console.log(workerAPI.getStats());
// { totalWorkers: 8, busyWorkers: 0, queuedTasks: 0, pendingTasks: 0 }

// Clean up when done
workerAPI.terminate();`,
  },
  options,
};

export const WORKER_POOL_REACT_COMPONENT: PreloadFileOptions<undefined> = {
  file: {
    name: 'CodeViewer.tsx',
    contents: `'use client';

import { createWorkerAPI } from '@/utils/createWorkerAPI';
import { useEffect, useState } from 'react';

export function CodeViewer() {
  const [workerAPI] = useState(() =>
    createWorkerAPI({
      poolSize: 8,
      initOptions: {
        themes: ['pierre-dark', 'pierre-light'],
      },
    })
  );

  useEffect(() => {
    return () => workerAPI.terminate();
  }, [workerAPI]);

  // Use workerAPI.renderFileToHast() etc.
}`,
  },
  options,
};

export const WORKER_POOL_API_REFERENCE: PreloadFileOptions<undefined> = {
  file: {
    name: 'api-reference.ts',
    contents: `// ShikiPoolManager constructor
new ShikiPoolManager(workerFactory, poolOptions?)

// Parameters:
// - workerFactory: () => Worker - Function that creates a Worker instance
// - poolOptions?: WorkerPoolOptions
//     - poolSize: number (default: 8) - Number of workers
//     - initOptions: InitOptions
//         - themes: string[] - Array of theme names to preload
//         - langs?: string[] - Array of languages to preload
//         - preferWasmHighlighter?: boolean - Use WASM highlighter

// Methods:
workerAPI.renderFileToHast(file, options?)
// Returns: Promise<{ lines: ElementContent[] }>

workerAPI.renderDiffToHast(oldFile, newFile, options?)
// Returns: Promise<{ oldLines: ElementContent[], newLines: ElementContent[] }>

workerAPI.renderDiffMetadataToHast(diff, options?)
// Returns: Promise<{ oldLines: ElementContent[], newLines: ElementContent[] }>

workerAPI.ensureInitialized()
// Returns: Promise<void>

workerAPI.terminate()
// Terminates all workers

workerAPI.getStats()
// Returns: { totalWorkers, busyWorkers, queuedTasks, pendingTasks }`,
  },
  options,
};
