import { preloadFileTree } from '@pierre/trees/ssr';

import { sampleFileList } from '../demo-data';
import { DemoA11yClient } from './DemoA11yClient';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';

const PRESELECTED_PATH = 'package.json';

const preloadedData = preloadFileTree({
  flattenEmptyDirectories: true,
  id: 'file-tree-a11y-demo',
  initialExpandedPaths: ['src', 'src/components'],
  initialSelectedPaths: [PRESELECTED_PATH],
  paths: sampleFileList,
  viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.a11y,
});

export function DemoA11y() {
  return <DemoA11yClient preloadedData={preloadedData} />;
}
