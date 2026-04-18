import type { FileTreeOptions } from '@pierre/trees';
import { preloadFileTree } from '@pierre/trees/ssr';

import { readSettingsCookies } from '../_components/readSettingsCookies';
import { GitStatusDemoClient } from '../_demos/GitStatusDemoClient';
import {
  GIT_STATUSES_A,
  sharedDemoFileTreeOptions,
  sharedInitialExpandedPaths,
} from '../demo-data';

export default async function TreesDevGitStatusPage() {
  const { flattenEmptyDirectories } = await readSettingsCookies();
  const sharedOptions: Omit<FileTreeOptions, 'gitStatus' | 'id'> = {
    flattenEmptyDirectories,
    initialExpandedPaths: sharedInitialExpandedPaths,
    paths: sharedDemoFileTreeOptions.paths,
    viewportHeight: 280,
  };

  const payload = preloadFileTree({
    ...sharedOptions,
    gitStatus: GIT_STATUSES_A,
    id: 'trees-git-status',
  });

  return (
    <GitStatusDemoClient
      containerHtml={payload.html}
      sharedOptions={sharedOptions}
    />
  );
}
