'use client';

import type { PreloadedFileResult } from '@pierre/precision-diffs/ssr';

import { DocsCodeExample } from '../DocsCodeExample';

interface WorkerPoolProps {
  helperVite: PreloadedFileResult<undefined>;
  helperNextjs: PreloadedFileResult<undefined>;
  helperWebpack: PreloadedFileResult<undefined>;
  helperEsbuild: PreloadedFileResult<undefined>;
  helperStatic: PreloadedFileResult<undefined>;
  helperVanilla: PreloadedFileResult<undefined>;
  apiReference: PreloadedFileResult<undefined>;
}

export function WorkerPool({
  helperVite,
  helperNextjs,
  helperWebpack,
  helperEsbuild,
  helperStatic,
  helperVanilla,
  apiReference,
}: WorkerPoolProps) {
  return (
    <section className="space-y-4">
      <h2>Worker Pool</h2>
      <p>
        By default, syntax highlighting runs on the main thread. For improved
        performance—especially when rendering large files or multiple diffs—you
        can opt into worker-based rendering. This moves all Shiki syntax
        highlighting off the main thread, keeping your UI responsive.
      </p>
      <p>
        To enable this, create a <code>ShikiPoolManager</code> instance and pass
        it to the existing React or Vanilla JS APIs.
      </p>

      <h3>Setup</h3>
      <p>
        The recommended approach is to create a small helper in your application
        that uses your bundler's worker syntax. The worker functionality is
        available from the <code>@pierre/precision-diffs/worker</code> module.
      </p>

      <h4>Vite</h4>
      <DocsCodeExample {...helperVite} />

      <h4>Next.js</h4>
      <DocsCodeExample {...helperNextjs} />
      <p>
        <strong>Important:</strong> Workers only work in client components. Make
        sure your component has the <code>'use client'</code> directive if using
        App Router.
      </p>

      <h4>Webpack 5</h4>
      <DocsCodeExample {...helperWebpack} />

      <h4>esbuild</h4>
      <DocsCodeExample {...helperEsbuild} />

      <h4>Rollup / Static Files</h4>
      <p>
        If your bundler doesn't have special worker support, build and serve the
        worker file statically:
      </p>
      <DocsCodeExample {...helperStatic} />

      <h4>Vanilla JS (No Bundler)</h4>
      <p>
        For projects without a bundler, host the worker file on your server and
        reference it directly:
      </p>
      <DocsCodeExample {...helperVanilla} />

      <h3>API Reference</h3>
      <p>
        These methods are exposed for advanced use cases. In most scenarios, you
        should pass the <code>ShikiPoolManager</code> instance to the React or
        Vanilla JS APIs rather than calling these methods directly.
      </p>
      <DocsCodeExample {...apiReference} />

      <h3>Worker Performance Tips</h3>
      <ul>
        <li>
          <strong>Worker Overhead:</strong> Creating workers has overhead.
          Pre-initialize if possible using <code>ensureInitialized()</code>.
        </li>
        <li>
          <strong>Serialization Cost:</strong> Large files have serialization
          cost when posting to workers.
        </li>
        <li>
          <strong>Pool Size:</strong> More workers = more parallelism but more
          memory. 8 is the default.
        </li>
        <li>
          <strong>Language/Theme Loading:</strong> Pre-load common
          languages/themes in <code>initOptions</code> to avoid lazy loading
          delays.
        </li>
      </ul>

      <h3>Troubleshooting</h3>
      <ul>
        <li>
          <strong>Worker not found:</strong> Make sure the worker script is
          properly bundled and served. Check browser console for 404 errors.
        </li>
        <li>
          <strong>"Highlighter not initialized" error:</strong> The worker needs
          to initialize before handling requests. The API handles this
          automatically, but custom usage might need explicit initialization.
        </li>
        <li>
          <strong>Memory usage increasing:</strong> Make sure to call{' '}
          <code>terminate()</code> when done to free worker resources.
        </li>
      </ul>

      <h3>Architecture</h3>
      <p>
        The worker pool manages a configurable number of worker threads that
        each initialize their own Shiki highlighter instance. Tasks are
        distributed across available workers, with queuing when all workers are
        busy.
      </p>
      <pre
        className="inline-block rounded-lg bg-neutral-100 p-4 text-sm dark:bg-neutral-900"
        style={{ fontFamily: 'Berkeley Mono, monospace', lineHeight: '16px' }}
      >
        {`┌─────────────────┐
│   Main Thread   │
│ ShikiPoolManager│ ← API
│       ↓         │
│  WorkerPool.ts  │
└────────┬────────┘
         │ postMessage
         ↓
┌─────────────────┐
│ Workers (8x)    │
│ shiki-worker.ts │
│  → codeToHast() │
│  → returns HAST │
└─────────────────┘`}
      </pre>
    </section>
  );
}