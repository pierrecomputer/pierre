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
  FileTreeIconConfig,
  FileTreeStateConfig,
  FileTreeSearchMode,
  FileTreeCollision,
  ChildrenComparator,
  GitStatusEntry,
} from '@pierre/trees';

// FileTreeOptions is the main options object for FileTree (vanilla and React).
// Pass it to the FileTree constructor or to the <FileTree options={...} /> component.
interface FileTreeOptions {
  // Required: array of file paths (forward slashes). Defines the tree structure.
  initialFiles: string[];

  // Optional: unique id for this instance (DOM ids, SSR). Defaults to ft_brw_1, etc.
  id?: string;

  // Optional: collapse single-child folder chains into one row. Default: false.
  flattenEmptyDirectories?: boolean;

  // Optional: load children when a folder is expanded (for very large trees). Default: false.
  useLazyDataLoader?: boolean;

  // Optional: file tree search behavior.
  fileTreeSearchMode?: FileTreeSearchMode;

  // Optional: enable built-in drag and drop. Default: false.
  dragAndDrop?: boolean;

  // Optional: Git status entries for file status indicators.
  gitStatus?: GitStatusEntry[];

  // Optional: custom SVG sprite sheet and icon remapping.
  icons?: FileTreeIconConfig;

  // Optional: paths that cannot be dragged when drag and drop is enabled.
  lockedPaths?: string[];

  // Optional: return true to overwrite the destination on DnD collision.
  onCollision?: (collision: FileTreeCollision) => boolean;

  // Optional: sort children within each directory. Default: true (folders first,
  // dot-prefixed next, case-insensitive alphabetical). false preserves insertion
  // order. { comparator: fn } for custom sorting.
  sort?: boolean | { comparator: ChildrenComparator };

  // Optional: enable virtualized rendering (only visible items are rendered).
  // Pass { threshold: N } to activate when item count >= N. Default: undefined (off).
  virtualize?: { threshold: number } | false;
}

// Example usage
const options: FileTreeOptions = {
  initialFiles: [
    'README.md',
    'package.json',
    'src/index.ts',
    'src/components/Button.tsx',
  ],
  flattenEmptyDirectories: true,
  fileTreeSearchMode: 'collapse-non-matches',
};

// State callbacks and controlled state are configured separately:
const stateConfig: FileTreeStateConfig = {
  initialExpandedItems: ['src'],
  onSelection: (items) => {
    const first = items.find((item) => !item.isFolder);
    if (first) {
      console.log('Selected:', first.path);
    }
  },
};`,
  },
  options,
};

export const FILE_TREE_SELECTION_ITEM_TYPE: PreloadFileOptions<undefined> = {
  file: {
    name: 'FileTreeSelectionItem.ts',
    contents: `import type { FileTreeSelectionItem } from '@pierre/trees';

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
  initialFiles: ['src/index.ts', 'src/components/Button.tsx'],
};`,
  },
  options,
};

export const FILE_TREE_SEARCH_MODE_TYPE: PreloadFileOptions<undefined> = {
  file: {
    name: 'FileTreeSearchMode.ts',
    contents: `import type { FileTreeSearchMode } from '@pierre/trees';

// FileTreeSearchMode is:
// - 'expand-matches' (default)
// - 'collapse-non-matches'
// - 'hide-non-matches'
// Pass it via fileTreeSearchMode in FileTreeOptions.
//
// 'expand-matches' (default): expand nodes that match the search.
// 'collapse-non-matches': hide non-matching branches; only matching
// paths and their parents stay visible.
// 'hide-non-matches': keep branch structure, but hide non-matching rows.

const options = {
  initialFiles: ['src/index.ts', 'src/components/Button.tsx'],
  fileTreeSearchMode: 'collapse-non-matches' as FileTreeSearchMode,
};`,
  },
  options,
};

export const FILE_TREE_ICON_CONFIG_TYPE: PreloadFileOptions<undefined> = {
  file: {
    name: 'FileTreeIconConfig.ts',
    contents: `import type { FileTreeIconConfig } from '@pierre/trees';

// FileTreeIconConfig lets you replace built-in icons with custom SVG symbols.
interface FileTreeIconConfig {
  // An SVG string with <symbol> definitions injected into the shadow DOM.
  spriteSheet?: string;

  // Map built-in icon names to custom symbol ids or objects with sizing info.
  remap?: Record<
    string,
    | string
    | { name: string; width?: number; height?: number; viewBox?: string }
  >;
}

// Example: replace the file and chevron icons with custom symbols.
const options = {
  initialFiles: ['src/index.ts', 'src/components/Button.tsx'],
  icons: {
    spriteSheet: \`
      <svg data-icon-sprite aria-hidden="true" width="0" height="0">
        <symbol id="my-file" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2">
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>
          <path d="M14 2v4a2 2 0 0 0 2 2h4"/>
        </symbol>
        <symbol id="my-folder" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2">
          <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>
        </symbol>
      </svg>
    \`,
    remap: {
      'file-tree-icon-file': 'my-file',
      'file-tree-icon-chevron': { name: 'my-folder', width: 16, height: 16 },
    },
  },
};`,
  },
  options,
};

export const FILE_TREE_STATE_CONFIG_TYPE: PreloadFileOptions<undefined> = {
  file: {
    name: 'FileTreeStateConfig.ts',
    contents: `import { FileTree } from '@pierre/trees';
import type { FileTreeStateConfig } from '@pierre/trees';

// FileTreeStateConfig controls default/controlled tree state and callbacks.
const stateConfig: FileTreeStateConfig = {
  initialExpandedItems: ['src', 'src/components'],
  initialSelectedItems: ['src/index.ts'],
  onSelection: (items) => {
    console.log(items);
  },
  onExpandedItemsChange: (items) => {
    console.log('expanded', items);
  },
};

const fileTree = new FileTree(
  {
    initialFiles: ['README.md', 'src/index.ts', 'src/components/Button.tsx'],
  },
  stateConfig
);`,
  },
  options,
};

export const FILES_OPTION_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'fileTreeOptions.ts',
    contents: `const fileTreeOptions = {
  initialFiles: [
    'README.md',
    'package.json',
    'src/index.ts',
    'src/components/Button.tsx',
    'src/utils/helpers.ts',
  ],
  // …
};`,
  },
  options: {
    theme: { dark: 'pierre-dark', light: 'pierre-light' },
    disableFileHeader: true,
  },
};

export const ON_SELECTION_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'onSelection.ts',
    contents: `// React: top-level prop
<FileTree
  options={{ initialFiles: ['src/index.ts', 'src/components/Button.tsx'] }}
  onSelection={(items: FileTreeSelectionItem[]) => {
    const file = items.find((i) => !i.isFolder);
    if (file) setSelectedPath(file.path);
  }}
/>;

// Vanilla: FileTreeStateConfig (second constructor argument)
const stateConfig = {
  onSelection: (items: FileTreeSelectionItem[]) => {
  const file = items.find((i) => !i.isFolder);
  if (file) setSelectedPath(file.path);
  },
};`,
  },
  options: {
    theme: { dark: 'pierre-dark', light: 'pierre-light' },
    disableFileHeader: true,
  },
};
