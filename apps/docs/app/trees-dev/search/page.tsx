import {
  preloadFileTree,
  serializeFileTreeSsrPayload,
} from '@pierre/trees/ssr';

import { readSettingsCookies } from '../_components/readSettingsCookies';
import { SearchDemoClient } from '../_demos/SearchDemoClient';
import { sharedDemoPaths, sharedInitialExpandedPaths } from '../demo-data';
import type { FileTreePathOptions } from '@/lib/fileTreePathOptions';

function getPayload(options: Omit<FileTreePathOptions, 'id'>, id: string) {
  return preloadFileTree({
    ...options,
    id,
  });
}

export default async function TreesDevSearchPage() {
  const { flattenEmptyDirectories } = await readSettingsCookies();
  const sharedOptions: Omit<
    FileTreePathOptions,
    'fileTreeSearchMode' | 'id' | 'initialSearchQuery' | 'search'
  > = {
    flattenEmptyDirectories,
    initialExpandedPaths: sharedInitialExpandedPaths,
    paths: sharedDemoPaths,
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
      collapseHtml={serializeFileTreeSsrPayload(collapsePayload, 'dom')}
      expandHtml={serializeFileTreeSsrPayload(expandPayload, 'dom')}
      hideHtml={serializeFileTreeSsrPayload(hidePayload, 'dom')}
      hiddenHtml={serializeFileTreeSsrPayload(hiddenPayload, 'dom')}
      sharedOptions={sharedOptions}
    />
  );
}
