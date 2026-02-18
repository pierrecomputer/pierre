import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const REACT_API_FILE_TREE: PreloadFileOptions<undefined> = {
  file: {
    name: 'FileExplorer.tsx',
    contents: `import { FileTree } from '@pierre/trees/react';

const files = [
  'src/index.ts',
  'src/components/Button.tsx',
  'src/utils/helpers.ts',
  'package.json',
];

export function FileExplorer() {
  return <FileTree options={{ initialFiles: files }} />;
}`,
  },
  options,
};

export const REACT_API_FILE_TREE_PROPS: PreloadFileOptions<undefined> = {
  file: {
    name: 'file_tree_props.tsx',
    contents: `import { FileTree } from '@pierre/trees/react';

// FileTree accepts these props:

<FileTree
  // Required: file list and tree options (see FileTree options section)
  options={{
    initialFiles: ['src/index.ts', 'package.json'],
    flattenEmptyDirectories: true,
    onSelection: (items) => console.log(items),
    config: {
      initialState: { expandedItems: ['src'], selectedItems: ['package.json'] },
      fileTreeSearchMode: 'expand-matches',
    },
  }}

  // Optional: CSS class name
  className="my-file-tree"

  // Optional: inline styles
  style={{ maxHeight: 400 }}

  // Optional: pre-rendered HTML for SSR hydration
  prerenderedHTML={htmlFromServer}
/>`,
  },
  options,
};
