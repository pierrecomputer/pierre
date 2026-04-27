import type { FileTreeOptions } from '@pierre/trees';

export type OverviewFileTreeOptions = Omit<
  FileTreeOptions,
  'paths' | 'preparedInput' | 'initialExpandedPaths'
>;

export const OVERVIEW_TREE_ID = 'trees-docs-overview';

export const OVERVIEW_PATHS: string[] = [
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

export const OVERVIEW_INITIAL_EXPANDED_PATHS: string[] = [
  'src',
  'src/components',
];

export const OVERVIEW_OPTIONS: OverviewFileTreeOptions = {
  id: OVERVIEW_TREE_ID,
};
