import { getVirtualizationWorkload } from '@pierre/tree-test-data';
import {
  type PathStoreFileTreeOptions,
  preloadPathStoreFileTree,
} from '@pierre/trees/path-store';

import { createPresortedPreparedInput } from './createPresortedPreparedInput';
import { PathStorePoweredRenderDemoClient } from './PathStorePoweredRenderDemoClient';

const linuxKernelWorkload = getVirtualizationWorkload('linux-1x');
const linuxKernelPreparedInput = createPresortedPreparedInput(
  linuxKernelWorkload.files
);
const PATH_STORE_HEADER_HTML =
  '<div data-path-store-demo-header style="align-items:center;display:flex;gap:12px;padding:8px 12px"><strong>Phase 6/7 path-store header</strong><button type="button">Log header action</button></div>';

export default function PathStorePoweredPage() {
  const sharedOptions: Omit<PathStoreFileTreeOptions, 'id' | 'preparedInput'> =
    {
      composition: {
        contextMenu: {
          enabled: true,
        },
        header: {
          html: PATH_STORE_HEADER_HTML,
        },
      },
      flattenEmptyDirectories: true,
      fileTreeSearchMode: 'hide-non-matches',
      initialExpandedPaths: linuxKernelWorkload.expandedFolders,
      paths: linuxKernelWorkload.files,
      search: true,
      viewportHeight: 500,
    };

  const payload = preloadPathStoreFileTree({
    ...sharedOptions,
    icons: 'complete',
    id: 'pst-phase6-mutations',
    preparedInput: linuxKernelPreparedInput,
  });

  return (
    <PathStorePoweredRenderDemoClient
      containerHtml={payload.html}
      sharedOptions={sharedOptions}
    />
  );
}
