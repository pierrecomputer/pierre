import { preloadFileTree } from '@pierre/trees/ssr';

import { readSettingsCookies } from '../_components/readSettingsCookies';
import {
  GIT_STATUSES_A,
  sharedDemoFileTreeOptions,
  sharedDemoStateConfig,
} from '../demo-data';
import { GitStatusDemoClient } from './GitStatusDemoClient';

export default async function GitStatusPage() {
  const { flattenEmptyDirectories, useLazyDataLoader } =
    await readSettingsCookies();
  const fileTreeOptions = {
    ...sharedDemoFileTreeOptions,
    flattenEmptyDirectories,
    useLazyDataLoader,
  };

  const gitStatusSsr = preloadFileTree(
    { ...fileTreeOptions, gitStatus: GIT_STATUSES_A },
    sharedDemoStateConfig
  );

  return (
    <GitStatusDemoClient
      preloadedGitStatusFileTreeHtml={gitStatusSsr.shadowHtml}
    />
  );
}
