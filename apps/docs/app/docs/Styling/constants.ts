import type { PreloadFileOptions } from '@pierre/precision-diffs/ssr';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
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
  /* Override the minimum width for the number column. Be default
   * it should accomodate 4 numbers with padding at a value 
   * of 7ch (the default) */
  --pjs-min-number-column-width: 7ch;

  /* By default we try to inherit the deletion/addition/modified
   * colors from the existing Shiki theme, however if you'd like
   * to override them, you can do so via these css variables: */
  --pjs-deletion-color-override: orange;
  --pjs-addition-color-override: yellow;
  --pjs-modified-color-override: purple;

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
    unsafeCSS: \`[data-pjs] {
      border: 2px solid #C635E4;
      border-bottom-left-radius: 8px;
      border-bottom-right-radius: 8px; }\`
  }}
  // ... other props
/>`,
  },
  options: {
    ...options,
    unsafeCSS: `[data-pjs] {
      border: 2px solid #C635E4;
      border-bottom-left-radius: 8px;
      border-bottom-right-radius: 8px; }`,
  },
};
