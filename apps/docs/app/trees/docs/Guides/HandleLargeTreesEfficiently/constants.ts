import { docsCodeSnippet } from '@/lib/docsCodeSnippet';

export const LARGE_TREES_LOAD_WORKSPACE_TREE = docsCodeSnippet(
  'load-workspace-tree.ts',
  `import { preparePresortedFileTreeInput } from '@pierre/trees';

export async function loadWorkspaceTree() {
  const sortedPaths = await fetchSortedWorkspacePaths();
  return preparePresortedFileTreeInput(sortedPaths);
}`
);

export const LARGE_TREES_VIRTUALIZATION_KNOBS = docsCodeSnippet(
  'virtualization-knobs.tsx',
  `const { model } = useFileTree({
  preparedInput,
  viewportHeight: 420,
  itemHeight: 30,
  overscan: 8,
});`
);
