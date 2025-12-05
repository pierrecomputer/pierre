import type { PreloadFileOptions } from '@pierre/precision-diffs/ssr';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
} as const;

export const WORKER_POOL_HELPER_VITE: PreloadFileOptions<undefined> = {
  file: {
    name: 'utils/workerFactory.ts',
    contents: `import WorkerUrl from '@pierre/precision-diffs/worker/worker.js?worker&url';

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
      '@pierre/precision-diffs/worker/worker.js',
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
        'precision-diffs',
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
  'precision-diffs',
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
      '@pierre/precision-diffs/worker/worker.js',
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
      '@pierre/precision-diffs/worker/worker.js',
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
} from '@pierre/precision-diffs/react';
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

// Any File, FileDiff, MultiFileDiff, or PatchDiff component nested within
// the layout will automatically use the worker pool, no additional props required.

// ---

// To change themes dynamically, use the useWorkerPool hook:
function ThemeSwitcher() {
  const workerPool = useWorkerPool();

  const switchToGitHub = () => {
    void workerPool?.setTheme({ dark: 'github-dark', light: 'github-light' });
  };

  return <button onClick={switchToGitHub}>Switch to GitHub theme</button>;
}
// All connected File, FileDiff, MultiFileDiff, and PatchDiff instances
// will automatically re-render with the new theme once it has loaded.`,
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

// To change themes dynamically, call setTheme on the worker pool:
await workerPool.setTheme({ dark: 'github-dark', light: 'github-light' });
// All connected File and FileDiff instances will automatically re-render
// with the new theme once it has loaded.

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
//   - enableASTCache?: boolean (default: false) - Cache rendered AST results
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
// Returns: { fileCache, diffCache } - LRU cache instances (when enableASTCache is true)`,
  },
  options,
};

export const WORKER_POOL_CACHING: PreloadFileOptions<undefined> = {
  file: {
    name: 'caching-example.ts',
    contents: `import {
  getOrCreateWorkerPoolSingleton,
} from '@pierre/precision-diffs/worker';
import { workerFactory } from './utils/workerFactory';

// Enable AST caching by setting enableASTCache to true
const workerPool = getOrCreateWorkerPoolSingleton({
  poolOptions: {
    workerFactory,
    enableASTCache: true, // <-- Enable caching
  },
  highlighterOptions: {
    theme: { dark: 'pierre-dark', light: 'pierre-light' },
  },
});

// With caching enabled:
// - Rendered file and diff AST results are stored in an LRU cache
// - Subsequent renders of the same file/diff return cached results instantly
// - No worker processing required for cache hits
// - Cache is automatically invalidated when:
//   - The theme changes via setTheme()
//   - The pool is terminated

// Inspect cache contents (for debugging)
const { fileCache, diffCache } = workerPool.inspectCaches();
console.log('Cached files:', fileCache.size);
console.log('Cached diffs:', diffCache.size);`,
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
