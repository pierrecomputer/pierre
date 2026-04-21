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

const TREE_APP_DARK_FILE_OPTIONS = {
  disableFileHeader: true,
  overflow: 'wrap',
  theme: 'pierre-dark',
  themeType: 'dark',
} as const;

const TREE_APP_LIGHT_FILE_OPTIONS = {
  disableFileHeader: true,
  overflow: 'wrap',
  theme: 'pierre-light',
  themeType: 'light',
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

  // Preload syntax-highlighted HTML for every demo file in parallel, under
  // both the dark and light Pierre themes. The client hands the right map to
  // TreeApp based on the active theme toggle so swapping modes never has to
  // fall back to an on-the-fly highlighter pass. Each file produces two
  // results, so we run them all in a single Promise.all to minimize latency.
  const preloadedEntries = await Promise.all(
    Object.entries(TREE_APP_DEMO_FILES).map(async ([path, file]) => {
      const [darkResult, lightResult] = await Promise.all([
        preloadFile({ file, options: TREE_APP_DARK_FILE_OPTIONS }),
        preloadFile({ file, options: TREE_APP_LIGHT_FILE_OPTIONS }),
      ]);
      return [
        path,
        {
          dark: darkResult.prerenderedHTML,
          light: lightResult.prerenderedHTML,
        },
      ] as const;
    })
  );
  const prerenderedHTMLByPath = {
    dark: Object.fromEntries(
      preloadedEntries.map(([path, variants]) => [path, variants.dark] as const)
    ),
    light: Object.fromEntries(
      preloadedEntries.map(
        ([path, variants]) => [path, variants.light] as const
      )
    ),
  };

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
