import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const STYLING_THEMING_REFERENCE_EXAMPLE: PreloadFileOptions<undefined> =
  {
    file: {
      name: 'theme-to-tree-styles.ts',
      contents: `import { themeToTreeStyles } from '@pierre/trees';

const treeStyles = themeToTreeStyles(theme);`,
    },
    options,
  };
