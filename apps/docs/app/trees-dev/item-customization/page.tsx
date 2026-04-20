import {
  preloadFileTree,
  serializeFileTreeSsrPayload,
} from '@pierre/trees/ssr';

import { readSettingsCookies } from '../_components/readSettingsCookies';
import { ItemCustomizationDemoClient } from '../_demos/ItemCustomizationDemoClient';
import { createPresortedPreparedInput } from '../_lib/createPresortedPreparedInput';
import {
  getItemCustomizationDecorationPreset,
  getTreesDevGitStatusPreset,
  ITEM_CUSTOMIZATION_DECORATION_ICONS,
  ITEM_CUSTOMIZATION_DEMO_DEFAULTS,
  ITEM_CUSTOMIZATION_DEMO_WORKLOAD_NAME,
} from '../_lib/itemCustomizationDemoData';
import { loadWorkloadDataPayload } from '../_lib/workloadLoader';
import type { FileTreePathOptions } from '@/lib/fileTreePathOptions';

const ITEM_CUSTOMIZATION_VIEWPORT_HEIGHT = 360;

export default async function TreesDevItemCustomizationPage() {
  const { flattenEmptyDirectories } = await readSettingsCookies();
  const workloadData = await loadWorkloadDataPayload(
    ITEM_CUSTOMIZATION_DEMO_WORKLOAD_NAME,
    'workload'
  );
  const defaultGitStatusPreset = getTreesDevGitStatusPreset(
    ITEM_CUSTOMIZATION_DEMO_DEFAULTS.gitStatusPresetId
  );
  const defaultDecorationPreset = getItemCustomizationDecorationPreset(
    ITEM_CUSTOMIZATION_DEMO_DEFAULTS.decorationPresetId
  );
  const sharedOptions: Omit<
    FileTreePathOptions,
    | 'composition'
    | 'gitStatus'
    | 'id'
    | 'onSelectionChange'
    | 'renderRowDecoration'
  > = {
    flattenEmptyDirectories,
    icons: ITEM_CUSTOMIZATION_DECORATION_ICONS,
    initialExpandedPaths: workloadData.initialExpandedPaths,
    paths: workloadData.paths,
    preparedInput: workloadData.pathsArePresorted
      ? createPresortedPreparedInput(workloadData.paths)
      : undefined,
    initialVisibleRowCount: ITEM_CUSTOMIZATION_VIEWPORT_HEIGHT / 30,
  };

  const payload = preloadFileTree({
    ...sharedOptions,
    composition: {
      contextMenu: {
        buttonVisibility: ITEM_CUSTOMIZATION_DEMO_DEFAULTS.buttonVisibility,
        enabled: ITEM_CUSTOMIZATION_DEMO_DEFAULTS.contextMenuEnabled,
        triggerMode: ITEM_CUSTOMIZATION_DEMO_DEFAULTS.triggerMode,
      },
    },
    gitStatus: defaultGitStatusPreset.entries,
    id: 'trees-dev-item-customization',
    renderRowDecoration: defaultDecorationPreset.renderer ?? undefined,
  });

  return (
    <ItemCustomizationDemoClient
      containerHtml={serializeFileTreeSsrPayload(payload, 'dom')}
      fileCountLabel={workloadData.selectedWorkload.fileCountLabel}
      sharedOptions={sharedOptions}
    />
  );
}
