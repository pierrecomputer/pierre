'use client';

import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import type { PreloadedFileResult } from '@pierre/precision-diffs/ssr';
import { useState } from 'react';

import { DocsCodeExample } from '../DocsCodeExample';

interface VanillaAPIHunksRendererProps {
  vanillaAPIHunksRenderer: PreloadedFileResult<undefined>;
  vanillaAPIHunksRendererPatch: PreloadedFileResult<undefined>;
}

export function VanillaAPIHunksRenderer({
  vanillaAPIHunksRenderer,
  vanillaAPIHunksRendererPatch,
}: VanillaAPIHunksRendererProps) {
  const [hunkType, setHunkType] = useState<'hunk-file' | 'hunk-patch'>(
    'hunk-file'
  );

  return (
    <>
      <ButtonGroup
        value={hunkType}
        onValueChange={(value) =>
          setHunkType(value as 'hunk-file' | 'hunk-patch')
        }
      >
        <ButtonGroupItem value="hunk-file">
          DiffHunksRenderer File
        </ButtonGroupItem>
        <ButtonGroupItem value="hunk-patch">
          DiffHunksRenderer Patch
        </ButtonGroupItem>
      </ButtonGroup>
      {hunkType === 'hunk-file' ? (
        <DocsCodeExample {...vanillaAPIHunksRenderer} />
      ) : (
        <DocsCodeExample {...vanillaAPIHunksRendererPatch} />
      )}
    </>
  );
}
