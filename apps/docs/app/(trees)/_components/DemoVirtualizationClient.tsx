'use client';

import {
  FileTree,
  type FileTreePreloadedData,
  useFileTree,
} from '@pierre/trees/react';
import type { CSSProperties } from 'react';

import { TREE_NEW_VIEWPORT_HEIGHTS } from '../_lib/dimensions';
import { getDefaultFileTreePanelClass } from './tree-examples/demo-data';
import { TreeExampleSection } from './tree-examples/TreeExampleSection';
import { FeatureHeader } from '@/components/FeatureHeader';

const FILE_COUNT_FORMATTER = new Intl.NumberFormat('en-US');
const panelStyle: CSSProperties = {
  colorScheme: 'dark',
  height: TREE_NEW_VIEWPORT_HEIGHTS.virtualization,
};

interface DemoVirtualizationClientProps {
  expandedPaths: readonly string[];
  paths: readonly string[];
  preloadedData: FileTreePreloadedData;
}

export function DemoVirtualizationClient({
  expandedPaths,
  paths,
  preloadedData,
}: DemoVirtualizationClientProps) {
  const { model } = useFileTree({
    flattenEmptyDirectories: true,
    id: 'trees-virtualization-demo',
    initialExpandedPaths: expandedPaths,
    paths,
    initialVisibleRowCount: TREE_NEW_VIEWPORT_HEIGHTS.virtualization / 30,
    stickyFolders: true,
  });

  return (
    <TreeExampleSection>
      <FeatureHeader
        id="virtualization"
        title="Always virtualized"
        description={
          <>
            Built-in, automatic virtualization renders trees with tens of
            thousands of items instantly. The tree mounts only the visible rows.
            The tree below contains{' '}
            <strong>{FILE_COUNT_FORMATTER.format(paths.length)} files</strong>{' '}
            with every folder expanded. This demo enables{' '}
            <code>stickyFolders</code>.
          </>
        }
      />

      <FileTree
        className={getDefaultFileTreePanelClass()}
        model={model}
        preloadedData={preloadedData}
        style={panelStyle}
      />
    </TreeExampleSection>
  );
}
