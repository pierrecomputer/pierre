'use client';

import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import type { PreloadedFileResult } from '@pierre/precision-diffs/ssr';
import { useState } from 'react';

import { DocsCodeExample } from '../DocsCodeExample';

type ExampleTypes = 'multi-file-diff' | 'patch-diff' | 'file-diff' | 'file';
type SharedPropsTypes = 'options' | 'render-props';

interface ReactAPIProps {
  reactAPIMultiFileDiff: PreloadedFileResult<undefined>;
  reactAPIFileDiff: PreloadedFileResult<undefined>;
  reactAPIPatch: PreloadedFileResult<undefined>;
  reactAPIFile: PreloadedFileResult<undefined>;
  sharedDiffOptions: PreloadedFileResult<undefined>;
  sharedDiffRenderProps: PreloadedFileResult<undefined>;
}

export function ReactAPI({
  reactAPIMultiFileDiff,
  reactAPIFileDiff,
  reactAPIFile,
  reactAPIPatch,
  sharedDiffOptions,
  sharedDiffRenderProps,
}: ReactAPIProps) {
  const [example, setExample] = useState<ExampleTypes>('multi-file-diff');
  const [sharedProps, setSharedProps] = useState<SharedPropsTypes>('options');
  return (
    <section className="space-y-4">
      <h2>React API</h2>
      <p>
        You can import the React components from{' '}
        <code>@pierre/precision-diffs/react</code>
      </p>

      <h3>Components</h3>
      <p>
        The React API exposes four main components: <code>MultiFileDiff</code>{' '}
        (compare two file versions), <code>PatchDiff</code> (render from a patch
        string), <code>FileDiff</code> (render a pre-parsed{' '}
        <code>FileDiffMetadata</code>), and <code>File</code> (render a single
        code file without diff).
      </p>
      <ButtonGroup
        value={example}
        onValueChange={(value) => setExample(value as ExampleTypes)}
      >
        <ButtonGroupItem value="multi-file-diff">MultiFileDiff</ButtonGroupItem>
        <ButtonGroupItem value="patch-diff">PatchDiff</ButtonGroupItem>
        <ButtonGroupItem value="file-diff">FileDiff</ButtonGroupItem>
        <ButtonGroupItem value="file">File</ButtonGroupItem>
      </ButtonGroup>
      {(() => {
        switch (example) {
          case 'multi-file-diff':
            return <DocsCodeExample {...reactAPIMultiFileDiff} />;
          case 'file-diff':
            return <DocsCodeExample {...reactAPIFileDiff} />;
          case 'patch-diff':
            return <DocsCodeExample {...reactAPIPatch} />;
          case 'file':
            return <DocsCodeExample {...reactAPIFile} />;
        }
      })()}

      <h3>Shared Props</h3>
      <p>
        The three diff components (<code>MultiFileDiff</code>,{' '}
        <code>PatchDiff</code>, and <code>FileDiff</code>) share a common set of
        props for configuration, annotations, and styling. The <code>File</code>{' '}
        component has similar props but uses <code>LineAnnotation</code> instead
        of <code>DiffLineAnnotation</code> (no <code>side</code> property).
      </p>
      <ButtonGroup
        value={sharedProps}
        onValueChange={(value) => setSharedProps(value as SharedPropsTypes)}
      >
        <ButtonGroupItem value="options">Options</ButtonGroupItem>
        <ButtonGroupItem value="render-props">Render Props</ButtonGroupItem>
      </ButtonGroup>
      {(() => {
        switch (sharedProps) {
          case 'options':
            return <DocsCodeExample {...sharedDiffOptions} />;
          case 'render-props':
            return <DocsCodeExample {...sharedDiffRenderProps} />;
        }
      })()}
    </section>
  );
}
