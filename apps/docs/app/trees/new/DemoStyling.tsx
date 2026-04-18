import { preloadFileTree } from '@pierre/trees/ssr';

import { sampleFileList } from '../demo-data';
import { DemoStylingClient } from './DemoStylingClient';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';

const lightPreloadedData = preloadFileTree({
  flattenEmptyDirectories: true,
  id: 'trees-styling-demo-light',
  paths: sampleFileList,
  viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.styling,
});
const darkPreloadedData = preloadFileTree({
  flattenEmptyDirectories: true,
  id: 'trees-styling-demo-dark',
  paths: sampleFileList,
  viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.styling,
});
const synthwavePreloadedData = preloadFileTree({
  flattenEmptyDirectories: true,
  id: 'trees-styling-demo-synthwave',
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
