import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const HELPER_SORT_CHILDREN: PreloadFileOptions<undefined> = {
  file: {
    name: 'sortChildren.ts',
    contents: `import {
  sortChildren,
  defaultChildrenComparator,
  alphabeticalChildrenComparator,
  type ChildrenComparator,
} from '@pierre/trees';

// Sort an array of child paths for display in a file tree.
// Use this when building custom loaders or when you need a specific order.

const childPaths = ['src/utils/helper.ts', 'src/index.ts', 'src/components'];
const isFolder = (path: string) =>
  path === 'src' || path === 'src/utils' || path === 'src/components';

// Default: folders first, then dot-prefixed, then case-insensitive alphabetical
const defaultOrder = sortChildren(childPaths, isFolder);

// Or use the built-in alphabetical comparator (no folders-first)
const alphabeticalOrder = sortChildren(
  childPaths,
  isFolder,
  alphabeticalChildrenComparator
);

// Custom comparator: e.g. put 'README' first
const customComparator: ChildrenComparator = (a, b, isFolder) => {
  const aName = a.split('/').pop() ?? '';
  const bName = b.split('/').pop() ?? '';
  if (aName === 'README.md') return -1;
  if (bName === 'README.md') return 1;
  return defaultChildrenComparator(a, b, isFolder);
};
const customOrder = sortChildren(childPaths, isFolder, customComparator);`,
  },
  options,
};

export const HELPER_GENERATE_SYNC_DATA_LOADER: PreloadFileOptions<undefined> = {
  file: {
    name: 'generateSyncDataLoader.ts',
    contents: `import {
  generateSyncDataLoader,
  type FileTreeOptions,
} from '@pierre/trees';
import { FileTree } from '@pierre/trees';
// or: import { FileTree } from '@pierre/trees/react';

// FileTree uses generateSyncDataLoader internally when you pass \`initialFiles\`.
// Use it directly when building custom loaders or integrating with the headless tree.

const filePaths = [
  'README.md',
  'package.json',
  'src/index.ts',
  'src/utils/helper.ts',
  'src/components/Button.tsx',
];

// All nodes are computed upfront. Best for small-to-medium trees.
const dataLoader = generateSyncDataLoader(filePaths, {
  rootId: 'root',
  rootName: 'root',
  flattenEmptyDirectories: true, // collapse single-child folder chains
  // sortComparator: myCustomComparator,
});

// When you pass \`initialFiles\` to FileTree, it builds the loader like this internally.
const options: FileTreeOptions = {
  initialFiles: filePaths,
  flattenEmptyDirectories: true,
};

const tree = new FileTree(options);
tree.render({ containerWrapper: document.getElementById('tree')! });`,
  },
  options,
};

export const HELPER_GENERATE_LAZY_DATA_LOADER: PreloadFileOptions<undefined> = {
  file: {
    name: 'generateLazyDataLoader.ts',
    contents: `import {
  generateLazyDataLoader,
  type FileTreeOptions,
} from '@pierre/trees';
import { FileTree } from '@pierre/trees';

// FileTree uses generateLazyDataLoader internally when you pass
// \`initialFiles\` and \`useLazyDataLoader: true\`. Use it directly for custom integrations.

const filePaths = [
  'README.md',
  'src/index.ts',
  'src/utils/helper.ts',
  'src/utils/format.ts',
  'src/components/Button.tsx',
  'src/components/Input.tsx',
];

// Nodes are computed on demand when folders are expanded.
// Best for large trees where most folders stay collapsed.
const dataLoader = generateLazyDataLoader(filePaths, {
  rootId: 'root',
  rootName: 'root',
  flattenEmptyDirectories: true,
});

const options: FileTreeOptions = {
  initialFiles: filePaths,
  useLazyDataLoader: true,
  flattenEmptyDirectories: true,
};

const tree = new FileTree(options);
tree.render({ containerWrapper: document.getElementById('tree')! });`,
  },
  options,
};
