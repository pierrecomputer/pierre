'use client';

import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import type { PreloadedFileResult } from '@pierre/precision-diffs/ssr';
import { useState } from 'react';

import { DocsCodeExample } from '../DocsCodeExample';

type ComponentType = 'file-diff' | 'file';
type PropsType = 'file-diff' | 'file';
type DiffHunksType = 'from-file' | 'from-patch';

interface VanillaAPIComponentsProps {
  fileDiffExample: PreloadedFileResult<undefined>;
  fileExample: PreloadedFileResult<undefined>;
}

export function VanillaAPIComponents({
  fileDiffExample,
  fileExample,
}: VanillaAPIComponentsProps) {
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
        <DocsCodeExample {...fileDiffExample} />
      ) : (
        <DocsCodeExample {...fileExample} />
      )}
    </>
  );
}

interface VanillaAPIPropsExampleProps {
  fileDiffProps: PreloadedFileResult<undefined>;
  fileProps: PreloadedFileResult<undefined>;
}

export function VanillaAPIPropsExample({
  fileDiffProps,
  fileProps,
}: VanillaAPIPropsExampleProps) {
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
        <DocsCodeExample {...fileDiffProps} />
      ) : (
        <DocsCodeExample {...fileProps} />
      )}
    </>
  );
}

interface VanillaAPIDiffHunksProps {
  diffHunksRenderer: PreloadedFileResult<undefined>;
  diffHunksRendererPatch: PreloadedFileResult<undefined>;
}

export function VanillaAPIDiffHunks({
  diffHunksRenderer,
  diffHunksRendererPatch,
}: VanillaAPIDiffHunksProps) {
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
        <DocsCodeExample {...diffHunksRenderer} />
      ) : (
        <DocsCodeExample {...diffHunksRendererPatch} />
      )}
    </>
  );
}
