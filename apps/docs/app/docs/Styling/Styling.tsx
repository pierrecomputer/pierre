'use client';

import { IconCiWarningFill } from '@/components/icons';
import { Notice } from '@/components/ui/notice';
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
        Diff and code components are rendered using shadow DOM APIs, allowing
        styles to be well-isolated from your page’s existing CSS. However, it
        also means you may have to utilize some custom CSS variables to override
        default styles. These can be done in your global CSS, as style props on
        parent components, or on the <code>FileDiff</code> component directly.
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
      <Notice variant="warning" icon={<IconCiWarningFill />}>
        We cannot currently guarantee backwards compatibility for this feature
        across any future changes to the library, even in patch versions. Please
        reach out so that we can discuss a more permanent solution for modifying
        styles.
      </Notice>
      <DocsCodeExample {...stylingUnsafe} />
    </section>
  );
}
