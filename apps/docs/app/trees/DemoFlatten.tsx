'use client';

import { IconFileTreeFill, IconFolders } from '@pierre/icons';
import {
  FileTree,
  type FileTreePreloadedData,
  useFileTree,
} from '@pierre/trees/react';
import Link from 'next/link';
import type { CSSProperties } from 'react';

import { TreeExampleHeading } from '../components/TreeExampleHeading';
import { FeatureHeader } from '../diff-examples/FeatureHeader';
import { sampleFileList } from './demo-data';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';
import { DEFAULT_FILE_TREE_PANEL_CLASS } from './tree-examples/demo-data';
import { TreeExampleSection } from './tree-examples/TreeExampleSection';
import { PRODUCTS } from '@/app/product-config';
import type { FileTreePathOptions } from '@/lib/fileTreePathOptions';

const HIERARCHICAL_MATCHED_EXPANDED_PATHS = [
  'build',
  'build/assets',
  'build/assets/images',
  'build/assets/images/social',
] as const;
const FLATTENED_MATCHED_EXPANDED_PATHS = [
  'build',
  'build/assets/images/social',
] as const;
const flattenStyle = {
  colorScheme: 'dark',
  '--trees-search-bg-override': 'light-dark(#fff, oklch(14.5% 0 0))',
} as CSSProperties;

const FILE_TREE_BASE_OPTIONS: Omit<FileTreePathOptions, 'id' | 'paths'> = {
  initialExpansion: 'closed',
  search: false,
};

function FlattenDemoTree({
  flattenEmptyDirectories,
  initialExpandedPaths,
  id,
  preloadedData,
  viewportHeight,
}: {
  flattenEmptyDirectories: boolean;
  initialExpandedPaths: readonly string[];
  id: string;
  preloadedData: FileTreePreloadedData;
  viewportHeight: number;
}) {
  const { model } = useFileTree({
    ...FILE_TREE_BASE_OPTIONS,
    flattenEmptyDirectories,
    id,
    initialExpandedPaths,
    paths: sampleFileList,
    viewportHeight,
  });

  return (
    <FileTree
      className={DEFAULT_FILE_TREE_PANEL_CLASS}
      model={model}
      preloadedData={preloadedData}
      style={{
        ...flattenStyle,
        height: `${String(viewportHeight)}px`,
      }}
    />
  );
}

interface DemoFlattenProps {
  preloadedData: {
    flattened: FileTreePreloadedData;
    hierarchical: FileTreePreloadedData;
  };
}

export function DemoFlatten({ preloadedData }: DemoFlattenProps) {
  return (
    <TreeExampleSection>
      <FeatureHeader
        id="flatten"
        title="Flatten empty directories"
        description={
          <>
            Enable the <code>flattenEmptyDirectories</code> boolean option in{' '}
            tree options to collapse single-child folder chains into one row for
            a more compact tree.{' '}
            <Link
              href={`${PRODUCTS.trees.docsPath}#core-types-filetreeoptions`}
              className="inline-link"
            >
              More about tree options…
            </Link>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <TreeExampleHeading icon={<IconFileTreeFill />}>
            Default expanded
          </TreeExampleHeading>
          <FlattenDemoTree
            flattenEmptyDirectories={false}
            initialExpandedPaths={HIERARCHICAL_MATCHED_EXPANDED_PATHS}
            id="file-tree-flatten-demo-hierarchical"
            preloadedData={preloadedData.hierarchical}
            viewportHeight={TREE_NEW_VIEWPORT_HEIGHTS.flattenHierarchical}
          />
        </div>

        <div className="space-y-2">
          <TreeExampleHeading icon={<IconFolders />}>
            Flattened directories
          </TreeExampleHeading>
          <FlattenDemoTree
            flattenEmptyDirectories
            initialExpandedPaths={FLATTENED_MATCHED_EXPANDED_PATHS}
            id="file-tree-flatten-demo-flattened"
            preloadedData={preloadedData.flattened}
            viewportHeight={TREE_NEW_VIEWPORT_HEIGHTS.flattenFlattened}
          />
        </div>
      </div>
    </TreeExampleSection>
  );
}
