'use client';

import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import type {
  PreloadMultiFileDiffResult,
  PreloadedFileResult,
} from '@pierre/precision-diffs/ssr';
import { useState } from 'react';

import { DocsCodeExample } from '../DocsCodeExample';
import type { DocsExampleTypes } from '../types';

interface OverviewExampleProps {
  initialDiffProps: PreloadMultiFileDiffResult<undefined>;
  reactSingleFile: PreloadedFileResult<undefined>;
  reactPatchFile: PreloadedFileResult<undefined>;
  vanillaSingleFile: PreloadedFileResult<undefined>;
  vanillaPatchFile: PreloadedFileResult<undefined>;
}

export function OverviewExample({
  reactSingleFile,
  reactPatchFile,
  vanillaSingleFile,
  vanillaPatchFile,
}: OverviewExampleProps) {
  const [type, setType] = useState<DocsExampleTypes>('vanilla');
  const [example, setExample] = useState<'single-file' | 'patch-file'>(
    'single-file'
  );

  const file = (() => {
    if (type === 'react') {
      if (example === 'single-file') {
        return reactSingleFile;
      } else {
        return reactPatchFile;
      }
    }
    if (example === 'single-file') {
      return vanillaSingleFile;
    } else {
      return vanillaPatchFile;
    }
  })();

  return (
    <>
      <div className="flex flex-col gap-2 sm:flex-row">
        <ButtonGroup
          className="flex-1 sm:flex-initial"
          value={type}
          onValueChange={(value) => setType(value as 'vanilla' | 'react')}
        >
          <ButtonGroupItem className="flex-1 sm:flex-initial" value="vanilla">
            Vanilla JS
          </ButtonGroupItem>
          <ButtonGroupItem className="flex-1 sm:flex-initial" value="react">
            React
          </ButtonGroupItem>
        </ButtonGroup>
        <ButtonGroup
          className="flex-1 sm:flex-initial"
          value={example}
          onValueChange={(value) =>
            setExample(value as 'single-file' | 'patch-file')
          }
        >
          <ButtonGroupItem
            className="flex-1 sm:flex-initial"
            value="single-file"
          >
            Single file
          </ButtonGroupItem>
          <ButtonGroupItem
            className="flex-1 sm:flex-initial"
            value="patch-file"
          >
            Patch file
          </ButtonGroupItem>
        </ButtonGroup>
      </div>
      <DocsCodeExample {...file} />
    </>
  );
}
