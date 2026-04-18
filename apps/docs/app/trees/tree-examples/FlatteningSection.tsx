import { IconFileTreeFill, IconFolders } from '@pierre/icons';
import Link from 'next/link';
import type { CSSProperties } from 'react';

import { TreeExampleHeading } from '../../components/TreeExampleHeading';
import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { DEFAULT_FILE_TREE_PANEL_CLASS, flatteningOptions } from './demo-data';
import { TreeExampleSection } from './TreeExampleSection';
import { PRODUCTS } from '@/app/product-config';
import { preloadFileTree } from '@/lib/treesCompat';
import { FileTree } from '@/lib/treesCompatClient';

const flattenStyle = {
  colorScheme: 'dark',
  '--trees-search-bg-override': 'light-dark(#fff, oklch(14.5% 0 0))',
} as CSSProperties;

const hierarchicalPrerenderedHTML = preloadFileTree(
  {
    ...flatteningOptions(false),
    id: 'flatten-demo-hierarchical',
  },
  {
    initialExpandedItems: [
      'build',
      'build/assets',
      'build/assets/images',
      'build/assets/images/social',
    ],
  }
).shadowHtml;

const flattenedPrerenderedHTML = preloadFileTree(
  {
    ...flatteningOptions(true),
    id: 'flatten-demo-flattened',
  },
  {
    initialExpandedItems: ['build', 'f::build/assets/images/social'],
  }
).shadowHtml;

export function FlatteningSection() {
  return (
    <TreeExampleSection>
      <FeatureHeader
        id="flatten"
        title="Flatten empty directories"
        description={
          <>
            Enable the <code>flattenEmptyDirectories</code> boolean option in{' '}
            <code>FileTreeOptions</code> to collapse single-child folder chains
            into one row for a more compact tree.{' '}
            <Link
              href={`${PRODUCTS.trees.docsPath}#core-types-filetreeoptions`}
              className="inline-link"
            >
              More about FileTreeOptions…
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <TreeExampleHeading icon={<IconFileTreeFill />}>
            Hierarchical
          </TreeExampleHeading>
          <FileTree
            className={DEFAULT_FILE_TREE_PANEL_CLASS}
            prerenderedHTML={hierarchicalPrerenderedHTML}
            options={{
              ...flatteningOptions(false),
              id: 'flatten-demo-hierarchical',
            }}
            initialExpandedItems={[
              'build',
              'build/assets',
              'build/assets/images',
              'build/assets/images/social',
            ]}
            style={flattenStyle}
          />
        </div>
        <div>
          <TreeExampleHeading icon={<IconFolders />}>
            Flattened
          </TreeExampleHeading>
          <FileTree
            className={DEFAULT_FILE_TREE_PANEL_CLASS}
            prerenderedHTML={flattenedPrerenderedHTML}
            options={{
              ...flatteningOptions(true),
              id: 'flatten-demo-flattened',
            }}
            initialExpandedItems={['build', 'f::build/assets/images/social']}
            style={flattenStyle}
          />
        </div>
      </div>
    </TreeExampleSection>
  );
}
