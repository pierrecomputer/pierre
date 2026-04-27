'use client';

import {
  FileTree,
  type FileTreePreloadedData,
  useFileTree,
} from '@pierre/trees/react';

import type { OverviewFileTreeOptions } from './constants';

interface OverviewFileTreeProps {
  initialExpandedPaths: readonly string[];
  options: OverviewFileTreeOptions;
  paths: readonly string[];
  preloadedData: FileTreePreloadedData;
}

export function OverviewFileTree({
  initialExpandedPaths,
  options,
  paths,
  preloadedData,
}: OverviewFileTreeProps) {
  const { model } = useFileTree({
    ...options,
    initialExpandedPaths,
    paths,
  });

  return (
    <FileTree
      className="rounded-lg border-1 py-4"
      model={model}
      preloadedData={preloadedData}
      style={{ height: 394, maxWidth: 400 }}
    />
  );
}
