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
} from '@pierre/file-tree';

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
} from '@pierre/file-tree';
import { FileTree } from '@pierre/file-tree';
// or: import { FileTree } from '@pierre/file-tree/react';

// FileTree uses generateSyncDataLoader internally when you pass \`files\`.
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

// When you pass \`files\` to FileTree, it builds the loader like this internally.
const options: FileTreeOptions = {
  files: filePaths,
  flattenEmptyDirectories: true,
};

const tree = new FileTree(options);
tree.render({ container: document.getElementById('tree')! });`,
  },
  options,
};

export const HELPER_GENERATE_LAZY_DATA_LOADER: PreloadFileOptions<undefined> = {
  file: {
    name: 'generateLazyDataLoader.ts',
    contents: `import {
  generateLazyDataLoader,
  type FileTreeOptions,
} from '@pierre/file-tree';
import { FileTree } from '@pierre/file-tree';

// FileTree uses generateLazyDataLoader internally when you pass
// \`files\` and \`useLazyDataLoader: true\`. Use it directly for custom integrations.

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
  files: filePaths,
  useLazyDataLoader: true,
  flattenEmptyDirectories: true,
};

const tree = new FileTree(options);
tree.render({ container: document.getElementById('tree')! });`,
  },
  options,
};

export const HELPER_PRELOAD_FILE_TREE: PreloadFileOptions<undefined> = {
  file: {
    name: 'preloadFileTree.ts',
    contents: `import { preloadFileTree } from '@pierre/file-tree/ssr';
import type { FileTreeOptions } from '@pierre/file-tree';

// Prerender the file tree HTML on the server for fast first paint.
// Hydrate on the client with the same options.

// Server (e.g. Next.js app router page)
const fileTreeOptions: FileTreeOptions = {
  files: ['README.md', 'src/index.ts', 'src/utils/helper.ts'],
  flattenEmptyDirectories: true,
};

export default async function Page() {
  const preloadedHtml = preloadFileTree(fileTreeOptions);

  return (
    <div
      dangerouslySetInnerHTML={{ __html: preloadedHtml }}
      data-file-tree-props={JSON.stringify(fileTreeOptions)}
    />
  );
}

// Client: use the React component with prerenderedHTML to hydrate,
// or use vanilla FileTree and pass the same options + container that
// holds the prerendered markup.`,
  },
  options,
};
