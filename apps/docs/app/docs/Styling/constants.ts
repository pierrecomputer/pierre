import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';
import type { PreloadFileOptions } from '@pierre/precision-diffs/ssr';

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
  --pjs-font-family: 'Berkeley Mono', monospace;
  --pjs-font-size: 14px;
  --pjs-line-height: 1.5;
  /* Controls tab character size */
  --pjs-tab-size: 2;
  /* Font used in header and separator components,
   * typically not a monospace font, but it's your call */
  --pjs-header-font-family: Helvetica;
  /* Override or customize any 'font-feature-settings'
   * for your code font */
  --pjs-font-features: normal;
  /* Override the minimum width for the number column. By default
   * it should take into account the number of digits required
   * based on the lines in the file itself, but you can manually
   * override if desired.  Generally we recommend using ch units
   * because they work well with monospaced fonts */
  --pjs-min-number-column-width: 3ch;

  /* By default we try to inherit the deletion/addition/modified
   * colors from the existing Shiki theme, however if you'd like
   * to override them, you can do so via these css variables: */
  --pjs-deletion-color-override: orange;
  --pjs-addition-color-override: yellow;
  --pjs-modified-color-override: purple;

  /* Line selection colors - customize the highlighting when users
   * select lines via enableLineSelection. These support light-dark()
   * for automatic theme adaptation. */
  --pjs-selection-color-override: rgb(37, 99, 235);
  --pjs-bg-selection-override: rgba(147, 197, 253, 0.28);
  --pjs-bg-selection-number-override: rgba(96, 165, 250, 0.55);
  --pjs-bg-selection-background-override: rgba(96, 165, 250, 0.2);
  --pjs-bg-selection-number-background-override: rgba(59, 130, 246, 0.4);

  /* Some basic variables for tweaking the layouts of some of the built in
   * components */
  --pjs-gap-inline: 8px;
  --pjs-gap-block: 8px;
}`,
  },
  options,
};

export const STYLING_CODE_INLINE: PreloadFileOptions<undefined> = {
  file: {
    name: 'inline.tsx',
    contents: `<FileDiff
  style={{
    '--pjs-font-family': 'JetBrains Mono, monospace',
    '--pjs-font-size': '13px'
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
  border-top: 1px solid var(--pjs-bg-context);
}

[data-line] {
  border-bottom: 1px solid var(--pjs-bg-context);
}

[data-column-number] {
  border-right: 1px solid var(--pjs-bg-context);
}\`
  }}
  // ... other props
/>`,
  },
  options: {
    ...options,
    unsafeCSS: `[data-line-index='0'] {
  border-top: 1px solid var(--pjs-bg-context);
}

[data-line] {
  border-bottom: 1px solid var(--pjs-bg-context);
}

[data-column-number] {
  border-right: 1px solid var(--pjs-bg-context);
}`,
  },
};
