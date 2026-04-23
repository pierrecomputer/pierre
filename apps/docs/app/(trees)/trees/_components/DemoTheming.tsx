import type { TreeThemeStyles } from '@pierre/trees';
import { preloadFileTree } from '@pierre/trees/ssr';

import { sampleFileList } from '../_lib/demo-data';
import { TREE_NEW_VIEWPORT_HEIGHTS } from '../_lib/dimensions';
import { DemoThemingClient } from './DemoThemingClient';
import { GIT_STATUSES_A } from './tree-examples/demo-data';

const preloadedData = preloadFileTree({
  flattenEmptyDirectories: true,
  gitStatus: GIT_STATUSES_A,
  id: 'trees-shiki-themes-tree',
  initialExpandedPaths: ['src', 'src/components'],
  initialSelectedPaths: ['package.json'],
  paths: sampleFileList,
  initialVisibleRowCount: TREE_NEW_VIEWPORT_HEIGHTS.theming / 30,
});

const initialThemeStyles: TreeThemeStyles = {
  colorScheme: 'light',
};

export function DemoTheming() {
  return (
    <DemoThemingClient
      initialThemeStyles={initialThemeStyles}
      preloadedData={preloadedData}
    />
  );
}
