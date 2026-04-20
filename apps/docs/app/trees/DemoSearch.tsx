import { type FileTreeSearchMode } from '@pierre/trees';
import { preloadFileTree } from '@pierre/trees/ssr';

import { sampleFileList } from './demo-data';
import { DemoSearchClient } from './DemoSearchClient';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';

const PREPOPULATED_SEARCH = 'tsx';
// Mirror the client `PREPOPULATED_EXPANDED_PATHS` so the SSR snapshot already
// has these non-matching folders expanded. That makes the difference between
// `collapse-non-matches` and `expand-matches` visible in the very first paint.
const PREPOPULATED_EXPANDED_PATHS = ['public/', 'node_modules/react/'];

function createSearchPreloadedData(
  mode: FileTreeSearchMode,
  id: string,
  viewportHeight: number
) {
  return preloadFileTree({
    fileTreeSearchMode: mode,
    flattenEmptyDirectories: true,
    id,
    initialExpandedPaths: PREPOPULATED_EXPANDED_PATHS,
    initialSearchQuery: PREPOPULATED_SEARCH,
    paths: sampleFileList,
    search: true,
    // Keep the preloaded search query visible across remounts and concurrent
    // sibling trees stealing focus during mount. The demos want the filter to
    // stay applied until a user interacts explicitly.
    searchBlurBehavior: 'retain',
    searchFakeFocus: true,
    initialVisibleRowCount: viewportHeight / 30,
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
