import { PathStore } from '@pierre/path-store';
import { getVirtualizationWorkload } from '@pierre/tree-test-data';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';

import { PathStoreTreesController } from '../src/path-store/controller';
import { PathStoreTreesView } from '../src/path-store/view';
import {
  computeStickyWindowLayout,
  computeWindowRange,
  PATH_STORE_TREES_DEFAULT_ITEM_HEIGHT,
  PATH_STORE_TREES_DEFAULT_OVERSCAN,
  PATH_STORE_TREES_DEFAULT_VIEWPORT_HEIGHT,
} from '../src/path-store/virtualization';

const workload = getVirtualizationWorkload('linux-5x');
const preparedInput = PathStore.preparePresortedInput(workload.files);
const controller = new PathStoreTreesController({
  flattenEmptyDirectories: true,
  initialExpandedPaths: workload.expandedFolders,
  paths: workload.files,
  preparedInput,
});

const itemCount = controller.getVisibleCount();
const viewportHeight = PATH_STORE_TREES_DEFAULT_VIEWPORT_HEIGHT;
const itemHeight = PATH_STORE_TREES_DEFAULT_ITEM_HEIGHT;
const overscan = PATH_STORE_TREES_DEFAULT_OVERSCAN;
const initialRange = computeWindowRange({
  itemCount,
  itemHeight,
  overscan,
  scrollTop: 0,
  viewportHeight,
});
const midRange = computeWindowRange(
  {
    itemCount,
    itemHeight,
    overscan,
    scrollTop: 9600,
    viewportHeight,
  },
  initialRange
);
const layout = computeStickyWindowLayout({
  itemCount,
  itemHeight,
  range: midRange,
  viewportHeight,
});

const html = renderToString(
  h(PathStoreTreesView, { controller, viewportHeight })
);

console.log(
  JSON.stringify(
    {
      htmlLength: html.length,
      itemCount,
      layout,
      midRange,
      visibleCount: controller.getVisibleCount(),
      workload: 'linux-5x',
    },
    null,
    2
  )
);

controller.destroy();
