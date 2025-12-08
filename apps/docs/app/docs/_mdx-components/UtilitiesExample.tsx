'use client';

import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import type { PreloadedFileResult } from '@pierre/precision-diffs/ssr';
import { useState } from 'react';

import { DocsCodeExample } from '../DocsCodeExample';

interface UtilitiesAcceptRejectProps {
  diffAcceptReject: PreloadedFileResult<undefined>;
  diffAcceptRejectReact: PreloadedFileResult<undefined>;
}

export function UtilitiesAcceptReject({
  diffAcceptReject,
  diffAcceptRejectReact,
}: UtilitiesAcceptRejectProps) {
  const [acceptRejectType, setAcceptRejectType] = useState<'vanilla' | 'react'>(
    'vanilla'
  );

  return (
    <>
      <ButtonGroup
        value={acceptRejectType}
        onValueChange={(value) =>
          setAcceptRejectType(value as 'vanilla' | 'react')
        }
      >
        <ButtonGroupItem value="vanilla">Vanilla JS</ButtonGroupItem>
        <ButtonGroupItem value="react">React</ButtonGroupItem>
      </ButtonGroup>
      {acceptRejectType === 'vanilla' ? (
        <DocsCodeExample {...diffAcceptReject} />
      ) : (
        <DocsCodeExample {...diffAcceptRejectReact} />
      )}
    </>
  );
}
