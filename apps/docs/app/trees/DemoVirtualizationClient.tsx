'use client';

import {
  FileTree,
  type FileTreePreloadedData,
  useFileTree,
} from '@pierre/trees/react';
import Link from 'next/link';
import type { CSSProperties } from 'react';

import { FeatureHeader } from '../diff-examples/FeatureHeader';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';
import { DEFAULT_FILE_TREE_PANEL_CLASS } from './tree-examples/demo-data';
import { TreeExampleSection } from './tree-examples/TreeExampleSection';
import { PRODUCTS } from '@/app/product-config';

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
            Trees with thousands of items render instantly with built-in and
            automatic virtualization. Only visible rows are mounted. See the{' '}
            <Link
              href={`${PRODUCTS.trees.docsPath}#shared-concepts-scale-and-rendering-settings`}
              className="inline-link"
            >
              scale settings reference
            </Link>{' '}
            for configuration details. As a demo, the tree below contains{' '}
            <strong>{FILE_COUNT_FORMATTER.format(paths.length)} files</strong>{' '}
            with every folder expanded.
          </>
        }
      />

      <FileTree
        className={DEFAULT_FILE_TREE_PANEL_CLASS}
        model={model}
        preloadedData={preloadedData}
        style={panelStyle}
      />
    </TreeExampleSection>
  );
}
