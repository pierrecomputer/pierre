'use client';

import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import { type CSSProperties, useState } from 'react';

import { DocsCodeExample } from '../DocsCodeExample';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

const NumberColumnWidthOverride = {
  '--diffs-min-number-column-width': '3ch',
} as CSSProperties;

type ExampleTypes = 'multi-file-diff' | 'patch-diff' | 'file-diff' | 'file';
type SharedPropsTypes =
  | 'diff-options'
  | 'diff-render-props'
  | 'file-options'
  | 'file-render-props';

interface ComponentTabsProps {
  reactAPIMultiFileDiff: PreloadedFileResult<undefined>;
  reactAPIFileDiff: PreloadedFileResult<undefined>;
  reactAPIPatch: PreloadedFileResult<undefined>;
  reactAPIFile: PreloadedFileResult<undefined>;
}

export function ComponentTabs({
  reactAPIMultiFileDiff,
  reactAPIFileDiff,
  reactAPIPatch,
  reactAPIFile,
}: ComponentTabsProps) {
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
            return <DocsCodeExample {...reactAPIMultiFileDiff} key={example} />;
          case 'file-diff':
            return <DocsCodeExample {...reactAPIFileDiff} key={example} />;
          case 'patch-diff':
            return <DocsCodeExample {...reactAPIPatch} key={example} />;
          case 'file':
            return <DocsCodeExample {...reactAPIFile} key={example} />;
        }
      })()}
    </>
  );
}

interface SharedPropTabsProps {
  sharedDiffOptions: PreloadedFileResult<undefined>;
  sharedDiffRenderProps: PreloadedFileResult<undefined>;
  sharedFileOptions: PreloadedFileResult<undefined>;
  sharedFileRenderProps: PreloadedFileResult<undefined>;
}

export function SharedPropTabs({
  sharedDiffOptions,
  sharedDiffRenderProps,
  sharedFileOptions,
  sharedFileRenderProps,
}: SharedPropTabsProps) {
  const [sharedProps, setSharedProps] =
    useState<SharedPropsTypes>('diff-options');

  return (
    <>
      <ButtonGroup
        value={sharedProps}
        onValueChange={(value) => setSharedProps(value as SharedPropsTypes)}
        className="no-scrollbar max-w-full overflow-x-auto md:overflow-visible"
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
            return (
              <DocsCodeExample
                {...sharedDiffOptions}
                style={NumberColumnWidthOverride}
                key={sharedProps}
              />
            );
          case 'diff-render-props':
            return (
              <DocsCodeExample
                {...sharedDiffRenderProps}
                style={NumberColumnWidthOverride}
                key={sharedProps}
              />
            );
          case 'file-options':
            return (
              <DocsCodeExample
                {...sharedFileOptions}
                style={NumberColumnWidthOverride}
                key={sharedProps}
              />
            );
          case 'file-render-props':
            return (
              <DocsCodeExample
                {...sharedFileRenderProps}
                style={NumberColumnWidthOverride}
                key={sharedProps}
              />
            );
        }
      })()}
    </>
  );
}
