import type { PreloadFileOptions } from '@pierre/diffs/ssr';
import type { FileTreeOptions } from '@pierre/file-tree';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

/** File list and options for the live FileTree in the Overview section */
export const OVERVIEW_FILE_TREE_OPTIONS: FileTreeOptions = {
  files: [
    'README.md',
    'package.json',
    'src/index.ts',
    'src/components/Button.tsx',
    'src/components/Header.tsx',
    'src/lib/utils.ts',
    'src/utils/stream.ts',
    '.gitignore',
  ],
  flattenEmptyDirectories: true,
};

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const TREES_REACT_BASIC_USAGE: PreloadFileOptions<undefined> = {
  file: {
    name: 'FileExplorer.tsx',
    contents: `import { FileTree } from '@pierre/file-tree/react';

const files = [
  'src/index.ts',
  'src/components/Button.tsx',
  'src/utils/helpers.ts',
  'package.json',
];

export function FileExplorer() {
  return <FileTree options={{ files }} />;
}`,
  },
  options,
};

export const TREES_VANILLA_BASIC_USAGE: PreloadFileOptions<undefined> = {
  file: {
    name: 'file-explorer.ts',
    contents: `import { FileTree } from '@pierre/file-tree';

const files = [
  'src/index.ts',
  'src/components/Button.tsx',
  'src/utils/helpers.ts',
  'package.json',
];

const fileTree = new FileTree({ files });
fileTree.render({ containerWrapper: document.body });`,
  },
  options,
};
