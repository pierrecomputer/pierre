import { docsCodeSnippet } from '@/lib/docsCodeSnippet';

export const CHOOSE_INTEGRATION_REACT_EXAMPLE = docsCodeSnippet(
  'project-tree.tsx',
  `import { FileTree, useFileTree } from '@pierre/trees/react';

export function ProjectTree({ paths }: { paths: readonly string[] }) {
  const { model } = useFileTree({ paths, search: true });

  return <FileTree model={model} className="h-96 rounded-lg border" />;
}`
);

export const CHOOSE_INTEGRATION_VANILLA_EXAMPLE = docsCodeSnippet(
  'mount-tree.ts',
  `import { FileTree } from '@pierre/trees';

const fileTree = new FileTree({
  paths: ['README.md', 'src/index.ts', 'src/components/Button.tsx'],
  search: true,
});

const container = document.getElementById('project-tree');
if (container instanceof HTMLElement) {
  fileTree.render({ fileTreeContainer: container });
}`
);
