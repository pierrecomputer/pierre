import {
  type PathStoreFileTreeOptions,
  preloadPathStoreFileTree,
} from '@pierre/trees/path-store';

import {
  GIT_STATUSES_A,
  sharedDemoFileTreeOptions,
  sharedDemoStateConfig,
} from '../demo-data';
import { PathStoreGitStatusDemoClient } from './PathStoreGitStatusDemoClient';

const pathStorePaths = sharedDemoFileTreeOptions.initialFiles;

export default function PathStoreGitStatusPage() {
  const sharedOptions: Omit<PathStoreFileTreeOptions, 'gitStatus' | 'id'> = {
    flattenEmptyDirectories:
      sharedDemoFileTreeOptions.flattenEmptyDirectories ?? false,
    initialExpandedPaths: sharedDemoStateConfig.initialExpandedItems,
    paths: pathStorePaths,
    viewportHeight: 280,
  };

  const payload = preloadPathStoreFileTree({
    ...sharedOptions,
    gitStatus: GIT_STATUSES_A,
    id: 'pst-phase9-git-status',
  });

  return (
    <PathStoreGitStatusDemoClient
      containerHtml={payload.html}
      sharedOptions={sharedOptions}
    />
  );
}
