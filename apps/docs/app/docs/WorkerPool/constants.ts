import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const WORKER_POOL_HELPER_VITE: PreloadFileOptions<undefined> = {
  file: {
    name: 'utils/workerFactory.ts',
    contents: `import WorkerUrl from '@pierre/diffs/worker/worker.js?worker&url';

export function workerFactory(): Worker {
  return new Worker(WorkerUrl, { type: 'module' });
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
      '@pierre/diffs/worker/worker.js',
      import.meta.url
    )
  );
}`,
  },
  options,
};

export const WORKER_POOL_VSCODE_LOCAL_ROOTS: PreloadFileOptions<undefined> = {
  file: {
    name: 'extension.ts',
    contents: `function getWebviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
  return {
    enableScripts: true,
    localResourceRoots: [
      // ... your other roots
      vscode.Uri.joinPath(
        extensionUri,
        'node_modules',
        '@pierre',
        'diffs',
        'dist',
        'worker'
      ),
    ],
  };
}`,
  },
  options,
};

export const WORKER_POOL_VSCODE_WORKER_URI: PreloadFileOptions<undefined> = {
  file: {
    name: 'extension.ts',
    contents: `const workerScriptPath = vscode.Uri.joinPath(
  this._extensionUri,
  'node_modules',
  '@pierre',
  'diffs',
  'dist',
  'worker',
  'worker-portable.js'
);
const workerScriptUri = webview.asWebviewUri(workerScriptPath);`,
  },
  options,
};

export const WORKER_POOL_VSCODE_INLINE_SCRIPT: PreloadFileOptions<undefined> = {
  file: {
    name: 'extension.ts',
    contents: `<script nonce="\${nonce}">window.WORKER_URI = "\${workerScriptUri}";</script>`,
  },
  options,
};

export const WORKER_POOL_VSCODE_CSP: PreloadFileOptions<undefined> = {
  file: {
    name: 'extension.ts',
    contents: `worker-src \${webview.cspSource} blob:;
connect-src \${webview.cspSource};`,
  },
  options,
};

export const WORKER_POOL_VSCODE_GLOBAL: PreloadFileOptions<undefined> = {
  file: {
    name: 'webview-ui/index.ts',
    contents: `declare global {
  interface Window {
    WORKER_URI: string;
  }
}`,
  },
  options,
};

export const WORKER_POOL_VSCODE_BLOB_URL: PreloadFileOptions<undefined> = {
  file: {
    name: 'webview-ui/index.ts',
    contents: `async function createWorkerBlobUrl(): Promise<string> {
  const response = await fetch(window.WORKER_URI);
  const workerCode = await response.text();
  const blob = new Blob([workerCode], { type: 'application/javascript' });
  return URL.createObjectURL(blob);
}`,
  },
  options,
};

export const WORKER_POOL_VSCODE_FACTORY: PreloadFileOptions<undefined> = {
  file: {
    name: 'webview-ui/index.ts',
    contents: `const workerBlobUrl = await createWorkerBlobUrl();

function workerFactory() {
  return new Worker(workerBlobUrl);
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
      '@pierre/diffs/worker/worker.js',
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
      '@pierre/diffs/worker/worker.js',
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
// 1. Copy worker.js to your static/public folder
// 2. Reference it by URL

export function workerFactory(): Worker {
  return new Worker('/static/workers/worker.js', { type: 'module' });
}`,
  },
  options,
};

export const WORKER_POOL_HELPER_VANILLA: PreloadFileOptions<undefined> = {
  file: {
    name: 'utils/workerFactory.js',
    contents: `// No bundler / Vanilla JS
// Host worker.js on your server and reference it by URL

export function workerFactory() {
  return new Worker('/path/to/worker.js', { type: 'module' });
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

import {
  useWorkerPool,
  WorkerPoolContextProvider,
} from '@pierre/diffs/react';
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
        // Optional: pick the Shiki engine ('shiki-js' is default)
        // preferredHighlighter: 'shiki-wasm',
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

// Any File, FileDiff, MultiFileDiff, or PatchDiff component nested within
// the layout will automatically use the worker pool, no additional props required.

// ---

// To change render options dynamically, use the useWorkerPool hook:
function ThemeSwitcher() {
  const workerPool = useWorkerPool();

  const switchToGitHub = () => {
    // setRenderOptions accepts a Partial<WorkerRenderingOptions>.
    // Any omitted options will use defaults:
    // - theme: { dark: 'pierre-dark', light: 'pierre-light' }
    // - lineDiffType: 'word-alt'
    // - tokenizeMaxLineLength: 1000
    void workerPool?.setRenderOptions({
      theme: { dark: 'github-dark', light: 'github-light' },
    });
  };

  return <button onClick={switchToGitHub}>Switch to GitHub theme</button>;
}
// WARNING: Changing render options will force all mounted components
// to re-render and will clear the render cache.`,
  },
  options,
};

