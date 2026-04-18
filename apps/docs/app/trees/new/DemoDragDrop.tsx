import { preloadPathStoreFileTree } from '@pierre/trees/path-store';

import { sampleFileList } from '../demo-data';
import { DemoDragDropClient } from './DemoDragDropClient';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';

const lockedPreloadedData = preloadPathStoreFileTree({
  dragAndDrop: true,
  flattenEmptyDirectories: true,
  id: 'path-store-drag-drop-demo-locked',
  paths: sampleFileList,
  search: false,
  viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.dragDrop,
});
const unlockedPreloadedData = preloadPathStoreFileTree({
  dragAndDrop: true,
  flattenEmptyDirectories: true,
  id: 'path-store-drag-drop-demo-unlocked',
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
