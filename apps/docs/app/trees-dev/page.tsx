import type { FileTreeOptions } from '@pierre/trees';
import { preloadFileTree } from '@pierre/trees/ssr';

import { ExampleCard } from './_components/ExampleCard';
import { readSettingsCookies } from './_components/readSettingsCookies';
import { createPresortedPreparedInput } from './path-store-powered/createPresortedPreparedInput';
import { PathStorePoweredRenderDemoClient } from './path-store-powered/PathStorePoweredRenderDemoClient';
import { loadPathStorePoweredWorkloadDataPayload } from './path-store-powered/pathStorePoweredWorkloadLoader';
import {
  DEFAULT_PATH_STORE_POWERED_WORKLOAD_NAME,
  getRequestedExpansionMode,
  getRequestedWorkloadName,
  PATH_STORE_POWERED_WORKLOAD_OPTIONS,
  PATH_STORE_PROOF_VIEWPORT_HEIGHT,
  type PathStorePoweredPageSearchParams,
} from './path-store-powered/pathStorePoweredWorkloadMeta';

const TREE_HEADER_HTML =
  '<div data-path-store-demo-header style="align-items:center;display:flex;gap:12px;padding:8px 12px"><strong>Trees demo header</strong><button type="button">Log header action</button></div>';
const MAIN_DEMO_TITLE = 'Main demo';

export default async function TreesDevIndexPage({
  searchParams,
}: {
  searchParams?:
    | Promise<PathStorePoweredPageSearchParams>
    | PathStorePoweredPageSearchParams;
}) {
  const { flattenEmptyDirectories } = await readSettingsCookies();
  const resolvedSearchParams = (await searchParams) ?? {};
  const selectedWorkloadName = getRequestedWorkloadName(resolvedSearchParams);
  const expansionMode = getRequestedExpansionMode(resolvedSearchParams);
  const workloadData = await loadPathStorePoweredWorkloadDataPayload(
    selectedWorkloadName,
    expansionMode
  );
  const sharedOptions: Omit<FileTreeOptions, 'id' | 'preparedInput'> = {
    composition: {
      contextMenu: {
        enabled: true,
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
    viewportHeight: PATH_STORE_PROOF_VIEWPORT_HEIGHT,
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
    <PathStorePoweredRenderDemoClient
      key={`${selectedWorkloadName}-${expansionMode}`}
      defaultWorkloadName={DEFAULT_PATH_STORE_POWERED_WORKLOAD_NAME}
      expansionMode={expansionMode}
      treeMountId={treeMountId}
      workloadData={workloadData}
      workloadOptions={PATH_STORE_POWERED_WORKLOAD_OPTIONS}
    >
      <ExampleCard
        title={MAIN_DEMO_TITLE}
        description={`Current workload: ${workloadData.selectedWorkload.label} (${workloadData.selectedWorkload.fileCountLabel}). Search, inline rename, drag and drop, icon switching, and direct mutation buttons all run against one hydrated tree. Use the context menu or F2 for rename/delete actions, then reset the tree or swap workloads to rerun the same proof.`}
      >
        <div
          id={treeMountId}
          style={{ height: `${String(PATH_STORE_PROOF_VIEWPORT_HEIGHT)}px` }}
          dangerouslySetInnerHTML={{ __html: payload.html }}
          suppressHydrationWarning
        />
      </ExampleCard>
    </PathStorePoweredRenderDemoClient>
  );
}
