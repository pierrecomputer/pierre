import type { GitStatusEntry } from '@pierre/trees';

import { sampleFileList } from '../../trees/demo-data';

export interface ThemeGridItem {
  name: string;
  type: string;
  styles: Record<string, string>;
}

export type ViewMode = 'trees' | 'diffs' | 'both';

const VALID_MODES = new Set<string>(['trees', 'diffs', 'both']);
export function isViewMode(value: string | null): value is ViewMode {
  return value != null && VALID_MODES.has(value);
}

export const MODES: { value: ViewMode; label: string }[] = [
  { value: 'trees', label: 'Trees' },
  { value: 'diffs', label: 'FileDiffs' },
  { value: 'both', label: 'Trees + FileDiffs' },
];

export const GRID_CLASSES: Record<ViewMode, string> = {
  trees:
    'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6',
  diffs: 'grid-cols-1 md:grid-cols-2 3xl:grid-cols-3',
  both: 'grid-cols-1 lg:grid-cols-2 3xl:grid-cols-3',
};

export const TREE_OPTIONS = {
  flattenEmptyDirectories: true,
} as const;

export const INITIAL_EXPANDED_ITEMS = [
  'build',
  'build/assets',
  'src',
  'src/components',
];

export const PREVIEW_FILES = sampleFileList.map((path) => {
  if (path === 'build/index.mjs') return 'build/hover.mjs';
  if (path === 'src/components/Button.tsx') return 'src/components/focus.tsx';
  if (path === 'src/components/Card.tsx') return 'src/components/selected.tsx';
  if (path === 'src/index.ts') return 'src/focus-selected.tsx';
  return path;
});

export const STATE_FILE_NAMES = {
  hover: 'hover.mjs',
  focus: 'focus.tsx',
  selected: 'selected.tsx',
  selectedFocused: 'focus-selected.tsx',
} as const;

export const GIT_STATUSES: GitStatusEntry[] = [
  { path: 'src/lib/utils.ts', status: 'modified' },
  { path: 'src/components/Header.tsx', status: 'added' },
  { path: '.gitignore', status: 'deleted' },
];

export const SWATCH_TOKENS: { key: string; label: string }[] = [
  { key: 'backgroundColor', label: 'bg' },
  { key: 'color', label: 'fg' },
  { key: 'borderColor', label: 'border' },
  { key: '--trees-theme-sidebar-border', label: 'border' },
  { key: '--trees-theme-sidebar-header-fg', label: 'muted' },
  { key: '--trees-theme-list-hover-bg', label: 'hover' },
  { key: '--trees-theme-list-active-selection-bg', label: 'selected bg' },
  { key: '--trees-theme-list-active-selection-fg', label: 'selected fg' },
  { key: '--trees-theme-focus-ring', label: 'focus ring' },
  { key: '--trees-theme-input-bg', label: 'input bg' },
  { key: '--trees-theme-git-added-fg', label: 'added' },
  { key: '--trees-theme-git-modified-fg', label: 'modified' },
  { key: '--trees-theme-git-deleted-fg', label: 'deleted' },
];
