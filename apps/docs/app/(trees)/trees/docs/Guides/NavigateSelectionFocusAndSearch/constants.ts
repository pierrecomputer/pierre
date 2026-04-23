import { docsCodeSnippet } from '@/lib/docsCodeSnippet';

export const NAVIGATE_REACT_SEARCH = docsCodeSnippet(
  'search-panel.tsx',
  `import {
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
}`
);

export const NAVIGATE_VANILLA_SEARCH = docsCodeSnippet(
  'vanilla-search.ts',
  `const fileTree = new FileTree({
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
const matchingPaths = fileTree.getSearchMatchingPaths();`
);
