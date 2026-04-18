import { preloadPathStoreFileTree } from '@pierre/trees/path-store';

import { sampleFileList } from '../demo-data';
import { DemoStylingClient } from './DemoStylingClient';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';

const lightPreloadedData = preloadPathStoreFileTree({
  flattenEmptyDirectories: true,
  id: 'path-store-theming-demo-light',
  paths: sampleFileList,
  viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.styling,
});
const darkPreloadedData = preloadPathStoreFileTree({
  flattenEmptyDirectories: true,
  id: 'path-store-theming-demo-dark',
  paths: sampleFileList,
  viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.styling,
});
const synthwavePreloadedData = preloadPathStoreFileTree({
  flattenEmptyDirectories: true,
  id: 'path-store-theming-demo-synthwave',
  paths: sampleFileList,
  viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.styling,
});

export function DemoStyling() {
  return (
    <DemoStylingClient
      preloadedData={{
        dark: darkPreloadedData,
        light: lightPreloadedData,
        synthwave: synthwavePreloadedData,
      }}
    />
  );
}
