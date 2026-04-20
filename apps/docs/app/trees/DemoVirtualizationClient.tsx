'use client';

import {
  FileTree,
  type FileTreePreloadedData,
  useFileTree,
} from '@pierre/trees/react';
import type { CSSProperties } from 'react';

import { FeatureHeader } from '../diff-examples/FeatureHeader';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';
import { getDefaultFileTreePanelClass } from './tree-examples/demo-data';
import { TreeExampleSection } from './tree-examples/TreeExampleSection';

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
  });

  return (
    <TreeExampleSection>
      <FeatureHeader
        id="virtualization"
        title="Always virtualized"
        description={
          <>
            Trees with tens of thousands of items render instantly with built-in
            and automatic virtualization. Only visible rows are mounted. The
            tree below contains{' '}
            <strong>{FILE_COUNT_FORMATTER.format(paths.length)} files</strong>{' '}
            with every folder expanded.
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
