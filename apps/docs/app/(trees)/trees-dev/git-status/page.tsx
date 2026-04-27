import {
  preloadFileTree,
  serializeFileTreeSsrPayload,
} from '@pierre/trees/ssr';
import type { FileTreePathOptions } from '@trees/_lib/fileTreePathOptions';

import { readSettingsCookies } from '../_components/readSettingsCookies';
import { GitStatusDemoClient } from '../_demos/GitStatusDemoClient';
import { createPresortedPreparedInput } from '../_lib/createPresortedPreparedInput';
import {
  getTreesDevGitStatusPreset,
  ITEM_CUSTOMIZATION_DEMO_DEFAULTS,
  ITEM_CUSTOMIZATION_DEMO_WORKLOAD_NAME,
} from '../_lib/itemCustomizationDemoData';
import { loadWorkloadDataPayload } from '../_lib/workloadLoader';

const GIT_STATUS_VIEWPORT_HEIGHT = 280;

export default async function TreesDevGitStatusPage() {
  const { flattenEmptyDirectories } = await readSettingsCookies();
  const workloadData = await loadWorkloadDataPayload(
    ITEM_CUSTOMIZATION_DEMO_WORKLOAD_NAME,
    'workload'
  );
  const defaultGitStatusPreset = getTreesDevGitStatusPreset(
    ITEM_CUSTOMIZATION_DEMO_DEFAULTS.gitStatusPresetId
  );
  const preparedInput = workloadData.pathsArePresorted
    ? createPresortedPreparedInput(workloadData.paths)
    : undefined;
  const sharedOptions: Omit<
    FileTreePathOptions,
    'gitStatus' | 'id' | 'preparedInput'
  > = {
    flattenEmptyDirectories,
    initialExpandedPaths: workloadData.initialExpandedPaths,
    paths: workloadData.paths,
    initialVisibleRowCount: GIT_STATUS_VIEWPORT_HEIGHT / 30,
  };

  const payload = preloadFileTree({
    ...sharedOptions,
    gitStatus: defaultGitStatusPreset.entries,
    id: 'trees-git-status',
    preparedInput,
  });

  return (
    <GitStatusDemoClient
      containerHtml={serializeFileTreeSsrPayload(payload, 'dom')}
      fileCountLabel={workloadData.selectedWorkload.fileCountLabel}
      pathsArePresorted={workloadData.pathsArePresorted}
      sharedOptions={sharedOptions}
    />
  );
}
