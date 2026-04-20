import { type FileTreeSearchMode } from '@pierre/trees';
import { preloadFileTree } from '@pierre/trees/ssr';

import { sampleFileList } from './demo-data';
import { DemoSearchClient } from './DemoSearchClient';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';

const PREPOPULATED_SEARCH = 'tsx';

function createSearchPreloadedData(
  mode: FileTreeSearchMode,
  id: string,
  viewportHeight: number
) {
  return preloadFileTree({
    fileTreeSearchMode: mode,
    flattenEmptyDirectories: true,
    id,
    initialSearchQuery: PREPOPULATED_SEARCH,
    paths: sampleFileList,
    search: true,
    viewportHeight,
  });
}

const hideNonMatchesPreloadedData = createSearchPreloadedData(
  'hide-non-matches',
  'file-tree-search-demo-hide-non-matches',
  TREE_NEW_VIEWPORT_HEIGHTS.searchHideNonMatches
);
const collapseNonMatchesPreloadedData = createSearchPreloadedData(
  'collapse-non-matches',
  'file-tree-search-demo-collapse-non-matches',
  TREE_NEW_VIEWPORT_HEIGHTS.searchCollapseNonMatches
);
const expandMatchesPreloadedData = createSearchPreloadedData(
  'expand-matches',
  'file-tree-search-demo-expand-matches',
  TREE_NEW_VIEWPORT_HEIGHTS.searchExpandMatches
);

export function DemoSearch() {
  return (
    <DemoSearchClient
      preloadedDataById={{
        'file-tree-search-demo-collapse-non-matches':
          collapseNonMatchesPreloadedData,
        'file-tree-search-demo-expand-matches': expandMatchesPreloadedData,
        'file-tree-search-demo-hide-non-matches': hideNonMatchesPreloadedData,
      }}
    />
  );
}
