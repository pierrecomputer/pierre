import { preloadPathStoreFileTree } from '@pierre/trees/path-store';
import type { PathStoreTreesSearchMode } from '@pierre/trees/path-store';

import { sampleFileList } from '../demo-data';
import { DemoSearchClient } from './DemoSearchClient';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';

const PREPOPULATED_SEARCH = 'tsx';

function createSearchPreloadedData(
  mode: PathStoreTreesSearchMode,
  id: string,
  viewportHeight: number
) {
  return preloadPathStoreFileTree({
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
  'path-store-search-demo-hide-non-matches',
  TREE_NEW_VIEWPORT_HEIGHTS.searchHideNonMatches
);
const collapseNonMatchesPreloadedData = createSearchPreloadedData(
  'collapse-non-matches',
  'path-store-search-demo-collapse-non-matches',
  TREE_NEW_VIEWPORT_HEIGHTS.searchCollapseNonMatches
);
const expandMatchesPreloadedData = createSearchPreloadedData(
  'expand-matches',
  'path-store-search-demo-expand-matches',
  TREE_NEW_VIEWPORT_HEIGHTS.searchExpandMatches
);

export function DemoSearch() {
  return (
    <DemoSearchClient
      preloadedDataById={{
        'path-store-search-demo-collapse-non-matches':
          collapseNonMatchesPreloadedData,
        'path-store-search-demo-expand-matches': expandMatchesPreloadedData,
        'path-store-search-demo-hide-non-matches': hideNonMatchesPreloadedData,
      }}
    />
  );
}
