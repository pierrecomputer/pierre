import type { CSSProperties } from 'react';

import type { GitStatusEntry } from '@/lib/treesCompat';

/** Default panel look for FileTree in docs examples. Apply via className + style on FileTree. */
export const DEFAULT_FILE_TREE_PANEL_CLASS =
  'dark min-h-0 flex-1 overflow-auto rounded-lg p-3 border border-neutral-200 dark:border-neutral-800';

export const DEFAULT_FILE_TREE_PANEL_STYLE: CSSProperties = {
  colorScheme: 'dark',
};

export const GIT_STATUSES_A: GitStatusEntry[] = [
  { path: 'src/index.ts', status: 'modified' },
  { path: 'src/components/Button.tsx', status: 'added' },
  { path: '.gitignore', status: 'deleted' },
];
