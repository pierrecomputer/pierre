import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const SSR_API_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'preload-file-tree.ts',
    contents: `import { preloadFileTree } from '@pierre/trees/ssr';

const payload = preloadFileTree({
  preparedInput,
  id: 'project-tree',
  initialExpandedPaths: ['src'],
  viewportHeight: 320,
});`,
  },
  options,
};
