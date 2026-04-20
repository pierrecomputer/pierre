import {
  preloadFileTree,
  serializeFileTreeSsrPayload,
} from '@pierre/trees/ssr';

import { ExampleCard } from './_components/ExampleCard';
import { readSettingsCookies } from './_components/readSettingsCookies';
import { MainDemoClient } from './_demos/MainDemoClient';
import { createPresortedPreparedInput } from './_lib/createPresortedPreparedInput';
import { loadWorkloadDataPayload } from './_lib/workloadLoader';
import {
  DEFAULT_TREES_WORKLOAD_NAME,
  FILE_TREE_PROOF_VIEWPORT_HEIGHT,
  getRequestedExpansionMode,
  getRequestedWorkloadName,
  TREES_WORKLOAD_OPTIONS,
  type TreesPageSearchParams,
} from './_lib/workloadMeta';
import type { FileTreePathOptions } from '@/lib/fileTreePathOptions';

const TREE_HEADER_HTML =
  '<div data-tree-demo-header style="align-items:center;display:flex;gap:12px;padding:8px 12px"><strong>Trees demo header</strong><button type="button">Log header action</button></div>';
const MAIN_DEMO_TITLE = 'Main demo';

export default async function TreesDevIndexPage({
  searchParams,
}: {
  searchParams?: Promise<TreesPageSearchParams> | TreesPageSearchParams;
}) {
  const { flattenEmptyDirectories } = await readSettingsCookies();
  const resolvedSearchParams = (await searchParams) ?? {};
  const selectedWorkloadName = getRequestedWorkloadName(resolvedSearchParams);
  const expansionMode = getRequestedExpansionMode(resolvedSearchParams);
  const workloadData = await loadWorkloadDataPayload(
    selectedWorkloadName,
    expansionMode
  );
  const sharedOptions: Omit<FileTreePathOptions, 'id' | 'preparedInput'> = {
    composition: {
      contextMenu: {
        enabled: true,
        triggerMode: 'both',
      },
      header: {
        html: TREE_HEADER_HTML,
      },
    },
    dragAndDrop: true,
    flattenEmptyDirectories,
    fileTreeSearchMode: 'hide-non-matches',
    initialExpandedPaths: workloadData.initialExpandedPaths,
    paths: workloadData.paths,
    search: true,
    stickyFolders: true,
    initialVisibleRowCount: FILE_TREE_PROOF_VIEWPORT_HEIGHT / 30,
  };
  const payload = preloadFileTree({
    ...sharedOptions,
    icons: 'complete',
    id: `trees-dev-main-${selectedWorkloadName}`,
    preparedInput: workloadData.pathsArePresorted
      ? createPresortedPreparedInput(workloadData.paths)
      : undefined,
  });
  const treeMountId = `trees-dev-main-proof-${selectedWorkloadName}-${expansionMode}`;

  return (
    <MainDemoClient
      key={`${selectedWorkloadName}-${expansionMode}`}
      defaultWorkloadName={DEFAULT_TREES_WORKLOAD_NAME}
      expansionMode={expansionMode}
      treeMountId={treeMountId}
      workloadData={workloadData}
      workloadOptions={TREES_WORKLOAD_OPTIONS}
    >
      <ExampleCard
        title={MAIN_DEMO_TITLE}
        description={`Current workload: ${workloadData.selectedWorkload.label} (${workloadData.selectedWorkload.fileCountLabel}). Search, inline rename, drag and drop, icon switching, and direct mutation buttons all run against one hydrated tree. Use the context menu or F2 for rename/delete actions, then reset the tree or swap workloads to rerun the same proof.`}
      >
        <div
          id={treeMountId}
          style={{ height: `${String(FILE_TREE_PROOF_VIEWPORT_HEIGHT)}px` }}
          dangerouslySetInnerHTML={{
            __html: serializeFileTreeSsrPayload(payload, 'dom'),
          }}
          suppressHydrationWarning
        />
      </ExampleCard>
    </MainDemoClient>
  );
}
