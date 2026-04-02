'use client';

import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import { useState } from 'react';

import { DocsCodeExample } from '../DocsCodeExample';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

type TokenInteractionMode = 'react' | 'vanilla';

interface TokenHookTabsProps {
  reactExample: PreloadedFileResult<undefined>;
  vanillaExample: PreloadedFileResult<undefined>;
}

export function TokenHookTabs({
  reactExample,
  vanillaExample,
}: TokenHookTabsProps) {
  const [mode, setMode] = useState<TokenInteractionMode>('react');

  return (
    <>
      <ButtonGroup
        value={mode}
        onValueChange={(value) => setMode(value as TokenInteractionMode)}
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
