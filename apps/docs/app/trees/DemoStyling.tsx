import { preloadFileTree } from '@pierre/trees/ssr';

import { sampleFileList } from './demo-data';
import { DemoStylingClient } from './DemoStylingClient';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';

const selectedPaths = {
  dark: 'package.json',
  light: 'package.json',
  synthwave: 'package.json',
} as const;

const lightPreloadedData = preloadFileTree({
  flattenEmptyDirectories: true,
  id: 'trees-styling-demo-light',
  initialSelectedPaths: [selectedPaths.light],
  paths: sampleFileList,
  viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.styling,
});
const darkPreloadedData = preloadFileTree({
  flattenEmptyDirectories: true,
  id: 'trees-styling-demo-dark',
  initialSelectedPaths: [selectedPaths.dark],
  paths: sampleFileList,
  viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.styling,
});
const synthwavePreloadedData = preloadFileTree({
  flattenEmptyDirectories: true,
  id: 'trees-styling-demo-synthwave',
  initialSelectedPaths: [selectedPaths.synthwave],
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
      selectedPaths={selectedPaths}
    />
  );
}
