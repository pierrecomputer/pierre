import type { FileTreeOptions } from '@pierre/trees';

export type ViewerLoadState =
  | 'fetching'
  | 'streaming'
  | 'parsing'
  | 'ready'
  | 'error';

export const CODE_VIEW_MARGIN_OFFSET = 12;

export const CODE_VIEW_PADDING_BLOCK = 13;

export function getCodeViewMarginOffset(isMobile: boolean): number {
  return isMobile ? 0 : CODE_VIEW_MARGIN_OFFSET;
}

export function getCodeViewPaddingTop(isMobile: boolean): number {
  return CODE_VIEW_PADDING_BLOCK + getCodeViewMarginOffset(isMobile);
}

export const CODE_VIEW_CUSTOM_CSS = `
[data-diffs-header] {
  container-type: scroll-state;
  container-name: sticky-header;
}

@media (min-width: 768px) {
  [data-diffs-header] {
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
    padding-bottom: 12px;
    margin-bottom: 12px;
    margin-right: 4px;
    border-bottom: 1px solid var(--color-border);
    padding-inline-start: 1px;
    padding-inline-end: 5px;
  }

  [data-file-tree-sticky-overlay-content] {
    box-shadow: 0 1.5px 3px -3px rgba(0,0,0,1);

    [data-item-section="spacing"] {
      opacity: 0.5;
    }

    > [data-file-tree-sticky-path]:last-of-type [data-item-section="spacing"] {
      margin-bottom: 4px;
    }
  }

  @media (prefers-color-scheme: dark) {
    [data-file-tree-sticky-overlay-content] {
      box-shadow: 0 3px 3px -3px rgba(0,0,0,0.8);

      [data-item-section="spacing"] {
        opacity: 0.6;
      }
    }
  }
`;

/** In `@layer unsafe` so it overrides core tree `padding-inline` without host vars. */
const SIDEBAR_VIRTUALIZED_SCROLL_UNSAFE_CSS = `
  [data-file-tree-virtualized-scroll="true"] {
    padding-inline-start: 0;
  }

  @media (width <= 767px) {
    [data-file-tree-search-container="true"],
    [data-file-tree-virtualized-scroll="true"] {
      padding-inline-start: 14px;
    }

    [data-file-tree-search-container="true"] {
      margin-right: 0;
      padding-inline-end: 14px;
    }

    [data-file-tree-virtualized-scroll="true"] {
      padding-inline-end: max(0px, calc(14px - var(--trees-scrollbar-gutter)));
    }
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
