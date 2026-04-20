import type { GitStatusEntry } from '@/lib/treesCompat';

export const TREE_NEW_GIT_STATUS_EXPANDED_PATHS = [
  'src',
  'src/components',
] as const;

export const TREE_NEW_GIT_STATUSES: GitStatusEntry[] = [
  { path: 'README.md', status: 'untracked' },
  { path: 'package.json', status: 'renamed' },
  { path: 'node_modules/', status: 'ignored' },
  { path: 'src/index.ts', status: 'modified' },
  { path: 'src/components/Button.tsx', status: 'added' },
  { path: '.gitignore', status: 'deleted' },
];
