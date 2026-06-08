'use client';

import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import { useState } from 'react';

import { DocsCodeExample } from '@/components/docs/DocsCodeExample';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

type EditorWorkerPoolMode = 'vanilla' | 'react';

interface EditorWorkerPoolTabsProps {
  vanillaExample: PreloadedFileResult<undefined>;
  reactExample: PreloadedFileResult<undefined>;
}

export function EditorWorkerPoolTabs({
  vanillaExample,
  reactExample,
}: EditorWorkerPoolTabsProps) {
  const [mode, setMode] = useState<EditorWorkerPoolMode>('vanilla');

  return (
    <>
      <ButtonGroup
        value={mode}
        onValueChange={(value) => setMode(value as EditorWorkerPoolMode)}
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
