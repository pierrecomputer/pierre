'use client';

import type { FileContents } from '@pierre/diffs';
import type { FileTreePreloadedData } from '@pierre/trees/react';
import { useFileTree } from '@pierre/trees/react';
import type { CSSProperties } from 'react';

import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';
import { TreeApp } from '@/components/TreeApp';

const treePanelStyle = {
  colorScheme: 'dark',
  '--trees-search-bg-override': 'light-dark(#fff, oklch(14.5% 0 0))',
} as CSSProperties;

const fileOptions = {
  disableFileHeader: true,
  theme: 'pierre-dark',
  themeType: 'dark',
} as const;

interface DemoTreeAppClientProps {
  files: Readonly<Record<string, FileContents>>;
  initialActivePath: string;
  initialExpandedPaths: readonly string[];
  paths: readonly string[];
  prerenderedHTMLByPath: Readonly<Record<string, string>>;
  treeId: string;
  treePreloadedData: FileTreePreloadedData;
}

export function DemoTreeAppClient({
  files,
  initialActivePath,
  initialExpandedPaths,
  paths,
  prerenderedHTMLByPath,
  treeId,
  treePreloadedData,
}: DemoTreeAppClientProps) {
  const { model } = useFileTree({
    flattenEmptyDirectories: true,
    id: treeId,
    initialExpandedPaths,
    initialSelectedPaths: [initialActivePath],
    paths,
    search: false,
    viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.treeApp,
  });

  return (
    <TreeApp
      fileOptions={fileOptions}
      files={files}
      height={TREE_NEW_VIEWPORT_HEIGHTS.treeApp}
      initialActivePath={initialActivePath}
      model={model}
      preloadedTreeData={treePreloadedData}
      prerenderedHTMLByPath={prerenderedHTMLByPath}
      treeClassName="dark h-full min-h-0 overflow-auto p-2"
      treeStyle={treePanelStyle}
    />
  );
}
