'use client';

import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import type { PreloadedFileResult } from '@pierre/precision-diffs/ssr';
import { useState } from 'react';

import { DocsCodeExample } from '../DocsCodeExample';

type ExampleTypes = 'multi-file-diff' | 'patch-diff' | 'file-diff' | 'file';

interface ReactAPIExampleProps {
  reactAPIMultiFileDiff: PreloadedFileResult<undefined>;
  reactAPIFileDiff: PreloadedFileResult<undefined>;
  reactAPIPatch: PreloadedFileResult<undefined>;
  reactAPIFile: PreloadedFileResult<undefined>;
}

export function ReactAPIExample({
  reactAPIMultiFileDiff,
  reactAPIFileDiff,
  reactAPIFile,
  reactAPIPatch,
}: ReactAPIExampleProps) {
  const [example, setExample] = useState<ExampleTypes>('multi-file-diff');

  return (
    <>
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
    </>
  );
}
