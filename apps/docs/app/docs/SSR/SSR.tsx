'use client';

import type { PreloadedFileResult } from '@pierre/precision-diffs/ssr';

import { DocsCodeExample } from '../DocsCodeExample';

interface SSRProps {
  serverComponent: PreloadedFileResult<undefined>;
  clientComponent: PreloadedFileResult<undefined>;
  installationComponent: PreloadedFileResult<undefined>;
}

export function SSR({
  serverComponent,
  clientComponent,
  installationComponent,
}: SSRProps) {
  return (
    <section className="space-y-4">
      <h2>SSR</h2>
      <p>
        Precision Diffs supports Server-Side Rendering (SSR) for improved
        performance and SEO. The SSR API allows you to pre-render file diffs on
        the server with syntax highlighting, then hydrate them on the client for
        full interactivity.
      </p>

      <p>
        The SSR functionality is available from the{' '}
        <code>@pierre/precision-diffs/ssr</code> module:
      </p>
      <DocsCodeExample {...installationComponent} />

      <h3>Server Component</h3>
      <p>
        Create a server component that pre-renders the diff using{' '}
        <code>preloadFileDiff</code>:
      </p>
      <DocsCodeExample {...serverComponent} />
      <p>
        The <code>preloadFileDiff</code> function returns a{' '}
        <code>PreloadedFileDiffResult</code> object containing the original{' '}
        <code>oldFile</code>, <code>newFile</code>, <code>options</code>, and{' '}
        <code>annotations</code> you passed in, plus a{' '}
        <code>prerenderedHTML</code> string with the fully syntax-highlighted
        diff. This object can be spread directly into the React or raw JS
        component's for automatic hydration.
      </p>

      <h3>Client Component</h3>
      <p>
        Create a client component that hydrates and displays the pre-rendered
        diff:
      </p>
      <DocsCodeExample {...clientComponent} />

      <h3>Performance Considerations</h3>
      <ul>
        <li>
          Pre-rendering happens at build time or request time on the server
        </li>
        <li>
          Syntax highlighting is CPU-intensive, so consider caching prerendered
          results
        </li>
        <li>
          The <code>prerenderedHTML</code> includes inline styles for the theme,
          eliminating FOUC (Flash of Unstyled Content)
        </li>
        <li>
          Client-side hydration is lightweight and only adds interactivity
          handlers
        </li>
      </ul>
    </section>
  );
}
