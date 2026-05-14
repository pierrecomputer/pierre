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
  initialVisibleRowCount: 14,
  itemHeight: 30,
  overscan: 8,
});`
);

export const LARGE_TREES_EXTERNAL_SCROLL = docsCodeSnippet(
  'external-scroll.ts',
  `import { FileTree } from '@pierre/trees/scroll';

const tree = new FileTree({
  preparedInput,
  stickyFolders: true,
  externalScroll: {
    initialSnapshot: {
      viewportTop: 0,
      viewportHeight: 480,
      topInset: 48,
    },
    source: externalScrollSource,
  },
});`
);
