import type { CSSProperties } from 'react';

import type { GitStatusEntry } from '@/lib/treesCompat';

/** Default panel look for FileTree in docs examples. Apply via className + style on FileTree. */
export function getDefaultFileTreePanelClass(
  colorMode: 'light' | 'dark' = 'dark'
): string {
  const base =
    'min-h-0 flex-1 overflow-auto rounded-lg py-3 border border-neutral-200 dark:border-neutral-800';
  return colorMode === 'dark' ? `dark ${base}` : base;
}

export const DEFAULT_FILE_TREE_PANEL_STYLE: CSSProperties = {
  colorScheme: 'dark',
};

export const GIT_STATUSES_A: GitStatusEntry[] = [
  { path: 'src/index.ts', status: 'modified' },
  { path: 'src/components/Button.tsx', status: 'added' },
  { path: '.gitignore', status: 'deleted' },
];
