import type { PreloadFileOptions } from '@pierre/precision-diffs/ssr';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
} as const;

export const WORKER_POOL_HELPER_VITE: PreloadFileOptions<undefined> = {
  file: {
    name: 'utils/workerFactory.ts',
    contents: `import ShikiWorkerUrl from '@pierre/precision-diffs/worker/shiki-worker.js?worker&url';

export function workerFactory(): Worker {
  return new Worker(ShikiWorkerUrl, { type: 'module' });
}`,
  },
  options,
};

export const WORKER_POOL_HELPER_NEXTJS: PreloadFileOptions<undefined> = {
  file: {
    name: 'utils/workerFactory.ts',
    contents: `'use client';

export function workerFactory(): Worker {
  return new Worker(
    new URL(
      '@pierre/precision-diffs/worker/shiki-worker.js',
      import.meta.url
    ),
    { type: 'module' }
  );
}`,
  },
  options,
};

export const WORKER_POOL_HELPER_WEBPACK: PreloadFileOptions<undefined> = {
  file: {
    name: 'utils/workerFactory.ts',
    contents: `export function workerFactory(): Worker {
  return new Worker(
    new URL(
      '@pierre/precision-diffs/worker/shiki-worker.js',
      import.meta.url
    ),
    { type: 'module' }
  );
}`,
  },
  options,
};

export const WORKER_POOL_HELPER_ESBUILD: PreloadFileOptions<undefined> = {
  file: {
    name: 'utils/workerFactory.ts',
    contents: `export function workerFactory(): Worker {
  return new Worker(
    new URL(
      '@pierre/precision-diffs/worker/shiki-worker.js',
      import.meta.url
    ),
    { type: 'module' }
  );
}`,
  },
  options,
};

export const WORKER_POOL_HELPER_STATIC: PreloadFileOptions<undefined> = {
  file: {
    name: 'utils/workerFactory.ts',
    contents: `// For Rollup or bundlers without special worker support:
// 1. Copy shiki-worker.js to your static/public folder
// 2. Reference it by URL

export function workerFactory(): Worker {
  return new Worker('/static/workers/shiki-worker.js', { type: 'module' });
}`,
  },
  options,
};

export const WORKER_POOL_HELPER_VANILLA: PreloadFileOptions<undefined> = {
  file: {
    name: 'utils/workerFactory.js',
    contents: `// No bundler / Vanilla JS
// Host shiki-worker.js on your server and reference it by URL

export function workerFactory() {
  return new Worker('/path/to/shiki-worker.js', { type: 'module' });
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

export const WORKER_POOL_REACT_USAGE: PreloadFileOptions<undefined> = {
  file: {
    name: 'HighlightProvider.tsx',
    contents: `// components/HighlightProvider.tsx
'use client';

import { WorkerPoolContextProvider } from '@pierre/precision-diffs/react';
import type { ReactNode } from 'react';
import { workerFactory } from '@/utils/workerFactory';

// Create a client component that wraps children with the worker pool.
// Import this in your layout to provide the worker pool to all pages.
export function HighlightProvider({ children }: { children: ReactNode }) {
  return (
    <WorkerPoolContextProvider
      poolOptions={{
        workerFactory,
        // poolSize defaults to 8. More workers = more parallelism but
        // also more memory. Too many can actually slow things down.
        // poolSize: 8,
      }}
      highlighterOptions={{
        theme: { dark: 'pierre-dark', light: 'pierre-light' },
        // Optionally preload languages to avoid lazy-loading delays
        langs: ['typescript', 'javascript', 'css', 'html'],
      }}
    >
      {children}
    </WorkerPoolContextProvider>
  );
}

// layout.tsx
// import { HighlightProvider } from '@/components/HighlightProvider';
//
// export default function Layout({ children }) {
//   return (
//     <html>
//       <body>
//         <HighlightProvider>{children}</HighlightProvider>
//       </body>
//     </html>
//   );
// }

// Any FileDiff or File component nested within the layout will
// automatically use the worker pool—no additional props required.`,
  },
  options,
};

export const WORKER_POOL_VANILLA_USAGE: PreloadFileOptions<undefined> = {
  file: {
    name: 'vanilla-worker-usage.ts',
    contents: `import { FileDiff } from '@pierre/precision-diffs';
import {
  getOrCreateWorkerPoolSingleton,
  terminateWorkerPoolSingleton,
} from '@pierre/precision-diffs/worker';
import { workerFactory } from './utils/workerFactory';

// Create a singleton worker pool instance using your workerFactory.
// This ensures the same pool is reused across your app.
const workerPool = getOrCreateWorkerPoolSingleton({
  poolOptions: {
    workerFactory,
    // poolSize defaults to 8. More workers = more parallelism but
    // also more memory. Too many can actually slow things down.
    // poolSize: 8,
  },
  highlighterOptions: {
    theme: { dark: 'pierre-dark', light: 'pierre-light' },
    // Optionally preload languages to avoid lazy-loading delays
    langs: ['typescript', 'javascript', 'css', 'html'],
  },
});

// Pass the workerPool to FileDiff to offload syntax highlighting
const instance = new FileDiff({
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  workerPool,
});

await instance.render({
  oldFile: { name: 'example.ts', contents: 'const x = 1;' },
  newFile: { name: 'example.ts', contents: 'const x = 2;' },
  containerWrapper: document.body,
});

// Optional: terminate workers when no longer needed (e.g., SPA navigation)
// Page unload automatically cleans up workers, but for SPAs you may want
// to call this when unmounting to free resources sooner.
// terminateWorkerPoolSingleton();`,
  },
  options,
};

export const WORKER_POOL_API_REFERENCE: PreloadFileOptions<undefined> = {
  file: {
    name: 'api-reference.ts',
    contents: `// WorkerPoolManager constructor
new WorkerPoolManager(poolOptions, highlighterOptions)

// Parameters:
// - poolOptions: WorkerPoolOptions
//   - workerFactory: () => Worker - Function that creates a Worker instance
//   - poolSize?: number (default: 8) - Number of workers
// - highlighterOptions: WorkerHighlighterOptions
//   - theme: PJSThemeNames | ThemesType - Theme name or { dark, light } object
//   - langs?: SupportedLanguages[] - Array of languages to preload
//   - preferWasmHighlighter?: boolean - Use WASM highlighter

// Methods:
poolManager.initialize()
// Returns: Promise<void> - Initializes workers (auto-called on first render)

poolManager.isInitialized()
// Returns: boolean

poolManager.setTheme(theme)
// Returns: Promise<void> - Changes the active theme

poolManager.renderFileToAST(file, options)
// Returns: Promise<RenderFileResult>

poolManager.renderPlainFileToAST(file, startingLineNumber?)
// Returns: RenderFileResult | undefined - Sync render with 'text' lang

poolManager.renderDiffFilesToAST(oldFile, newFile, options)
// Returns: Promise<RenderDiffResult>

poolManager.renderDiffMetadataToAST(diff, options)
// Returns: Promise<RenderDiffResult>

poolManager.terminate()
// Terminates all workers and resets state

poolManager.getStats()
// Returns: { totalWorkers, busyWorkers, queuedTasks, pendingTasks }`,
  },
  options,
};
