'use client';

import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import { useState } from 'react';

import { DocsCodeExample } from '@/components/docs/DocsCodeExample';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

type EditorComponentMode = 'file' | 'file-diff' | 'multi-file-diff';

interface EditorComponentTabsProps {
  fileExample: PreloadedFileResult<undefined>;
  fileDiffExample: PreloadedFileResult<undefined>;
  multiFileDiffExample?: PreloadedFileResult<undefined>;
}

export function EditorComponentTabs({
  fileExample,
  fileDiffExample,
  multiFileDiffExample,
}: EditorComponentTabsProps) {
  const [mode, setMode] = useState<EditorComponentMode>('file');

  return (
    <>
      <ButtonGroup
        value={mode}
        onValueChange={(value) => setMode(value as EditorComponentMode)}
      >
        <ButtonGroupItem value="file">File</ButtonGroupItem>
        <ButtonGroupItem value="file-diff">FileDiff</ButtonGroupItem>
        {multiFileDiffExample != null ? (
          <ButtonGroupItem value="multi-file-diff">
            MultiFileDiff
          </ButtonGroupItem>
        ) : null}
      </ButtonGroup>
      {(() => {
        switch (mode) {
          case 'file':
            return <DocsCodeExample {...fileExample} key={mode} />;
          case 'file-diff':
            return <DocsCodeExample {...fileDiffExample} key={mode} />;
          case 'multi-file-diff':
            return multiFileDiffExample != null ? (
              <DocsCodeExample {...multiFileDiffExample} key={mode} />
            ) : null;
        }
      })()}
    </>
  );
}
