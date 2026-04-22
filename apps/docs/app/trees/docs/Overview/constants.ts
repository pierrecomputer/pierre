import type { FileTreeOptions } from '@/lib/treesCompatShared';

export const OVERVIEW_TREE_ID = 'trees-docs-overview';

export const OVERVIEW_FILES: string[] = [
  'README.md',
  'package.json',
  '.gitignore',
  'src/index.ts',
  'src/components/Button.tsx',
  'src/components/Card.tsx',
  'src/components/Header.tsx',
  'src/lib/utils.ts',
  'src/styles/globals.css',
  'public/favicon.ico',
];

export const OVERVIEW_INITIAL_EXPANDED_ITEMS: string[] = [
  'src',
  'src/components',
];

export const OVERVIEW_OPTIONS: FileTreeOptions = {
  id: OVERVIEW_TREE_ID,
};
