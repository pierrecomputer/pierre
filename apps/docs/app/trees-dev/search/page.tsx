import type { FileTreeOptions } from '@pierre/trees';
import { preloadFileTree } from '@pierre/trees/ssr';

import { readSettingsCookies } from '../_components/readSettingsCookies';
import { SearchDemoClient } from '../_demos/SearchDemoClient';
import {
  sharedDemoFileTreeOptions,
  sharedInitialExpandedPaths,
} from '../demo-data';

function getPayload(options: Omit<FileTreeOptions, 'id'>, id: string) {
  return preloadFileTree({
    ...options,
    id,
  });
}

export default async function TreesDevSearchPage() {
  const { flattenEmptyDirectories } = await readSettingsCookies();
  const sharedOptions: Omit<
    FileTreeOptions,
    'fileTreeSearchMode' | 'id' | 'initialSearchQuery' | 'search'
  > = {
    flattenEmptyDirectories,
    initialExpandedPaths: sharedInitialExpandedPaths,
    paths: sharedDemoFileTreeOptions.paths,
    viewportHeight: 260,
  };

  const expandPayload = getPayload(
    {
      ...sharedOptions,
      fileTreeSearchMode: 'expand-matches',
      search: true,
    },
    'trees-search-expand'
  );
  const collapsePayload = getPayload(
    {
      ...sharedOptions,
      fileTreeSearchMode: 'collapse-non-matches',
      search: true,
    },
    'trees-search-collapse'
  );
  const hidePayload = getPayload(
    {
      ...sharedOptions,
      fileTreeSearchMode: 'hide-non-matches',
      search: true,
    },
    'trees-search-hide'
  );
  const hiddenPayload = getPayload(
    {
      ...sharedOptions,
      fileTreeSearchMode: 'hide-non-matches',
      search: false,
    },
    'trees-search-hidden'
  );

  return (
    <SearchDemoClient
      collapseHtml={collapsePayload.html}
      expandHtml={expandPayload.html}
      hideHtml={hidePayload.html}
      hiddenHtml={hiddenPayload.html}
      sharedOptions={sharedOptions}
    />
  );
}
