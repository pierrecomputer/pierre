'use client';

import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import type { PreloadedFileResult } from '@pierre/precision-diffs/ssr';
import { useState } from 'react';

import { DocsCodeExample } from '../DocsCodeExample';

interface ReactAPIProps {
  reactAPIDiff: PreloadedFileResult<undefined>;
  reactAPIFile: PreloadedFileResult<undefined>;
  reactAPIFilePatch: PreloadedFileResult<undefined>;
}

export function ReactAPI({
  reactAPIDiff,
  reactAPIFile,
  reactAPIFilePatch,
}: ReactAPIProps) {
  const [example, setExample] = useState<'file-diff' | 'file'>('file-diff');
  return (
    <section className="space-y-4">
      <h2>React API</h2>
      <p>
        Right now the React API exposes two main components,{' '}
        <code>FileDiff</code> (for rendering diffs for a specific file) and{' '}
        <code>File</code> for rendering just a single code file. We plan to add
        more components like a file picker and tools for virtualization of
        longer diffs in the future.
      </p>
      <p>
        You can import the react components from{' '}
        <code>@pierre/precision-diffs/react</code>
      </p>
      <ButtonGroup
        value={example}
        onValueChange={(value) => setExample(value as 'file-diff' | 'file')}
      >
        <ButtonGroupItem value="file-diff">FileDiff</ButtonGroupItem>
        <ButtonGroupItem value="file">File</ButtonGroupItem>
      </ButtonGroup>
      {example === 'file-diff' ? (
        <>
          <DocsCodeExample {...reactAPIDiff} />
          <p>
            Alternatively, if you already have a unified diff for a single file,
            pass it via the <code>patch</code> prop instead of{' '}
            <code>oldFile</code> and <code>newFile</code>.
          </p>
          <DocsCodeExample {...reactAPIFilePatch} />
        </>
      ) : (
        <DocsCodeExample {...reactAPIFile} />
      )}
    </section>
  );
}
