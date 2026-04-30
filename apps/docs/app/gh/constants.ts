import type { FileTreeOptions } from '@pierre/trees';

export const DEFAULT_PR_URL = 'https://github.com/nodejs/node/pull/59805';

// Hide the built-in search input until the user opts into search via the
// sidebar toggle. The trees library always mounts the input when
// `search: true`, but reflects open/closed state on the container's
// `data-open` attribute -- we collapse it when closed so it doesn't take up
// vertical space above the tree.
const HIDDEN_SEARCH_UNSAFE_CSS = `
  [data-file-tree-search-container][data-open='false'] {
    display: none;
  }
`;

/** In `@layer unsafe` so it overrides core tree `padding-inline` without host vars. */
const SIDEBAR_VIRTUALIZED_SCROLL_UNSAFE_CSS = `
  [data-file-tree-virtualized-scroll="true"] {
    padding-inline-start: 0;
  }
    [data-file-tree-search-container="true"] {
    padding-inline-start: 1px;
  }
`;

// Options shared across all mounts of this tree. Lives at module scope so the
// reference stays stable and useFileTree() never churns its initial snapshot.
export const BASE_FILE_TREE_OPTIONS = {
  flattenEmptyDirectories: true,
  id: 'gh-code-view-tree',
  initialExpansion: 'open',
  search: true,
  stickyFolders: true,
  unsafeCSS: `${HIDDEN_SEARCH_UNSAFE_CSS}\n${SIDEBAR_VIRTUALIZED_SCROLL_UNSAFE_CSS}`,
} as const satisfies Omit<FileTreeOptions, 'paths' | 'preparedInput'>;
