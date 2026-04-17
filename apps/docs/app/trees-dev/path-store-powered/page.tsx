import {
  type PathStoreFileTreeOptions,
  preloadPathStoreFileTree,
} from '@pierre/trees/path-store';

import { ExampleCard } from '../_components/ExampleCard';
import { createPresortedPreparedInput } from './createPresortedPreparedInput';
import { PathStorePoweredRenderDemoClient } from './PathStorePoweredRenderDemoClient';
import { loadPathStorePoweredWorkloadDataPayload } from './pathStorePoweredWorkloadLoader';
import {
  DEFAULT_PATH_STORE_POWERED_WORKLOAD_NAME,
  getRequestedExpansionMode,
  getRequestedWorkloadName,
  PATH_STORE_POWERED_WORKLOAD_OPTIONS,
  PATH_STORE_PROOF_VIEWPORT_HEIGHT,
  type PathStorePoweredPageSearchParams,
} from './pathStorePoweredWorkloadMeta';

const PATH_STORE_HEADER_HTML =
  '<div data-path-store-demo-header style="align-items:center;display:flex;gap:12px;padding:8px 12px"><strong>Phase 10 path-store header</strong><button type="button">Log header action</button></div>';
const PATH_STORE_PROOF_TITLE =
  'Mutation + search + rename + drag-drop tree proof';

export default async function PathStorePoweredPage({
  searchParams,
}: {
  searchParams?:
    | Promise<PathStorePoweredPageSearchParams>
    | PathStorePoweredPageSearchParams;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const selectedWorkloadName = getRequestedWorkloadName(resolvedSearchParams);
  const expansionMode = getRequestedExpansionMode(resolvedSearchParams);
  const workloadData = await loadPathStorePoweredWorkloadDataPayload(
    selectedWorkloadName,
    expansionMode
  );
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
      dragAndDrop: true,
      flattenEmptyDirectories: true,
      fileTreeSearchMode: 'hide-non-matches',
      initialExpandedPaths: workloadData.initialExpandedPaths,
      paths: workloadData.paths,
      search: true,
      viewportHeight: PATH_STORE_PROOF_VIEWPORT_HEIGHT,
    };
  const payload = preloadPathStoreFileTree({
    ...sharedOptions,
    icons: 'complete',
    id: `pst-phase8-renaming-${selectedWorkloadName}`,
    preparedInput: workloadData.pathsArePresorted
      ? createPresortedPreparedInput(workloadData.paths)
      : undefined,
  });
  const treeMountId = `pst-phase8-proof-${selectedWorkloadName}-${expansionMode}`;

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
        title={PATH_STORE_PROOF_TITLE}
        description={`Current workload: ${workloadData.selectedWorkload.label} (${workloadData.selectedWorkload.fileCountLabel}). Phase 7 search is instrumented directly in this main demo now, Phase 8 inline rename lives beside it, and Phase 10 drag/drop now runs on the same hydrated tree: drag rows directly to folders or root, use the mutation buttons to confirm the tree stays coherent, and use the context menu or F2 for delete/rename actions.`}
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
