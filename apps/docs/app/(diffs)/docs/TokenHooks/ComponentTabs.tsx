'use client';

import { useState } from 'react';

import { DocsCodeExample } from '@/components/docs/DocsCodeExample';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import type { PreloadedCodeExample } from '@/lib/preloadCodeExample';

type TokenInteractionMode = 'react' | 'vanilla';

interface TokenHookTabsProps {
  reactExample: PreloadedCodeExample<undefined, undefined>;
  vanillaExample: PreloadedCodeExample<undefined, undefined>;
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
