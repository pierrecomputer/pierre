'use client';

import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import type { PreloadedFileResult } from '@pierre/precision-diffs/ssr';
import { useState } from 'react';

import { DocsCodeExample } from '../DocsCodeExample';
import type { DocsExampleTypes } from '../types';

interface OverviewExamplesProps {
  reactSingleFile: PreloadedFileResult<undefined>;
  reactPatchFile: PreloadedFileResult<undefined>;
  vanillaSingleFile: PreloadedFileResult<undefined>;
  vanillaPatchFile: PreloadedFileResult<undefined>;
}

export function OverviewExamples({
  reactSingleFile,
  reactPatchFile,
  vanillaSingleFile,
  vanillaPatchFile,
}: OverviewExamplesProps) {
  const [type, setType] = useState<DocsExampleTypes>('vanilla');
  const [example, setExample] = useState<'single-file' | 'patch-file'>(
    'single-file'
  );

  const file = (() => {
    if (type === 'react') {
      return example === 'single-file' ? reactSingleFile : reactPatchFile;
    }
    return example === 'single-file' ? vanillaSingleFile : vanillaPatchFile;
  })();

  return (
    <>
      <div className="flex gap-2">
        <ButtonGroup
          value={type}
          onValueChange={(value) => setType(value as 'vanilla' | 'react')}
        >
          <ButtonGroupItem value="vanilla">Vanilla JS</ButtonGroupItem>
          <ButtonGroupItem value="react">React</ButtonGroupItem>
        </ButtonGroup>
        <ButtonGroup
          value={example}
          onValueChange={(value) =>
            setExample(value as 'single-file' | 'patch-file')
          }
        >
          <ButtonGroupItem value="single-file">Single file</ButtonGroupItem>
          <ButtonGroupItem value="patch-file">Patch file</ButtonGroupItem>
        </ButtonGroup>
      </div>
      <DocsCodeExample {...file} />
    </>
  );
}
