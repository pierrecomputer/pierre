import { PathStore } from '@pierre/path-store';
import { getVirtualizationWorkload } from '@pierre/tree-test-data';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';

import { PathStoreTreesController } from '../src/path-store/controller';
import { PathStoreTreesView } from '../src/path-store/view';
import {
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

const renderStart = performance.now();
const plainHtml = renderToString(
  h(PathStoreTreesView, {
    controller,
    renderMode: 'plain',
    viewportHeight,
  })
);
const styledHtml = renderToString(
  h(PathStoreTreesView, {
    controller,
    renderMode: 'styled',
    viewportHeight,
  })
);
const renderDurationMs = performance.now() - renderStart;

const scrollStart = performance.now();
let range = computeWindowRange({
  itemCount,
  itemHeight,
  overscan,
  scrollTop: 0,
  viewportHeight,
});
for (const scrollTop of [300, 1200, 4800, 9600, 19200]) {
  range = computeWindowRange(
    { itemCount, itemHeight, overscan, scrollTop, viewportHeight },
    range
  );
  controller.getVisibleRows(range.start, range.end);
}
const scrollDurationMs = performance.now() - scrollStart;

console.log(
  JSON.stringify(
    {
      itemCount,
      plainHtmlLength: plainHtml.length,
      renderDurationMs: Number(renderDurationMs.toFixed(3)),
      scrollDurationMs: Number(scrollDurationMs.toFixed(3)),
      styledHtmlLength: styledHtml.length,
      windowSize: range.end >= range.start ? range.end - range.start + 1 : 0,
      workload: 'linux-5x',
    },
    null,
    2
  )
);

controller.destroy();
