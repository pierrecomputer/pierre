'use client';

import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import { useState } from 'react';

import { DocsCodeExample } from '@/components/docs/DocsCodeExample';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

type EditorComponentMode = 'file' | 'file-diff';

interface EditorComponentTabsProps {
  fileExample: PreloadedFileResult<undefined>;
  fileDiffExample: PreloadedFileResult<undefined>;
}

export function EditorComponentTabs({
  fileExample,
  fileDiffExample,
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
      </ButtonGroup>
      {mode === 'file' ? (
        <DocsCodeExample {...fileExample} key={mode} />
      ) : (
        <DocsCodeExample {...fileDiffExample} key={mode} />
      )}
    </>
  );
}
