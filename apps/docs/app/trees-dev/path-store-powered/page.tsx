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

export default function PathStorePoweredPage() {
  const sharedOptions: Omit<
    PathStoreFileTreeOptions,
    'id' | 'preparedInput' | 'renderMode'
  > = {
    flattenEmptyDirectories: true,
    initialExpandedPaths: linuxKernelWorkload.expandedFolders,
    paths: linuxKernelWorkload.files,
    viewportHeight: 500,
  };

  const plainPayload = preloadPathStoreFileTree({
    ...sharedOptions,
    id: 'pst-phase1a',
    preparedInput: linuxKernelPreparedInput,
    renderMode: 'plain',
  });
  const styledPayload = preloadPathStoreFileTree({
    ...sharedOptions,
    id: 'pst-phase1b',
    preparedInput: linuxKernelPreparedInput,
    renderMode: 'styled',
  });

  return (
    <PathStorePoweredRenderDemoClient
      plainContainerHtml={plainPayload.html}
      sharedOptions={sharedOptions}
      styledContainerHtml={styledPayload.html}
    />
  );
}
