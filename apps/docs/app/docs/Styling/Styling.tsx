'use client';

import type { PreloadedFileResult } from '@pierre/precision-diffs/ssr';

import { DocsCodeExample } from '../DocsCodeExample';

interface StylingProps {
  stylingGlobal: PreloadedFileResult<undefined>;
  stylingInline: PreloadedFileResult<undefined>;
}

export function Styling({ stylingGlobal, stylingInline }: StylingProps) {
  return (
    <section className="space-y-4">
      <h2>Styling</h2>
      <p>
        Diff and code are rendered using shadow DOM APIs. This means that the
        styles applied to the diffs will be well isolated from your page‘s
        existing CSS. However, it also means if you want to customize the
        built-in styles, you‘ll have to utilize some custom CSS variables. These
        can be done either in your global CSS, as style props on parent
        components, or on the <code>FileDiff</code> component directly.
      </p>
      <DocsCodeExample {...stylingGlobal} />
      <DocsCodeExample {...stylingInline} />
    </section>
  );
}
