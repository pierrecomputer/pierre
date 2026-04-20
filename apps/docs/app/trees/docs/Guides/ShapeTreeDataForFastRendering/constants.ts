import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const SHAPE_TREE_DATA_PREPARE_LOADER: PreloadFileOptions<undefined> = {
  file: {
    name: 'load-project-tree-input.ts',
    contents: `import { prepareFileTreeInput } from '@pierre/trees';

export async function loadProjectTreeInput(projectId: string) {
  const paths = await fetchProjectPaths(projectId);

  return prepareFileTreeInput(paths, {
    flattenEmptyDirectories: true,
  });
}`,
  },
  options,
};

export const SHAPE_TREE_DATA_REACT_TREE: PreloadFileOptions<undefined> = {
  file: {
    name: 'react-tree.tsx',
    contents: `import { FileTree, useFileTree } from '@pierre/trees/react';
import type { FileTreePreparedInput } from '@pierre/trees';

export function ReactTree({
  preparedInput,
}: {
  preparedInput: FileTreePreparedInput;
}) {
  const { model } = useFileTree({ preparedInput, viewportHeight: 320 });
  return <FileTree model={model} />;
}`,
  },
  options,
};

export const SHAPE_TREE_DATA_VANILLA_MOUNT: PreloadFileOptions<undefined> = {
  file: {
    name: 'mount-vanilla-tree.ts',
    contents: `import { FileTree, type FileTreePreparedInput } from '@pierre/trees';

export function mountVanillaTree(
  container: HTMLElement,
  preparedInput: FileTreePreparedInput
) {
  const fileTree = new FileTree({ preparedInput, viewportHeight: 320 });
  fileTree.render({ fileTreeContainer: container });
  return fileTree;
}`,
  },
  options,
};

export const SHAPE_TREE_DATA_SMALL_PATHS: PreloadFileOptions<undefined> = {
  file: {
    name: 'small-paths.ts',
    contents: `const fileTree = new FileTree({
  paths: ['README.md', 'src/index.ts', 'src/components/Button.tsx'],
});`,
  },
  options,
};

export const SHAPE_TREE_DATA_PRESORTED: PreloadFileOptions<undefined> = {
  file: {
    name: 'presorted.ts',
    contents: `import { preparePresortedFileTreeInput } from '@pierre/trees';

const preparedInput = preparePresortedFileTreeInput([
  'README.md',
  'src/index.ts',
  'src/components/Button.tsx',
]);`,
  },
  options,
};
