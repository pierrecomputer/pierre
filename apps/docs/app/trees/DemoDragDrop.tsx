import { preloadFileTree } from '@pierre/trees/ssr';

import { sampleFileList } from './demo-data';
import { DemoDragDropClient } from './DemoDragDropClient';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';

const lockedPreloadedData = preloadFileTree({
  dragAndDrop: true,
  flattenEmptyDirectories: true,
  id: 'file-tree-drag-drop-demo-locked',
  paths: sampleFileList,
  renderRowDecoration: ({ item }) =>
    item.path === 'package.json'
      ? { icon: 'file-tree-icon-lock', title: 'Locked file' }
      : null,
  search: false,
  initialVisibleRowCount: TREE_NEW_VIEWPORT_HEIGHTS.dragDrop / 30,
});
const unlockedPreloadedData = preloadFileTree({
  dragAndDrop: true,
  flattenEmptyDirectories: true,
  id: 'file-tree-drag-drop-demo-unlocked',
  paths: sampleFileList,
  search: false,
  initialVisibleRowCount: TREE_NEW_VIEWPORT_HEIGHTS.dragDrop / 30,
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
