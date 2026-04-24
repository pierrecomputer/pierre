import { docsCodeSnippet } from '@/lib/docsCodeSnippet';

export const REACT_API_EXAMPLE = docsCodeSnippet(
  'project-tree.tsx',
  `import { FileTree, useFileTree } from '@pierre/trees/react';

export function ProjectTree({ paths }: { paths: readonly string[] }) {
  const { model } = useFileTree({ paths, search: true });
  return <FileTree model={model} />;
}`
);

export const REACT_API_SELECTOR_HOOKS = docsCodeSnippet(
  'selector-hooks.tsx',
  `const { model } = useFileTree({ paths, search: true });
const selectedPaths = useFileTreeSelection(model);
const search = useFileTreeSearch(model);
const focusedPath = useFileTreeSelector(model, (currentModel) =>
  currentModel.getFocusedPath()
);`
);
