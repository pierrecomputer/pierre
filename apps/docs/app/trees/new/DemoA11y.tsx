import { preloadPathStoreFileTree } from '@pierre/trees/path-store';

import { sampleFileList } from '../demo-data';
import { DemoA11yClient } from './DemoA11yClient';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';

const preloadedData = preloadPathStoreFileTree({
  flattenEmptyDirectories: true,
  id: 'path-store-a11y-demo',
  initialExpandedPaths: ['src', 'src/components'],
  paths: sampleFileList,
  viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.a11y,
});

export function DemoA11y() {
  return <DemoA11yClient preloadedData={preloadedData} />;
}
