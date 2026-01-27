'use client';

import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import { useState } from 'react';

import { DocsCodeExample } from '../../../docs/DocsCodeExample';
import type { DocsExampleTypes } from '../../../docs/types';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

interface TreesCodeToggleProps {
  vanilla: PreloadedFileResult<undefined>;
  react: PreloadedFileResult<undefined>;
}

export function TreesCodeToggle({ vanilla, react }: TreesCodeToggleProps) {
  const [type, setType] = useState<DocsExampleTypes>('vanilla');

  const file = type === 'react' ? react : vanilla;

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
      </div>
      <DocsCodeExample {...file} key={type} />
    </>
  );
}
