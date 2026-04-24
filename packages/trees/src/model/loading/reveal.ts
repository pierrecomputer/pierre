import { PathStore } from '@pierre/path-store';

import type {
  FileTreeRevealDirectorySnapshot,
  FileTreeSortComparator,
} from '../types';

export interface PreparedRevealDirectorySnapshot {
  childDirectoryKnownChildCountByPath: ReadonlyMap<string, number>;
  children: readonly string[];
}

function isDirectChildPath(directoryPath: string, childPath: string): boolean {
  if (!childPath.startsWith(directoryPath) || childPath === directoryPath) {
    return false;
  }

  const relativePath = childPath.slice(directoryPath.length);
  const normalizedRelativePath = childPath.endsWith('/')
    ? relativePath.slice(0, -1)
    : relativePath;

  return (
    normalizedRelativePath.length > 0 && !normalizedRelativePath.includes('/')
  );
}

function validateKnownChildCount(
  childPath: string,
  knownChildCount: number | null | undefined
): number | null {
  if (knownChildCount == null) {
    return null;
  }

  if (!childPath.endsWith('/')) {
    throw new Error(
      `Reveal reservation hints are only valid for directory children: "${childPath}"`
    );
  }

  if (!Number.isInteger(knownChildCount) || knownChildCount < 0) {
    throw new Error(
      `knownChildCount must be a non-negative integer. Received: ${String(knownChildCount)}`
    );
  }

  return knownChildCount;
}

export function prepareRevealDirectorySnapshot({
  directoryPath,
  onCustomSort,
  snapshot,
  sort,
}: {
  directoryPath: string;
  onCustomSort: () => void;
  snapshot: FileTreeRevealDirectorySnapshot;
  sort: 'default' | FileTreeSortComparator | undefined;
}): PreparedRevealDirectorySnapshot {
  const childPaths = [...snapshot.children];
  const hintSidecar = snapshot.childDirectoryKnownChildCounts;
  if (hintSidecar != null && hintSidecar.length !== childPaths.length) {
    throw new Error(
      `Reveal snapshot hint sidecar length must match children for "${directoryPath}"`
    );
  }

  const seenPaths = new Set<string>();
  const childDirectoryKnownChildCountByPath = new Map<string, number>();
  childPaths.forEach((childPath, index) => {
    if (!isDirectChildPath(directoryPath, childPath)) {
      throw new Error(
        `Reveal snapshot child must be a direct child of ${directoryPath}: "${childPath}"`
      );
    }

    if (seenPaths.has(childPath)) {
      throw new Error(
        `Reveal snapshot children must be unique. Duplicate: "${childPath}"`
      );
    }
    seenPaths.add(childPath);

    const knownChildCount = validateKnownChildCount(
      childPath,
      hintSidecar?.[index]
    );
    if (knownChildCount != null) {
      childDirectoryKnownChildCountByPath.set(childPath, knownChildCount);
    }
  });

  const children =
    typeof sort === 'function' && childPaths.length > 1
      ? (onCustomSort(), PathStore.preparePaths(childPaths, { sort }))
      : childPaths;

  return {
    childDirectoryKnownChildCountByPath,
    children,
  };
}
