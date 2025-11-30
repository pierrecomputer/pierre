'use client';

import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import type { PreloadedFileResult } from '@pierre/precision-diffs/ssr';
import { useState } from 'react';

import { DocsCodeExample } from '../DocsCodeExample';

interface VanillaAPIProps {
  vanillaAPIFileDiff: PreloadedFileResult<undefined>;
  vanillaAPIFileFile: PreloadedFileResult<undefined>;
  vanillaAPICustomHunk: PreloadedFileResult<undefined>;
  vanillaAPIHunksRenderer: PreloadedFileResult<undefined>;
  vanillaAPIHunksRendererPatch: PreloadedFileResult<undefined>;
  vanillaAPICodeUtilities: PreloadedFileResult<undefined>;
}

export function VanillaAPI({
  vanillaAPIFileDiff,
  vanillaAPIFileFile,
  vanillaAPICustomHunk,
  vanillaAPIHunksRenderer,
  vanillaAPIHunksRendererPatch,
  vanillaAPICodeUtilities,
}: VanillaAPIProps) {
  const [componentType, setComponentType] = useState<'file-diff' | 'file'>(
    'file-diff'
  );
  const [hunkType, setHunkType] = useState<'hunk-file' | 'hunk-patch'>(
    'hunk-file'
  );
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
        If you want to render custom hunk separators that won‘t scroll with the
        content, there are a few tricks you will need to employ. See the
        following code snippet:
      </p>
      <DocsCodeExample {...vanillaAPICustomHunk} />
      <h3>Classes</h3>
      <p>
        These core classes can be thought of as the building blocks for the
        different components and APIs in Precision Diffs. Most of them should be
        usable in a variety of environments (server and browser).
      </p>
      <h4>DiffHunksRenderer</h4>
      <p>
        Essentially a class that takes <code>FileDiffMetadata</code> data
        structure and can render out the raw{' '}
        <a href="https://github.com/syntax-tree/hast" target="_blank">
          hast
        </a>{' '}
        elements of the code which can be subsequently rendered as HTML strings
        or transformed further. You can generate <code>FileDiffMetadata</code>{' '}
        via <code>parseDiffFromFile</code> or <code>parsePatchFiles</code>{' '}
        utility functions.
      </p>
      <ButtonGroup
        value={hunkType}
        onValueChange={(value) =>
          setHunkType(value as 'hunk-file' | 'hunk-patch')
        }
      >
        <ButtonGroupItem value="hunk-file">From Two Files</ButtonGroupItem>
        <ButtonGroupItem value="hunk-patch">From Patch File</ButtonGroupItem>
      </ButtonGroup>
      {hunkType === 'hunk-file' ? (
        <DocsCodeExample {...vanillaAPIHunksRenderer} />
      ) : (
        <DocsCodeExample {...vanillaAPIHunksRendererPatch} />
      )}
      <h3>Shared Highlighter Utilities</h3>
      <p>
        Because it‘s important to re-use your highlighter instance when using
        Shiki, we‘ve ensured that all the classes and components you use with
        Precision Diffs will automatically use a shared highlighter instance and
        also automatically load languages and themes on demand as necessary.
      </p>
      <p>
        We provide APIs to preload the highlighter, themes, and languages if you
        want to have that ready before rendering. Also there are some cleanup
        utilities if you want to be memory conscious.
      </p>
      <p>
        Shiki comes with a lot of built-in{' '}
        <a href="https://shiki.style/themes" target="_blank">
          themes
        </a>
        , but if you would like to use your own custom or modified theme, you
        simply have to register it and then it‘ll just work as any other
        built-in theme.
      </p>
      <DocsCodeExample {...vanillaAPICodeUtilities} />
    </section>
  );
}
