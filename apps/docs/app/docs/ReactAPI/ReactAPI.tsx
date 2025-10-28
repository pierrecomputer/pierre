'use client';

import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import type { PreloadedFileResult } from '@pierre/precision-diffs/ssr';
import { useState } from 'react';

import { DocsCodeExample } from '../DocsCodeExample';

type ExampleTypes = 'multi-file-diff' | 'patch-diff' | 'file-diff' | 'file';

interface ReactAPIProps {
  reactAPIMultiFileDiff: PreloadedFileResult<undefined>;
  reactAPIFileDiff: PreloadedFileResult<undefined>;
  reactAPIPatch: PreloadedFileResult<undefined>;
  reactAPIFile: PreloadedFileResult<undefined>;
}

export function ReactAPI({
  reactAPIMultiFileDiff,
  reactAPIFileDiff,
  reactAPIFile,
  reactAPIPatch,
}: ReactAPIProps) {
  const [example, setExample] = useState<ExampleTypes>('multi-file-diff');
  return (
    <section className="space-y-4">
      <h2>React API</h2>
      <p>
        Right now, the React API exposes two main components,{' '}
        <code>FileDiff</code> (for rendering diffs for a specific file) and{' '}
        <code>File</code> for rendering just a single code file. We plan to add
        more components like a file picker and tools for virtualization of
        longer diffs in the future.
      </p>
      <p>
        You can import the React components from{' '}
        <code>@pierre/precision-diffs/react</code>
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
    </section>
  );
}
