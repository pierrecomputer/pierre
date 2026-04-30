import type { FileTreeOptions } from '@pierre/trees';

export const DEFAULT_PR_URL = 'https://github.com/nodejs/node/pull/59805';

// Options shared across all mounts of this tree. Lives at module scope so the
// reference stays stable and useFileTree() never churns its initial snapshot.
export const BASE_FILE_TREE_OPTIONS = {
  flattenEmptyDirectories: true,
  id: 'gh-code-view-tree',
  initialExpansion: 'open',
  search: true,
  stickyFolders: true,
} as const satisfies Omit<FileTreeOptions, 'paths' | 'preparedInput'>;
