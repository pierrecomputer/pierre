import { docsCodeSnippet } from '@/lib/docsCodeSnippet';

export const REACT_QUICKSTART_INSTALL = docsCodeSnippet(
  'install.sh',
  `bun add @pierre/trees
# npm: npm install @pierre/trees
# pnpm: pnpm add @pierre/trees`
);

export const REACT_QUICKSTART_PROJECT_TREE = docsCodeSnippet(
  'project-tree.tsx',
  `import { FileTree, useFileTree } from '@pierre/trees/react';
import type { FileTreePreparedInput } from '@pierre/trees';

interface ProjectTreeProps {
  preparedInput: FileTreePreparedInput;
}

export function ProjectTree({ preparedInput }: ProjectTreeProps) {
  const { model } = useFileTree({
    preparedInput,
    search: true,
    initialExpandedPaths: ['src', 'src/components'],
  });

  return (
    <FileTree
      model={model}
      className="rounded-lg border"
      style={{ height: '320px' }}
    />
  );
}`
);

export const REACT_QUICKSTART_SEARCHABLE_TREE = docsCodeSnippet(
  'searchable-tree.tsx',
  `import {
  FileTree,
  useFileTree,
  useFileTreeSearch,
  useFileTreeSelection,
} from '@pierre/trees/react';

export function SearchableTree({ paths }: { paths: readonly string[] }) {
  const { model } = useFileTree({
    paths,
    fileTreeSearchMode: 'hide-non-matches',
    search: true,
  });
  const selectedPaths = useFileTreeSelection(model);
  const search = useFileTreeSearch(model);

  return (
    <div className="space-y-3">
      <input
        value={search.value}
        onChange={(event) => search.setValue(event.target.value)}
        placeholder="Search files"
      />
      <p>{selectedPaths.length} item(s) selected.</p>
      <FileTree model={model} className="rounded-lg border" />
    </div>
  );
}`
);
