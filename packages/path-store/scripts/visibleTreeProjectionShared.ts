import { getVirtualizationWorkload } from '@pierre/tree-test-data';

import { createVisibleTreeProjection, PathStore } from '../src/index';
import type { PathStoreVisibleRow } from '../src/public-types';

export interface VisibleTreeProjectionWorkload {
  collapseTargetPath: string | null;
  expandedFolderCount: number;
  expandedFolders: readonly string[];
  fileCount: number;
  files: readonly string[];
  name: string;
  presortedFiles: readonly string[];
  rows: readonly PathStoreVisibleRow[];
  store: PathStore;
  visibleCount: number;
}

export interface VisibleTreeProjectionScenario {
  description: string;
  measure: () => {
    collapseTargetPath?: string | null;
    rowCount: number;
  };
  name: string;
}

// Prepares a stable visible-row snapshot plus a reusable store for the
// projection benchmarks so profile runs can isolate helper cost from setup.
export function createVisibleTreeProjectionWorkload(
  workloadName: string
): VisibleTreeProjectionWorkload {
  const workload = getVirtualizationWorkload(workloadName);
  const store = new PathStore({
    flattenEmptyDirectories: true,
    initialExpandedPaths: workload.expandedFolders,
    paths: workload.files,
  });
  const visibleCount = store.getVisibleCount();
  const rows =
    visibleCount > 0 ? store.getVisibleSlice(0, visibleCount - 1) : [];

  return {
    collapseTargetPath: pickCollapseTargetPath(rows),
    expandedFolderCount: workload.expandedFolders.length,
    expandedFolders: workload.expandedFolders,
    fileCount: workload.files.length,
    files: workload.files,
    name: workloadName,
    presortedFiles: workload.presortedFiles,
    rows,
    store,
    visibleCount,
  };
}

export function createVisibleTreeProjectionScenarios(
  workload: VisibleTreeProjectionWorkload
): VisibleTreeProjectionScenario[] {
  const scenarios: VisibleTreeProjectionScenario[] = [
    {
      description:
        'Projects a precomputed visible slice into parent/setsize metadata.',
      measure: () => {
        const projection = createVisibleTreeProjection(workload.rows);
        return { rowCount: projection.rows.length };
      },
      name: 'projection-only',
    },
    {
      description:
        'Reads the full visible slice from the store, then projects it.',
      measure: () => {
        const rows =
          workload.visibleCount > 0
            ? workload.store.getVisibleSlice(0, workload.visibleCount - 1)
            : [];
        const projection = createVisibleTreeProjection(rows);
        return { rowCount: projection.rows.length };
      },
      name: 'slice-and-projection',
    },
  ];

  if (workload.collapseTargetPath != null) {
    const collapseTargetPath = workload.collapseTargetPath;
    const toggleStore = new PathStore({
      flattenEmptyDirectories: true,
      initialExpandedPaths: workload.expandedFolders,
      paths: workload.files,
    });
    let isCollapsed = false;

    scenarios.push({
      description:
        'Alternates collapse and expand on a live store, then rebuilds projection metadata from the new visible slice.',
      measure: () => {
        if (isCollapsed) {
          toggleStore.expand(collapseTargetPath);
        } else {
          toggleStore.collapse(collapseTargetPath);
        }
        isCollapsed = !isCollapsed;

        const visibleCount = toggleStore.getVisibleCount();
        const rows =
          visibleCount > 0
            ? toggleStore.getVisibleSlice(0, visibleCount - 1)
            : [];
        const projection = createVisibleTreeProjection(rows);
        return {
          collapseTargetPath,
          rowCount: projection.rows.length,
        };
      },
      name: 'toggle-slice-and-projection',
    });

    // Pre-compute a presorted input so each fresh store avoids re-sorting the
    // same path set. This mirrors the intended API usage for repeated
    // construction from a known file list.
    const collapsePreparedInput = PathStore.preparePresortedInput(
      workload.presortedFiles
    );

    scenarios.push({
      description:
        'Constructs a fresh store from presorted input, collapses one representative directory, then rebuilds projection metadata from the new visible slice.',
      measure: () => {
        const freshStore = new PathStore({
          flattenEmptyDirectories: true,
          initialExpandedPaths: workload.expandedFolders,
          preparedInput: collapsePreparedInput,
        });
        freshStore.collapse(collapseTargetPath);
        const visibleCount = freshStore.getVisibleCount();
        const rows =
          visibleCount > 0
            ? freshStore.getVisibleSlice(0, visibleCount - 1)
            : [];
        const projection = createVisibleTreeProjection(rows);
        return {
          collapseTargetPath,
          rowCount: projection.rows.length,
        };
      },
      name: 'collapse-slice-and-projection',
    });
  }

  return scenarios;
}

export function summarizeDurations(durationsMs: readonly number[]) {
  const sorted = [...durationsMs].sort((left, right) => left - right);
  const count = sorted.length;
  const sum = sorted.reduce((total, duration) => total + duration, 0);
  const percentile = (fraction: number): number => {
    if (count === 0) {
      return 0;
    }

    const index = Math.min(
      count - 1,
      Math.max(0, Math.ceil(count * fraction) - 1)
    );
    return sorted[index] ?? 0;
  };

  return {
    averageMs: count === 0 ? 0 : sum / count,
    maxMs: sorted[count - 1] ?? 0,
    medianMs: percentile(0.5),
    minMs: sorted[0] ?? 0,
    p95Ms: percentile(0.95),
    runCount: count,
  };
}

function pickCollapseTargetPath(
  rows: readonly PathStoreVisibleRow[]
): string | null {
  for (const row of rows) {
    if (row.kind === 'directory' && row.hasChildren && row.depth <= 1) {
      return row.path;
    }
  }

  for (const row of rows) {
    if (row.kind === 'directory' && row.hasChildren) {
      return row.path;
    }
  }

  return null;
}
