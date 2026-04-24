import { FILE_TREE_DENSITY_PRESETS } from '@pierre/trees';
import { preloadFileTree } from '@pierre/trees/ssr';

import { sampleFileList } from '../_lib/demo-data';
import { TREE_NEW_VIEWPORT_HEIGHTS } from '../_lib/dimensions';
import { DemoDensityClient } from './DemoDensityClient';

const compactPreloadedData = preloadFileTree({
  flattenEmptyDirectories: true,
  id: 'trees-density-demo-compact',
  density: 'compact',
  paths: sampleFileList,
  initialVisibleRowCount:
    TREE_NEW_VIEWPORT_HEIGHTS.densityCompact /
    FILE_TREE_DENSITY_PRESETS.compact.itemHeight,
});

const defaultPreloadedData = preloadFileTree({
  flattenEmptyDirectories: true,
  id: 'trees-density-demo-default',
  density: 'default',
  paths: sampleFileList,
  initialVisibleRowCount:
    TREE_NEW_VIEWPORT_HEIGHTS.densityDefault /
    FILE_TREE_DENSITY_PRESETS.default.itemHeight,
});

const relaxedPreloadedData = preloadFileTree({
  flattenEmptyDirectories: true,
  id: 'trees-density-demo-relaxed',
  density: 'relaxed',
  paths: sampleFileList,
  initialVisibleRowCount:
    TREE_NEW_VIEWPORT_HEIGHTS.densityRelaxed /
    FILE_TREE_DENSITY_PRESETS.relaxed.itemHeight,
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
