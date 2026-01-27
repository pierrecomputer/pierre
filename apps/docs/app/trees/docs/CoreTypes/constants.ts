import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const FILE_TREE_OPTIONS_TYPE: PreloadFileOptions<undefined> = {
  file: {
    name: 'FileTreeOptions.ts',
    contents: `import type {
  FileTreeOptions,
  FileTreeSelectionItem,
  HeadlessTreeConfig,
} from '@pierre/file-tree';

// FileTreeOptions is the main options object for FileTree (vanilla and React).
// Pass it to the FileTree constructor or to the <FileTree options={...} /> component.
interface FileTreeOptions {
  // Required: array of file paths (forward slashes). Defines the tree structure.
  files: string[];

  // Optional: unique id for this instance (DOM ids, SSR). Defaults to ft_brw_1, etc.
  id?: string;

  // Optional: collapse single-child folder chains into one row. Default: false.
  flattenEmptyDirectories?: boolean;

  // Optional: load children when a folder is expanded (for very large trees). Default: false.
  useLazyDataLoader?: boolean;

  // Optional: callback when selection changes. Receives FileTreeSelectionItem[].
  onSelection?: (items: FileTreeSelectionItem[]) => void;

  // Optional: headless tree config (initialState, fileTreeSearchMode, setState, etc.).
  config?: HeadlessTreeConfig;
}

// Example usage
const options: FileTreeOptions = {
  files: [
    'README.md',
    'package.json',
    'src/index.ts',
    'src/components/Button.tsx',
  ],
  flattenEmptyDirectories: true,
  onSelection: (items) => {
    const file = items.find((i) => !i.isFolder);
    if (file) console.log('Selected:', file.path);
  },
};`,
  },
  options,
};

export const FILE_TREE_SELECTION_ITEM_TYPE: PreloadFileOptions<undefined> = {
  file: {
    name: 'FileTreeSelectionItem.ts',
    contents: `import type { FileTreeSelectionItem } from '@pierre/file-tree';

// FileTreeSelectionItem describes one item in the selection.
// Your onSelection callback receives an array of these.
interface FileTreeSelectionItem {
  // The path of the file or folder (e.g. 'src/index.ts' or 'src/components').
  path: string;

  // true for folders, false for files.
  isFolder: boolean;
}

// Example: use in onSelection
function handleSelection(items: FileTreeSelectionItem[]) {
  const selectedFile = items.find((i) => !i.isFolder);
  const selectedFolders = items.filter((i) => i.isFolder);

  if (selectedFile) {
    console.log('Selected file:', selectedFile.path);
  }
  selectedFolders.forEach((folder) => {
    console.log('Expanded folder:', folder.path);
  });
}

// Pass to FileTreeOptions
const options = {
  files: ['src/index.ts', 'src/components/Button.tsx'],
  onSelection: handleSelection,
};`,
  },
  options,
};

export const FILE_TREE_SEARCH_MODE_TYPE: PreloadFileOptions<undefined> = {
  file: {
    name: 'FileTreeSearchMode.ts',
    contents: `import type { FileTreeSearchMode } from '@pierre/file-tree';

// FileTreeSearchMode is 'expand-matches' | 'collapse-non-matches'.
// Pass it via config.fileTreeSearchMode in FileTreeOptions.
//
// 'expand-matches' (default): expand nodes that match the search.
// 'collapse-non-matches': hide non-matching branches; only matching
// paths and their parents stay visible.

const options = {
  files: ['src/index.ts', 'src/components/Button.tsx'],
  config: {
    fileTreeSearchMode: 'collapse-non-matches',
  },
};`,
  },
  options,
};

export const HEADLESS_TREE_CONFIG_TYPE: PreloadFileOptions<undefined> = {
  file: {
    name: 'HeadlessTreeConfig.ts',
    contents: `import type { HeadlessTreeConfig, FileTreeSearchMode } from '@pierre/file-tree';

// HeadlessTreeConfig is the optional config passed inside FileTreeOptions.
// It is a subset of @headless-tree/core TreeConfig: FileTree wires up
// dataLoader, rootItemId, getItemName, isItemFolder, and features for you.
// You can pass:

// config.initialState — initial tree state
interface InitialState {
  expandedItems?: string[];  // item ids to expand on load (paths or f::... for flattened)
  selectedItems?: string[]; // item ids to select on load (e.g. ['package.json'])
  focusedItem?: string | null; // item id to focus, or null
}

// config.fileTreeSearchMode — how search affects the tree (see FileTreeSearchMode)
// config.setState — optional callback for controlled state updates (advanced)

const options = {
  files: ['README.md', 'src/index.ts', 'src/components/Button.tsx'],
  config: {
    initialState: {
      expandedItems: ['src', 'src/components'],
      selectedItems: ['src/index.ts'],
    },
    fileTreeSearchMode: 'collapse-non-matches' as FileTreeSearchMode,
  },
} as const;`,
  },
  options,
};
