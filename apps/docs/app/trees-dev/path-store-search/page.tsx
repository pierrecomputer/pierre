import {
  type PathStoreFileTreeOptions,
  preloadPathStoreFileTree,
} from '@pierre/trees/path-store';

import { sharedDemoFileTreeOptions, sharedDemoStateConfig } from '../demo-data';
import { PathStoreSearchDemoClient } from './PathStoreSearchDemoClient';

const searchPaths = sharedDemoFileTreeOptions.initialFiles;

function getPayload(options: Omit<PathStoreFileTreeOptions, 'id'>, id: string) {
  return preloadPathStoreFileTree({
    ...options,
    id,
  });
}

export default function PathStoreSearchPage() {
  const sharedOptions: Omit<
    PathStoreFileTreeOptions,
    'fileTreeSearchMode' | 'id' | 'initialSearchQuery' | 'search'
  > = {
    flattenEmptyDirectories: true,
    initialExpandedPaths: sharedDemoStateConfig.initialExpandedItems,
    paths: searchPaths,
    viewportHeight: 260,
  };

  const expandPayload = getPayload(
    {
      ...sharedOptions,
      fileTreeSearchMode: 'expand-matches',
      search: true,
    },
    'pst-search-expand'
  );
  const collapsePayload = getPayload(
    {
      ...sharedOptions,
      fileTreeSearchMode: 'collapse-non-matches',
      search: true,
    },
    'pst-search-collapse'
  );
  const hidePayload = getPayload(
    {
      ...sharedOptions,
      fileTreeSearchMode: 'hide-non-matches',
      search: true,
    },
    'pst-search-hide'
  );
  const hiddenPayload = getPayload(
    {
      ...sharedOptions,
      fileTreeSearchMode: 'hide-non-matches',
      search: false,
    },
    'pst-search-hidden'
  );

  return (
    <PathStoreSearchDemoClient
      collapseHtml={collapsePayload.html}
      expandHtml={expandPayload.html}
      hideHtml={hidePayload.html}
      hiddenHtml={hiddenPayload.html}
      sharedOptions={sharedOptions}
    />
  );
}
