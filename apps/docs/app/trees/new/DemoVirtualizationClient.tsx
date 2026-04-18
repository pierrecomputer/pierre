'use client';

import {
  FileTree,
  type FileTreePreloadedData,
  useFileTree,
} from '@pierre/trees/react';
import Link from 'next/link';
import type { CSSProperties } from 'react';

import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { DEFAULT_FILE_TREE_PANEL_CLASS } from '../tree-examples/demo-data';
import { TreeExampleSection } from '../tree-examples/TreeExampleSection';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';
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
    viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.virtualization,
  });

  return (
    <TreeExampleSection>
      <FeatureHeader
        id="virtualization"
        title="Virtualized rendering"
        description={
          <>
            Trees with thousands of items render instantly with built-in
            virtualization. Only visible rows are mounted. See{' '}
            <Link
              href={`${PRODUCTS.trees.docsPath}#core-types-filetreeoptions`}
              className="inline-link"
            >
              <code>FileTreeOptions</code>
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
