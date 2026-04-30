'use client';

import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import { useState } from 'react';

import { DocsCodeExample } from '@/components/docs/DocsCodeExample';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

type CodeViewExampleMode = 'react' | 'vanilla';

interface CodeViewExampleTabsProps {
  reactExample: PreloadedFileResult<undefined>;
  vanillaExample: PreloadedFileResult<undefined>;
}

export function CodeViewExampleTabs({
  reactExample,
  vanillaExample,
}: CodeViewExampleTabsProps) {
  const [mode, setMode] = useState<CodeViewExampleMode>('react');

  return (
    <>
      <ButtonGroup
        value={mode}
        onValueChange={(value) => setMode(value as CodeViewExampleMode)}
      >
        <ButtonGroupItem value="react">React</ButtonGroupItem>
        <ButtonGroupItem value="vanilla">Vanilla JS</ButtonGroupItem>
      </ButtonGroup>
      {mode === 'react' ? (
        <DocsCodeExample {...reactExample} key={mode} />
      ) : (
        <DocsCodeExample {...vanillaExample} key={mode} />
      )}
    </>
  );
}
