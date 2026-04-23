import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const STYLING_CODE_GLOBAL: PreloadFileOptions<undefined> = {
  file: {
    name: 'global.css',
    contents: `:root {
  /* Available Custom CSS Variables. Most should be self explanatory */
  /* Sets code font, very important */
  --diffs-font-family: 'Berkeley Mono', monospace;
  --diffs-font-size: 14px;
  --diffs-line-height: 1.5;
  /* Controls tab character size */
  --diffs-tab-size: 2;
  /* Font used in header and separator components,
   * typically not a monospace font, but it's your call */
  --diffs-header-font-family: Helvetica;
  /* Override or customize any 'font-feature-settings'
   * for your code font */
  --diffs-font-features: normal;
  /* Override the minimum width for the number column. By default
   * it should take into account the number of digits required
   * based on the lines in the file itself, but you can manually
   * override if desired.  Generally we recommend using ch units
   * because they work well with monospaced fonts */
  --diffs-min-number-column-width: 3ch;

  /* By default we try to inherit the deletion/addition/modified
   * colors from the existing Shiki theme, however if you'd like
   * to override them, you can do so via these css variables: */
  --diffs-deletion-color-override: orange;
  --diffs-addition-color-override: yellow;
  --diffs-modified-color-override: purple;

  /* Line selection colors - customize the highlighting when users
   * select lines via enableLineSelection. These support light-dark()
   * for automatic theme adaptation. */
  --diffs-selection-color-override: rgb(37, 99, 235);
  --diffs-bg-selection-override: rgba(147, 197, 253, 0.28);
  --diffs-bg-selection-number-override: rgba(96, 165, 250, 0.55);
  --diffs-bg-selection-background-override: rgba(96, 165, 250, 0.2);
  --diffs-bg-selection-number-background-override: rgba(59, 130, 246, 0.4);

  /* Some basic variables for tweaking the layouts of some of the built in
   * components */
  --diffs-gap-inline: 8px;
  --diffs-gap-block: 8px;
}`,
  },
  options,
};

export const STYLING_CODE_INLINE: PreloadFileOptions<undefined> = {
  file: {
    name: 'inline.tsx',
    contents: `<FileDiff
  style={{
    '--diffs-font-family': 'JetBrains Mono, monospace',
    '--diffs-font-size': '13px'
  } as React.CSSProperties}
  // ... other props
/>`,
  },
  options,
};

export const STYLING_CODE_UNSAFE: PreloadFileOptions<undefined> = {
  file: {
    name: 'unsafe-css.tsx',
    contents: `<FileDiff
  options={{
    unsafeCSS: /* css */ \`
[data-line-index='0'] {
  border-top: 1px solid var(--diffs-bg-context);
}

[data-line] {
  border-bottom: 1px solid var(--diffs-bg-context);
}

[data-column-number] {
  border-right: 1px solid var(--diffs-bg-context);
}\`
  }}
  // ... other props
/>`,
  },
  options: {
    ...options,
    unsafeCSS: `[data-line-index='0'] {
  border-top: 1px solid var(--diffs-bg-context);
}

[data-line] {
  border-bottom: 1px solid var(--diffs-bg-context);
}

[data-column-number] {
  border-right: 1px solid var(--diffs-bg-context);
}`,
  },
};
