import type { FileTreeIcons } from '@pierre/trees';
import { preloadPathStoreFileTree } from '@pierre/trees/path-store';

import { sampleFileList } from '../demo-data';
import { DemoCustomIconsClient } from './DemoCustomIconsClient';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';

function createIconDemoPreloadedData(id: string, icons: FileTreeIcons) {
  return preloadPathStoreFileTree({
    dragAndDrop: true,
    flattenEmptyDirectories: true,
    icons,
    id,
    initialExpandedPaths: ['src', 'src/components'],
    paths: sampleFileList,
    viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.customIcons,
  });
}

const minimalPreloadedData = createIconDemoPreloadedData(
  'path-store-built-in-icons-minimal',
  'minimal'
);
const standardPreloadedData = createIconDemoPreloadedData(
  'path-store-built-in-icons-standard',
  'standard'
);
const completePreloadedData = createIconDemoPreloadedData(
  'path-store-built-in-icons-complete',
  'complete'
);

export function DemoCustomIcons() {
  return (
    <DemoCustomIconsClient
      preloadedDataById={{
        'path-store-built-in-icons-complete': completePreloadedData,
        'path-store-built-in-icons-minimal': minimalPreloadedData,
        'path-store-built-in-icons-standard': standardPreloadedData,
      }}
    />
  );
}
