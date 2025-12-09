'use client';

import { IconInfoFill } from '@/components/icons';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import { Notice } from '@/components/ui/notice';
import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import { type CSSProperties, useState } from 'react';

import { DocsCodeExample } from '../DocsCodeExample';
import { ProseWrapper } from '../ProseWrapper';

const NumberColumnWidthOverride = {
  '--diffs-min-number-column-width': '3ch',
} as CSSProperties;

type ExampleTypes = 'multi-file-diff' | 'patch-diff' | 'file-diff' | 'file';
type SharedPropsTypes =
  | 'diff-options'
  | 'diff-render-props'
  | 'file-options'
  | 'file-render-props';

interface ReactAPIProps {
  reactAPIMultiFileDiff: PreloadedFileResult<undefined>;
  reactAPIFileDiff: PreloadedFileResult<undefined>;
  reactAPIPatch: PreloadedFileResult<undefined>;
  reactAPIFile: PreloadedFileResult<undefined>;
  sharedDiffOptions: PreloadedFileResult<undefined>;
  sharedDiffRenderProps: PreloadedFileResult<undefined>;
  sharedFileOptions: PreloadedFileResult<undefined>;
  sharedFileRenderProps: PreloadedFileResult<undefined>;
}

export function ReactAPI({
  reactAPIMultiFileDiff,
  reactAPIFileDiff,
  reactAPIFile,
  reactAPIPatch,
  sharedDiffOptions,
  sharedDiffRenderProps,
  sharedFileOptions,
  sharedFileRenderProps,
}: ReactAPIProps) {
  const [example, setExample] = useState<ExampleTypes>('multi-file-diff');
  const [sharedProps, setSharedProps] =
    useState<SharedPropsTypes>('diff-options');
  return (
    <ProseWrapper>
      <h2>React API</h2>
      <Notice icon={<IconInfoFill />}>
        Import React components from <code>@pierre/diffs/react</code>.
      </Notice>
      <p>
        We offer a variety of components to render diffs and files. Many of them
        share similar types of props, which you can find documented in{' '}
        <a href="#react-api-shared-props">Shared Props</a>.
      </p>

      <h3>Components</h3>
      <p>The React API exposes four main components:</p>
      <ul>
        <li>
          <code>MultiFileDiff</code> compares two file versions
        </li>
        <li>
          <code>PatchDiff</code> renders from a patch string
        </li>
        <li>
          <code>FileDiff</code> renders a pre-parsed{' '}
          <code>FileDiffMetadata</code>
        </li>
        <li>
          <code>File</code> renders a single code file without a diff
        </li>
      </ul>

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

      <h3>Shared Props</h3>
      <p>
        The three diff components (<code>MultiFileDiff</code>,{' '}
        <code>PatchDiff</code>, and <code>FileDiff</code>) share a common set of
        props for configuration, annotations, and styling. The <code>File</code>{' '}
        component has similar props, but uses <code>LineAnnotation</code>{' '}
        instead of <code>DiffLineAnnotation</code> (no <code>side</code>{' '}
        property).
      </p>
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
    </ProseWrapper>
  );
}
