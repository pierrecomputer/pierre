import type {
  FileTreeOptions,
  FileTreeSearchMode,
  GitStatusEntry,
} from '@pierre/trees';
import type { CSSProperties } from 'react';

import { sharedDemoFileTreeOptions } from '../../trees/demo-data';

/** Default panel look for FileTree in docs examples. Apply via className + style on FileTree. */
export const DEFAULT_FILE_TREE_PANEL_CLASS =
  'dark min-h-0 flex-1 overflow-auto rounded-lg p-3 border border-[var(--trees-border-color)]';

export const DEFAULT_FILE_TREE_PANEL_STYLE: CSSProperties = {
  colorScheme: 'dark',
};

export const GIT_STATUSES_A: GitStatusEntry[] = [
  { path: 'src/index.ts', status: 'modified' },
  { path: 'src/components/Button.tsx', status: 'added' },
  { path: '.gitignore', status: 'deleted' },
];

export const GIT_STATUSES_B: GitStatusEntry[] = [
  { path: 'README.md', status: 'modified' },
  { path: 'src/lib/utils.ts', status: 'modified' },
  { path: 'src/utils/worker.ts', status: 'added' },
];

/** Options with flatten empty directories enabled (nested folders collapsed). Pass initialExpandedItems on the component for initial open folders (e.g. ['build']). */
export function flatteningOptions(flatten: boolean): FileTreeOptions {
  return {
    ...sharedDemoFileTreeOptions,
    flattenEmptyDirectories: flatten,
  };
}

/** Base options for all tree example sections. */
export const baseTreeOptions = sharedDemoFileTreeOptions;

/** Options for drag-and-drop examples. Optional lockedPaths prevents those paths from being dragged. */
export function dragDropOptions(lockedPaths?: string[]): FileTreeOptions {
  return {
    ...baseTreeOptions,
    dragAndDrop: true,
    ...(lockedPaths != null && lockedPaths.length > 0 && { lockedPaths }),
  };
}

/** Options with search mode for the search example. Pass fileTreeSearchMode at top level so the tree applies it. Use stateConfig.initialSearchQuery in the component for prepopulated search. */
export function searchOptions(mode: FileTreeSearchMode): FileTreeOptions {
  return {
    ...sharedDemoFileTreeOptions,
    fileTreeSearchMode: mode,
  };
}
