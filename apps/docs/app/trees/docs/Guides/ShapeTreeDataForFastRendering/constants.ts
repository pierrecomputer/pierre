import { docsCodeSnippet } from '@/lib/docsCodeSnippet';

export const SHAPE_TREE_DATA_PREPARE_LOADER = docsCodeSnippet(
  'load-project-tree-input.ts',
  `import { prepareFileTreeInput } from '@pierre/trees';

export async function loadProjectTreeInput(projectId: string) {
  const paths = await fetchProjectPaths(projectId);

  return prepareFileTreeInput(paths, {
    flattenEmptyDirectories: true,
  });
}`
);

export const SHAPE_TREE_DATA_REACT_TREE = docsCodeSnippet(
  'react-tree.tsx',
  `import { FileTree, useFileTree } from '@pierre/trees/react';
import type { FileTreePreparedInput } from '@pierre/trees';

export function ReactTree({
  preparedInput,
}: {
  preparedInput: FileTreePreparedInput;
}) {
  const { model } = useFileTree({ preparedInput, viewportHeight: 320 });
  return <FileTree model={model} />;
}`
);

export const SHAPE_TREE_DATA_VANILLA_MOUNT = docsCodeSnippet(
  'mount-vanilla-tree.ts',
  `import { FileTree, type FileTreePreparedInput } from '@pierre/trees';

export function mountVanillaTree(
  container: HTMLElement,
  preparedInput: FileTreePreparedInput
) {
  const fileTree = new FileTree({ preparedInput, viewportHeight: 320 });
  fileTree.render({ fileTreeContainer: container });
  return fileTree;
}`
);

export const SHAPE_TREE_DATA_SMALL_PATHS = docsCodeSnippet(
  'small-paths.ts',
  `const fileTree = new FileTree({
  paths: ['README.md', 'src/index.ts', 'src/components/Button.tsx'],
});`
);

export const SHAPE_TREE_DATA_PRESORTED = docsCodeSnippet(
  'presorted.ts',
  `import { preparePresortedFileTreeInput } from '@pierre/trees';

const preparedInput = preparePresortedFileTreeInput([
  'README.md',
  'src/index.ts',
  'src/components/Button.tsx',
]);`
);
