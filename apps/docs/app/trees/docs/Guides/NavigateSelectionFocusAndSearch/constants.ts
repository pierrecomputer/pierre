import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const NAVIGATE_REACT_SEARCH: PreloadFileOptions<undefined> = {
  file: {
    name: 'search-panel.tsx',
    contents: `import {
  FileTree,
  useFileTree,
  useFileTreeSearch,
  useFileTreeSelection,
} from '@pierre/trees/react';

export function SearchPanel({ paths }: { paths: readonly string[] }) {
  const { model } = useFileTree({
    paths,
    search: true,
    fileTreeSearchMode: 'hide-non-matches',
  });
  const selectedPaths = useFileTreeSelection(model);
  const search = useFileTreeSearch(model);

  return (
    <div className="space-y-3">
      <label className="block">
        <span>Search</span>
        <input
          value={search.value}
          onChange={(event) => search.setValue(event.target.value)}
        />
      </label>
      <p>{selectedPaths.length} selected</p>
      <FileTree model={model} className="rounded-lg border" />
    </div>
  );
}`,
  },
  options,
};

export const NAVIGATE_VANILLA_SEARCH: PreloadFileOptions<undefined> = {
  file: {
    name: 'vanilla-search.ts',
    contents: `const fileTree = new FileTree({
  paths,
  search: true,
  fileTreeSearchMode: 'hide-non-matches',
});

fileTree.render({ fileTreeContainer: container });
searchInput.addEventListener('input', () => {
  fileTree.setSearch(searchInput.value);
});

const selectedPaths = fileTree.getSelectedPaths();
const focusedPath = fileTree.getFocusedPath();
const matchingPaths = fileTree.getSearchMatchingPaths();`,
  },
  options,
};
