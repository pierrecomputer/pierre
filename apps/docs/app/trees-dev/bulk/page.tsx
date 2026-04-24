import {
  preloadFileTree,
  serializeFileTreeSsrPayload,
} from '@pierre/trees/ssr';

import { BulkIngestDemoClient } from '../_demos/BulkIngestDemoClient';
import {
  type BulkExperimentPageSearchParams,
  getBulkExperimentExpansionOptions,
  getRequestedBulkExperimentRouteState,
} from '../_lib/bulkExperimentMeta';
import { BULK_EXPERIMENT_PREVIEW_DATA } from '../_lib/bulkExperimentPreviewData';
import { createPresortedPreparedInput } from '../_lib/createPresortedPreparedInput';
import { FILE_TREE_PROOF_VIEWPORT_HEIGHT } from '../_lib/workloadMeta';

export default async function TreesDevBulkPage({
  searchParams,
}: {
  searchParams?:
    | Promise<BulkExperimentPageSearchParams>
    | BulkExperimentPageSearchParams;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const routeState = getRequestedBulkExperimentRouteState(resolvedSearchParams);
  const previewData = BULK_EXPERIMENT_PREVIEW_DATA[routeState.workloadName];
  const payload = preloadFileTree({
    flattenEmptyDirectories: false,
    id: `trees-dev-bulk-${routeState.workloadName}-${routeState.expansionMode}`,
    ...getBulkExperimentExpansionOptions(
      routeState.workloadName,
      routeState.expansionMode
    ),
    initialVisibleRowCount: FILE_TREE_PROOF_VIEWPORT_HEIGHT / 30,
    paths: previewData.previewPaths,
    preparedInput: createPresortedPreparedInput(previewData.previewPaths),
    search: true,
  });

  return (
    <BulkIngestDemoClient
      key={JSON.stringify(routeState)}
      payloadHtml={serializeFileTreeSsrPayload(payload, 'dom')}
      {...routeState}
    />
  );
}
