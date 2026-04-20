import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const VANILLA_API_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'vanilla-api.ts',
    contents: `import { FileTree } from '@pierre/trees';

const fileTree = new FileTree({
  paths: ['README.md', 'src/index.ts'],
  search: true,
});

fileTree.render({ fileTreeContainer: container });`,
  },
  options,
};
