'use client';

import { useState } from 'react';

import { DocsCodeExample } from '@/components/docs/DocsCodeExample';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import type { PreloadedCodeExample } from '@/lib/preloadCodeExample';

type EditWorkerPoolMode = 'vanilla' | 'react';

interface EditWorkerPoolTabsProps {
  vanillaExample: PreloadedCodeExample<undefined, undefined>;
  reactExample: PreloadedCodeExample<undefined, undefined>;
}

export function EditWorkerPoolTabs({
  vanillaExample,
  reactExample,
}: EditWorkerPoolTabsProps) {
  const [mode, setMode] = useState<EditWorkerPoolMode>('vanilla');

  return (
    <>
      <ButtonGroup
        value={mode}
        onValueChange={(value) => setMode(value as EditWorkerPoolMode)}
      >
        <ButtonGroupItem value="vanilla">Vanilla JS</ButtonGroupItem>
        <ButtonGroupItem value="react">React</ButtonGroupItem>
      </ButtonGroup>
      {mode === 'vanilla' ? (
        <DocsCodeExample {...vanillaExample} key={mode} />
      ) : (
        <DocsCodeExample {...reactExample} key={mode} />
      )}
    </>
  );
}