export const WORKER_POOL_VANILLA_USAGE: PreloadFileOptions<undefined> = {
  file: {
    name: 'vanilla-worker-usage.ts',
    contents: `import { FileDiff } from '@pierre/diffs';
import {
  getOrCreateWorkerPoolSingleton,
  terminateWorkerPoolSingleton,
} from '@pierre/diffs/worker';
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
    // Optional: pick the Shiki engine ('shiki-js' is default)
    // preferredHighlighter: 'shiki-wasm',
    // Optionally preload languages to avoid lazy-loading delays
    langs: ['typescript', 'javascript', 'css', 'html'],
  },
});

// Pass the workerPool as the second argument to FileDiff
const instance = new FileDiff(
  { theme: { dark: 'pierre-dark', light: 'pierre-light' } },
  workerPool
);

// Note: Store file objects in variables rather than inlining them.
// FileDiff uses reference equality to detect changes and skip
// unnecessary re-renders.
const oldFile = { name: 'example.ts', contents: 'const x = 1;' };
const newFile = { name: 'example.ts', contents: 'const x = 2;' };

instance.render({ oldFile, newFile, containerWrapper: document.body });

// To change render options dynamically, call setRenderOptions on the worker pool.
// It accepts a Partial<WorkerRenderingOptions>. Any omitted options will use defaults:
// - theme: { dark: 'pierre-dark', light: 'pierre-light' }
// - lineDiffType: 'word-alt'
// - tokenizeMaxLineLength: 1000
await workerPool.setRenderOptions({
  theme: { dark: 'github-dark', light: 'github-light' },
});
// WARNING: Changing render options will force all mounted components
// to re-render and will clear the render cache.

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
//   - totalASTLRUCacheSize?: number (default: 100) - Max items per cache
//     (Two separate LRU caches are maintained: one for files, one for diffs.
//      Each cache has this limit, so total cached items can be 2x this value.)
// - highlighterOptions: WorkerInitializationRenderOptions
//   - theme?: DiffsThemeNames | ThemesType - Theme name or { dark, light } object
//   - lineDiffType?: 'word' | 'word-alt' | 'char' - How to diff lines (default: 'word-alt')
//   - tokenizeMaxLineLength?: number - Max line length to tokenize (default: 1000)
//   - preferredHighlighter?: 'shiki-js' | 'shiki-wasm' - Highlighter engine (default: 'shiki-js')
//   - langs?: SupportedLanguages[] - Array of languages to preload

// Methods:
poolManager.initialize()
// Returns: Promise<void> - Initializes workers (auto-called on first render)

poolManager.isInitialized()
// Returns: boolean

poolManager.setRenderOptions(options)
// Returns: Promise<void> - Changes render options dynamically
// Accepts: Partial<WorkerRenderingOptions>
//   - theme?: DiffsThemeNames | ThemesType
//   - lineDiffType?: 'word' | 'word-alt' | 'char'
//   - tokenizeMaxLineLength?: number
// Omitted options will use defaults. WARNING: This forces all mounted
// components to re-render and clears the render cache.

poolManager.getRenderOptions()
// Returns: WorkerRenderingOptions - Current render options (copy)

poolManager.highlightFileAST(fileInstance, file, options)
// Queues highlighted file render, calls fileInstance.onHighlightSuccess when done

poolManager.getPlainFileAST(file, startingLineNumber?)
// Returns: ThemedFileResult | undefined - Sync render with 'text' lang

poolManager.highlightDiffAST(fileDiffInstance, diff, options)
// Queues highlighted diff render, calls fileDiffInstance.onHighlightSuccess when done

poolManager.getPlainDiffAST(diff, lineDiffType)
// Returns: ThemedDiffResult | undefined - Sync render with 'text' lang

poolManager.terminate()
// Terminates all workers and resets state

poolManager.getStats()
// Returns: { totalWorkers, busyWorkers, queuedTasks, pendingTasks }

poolManager.inspectCaches()
// Returns: { fileCache, diffCache } - LRU cache instances for debugging

poolManager.evictFileFromCache(cacheKey)
// Returns: boolean - Evicts a file from the cache by its cacheKey
// Returns true if the item was evicted, false if it wasn't in the cache

poolManager.evictDiffFromCache(cacheKey)
// Returns: boolean - Evicts a diff from the cache by its cacheKey
// Returns true if the item was evicted, false if it wasn't in the cache`,
  },
  options,
};

