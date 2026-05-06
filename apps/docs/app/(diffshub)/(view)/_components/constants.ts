import type { FileTreeOptions } from '@pierre/trees';

export type ViewerLoadState =
  | 'fetching'
  | 'streaming'
  | 'parsing'
  | 'ready'
  | 'error';

export const CODE_VIEW_MARGIN_OFFSET = 12;

export const CODE_VIEW_PADDING_BLOCK = 17;

export const CODE_VIEW_CUSTOM_CSS = `
[data-diffs-header] {
  container-type: scroll-state;
  container-name: sticky-header;
  top: 12px;

  &::before {
    position: absolute;
    top: -12px;
    left: 0;
    right: 0;
    height: 12px;
    width: 100%;
    content: '';
    background-color: var(--diffs-bg);
  }
}

@container sticky-header scroll-state(stuck: top) {
  [data-diffs-header]::after {
    position: absolute;
    bottom: -1px;
    left: 0;
    width: 100%;
    height: 1px;
    content: '';
    background-color: var(--color-border);
  }
}
`;

// Hide the built-in search input until the user opts into search via the
// sidebar toggle. The trees library always mounts the input when
// `search: true`, but reflects open/closed state on the container's
// `data-open` attribute -- we collapse it when closed so it doesn't take up
// vertical space above the tree.
const HIDDEN_SEARCH_UNSAFE_CSS = `
  [data-file-tree-search-container][data-open='false'] {
    display: none;
  }
  [data-file-tree-search-container] {
    margin-bottom: 8px;
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

// In this view everything is assumed to be changing, so the folder dot that
// signals "contains a git change" is superfluous and is hidden globally.
const SUPPRESS_FOLDER_DOT_UNSAFE_CSS = `
  [data-item-contains-git-change='true'] > [data-item-section='git'] {
    display: none;
  }
`;

// Folders get higher contrast and medium weight to stand out from regular file
// entries, which use the default muted tree fg color.
const FOLDER_LABEL_UNSAFE_CSS = `
  [data-item-type='folder'] {
    color: color-mix(in lab, light-dark(#000, #fff) 25%, var(--trees-fg));
    font-weight: 500;
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
  unsafeCSS: `${HIDDEN_SEARCH_UNSAFE_CSS}\n${SIDEBAR_VIRTUALIZED_SCROLL_UNSAFE_CSS}\n${SUPPRESS_FOLDER_DOT_UNSAFE_CSS}\n${FOLDER_LABEL_UNSAFE_CSS}`,
} as const satisfies Omit<FileTreeOptions, 'paths' | 'preparedInput'>;
