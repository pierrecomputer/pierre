'use client';

import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import { useState } from 'react';

import { DocsCodeExample } from '@/components/docs/DocsCodeExample';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

type CodeViewerExampleMode = 'react' | 'vanilla';

interface CodeViewerExampleTabsProps {
  reactExample: PreloadedFileResult<undefined>;
  vanillaExample: PreloadedFileResult<undefined>;
}

export function CodeViewerExampleTabs({
  reactExample,
  vanillaExample,
}: CodeViewerExampleTabsProps) {
  const [mode, setMode] = useState<CodeViewerExampleMode>('react');

  return (
    <>
      <ButtonGroup
        value={mode}
        onValueChange={(value) => setMode(value as CodeViewerExampleMode)}
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
