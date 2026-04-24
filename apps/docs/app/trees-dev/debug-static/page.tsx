import {
  preloadFileTree,
  serializeFileTreeSsrPayload,
} from '@pierre/trees/ssr';

import { DebugStaticClient } from '../_demos/DebugStaticClient';
import { createPresortedPreparedInput } from '../_lib/createPresortedPreparedInput';
import { DEBUG_STATIC_PATHS } from '../_lib/debugStaticData';
import { FILE_TREE_PROOF_VIEWPORT_HEIGHT } from '../_lib/workloadMeta';

export default function TreesDevDebugStaticPage() {
  const mountId = 'trees-dev-debug-static';
  const preparedInput = createPresortedPreparedInput(DEBUG_STATIC_PATHS);
  const payload = preloadFileTree({
    flattenEmptyDirectories: false,
    id: 'trees-dev-debug-static',
    initialVisibleRowCount: FILE_TREE_PROOF_VIEWPORT_HEIGHT / 30,
    paths: DEBUG_STATIC_PATHS,
    preparedInput,
  });

  return (
    <DebugStaticClient
      mountId={mountId}
      mountMode="hydrate"
      payloadHtml={serializeFileTreeSsrPayload(payload, 'dom')}
    />
  );
}
