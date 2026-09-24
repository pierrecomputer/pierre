'use client';

import { useState } from 'react';

import { DocsCodeExample } from '@/components/docs/DocsCodeExample';
import type { DocsExampleTypes } from '@/components/docs/types';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import type { PreloadedCodeExample } from '@/lib/preloadCodeExample';

interface CodeToggleProps {
  reactSingleFile: PreloadedCodeExample<undefined, undefined>;
  reactPatchFile: PreloadedCodeExample<undefined, undefined>;
  vanillaSingleFile: PreloadedCodeExample<undefined, undefined>;
  vanillaPatchFile: PreloadedCodeExample<undefined, undefined>;
}

export function CodeToggle({
  reactSingleFile,
  reactPatchFile,
  vanillaSingleFile,
  vanillaPatchFile,
}: CodeToggleProps) {
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
      <div className="flex flex-wrap gap-2">
        <ButtonGroup
          className="sm:flex-initial"
          value={type}
          onValueChange={(value) => setType(value as DocsExampleTypes)}
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
      <DocsCodeExample {...file} key={`${type}-${example}`} />
    </>
  );
}
