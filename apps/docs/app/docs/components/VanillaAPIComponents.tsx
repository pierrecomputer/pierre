'use client';

import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import type { PreloadedFileResult } from '@pierre/precision-diffs/ssr';
import { useState } from 'react';

import { DocsCodeExample } from '../DocsCodeExample';

interface VanillaAPIComponentsProps {
  vanillaAPIFileDiff: PreloadedFileResult<undefined>;
  vanillaAPIFileFile: PreloadedFileResult<undefined>;
}

export function VanillaAPIComponents({
  vanillaAPIFileDiff,
  vanillaAPIFileFile,
}: VanillaAPIComponentsProps) {
  const [componentType, setComponentType] = useState<'file-diff' | 'file'>(
    'file-diff'
  );

  return (
    <>
      <ButtonGroup
        value={componentType}
        onValueChange={(value) =>
          setComponentType(value as 'file-diff' | 'file')
        }
      >
        <ButtonGroupItem value="file-diff">FileDiff</ButtonGroupItem>
        <ButtonGroupItem value="file">File</ButtonGroupItem>
      </ButtonGroup>
      {componentType === 'file-diff' ? (
        <DocsCodeExample {...vanillaAPIFileDiff} />
      ) : (
        <DocsCodeExample {...vanillaAPIFileFile} />
      )}
    </>
  );
}
