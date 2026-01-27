'use client';

import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import { useState } from 'react';

import { DocsCodeExample } from '../DocsCodeExample';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

type ComponentType = 'file-diff' | 'file';
type PropsType = 'file-diff' | 'file';
type DiffHunksType = 'from-file' | 'from-patch';

interface VanillaComponentTabsProps {
  fileDiffExample: PreloadedFileResult<undefined>;
  fileExample: PreloadedFileResult<undefined>;
}

export function VanillaComponentTabs({
  fileDiffExample,
  fileExample,
}: VanillaComponentTabsProps) {
  const [componentType, setComponentType] =
    useState<ComponentType>('file-diff');

  return (
    <>
      <ButtonGroup
        value={componentType}
        onValueChange={(value) => setComponentType(value as ComponentType)}
      >
        <ButtonGroupItem value="file-diff">FileDiff</ButtonGroupItem>
        <ButtonGroupItem value="file">File</ButtonGroupItem>
      </ButtonGroup>
      {componentType === 'file-diff' ? (
        <DocsCodeExample
          {...fileDiffExample}
          key={`component-type-${componentType}`}
        />
      ) : (
        <DocsCodeExample
          {...fileExample}
          key={`component-type-${componentType}`}
        />
      )}
    </>
  );
}

interface VanillaPropTabsProps {
  fileDiffProps: PreloadedFileResult<undefined>;
  fileProps: PreloadedFileResult<undefined>;
}

export function VanillaPropTabs({
  fileDiffProps,
  fileProps,
}: VanillaPropTabsProps) {
  const [propsType, setPropsType] = useState<PropsType>('file-diff');

  return (
    <>
      <ButtonGroup
        value={propsType}
        onValueChange={(value) => setPropsType(value as PropsType)}
      >
        <ButtonGroupItem value="file-diff">FileDiff Props</ButtonGroupItem>
        <ButtonGroupItem value="file">File Props</ButtonGroupItem>
      </ButtonGroup>
      {propsType === 'file-diff' ? (
        <DocsCodeExample {...fileDiffProps} key={`props-type-${propsType}`} />
      ) : (
        <DocsCodeExample {...fileProps} key={`props-type-${propsType}`} />
      )}
    </>
  );
}

interface DiffHunksTabsProps {
  diffHunksRenderer: PreloadedFileResult<undefined>;
  diffHunksRendererPatch: PreloadedFileResult<undefined>;
}

export function DiffHunksTabs({
  diffHunksRenderer,
  diffHunksRendererPatch,
}: DiffHunksTabsProps) {
  const [diffHunksType, setDiffHunksType] =
    useState<DiffHunksType>('from-file');

  return (
    <>
      <ButtonGroup
        value={diffHunksType}
        onValueChange={(value) => setDiffHunksType(value as DiffHunksType)}
      >
        <ButtonGroupItem value="from-file">Two Files</ButtonGroupItem>
        <ButtonGroupItem value="from-patch">Patch File</ButtonGroupItem>
      </ButtonGroup>
      {diffHunksType === 'from-file' ? (
        <DocsCodeExample {...diffHunksRenderer} key={diffHunksType} />
      ) : (
        <DocsCodeExample {...diffHunksRendererPatch} key={diffHunksType} />
      )}
    </>
  );
}
