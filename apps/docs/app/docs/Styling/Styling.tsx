'use client';

import { IconCiWarning } from '@/components/icons';
import type { PreloadedFileResult } from '@pierre/precision-diffs/ssr';

import { DocsCodeExample } from '../DocsCodeExample';

interface StylingProps {
  stylingGlobal: PreloadedFileResult<undefined>;
  stylingInline: PreloadedFileResult<undefined>;
  stylingUnsafe: PreloadedFileResult<undefined>;
}

export function Styling({
  stylingGlobal,
  stylingInline,
  stylingUnsafe,
}: StylingProps) {
  return (
    <section className="space-y-4">
      <h2>Styling</h2>
      <p>
        Diff and code are rendered using shadow DOM APIs. This means that the
        styles applied to the diffs will be well isolated from your page's
        existing CSS. However, it also means if you want to customize the
        built-in styles, you'll have to utilize some custom CSS variables. These
        can be done either in your global CSS, as style props on parent
        components, or on the <code>FileDiff</code> component directly.
      </p>
      <DocsCodeExample {...stylingGlobal} />
      <DocsCodeExample {...stylingInline} />

      <h3 data-toc-ignore>Advanced: Unsafe CSS</h3>
      <p>
        For advanced customization, you can inject arbitrary CSS into the shadow
        DOM using the <code>unsafeCSS</code> option. This CSS will be wrapped in
        an <code>@layer unsafe</code> block, giving it the highest priority in
        the cascade. Use this sparingly and with caution, as it bypasses the
        normal style isolation.
      </p>
      <p>
        We also recommend that any CSS you apply uses simple, direct selectors
        targeting the existing data attributes. Avoid structural selectors like{' '}
        <code>:first-child</code>, <code>:last-child</code>,{' '}
        <code>:nth-child()</code>, sibling combinators (<code>+</code> or{' '}
        <code>~</code>), deeply nested descendant selectors, or bare tag
        selectors—these are susceptible to breaking in future versions or in
        edge cases that may be difficult to anticipate.
      </p>
      <p className="font-semibold italic">
        <IconCiWarning size={16} className="inline-block text-red-500" /> We
        cannot currently guarantee backwards compatibility for this feature
        across any future changes to the library, even in patch versions. Please
        reach out so that we can discuss a more permanent solution for the style
        change that you're looking for.
      </p>
      <DocsCodeExample {...stylingUnsafe} />
    </section>
  );
}
