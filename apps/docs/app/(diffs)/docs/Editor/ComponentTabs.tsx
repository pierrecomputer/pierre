'use client';

import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import { IconInfoFill } from '@pierre/icons';
import { useState } from 'react';

import { DocsCodeExample } from '@/components/docs/DocsCodeExample';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import { Notice } from '@/components/ui/notice';

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
      {mode === 'file-diff' ? (
        <Notice variant="warning" icon={<IconInfoFill />} className="mt-2">
          <p>
            Editing a <code>FileDiff</code> requires the full file contents. The
            editor targets the addition side (the new version of the file) and
            cannot reconstruct it from a partial diff. Make sure one of the
            following is true before attaching the editor:
          </p>
          <ul className="list-disc pl-5">
            <li>
              You rendered the diff by passing <code>oldFile</code> and{' '}
              <code>newFile</code> as <code>FileContents</code> objects directly
              (the common case).
            </li>
            <li>
              You rendered from a <code>FileDiff</code> object where{' '}
              <code>isPartial</code> is <code>false</code>, meaning{' '}
              <code>additionLines</code> contains the complete new-file contents
              (not just the patch context lines).
            </li>
          </ul>
          <p>
            If neither condition is met — for example, when the diff was parsed
            from a raw patch with no accompanying source files —{' '}
            <code>editor.edit()</code> will attach, but editing will have no
            effect.
          </p>
        </Notice>
      ) : null}
    </>
  );
}
