import type { TreeThemeStyles } from '@pierre/trees';
import { preloadPathStoreFileTree } from '@pierre/trees/path-store';

import { sampleFileList } from '../demo-data';
import { GIT_STATUSES_A } from '../tree-examples/demo-data';
import { DemoThemingClient } from './DemoThemingClient';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';

const preloadedData = preloadPathStoreFileTree({
  flattenEmptyDirectories: true,
  gitStatus: GIT_STATUSES_A,
  id: 'path-store-shiki-themes-tree',
  initialExpandedPaths: ['src', 'src/components'],
  paths: sampleFileList,
  viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.theming,
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
