import { docsCodeSnippet } from '@/lib/docsCodeSnippet';

export const SSR_GUIDE_PRELOAD_FILE_TREE = docsCodeSnippet(
  'preload-file-tree.ts',
  `import { preloadFileTree } from '@pierre/trees/ssr';

const payload = preloadFileTree({
  preparedInput,
  id: 'project-tree',
  initialExpandedPaths: ['src'],
  search: true,
  initialVisibleRowCount: 11,
});`
);

export const SSR_GUIDE_REACT_HYDRATION = docsCodeSnippet(
  'project-tree-client.tsx',
  `import { FileTree, useFileTree } from '@pierre/trees/react';
import type { FileTreePreparedInput } from '@pierre/trees';
import type { FileTreeSsrPayload } from '@pierre/trees/ssr';

export function ProjectTreeClient({
  preparedInput,
  preloadedData,
}: {
  preparedInput: FileTreePreparedInput;
  preloadedData: FileTreeSsrPayload;
}) {
  const { model } = useFileTree({
    preparedInput,
    id: preloadedData.id,
    initialExpandedPaths: ['src'],
    search: true,
    initialVisibleRowCount: 11,
  });

  return <FileTree model={model} preloadedData={preloadedData} />;
}`
);

export const SSR_GUIDE_VANILLA_HYDRATION = docsCodeSnippet(
  'vanilla-hydrate.ts',
  `import { FileTree } from '@pierre/trees';

const fileTree = new FileTree({
  preparedInput,
  id: 'project-tree',
  initialExpandedPaths: ['src'],
  search: true,
  initialVisibleRowCount: 11,
});

const container = document.getElementById('project-tree');
if (container instanceof HTMLElement) {
  fileTree.hydrate({ fileTreeContainer: container });
}`
);
