'use client';

import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import type { PreloadedFileResult } from '@pierre/precision-diffs/ssr';
import { useState } from 'react';

import { DocsCodeExample } from '../DocsCodeExample';

interface VanillaAPIProps {
  vanillaAPIFileDiff: PreloadedFileResult<undefined>;
  vanillaAPIFileFile: PreloadedFileResult<undefined>;
  vanillaAPICustomHunk: PreloadedFileResult<undefined>;
  vanillaAPIDiffHunksRenderer: PreloadedFileResult<undefined>;
  vanillaAPIDiffHunksRendererPatch: PreloadedFileResult<undefined>;
  vanillaAPIFileRenderer: PreloadedFileResult<undefined>;
}

export function VanillaAPI({
  vanillaAPIFileDiff,
  vanillaAPIFileFile,
  vanillaAPICustomHunk,
  vanillaAPIDiffHunksRenderer,
  vanillaAPIDiffHunksRendererPatch,
  vanillaAPIFileRenderer,
}: VanillaAPIProps) {
  const [componentType, setComponentType] = useState<'file-diff' | 'file'>(
    'file-diff'
  );
  const [diffHunksType, setDiffHunksType] = useState<
    'from-file' | 'from-patch'
  >('from-file');
  return (
    <section className="space-y-4">
      <h2>Vanilla JS API</h2>
      <p>
        The vanilla JavaScript API for Precision Diffs exposes a mix of
        components and raw classes. The components and the React API are built
        on many of these foundation classes. The goal has been to abstract away
        a lot of the heavy lifting when working with Shiki directly and provide
        a set of standardized APIs that can be used with any framework and even
        server rendered if necessary.
      </p>
      <p>
        You can import all of this via the core package{' '}
        <code>@pierre/precision-diffs</code>
      </p>
      <h3>Components</h3>
      <p>
        There are two core components in the vanilla JavaScript API,{' '}
        <code>FileDiff</code> and <code>File</code>
      </p>
      <ButtonGroup
        value={componentType}
        onValueChange={(value) =>
          setComponentType(value as 'file-diff' | 'file')
        }
      >
        <ButtonGroupItem value="file-diff">FileDiff</ButtonGroupItem>
        <ButtonGroupItem value="file">File</ButtonGroupItem>
      </ButtonGroup>
      {componentType === 'file-diff' ? (
        <DocsCodeExample {...vanillaAPIFileDiff} />
      ) : (
        <DocsCodeExample {...vanillaAPIFileFile} />
      )}
      <h4>Hunk Separators</h4>
      <p>
        If you want to render custom hunk separators that won't scroll with the
        content, there are a few tricks you will need to employ. See the
        following code snippet:
      </p>
      <DocsCodeExample {...vanillaAPICustomHunk} />
      <h3>Renderers</h3>
      <p>
        <strong>Note:</strong> For most use cases, you should use the
        higher-level components like <code>FileDiff</code> and <code>File</code>{' '}
        (vanilla JS) or the React components (<code>MultiFileDiff</code>,{' '}
        <code>FileDiff</code>, <code>PatchDiff</code>, <code>File</code>). These
        renderers are low-level building blocks intended for advanced use cases.
      </p>
      <p>
        These renderer classes handle the low-level work of parsing and
        rendering code with syntax highlighting. Useful when you need direct
        access to the rendered output as{' '}
        <a href="https://github.com/syntax-tree/hast" target="_blank">
          hast
        </a>{' '}
        nodes or HTML strings for custom rendering pipelines.
      </p>
      <h4>DiffHunksRenderer</h4>
      <p>
        Takes a <code>FileDiffMetadata</code> data structure and renders out the
        raw hast elements for diff hunks. You can generate{' '}
        <code>FileDiffMetadata</code> via <code>parseDiffFromFile</code> or{' '}
        <code>parsePatchFiles</code> utility functions.
      </p>
      <ButtonGroup
        value={diffHunksType}
        onValueChange={(value) =>
          setDiffHunksType(value as 'from-file' | 'from-patch')
        }
      >
        <ButtonGroupItem value="from-file">From Two Files</ButtonGroupItem>
        <ButtonGroupItem value="from-patch">From Patch File</ButtonGroupItem>
      </ButtonGroup>
      {diffHunksType === 'from-file' ? (
        <DocsCodeExample {...vanillaAPIDiffHunksRenderer} />
      ) : (
        <DocsCodeExample {...vanillaAPIDiffHunksRendererPatch} />
      )}
      <h4>FileRenderer</h4>
      <p>
        Takes a <code>FileContents</code> object (just a filename and contents
        string) and renders syntax-highlighted code as hast elements. Useful for
        rendering single files without any diff context.
      </p>
      <DocsCodeExample {...vanillaAPIFileRenderer} />
    </section>
  );
}
