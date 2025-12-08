'use client';

import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import type { PreloadedFileResult } from '@pierre/precision-diffs/ssr';
import { useState } from 'react';

import { DocsCodeExample } from '../DocsCodeExample';

type ExampleTypes = 'multi-file-diff' | 'patch-diff' | 'file-diff' | 'file';
type SharedPropsTypes =
  | 'diff-options'
  | 'diff-render-props'
  | 'file-options'
  | 'file-render-props';

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

interface ReactAPISharedPropsProps {
  sharedDiffOptions: PreloadedFileResult<undefined>;
  sharedDiffRenderProps: PreloadedFileResult<undefined>;
  sharedFileOptions: PreloadedFileResult<undefined>;
  sharedFileRenderProps: PreloadedFileResult<undefined>;
}

export function ReactAPISharedProps({
  sharedDiffOptions,
  sharedDiffRenderProps,
  sharedFileOptions,
  sharedFileRenderProps,
}: ReactAPISharedPropsProps) {
  const [sharedProps, setSharedProps] =
    useState<SharedPropsTypes>('diff-options');

  return (
    <>
      <ButtonGroup
        value={sharedProps}
        onValueChange={(value) => setSharedProps(value as SharedPropsTypes)}
        className="no-scrollbar max-w-full overflow-x-auto"
      >
        <ButtonGroupItem value="diff-options">Diff Options</ButtonGroupItem>
        <ButtonGroupItem value="diff-render-props">
          Diff Render Props
        </ButtonGroupItem>
        <ButtonGroupItem value="file-options">File Options</ButtonGroupItem>
        <ButtonGroupItem value="file-render-props">
          File Render Props
        </ButtonGroupItem>
      </ButtonGroup>
      {(() => {
        switch (sharedProps) {
          case 'diff-options':
            return <DocsCodeExample {...sharedDiffOptions} />;
          case 'diff-render-props':
            return <DocsCodeExample {...sharedDiffRenderProps} />;
          case 'file-options':
            return <DocsCodeExample {...sharedFileOptions} />;
          case 'file-render-props':
            return <DocsCodeExample {...sharedFileRenderProps} />;
        }
      })()}
    </>
  );
}
