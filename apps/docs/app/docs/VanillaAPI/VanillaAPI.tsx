'use client';

import { IconInfoFill } from '@/components/icons';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import { Notice } from '@/components/ui/notice';
import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import { useState } from 'react';

import { DocsCodeExample } from '../DocsCodeExample';

type ComponentType = 'file-diff' | 'file';
type PropsType = 'file-diff' | 'file';
type DiffHunksType = 'from-file' | 'from-patch';

interface VanillaAPIProps {
  fileDiffExample: PreloadedFileResult<undefined>;
  fileExample: PreloadedFileResult<undefined>;
  fileDiffProps: PreloadedFileResult<undefined>;
  fileProps: PreloadedFileResult<undefined>;
  customHunk: PreloadedFileResult<undefined>;
  diffHunksRenderer: PreloadedFileResult<undefined>;
  diffHunksRendererPatch: PreloadedFileResult<undefined>;
  fileRenderer: PreloadedFileResult<undefined>;
}

export function VanillaAPI({
  fileDiffExample,
  fileExample,
  fileDiffProps,
  fileProps,
  customHunk,
  diffHunksRenderer,
  diffHunksRendererPatch,
  fileRenderer,
}: VanillaAPIProps) {
  const [componentType, setComponentType] =
    useState<ComponentType>('file-diff');
  const [propsType, setPropsType] = useState<PropsType>('file-diff');
  const [diffHunksType, setDiffHunksType] =
    useState<DiffHunksType>('from-file');

  return (
    <>
      <h2>Vanilla JS API</h2>

      <Notice icon={<IconInfoFill />}>
        Import vanilla JavaScript classes, components, and methods from{' '}
        <code>@pierre/diffs</code>.
      </Notice>

      <h3>Components</h3>
      <p>
        The Vanilla JS API exposes two core components: <code>FileDiff</code>{' '}
        (compare two file versions or render a pre-parsed{' '}
        <code>FileDiffMetadata</code>) and <code>File</code> (render a single
        code file without diff). Typically you’ll want to interface with these
        as they’ll handle all the complicated aspects of syntax highlighting,
        theming, and full interactivity for you.
      </p>
      <ButtonGroup
        value={componentType}
        onValueChange={(value) => setComponentType(value as ComponentType)}
      >
        <ButtonGroupItem value="file-diff">FileDiff</ButtonGroupItem>
        <ButtonGroupItem value="file">File</ButtonGroupItem>
      </ButtonGroup>
      {componentType === 'file-diff' ? (
        <DocsCodeExample
          {...fileDiffExample}
          key={`component-type-${componentType}`}
        />
      ) : (
        <DocsCodeExample
          {...fileExample}
          key={`component-type-${componentType}`}
        />
      )}

      <h3 id="vanilla-js-api-props">Props</h3>
      <p>
        Both <code>FileDiff</code> and <code>File</code> accept an options
        object in their constructor. The <code>File</code> component has similar
        options, but excludes diff-specific settings and uses{' '}
        <code>LineAnnotation</code> instead of <code>DiffLineAnnotation</code>{' '}
        (no <code>side</code> property).
      </p>
      <ButtonGroup
        value={propsType}
        onValueChange={(value) => setPropsType(value as PropsType)}
      >
        <ButtonGroupItem value="file-diff">FileDiff Props</ButtonGroupItem>
        <ButtonGroupItem value="file">File Props</ButtonGroupItem>
      </ButtonGroup>
      {propsType === 'file-diff' ? (
        <DocsCodeExample {...fileDiffProps} key={`props-type-${propsType}`} />
      ) : (
        <DocsCodeExample {...fileProps} key={`props-type-${propsType}`} />
      )}

      <h4 data-toc-ignore>Custom Hunk Separators</h4>
      <p>
        If you want to render custom hunk separators that won’t scroll with the
        content, there are a few tricks you will need to employ. See the
        following code snippet:
      </p>
      <DocsCodeExample {...customHunk} />

      <h3>Renderers</h3>
      <Notice icon={<IconInfoFill />}>
        For most use cases, you should use the higher-level components like{' '}
        <code>FileDiff</code> and <code>File</code> (vanilla JS) or the React
        components (<code>MultiFileDiff</code>, <code>FileDiff</code>,{' '}
        <code>PatchDiff</code>, <code>File</code>). These renderers are
        low-level building blocks intended for advanced use cases.
      </Notice>
      <p>
        These renderer classes handle the low-level work of parsing and
        rendering code with syntax highlighting. Useful when you need direct
        access to the rendered output as{' '}
        <a href="https://github.com/syntax-tree/hast" target="_blank">
          HAST
        </a>{' '}
        nodes or HTML strings for custom rendering pipelines.
      </p>
      <h4 data-toc-ignore>DiffHunksRenderer</h4>
      <p>
        Takes a <code>FileDiffMetadata</code> data structure and renders out the
        raw HAST (Hypertext Abstract Syntax Tree) elements for diff hunks. You
        can generate <code>FileDiffMetadata</code> via{' '}
        <code>parseDiffFromFile</code> or <code>parsePatchFiles</code> utility
        functions.
      </p>
      <ButtonGroup
        value={diffHunksType}
        onValueChange={(value) => setDiffHunksType(value as DiffHunksType)}
      >
        <ButtonGroupItem value="from-file">Two Files</ButtonGroupItem>
        <ButtonGroupItem value="from-patch">Patch File</ButtonGroupItem>
      </ButtonGroup>
      {diffHunksType === 'from-file' ? (
        <DocsCodeExample {...diffHunksRenderer} key={diffHunksType} />
      ) : (
        <DocsCodeExample {...diffHunksRendererPatch} key={diffHunksType} />
      )}
      <h4 data-toc-ignore>FileRenderer</h4>
      <p>
        Takes a <code>FileContents</code> object (just a filename and contents
        string) and renders syntax-highlighted code as HAST elements. Useful for
        rendering single files without any diff context.
      </p>
      <DocsCodeExample {...fileRenderer} />
    </>
  );
}
