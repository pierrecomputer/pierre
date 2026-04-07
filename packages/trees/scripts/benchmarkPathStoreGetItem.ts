import { PathStore } from '@pierre/path-store';
import { getVirtualizationWorkload } from '@pierre/tree-test-data';

import { PathStoreTreesController } from '../src/path-store/controller';

const workload = getVirtualizationWorkload('linux-5x');
const preparedInput = PathStore.preparePresortedInput(workload.files);
const controller = new PathStoreTreesController({
  flattenEmptyDirectories: true,
  initialExpandedPaths: workload.expandedFolders,
  paths: workload.files,
  preparedInput,
});

const fileHitPaths = workload.files.slice(0, 2_000);
const directoryAliasHitPaths = workload.expandedFolders.slice(0, 2_000);
const directoryCanonicalHitPaths = directoryAliasHitPaths.map(
  (path) => `${path}/`
);
const missPaths = fileHitPaths.map(
  (path, index) => `${path}.missing-${index.toString(36)}`
);

function timeLookups(paths: readonly string[]): number {
  const start = performance.now();
  for (const path of paths) {
    controller.getItem(path);
  }
  return performance.now() - start;
}

console.log(
  JSON.stringify(
    {
      directoryAliasHitCount: directoryAliasHitPaths.length,
      directoryAliasHitDurationMs: Number(
        timeLookups(directoryAliasHitPaths).toFixed(3)
      ),
      directoryCanonicalHitCount: directoryCanonicalHitPaths.length,
      directoryCanonicalHitDurationMs: Number(
        timeLookups(directoryCanonicalHitPaths).toFixed(3)
      ),
      fileHitCount: fileHitPaths.length,
      fileHitDurationMs: Number(timeLookups(fileHitPaths).toFixed(3)),
      missCount: missPaths.length,
      missDurationMs: Number(timeLookups(missPaths).toFixed(3)),
      workload: 'linux-5x',
    },
    null,
    2
  )
);

controller.destroy();
