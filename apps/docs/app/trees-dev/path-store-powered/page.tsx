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
  const sharedOptions: Omit<PathStoreFileTreeOptions, 'id' | 'preparedInput'> =
    {
      flattenEmptyDirectories: true,
      initialExpandedPaths: linuxKernelWorkload.expandedFolders,
      paths: linuxKernelWorkload.files,
      viewportHeight: 500,
    };

  const payload = preloadPathStoreFileTree({
    ...sharedOptions,
    id: 'pst-phase2',
    preparedInput: linuxKernelPreparedInput,
  });

  return (
    <PathStorePoweredRenderDemoClient
      containerHtml={payload.html}
      sharedOptions={sharedOptions}
    />
  );
}
