'use client';

import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import { IconInfoFill } from '@pierre/icons';
import { useState } from 'react';

import { DocsCodeExample } from '@/components/docs/DocsCodeExample';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import { Notice } from '@/components/ui/notice';

type EditComponentMode = 'file' | 'file-diff' | 'multi-file-diff';

interface EditComponentTabsProps {
  fileExample: PreloadedFileResult<undefined>;
  fileDiffExample: PreloadedFileResult<undefined>;
  multiFileDiffExample?: PreloadedFileResult<undefined>;
}

export function EditComponentTabs({
  fileExample,
  fileDiffExample,
  multiFileDiffExample,
}: EditComponentTabsProps) {
  const [mode, setMode] = useState<EditComponentMode>('file');

  return (
    <>
      <ButtonGroup
        value={mode}
        onValueChange={(value) => setMode(value as EditComponentMode)}
        className="no-scrollbar max-w-full overflow-x-auto md:overflow-visible"
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
            cannot reconstruct it from patch context alone. Make sure one of the
            following is true before editing begins:
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
            <li>
              You supplied <code>loadDiffFiles</code> so a partial diff can load
              its complete old and new files after the editor attaches.
            </li>
          </ul>
          <p>
            Without any source for the complete files — for example, when the
            diff was parsed from a raw patch with no accompanying source files —{' '}
            <code>editor.edit()</code> will attach, but editing will have no
            effect.
          </p>
        </Notice>
      ) : null}
    </>
  );
}
