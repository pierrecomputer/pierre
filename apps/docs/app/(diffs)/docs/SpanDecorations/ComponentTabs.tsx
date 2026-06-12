'use client';

import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import { useState } from 'react';

import { DocsCodeExample } from '@/components/docs/DocsCodeExample';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

type SpanDecorationMode = 'react' | 'vanilla';

interface SpanDecorationTabsProps {
  reactExample: PreloadedFileResult<undefined>;
  vanillaExample: PreloadedFileResult<undefined>;
}

export function SpanDecorationTabs({
  reactExample,
  vanillaExample,
}: SpanDecorationTabsProps) {
  const [mode, setMode] = useState<SpanDecorationMode>('react');

  return (
    <>
      <ButtonGroup
        value={mode}
        onValueChange={(value) => setMode(value as SpanDecorationMode)}
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
