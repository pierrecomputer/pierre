import { preloadFileTree } from '@pierre/trees/ssr';

import { sampleFileList } from './demo-data';
import { DemoDragDropClient } from './DemoDragDropClient';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';

const lockedPreloadedData = preloadFileTree({
  dragAndDrop: true,
  flattenEmptyDirectories: true,
  id: 'file-tree-drag-drop-demo-locked',
  paths: sampleFileList,
  search: false,
  viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.dragDrop,
});
const unlockedPreloadedData = preloadFileTree({
  dragAndDrop: true,
  flattenEmptyDirectories: true,
  id: 'file-tree-drag-drop-demo-unlocked',
  paths: sampleFileList,
  search: false,
  viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.dragDrop,
});

export function DemoDragDrop() {
  return (
    <DemoDragDropClient
      preloadedData={{
        locked: lockedPreloadedData,
        unlocked: unlockedPreloadedData,
      }}
    />
  );
}
