'use client';

import { IconBulbFill, IconCiWarningFill } from '@/components/icons';
import { Notice } from '@/components/ui/notice';
import type { PreloadedFileResult } from '@pierre/precision-diffs/ssr';

import { DocsCodeExample } from '../DocsCodeExample';

interface SSRProps {
  usageServer: PreloadedFileResult<undefined>;
  usageClient: PreloadedFileResult<undefined>;
  preloadFileDiff: PreloadedFileResult<undefined>;
  preloadMultiFileDiff: PreloadedFileResult<undefined>;
  preloadPatchDiff: PreloadedFileResult<undefined>;
  preloadFile: PreloadedFileResult<undefined>;
  preloadPatchFile: PreloadedFileResult<undefined>;
}

export function SSR({
  usageServer,
  usageClient,
  preloadFileDiff,
  preloadMultiFileDiff,
  preloadPatchDiff,
  preloadFile,
  preloadPatchFile,
}: SSRProps) {
  return (
    <section className="space-y-4">
      <h2>SSR</h2>

      <Notice icon={<IconBulbFill />}>
        Import SSR utilities from <code>@pierre/precision-diffs/ssr</code>.
      </Notice>
      <p>
        The SSR API allows you to pre-render file diffs on the server with
        syntax highlighting, then hydrate them on the client for full
        interactivity.
      </p>

      <h3>Usage</h3>
      <p>
        Each preload function returns an object containing the original inputs
        plus a <code>prerenderedHTML</code> string. This object can be spread
        directly into the corresponding React component for automatic hydration.
      </p>

      <Notice variant="warning" icon={<IconCiWarningFill />}>
        Inputs used for pre-rendering must exactly match what’s rendered in the
        client component. We recommend spreading the entire result object into
        your File or Diff component to ensure the client receives the same
        inputs that were used to generate the pre-rendered HTML.
      </Notice>

      <h4 data-toc-ignore>Server Component</h4>
      <DocsCodeExample {...usageServer} />

      <h4 data-toc-ignore>Client Component</h4>
      <DocsCodeExample {...usageClient} />

      <h3>Preloaders</h3>
      <p>
        We provide several preload functions to handle different input formats.
        Choose the one that matches your data source.
      </p>

      <h4 data-toc-ignore>preloadFile</h4>
      <p>
        Preloads a single file with syntax highlighting (no diff). Use this when
        you want to render a file without any diff context. Spread into the{' '}
        <code>File</code> component.
      </p>
      <DocsCodeExample {...preloadFile} />

      <h4 data-toc-ignore>preloadFileDiff</h4>
      <p>
        Preloads a diff from a <code>FileDiffMetadata</code> object. Use this
        when you already have parsed diff metadata (e.g., from{' '}
        <code>parseDiffFromFile</code> or <code>parsePatchFiles</code>). Spread
        into the <code>FileDiff</code> component.
      </p>
      <DocsCodeExample {...preloadFileDiff} />

      <h4 data-toc-ignore>preloadMultiFileDiff</h4>
      <p>
        Preloads a diff directly from old and new file contents. This is the
        simplest option when you have the raw file contents and want to generate
        a diff. Spread into the <code>MultiFileDiff</code> component.
      </p>
      <DocsCodeExample {...preloadMultiFileDiff} />

      <h4 data-toc-ignore>preloadPatchDiff</h4>
      <p>
        Preloads a diff from a unified patch string for a single file. Use this
        when you have a patch in unified diff format. Spread into the{' '}
        <code>PatchDiff</code> component.
      </p>
      <DocsCodeExample {...preloadPatchDiff} />

      <h4 data-toc-ignore>preloadPatchFile</h4>
      <p>
        Preloads multiple diffs from a multi-file patch string. Returns an array
        of results, one for each file in the patch. Each result can be spread
        into a <code>FileDiff</code> component.
      </p>
      <DocsCodeExample {...preloadPatchFile} />
    </section>
  );
}
