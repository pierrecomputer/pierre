import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const REACT_QUICKSTART_INSTALL: PreloadFileOptions<undefined> = {
  file: {
    name: 'install.sh',
    contents: `bun add @pierre/trees
# npm: npm install @pierre/trees
# pnpm: pnpm add @pierre/trees`,
  },
  options,
};

export const REACT_QUICKSTART_PROJECT_TREE: PreloadFileOptions<undefined> = {
  file: {
    name: 'project-tree.tsx',
    contents: `import { FileTree, useFileTree } from '@pierre/trees/react';
import type { FileTreePreparedInput } from '@pierre/trees';

interface ProjectTreeProps {
  preparedInput: FileTreePreparedInput;
}

export function ProjectTree({ preparedInput }: ProjectTreeProps) {
  const { model } = useFileTree({
    preparedInput,
    search: true,
    initialExpandedPaths: ['src', 'src/components'],
    viewportHeight: 320,
  });

  return <FileTree model={model} className="rounded-lg border" />;
}`,
  },
  options,
};

export const REACT_QUICKSTART_SEARCHABLE_TREE: PreloadFileOptions<undefined> = {
  file: {
    name: 'searchable-tree.tsx',
    contents: `import {
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
}`,
  },
  options,
};
