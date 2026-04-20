import { preloadFileTree } from '@pierre/trees/ssr';

import { sampleFileList } from './demo-data';
import { DemoDensityClient } from './DemoDensityClient';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';

const compactPreloadedData = preloadFileTree({
  flattenEmptyDirectories: true,
  id: 'trees-density-demo-compact',
  itemHeight: 24,
  paths: sampleFileList,
  initialVisibleRowCount: TREE_NEW_VIEWPORT_HEIGHTS.densityCompact / 24,
});

const defaultPreloadedData = preloadFileTree({
  flattenEmptyDirectories: true,
  id: 'trees-density-demo-default',
  itemHeight: 30,
  paths: sampleFileList,
  initialVisibleRowCount: TREE_NEW_VIEWPORT_HEIGHTS.densityDefault / 30,
});

const relaxedPreloadedData = preloadFileTree({
  flattenEmptyDirectories: true,
  id: 'trees-density-demo-relaxed',
  itemHeight: 36,
  paths: sampleFileList,
  initialVisibleRowCount: TREE_NEW_VIEWPORT_HEIGHTS.densityRelaxed / 36,
});

export function DemoDensity() {
  return (
    <DemoDensityClient
      preloadedData={{
        compact: compactPreloadedData,
        default: defaultPreloadedData,
        relaxed: relaxedPreloadedData,
      }}
    />
  );
}
