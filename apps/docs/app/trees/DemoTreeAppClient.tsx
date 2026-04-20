'use client';

import type { FileContents } from '@pierre/diffs';
import type { FileTreePreloadedData } from '@pierre/trees/react';
import { useFileTree } from '@pierre/trees/react';
import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';

import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';
import { TreeApp } from '@/components/TreeApp';

const COMPACT_ITEM_HEIGHT = 24;
const COMPACT_DENSITY = 0.8;

const treePanelStyle = {
  colorScheme: 'dark',
  '--trees-search-bg-override': 'light-dark(#fff, oklch(14.5% 0 0))',
  '--trees-density-override': COMPACT_DENSITY,
  '--trees-row-height-override': `${String(COMPACT_ITEM_HEIGHT)}px`,
} as CSSProperties;

const fileOptions = {
  disableFileHeader: true,
  theme: 'pierre-dark',
  themeType: 'dark',
} as const;

const composition = {
  contextMenu: {
    enabled: true,
    triggerMode: 'both',
  },
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
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null
  );

  useEffect(() => {
    setPortalContainer(document.getElementById('dark-mode-portal-container'));
  }, []);

  const treeOptions = useMemo(
    () => ({
      composition,
      flattenEmptyDirectories: true,
      id: treeId,
      initialExpandedPaths,
      initialSelectedPaths: [initialActivePath],
      itemHeight: COMPACT_ITEM_HEIGHT,
      paths,
      renaming: true as const,
      search: false as const,
      viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.treeApp,
    }),
    [initialActivePath, initialExpandedPaths, paths, treeId]
  );

  const { model } = useFileTree(treeOptions);

  return (
    <TreeApp
      contextMenuPortalContainer={portalContainer}
      fileOptions={fileOptions}
      files={files}
      height={TREE_NEW_VIEWPORT_HEIGHTS.treeApp}
      initialActivePath={initialActivePath}
      model={model}
      preloadedTreeData={treePreloadedData}
      prerenderedHTMLByPath={prerenderedHTMLByPath}
      projectName="acme-components"
      treeClassName="dark h-full min-h-0 overflow-auto"
      treeStyle={treePanelStyle}
    />
  );
}
