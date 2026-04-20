import { preloadFile } from '@pierre/diffs/ssr';
import { preloadFileTree } from '@pierre/trees/ssr';

import { DemoTreeAppClient } from './DemoTreeAppClient';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';
import {
  TREE_APP_DEMO_FILES,
  TREE_APP_DEMO_GIT_STATUSES,
  TREE_APP_DEMO_INITIAL_ACTIVE_PATH,
  TREE_APP_DEMO_INITIAL_EXPANDED_PATHS,
  TREE_APP_DEMO_PATHS,
  TREE_APP_DEMO_UNSAFE_CSS,
} from './treeAppDemoData';

const TREE_APP_DEMO_TREE_ID = 'tree-app-hero-demo';
const TREE_APP_DEMO_ITEM_HEIGHT = 24;

const TREE_APP_FILE_OPTIONS = {
  disableFileHeader: true,
  theme: 'pierre-dark',
  themeType: 'dark',
} as const;

export async function DemoTreeApp() {
  const treePreloadedData = preloadFileTree({
    dragAndDrop: true,
    fileTreeSearchMode: 'hide-non-matches',
    flattenEmptyDirectories: true,
    gitStatus: TREE_APP_DEMO_GIT_STATUSES,
    id: TREE_APP_DEMO_TREE_ID,
    initialExpandedPaths: TREE_APP_DEMO_INITIAL_EXPANDED_PATHS,
    initialSelectedPaths: [TREE_APP_DEMO_INITIAL_ACTIVE_PATH],
    itemHeight: TREE_APP_DEMO_ITEM_HEIGHT,
    paths: TREE_APP_DEMO_PATHS,
    search: true,
    unsafeCSS: TREE_APP_DEMO_UNSAFE_CSS,
    initialVisibleRowCount:
      TREE_NEW_VIEWPORT_HEIGHTS.treeApp / TREE_APP_DEMO_ITEM_HEIGHT,
  });

  // Preload syntax-highlighted HTML for every demo file in parallel so the
  // first paint can land on a real file without any client-side highlighter
  // work. The result map is keyed by the same path the file lives at in the
  // tree so TreeApp can look it up directly.
  const preloadedEntries = await Promise.all(
    Object.entries(TREE_APP_DEMO_FILES).map(async ([path, file]) => {
      const result = await preloadFile({
        file,
        options: TREE_APP_FILE_OPTIONS,
      });
      return [path, result.prerenderedHTML] as const;
    })
  );
  const prerenderedHTMLByPath = Object.fromEntries(preloadedEntries);

  return (
    <DemoTreeAppClient
      files={TREE_APP_DEMO_FILES}
      initialActivePath={TREE_APP_DEMO_INITIAL_ACTIVE_PATH}
      initialExpandedPaths={TREE_APP_DEMO_INITIAL_EXPANDED_PATHS}
      paths={TREE_APP_DEMO_PATHS}
      prerenderedHTMLByPath={prerenderedHTMLByPath}
      treeId={TREE_APP_DEMO_TREE_ID}
      treePreloadedData={treePreloadedData}
    />
  );
}
