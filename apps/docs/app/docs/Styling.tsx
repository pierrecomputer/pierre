import type { FileContents } from '@pierre/precision-diffs';

import { DocsCodeExample } from './DocsCodeExample';

export function Styling() {
  return (
    <section className="space-y-4">
      <h2>Styling</h2>
      <p>
        Diff and code are rendered using shadow dom APIs. This means that the
        styles applied to the diffs will be well isolated from your pages
        existing CSS. However it also means if you want to customize the built
        in styles, you&lsquo;ll have to utilize some custom CSS variables. These
        can be done either in your global CSS, as style props on parent
        components, or the event <code>FileDiff</code> component directly.
      </p>
      <DocsCodeExample file={CODE_GLOBAL} />
      <DocsCodeExample file={CODE_INLINE} />
    </section>
  );
}

const CODE_GLOBAL: FileContents = {
  name: 'global.css',
  contents: `:root {
  /* Available Custom CSS Variables. Most should be self explanatory */
  /* Sets code font, very important */
  --pjs-font-family: 'Berkeley Mono', monospace;
  --pjs-font-size: 14px;
  --pjs-line-height: 1.5;
  /* Controls tab character size */
  --pjs-tab-size: 2;
  /* Font used in header and separator components, typically not a monospace
   * font, but it's your call */
  --pjs-header-font-family: Helvetica;
  /* Override or customize any 'font-feature-settings' for your code font */
  --pjs-font-features: normal;

  /* By default we try to inherit the deletion/addition/modified colors from
   * the existing Shiki theme, however if you'd like to override them, you can do
   * so via these css variables: */
  --pjs-deletion-color-override: orange;
  --pjs-addition-color-override: yellow;
  --pjs-modified-color-override: purple;
}`,
};

const CODE_INLINE: FileContents = {
  name: 'inline.tsx',
  contents: `<FileDiff
  style={{
    '--pjs-font-family': 'JetBrains Mono, monospace',
    '--pjs-font-size': '13px'
  } as React.CSSProperties}
  // ... other props
/>`,
};