export const WORKER_POOL_CACHING: PreloadFileOptions<undefined> = {
  file: {
    name: 'caching-example.ts',
    contents: `import {
  getOrCreateWorkerPoolSingleton,
} from '@pierre/diffs/worker';
import { workerFactory } from './utils/workerFactory';

const workerPool = getOrCreateWorkerPoolSingleton({
  poolOptions: {
    workerFactory,
    // Optional: configure cache size per cache (default: 100)
    // Two separate LRU caches are maintained: one for files,
    // one for diffs, so combined cache size will be double
    totalASTLRUCacheSize: 200,
  },
  highlighterOptions: {
    theme: { dark: 'pierre-dark', light: 'pierre-light' },
  },
});

// Caching is enabled automatically when files/diffs have a cacheKey.
// Files and diffs without cacheKey will not be cached.

const fileWithCaching = {
  name: 'example.ts',
  contents: 'const x = 42;',
  cacheKey: 'file-abc123', // <-- Enables caching for this file
};

const fileWithoutCaching = {
  name: 'other.ts',
  contents: 'const y = 1;',
  // No cacheKey - will not be cached
};

// IMPORTANT: The cacheKey must change whenever the content changes!
// If content changes but the key stays the same, stale cached results
// will be returned. Use content hashes or version numbers in your keys.
const fileV1 = { name: 'file.ts', contents: 'v1', cacheKey: 'file-v1' };
const fileV2 = { name: 'file.ts', contents: 'v2', cacheKey: 'file-v2' };

// Cache key best practices:
// - DON'T use file contents as the key - large strings potentially
//   waste memory
// - DON'T rely solely on filenames - they may not be unique or stable
// - DO use stable identifiers like commit SHAs, file IDs, or version numbers
// - DO combine identifiers when needed: \`\${fileId}-\${version}\`

// How caching works:
// - Files/diffs with cacheKey are stored in an LRU cache after rendering
// - Subsequent renders with the same cacheKey return cached results instantly
// - No worker processing required for cache hits
// - Cache is validated against render options (e.g., theme, lineDiffType)
// - If options changed, cached result is skipped and re-rendered
// - Cache is cleared when the pool is terminated

// Inspect cache contents (for debugging)
const { fileCache, diffCache } = workerPool.inspectCaches();
console.log('Cached files:', fileCache.size);
console.log('Cached diffs:', diffCache.size);

// Evict specific items from the cache when content is invalidated
// (e.g., user edits a file, new commit is pushed)
workerPool.evictFileFromCache('file-abc123');
workerPool.evictDiffFromCache('diff-xyz789');`,
  },
  options,
};

export const WORKER_POOL_ARCHITECTURE_ASCII: PreloadFileOptions<undefined> = {
  file: {
    name: 'architecture.txt',
    contents: `┌────────────── Main Thread ──────────────┐
│ ┌ React (if used) ────────────────────┐ │
│ │ <WorkerPoolContextProvider>         │ │
│ │   <FileDiff />                      │ │
│ │   <File />                          │ │
│ │ </WorkerPoolContextProvider>        │ │
│ │                                     │ │
│ │ * Each component manages their own  │ │
│ │   instances of the Vanilla JS       │ │
│ │   Classes                           │ │
│ └─┬───────────────────────────────────┘ │
│   │                                     │
│   ↓                                     │
│ ┌ Vanilla JS Classes ─────────────────┐ │
│ │ new FileDiff(opts, poolManager)     │ │
│ │ new File(opts, poolManager)         │ │
│ │                                     │ │
│ │ * Renders plain text synchronously  │ │
│ │ * Queue requests to WorkerPool for  │ │
│ │   highlighted HAST                  │ │
│ │ * Automatically render the          │ │
│ │   highlighted HAST response         │ │
│ └─┬─────────────────────────────────┬─┘ │
│   │ HAST Request                    ↑   │
│   ↓                   HAST Response │   │
│ ┌ WorkerPoolManager ────────────────┴─┐ │
│ │ * Shared singleton                  │ │
│ │ * Manages WorkerPool instance and   │ │
│ │   request queue                     │ │
│ └─┬─────────────────────────────────┬─┘ │
└───│─────────────────────────────────│───┘
    │ postMessage                     ↑
    ↓                   HAST Response │
┌───┴───────── Worker Threads ────────│───┐
│ ┌ worker.js ────────────────────────│─┐ │
│ │ * 8 threads by default            │ │ │
│ │ * Runs Shiki's codeToHast() ──────┘ │ │
│ │ * Manages themes and language       │ │
│ │   loading automatically             │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘`,
  },
  options: {
    ...options,
    disableFileHeader: true,
    disableLineNumbers: true,
  },
};
