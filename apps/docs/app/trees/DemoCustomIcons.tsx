import type { FileTreeIcons } from '@pierre/trees';
import { preloadFileTree } from '@pierre/trees/ssr';

import { sampleFileList } from './demo-data';
import { DemoCustomIconsClient } from './DemoCustomIconsClient';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';

function createIconDemoPreloadedData(id: string, icons: FileTreeIcons) {
  return preloadFileTree({
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
  'trees-built-in-icons-minimal',
  'minimal'
);
const standardPreloadedData = createIconDemoPreloadedData(
  'trees-built-in-icons-standard',
  'standard'
);
const completePreloadedData = createIconDemoPreloadedData(
  'trees-built-in-icons-complete',
  'complete'
);

export function DemoCustomIcons() {
  return (
    <DemoCustomIconsClient
      preloadedDataById={{
        'trees-built-in-icons-complete': completePreloadedData,
        'trees-built-in-icons-minimal': minimalPreloadedData,
        'trees-built-in-icons-standard': standardPreloadedData,
      }}
    />
  );
}
