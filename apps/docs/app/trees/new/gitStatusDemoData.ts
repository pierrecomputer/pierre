import type { GitStatusEntry } from '@/lib/treesCompat';

export const TREE_NEW_GIT_STATUS_EXPANDED_PATHS = [
  'src',
  'src/components',
] as const;

export const TREE_NEW_GIT_STATUSES_A: GitStatusEntry[] = [
  { path: 'README.md', status: 'untracked' },
  { path: 'package.json', status: 'renamed' },
  { path: 'build/', status: 'ignored' },
  { path: 'src/index.ts', status: 'modified' },
  { path: 'src/components/Button.tsx', status: 'added' },
  { path: '.gitignore', status: 'deleted' },
];

export const TREE_NEW_GIT_STATUSES_B: GitStatusEntry[] = [
  { path: 'README.md', status: 'modified' },
  { path: 'build/scripts.js', status: 'added' },
  { path: 'src/components/Card.tsx', status: 'renamed' },
  { path: 'src/utils/worker.ts', status: 'untracked' },
  { path: '.gitignore', status: 'deleted' },
];
