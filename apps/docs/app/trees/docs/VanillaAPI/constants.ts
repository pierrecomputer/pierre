import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const VANILLA_API_FILE_TREE_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'file_tree_example.ts',
    contents: `import { FileTree } from '@pierre/trees';

const files = [
  'src/index.ts',
  'src/components/Button.tsx',
  'src/utils/helpers.ts',
  'package.json',
];

const fileTree = new FileTree({ initialFiles: files });
fileTree.render({ containerWrapper: document.getElementById('tree-container') });

// Clean up when done
// fileTree.cleanUp();`,
  },
  options,
};

export const VANILLA_API_FILE_TREE_OPTIONS: PreloadFileOptions<undefined> = {
  file: {
    name: 'file_tree_options.ts',
    contents: `import { FileTree } from '@pierre/trees';

// Constructor options (see FileTree options section for full details)
const fileTree = new FileTree({
  initialFiles: ['src/index.ts', 'package.json'],
  id: 'my-tree',
  flattenEmptyDirectories: true,
  useLazyDataLoader: false,
  onSelection: (items) => console.log(items),
  config: {
    initialState: { expandedItems: ['src'], selectedItems: ['package.json'] },
    fileTreeSearchMode: 'expand-matches',
  },
});

// Render into the DOM
fileTree.render({
  fileTreeContainer: existingElement,  // optional: reuse a <file-tree> element
  containerWrapper: document.body,     // optional: append to this parent
});

// Instance methods
fileTree.getFileTreeContainer();  // get the root <file-tree-container> element
fileTree.setOptions({ ... });     // not yet implemented
fileTree.cleanUp();               // unmount and clear references`,
  },
  options,
};
