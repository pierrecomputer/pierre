'use client';

import type { PreloadedFileResult } from '@pierre/precision-diffs/ssr';

import { DocsCodeExample } from '../DocsCodeExample';

interface StylingExampleProps {
  stylingGlobal: PreloadedFileResult<undefined>;
  stylingInline: PreloadedFileResult<undefined>;
}

export function StylingExample({
  stylingGlobal,
  stylingInline,
}: StylingExampleProps) {
  return (
    <>
      <DocsCodeExample {...stylingGlobal} />
      <DocsCodeExample {...stylingInline} />
    </>
  );
}
