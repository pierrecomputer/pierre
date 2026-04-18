'use client';

import {
  FileTree,
  type FileTreePreloadedData,
  useFileTree,
} from '@pierre/trees/react';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { useState } from 'react';

import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { DEFAULT_FILE_TREE_PANEL_CLASS } from '../tree-examples/demo-data';
import { TreeExampleSection } from '../tree-examples/TreeExampleSection';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';
import { PRODUCTS } from '@/app/product-config';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

const TRUNCATION_EXPANDED_PATHS = ['apps', 'packages', 'src'] as const;

const middotPanelStyle = {
  colorScheme: 'dark',
  '--trees-search-bg-override': 'light-dark(#fff, oklch(14.5% 0 0))',
} as CSSProperties;

interface DemoMiddotTruncationClientProps {
  paths: readonly string[];
  preloadedData: {
    flattened: FileTreePreloadedData;
    hierarchical: FileTreePreloadedData;
  };
}

export function DemoMiddotTruncationClient({
  paths,
  preloadedData,
}: DemoMiddotTruncationClientProps) {
  const [flattenEmptyDirectories, setFlattenEmptyDirectories] = useState(true);
  const [widthMode, setWidthMode] = useState<'narrow' | 'wide'>('narrow');
  const { model: flattenedModel } = useFileTree({
    flattenEmptyDirectories: true,
    id: 'trees-middot-truncation-flattened',
    initialExpandedPaths: TRUNCATION_EXPANDED_PATHS,
    paths,
    search: false,
    viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.middotTruncation,
  });
  const { model: hierarchicalModel } = useFileTree({
    flattenEmptyDirectories: false,
    id: 'trees-middot-truncation-hierarchical',
    initialExpandedPaths: TRUNCATION_EXPANDED_PATHS,
    paths,
    search: false,
    viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.middotTruncation,
  });

  const activeModel = flattenEmptyDirectories
    ? flattenedModel
    : hierarchicalModel;
  const activePreloadedData = flattenEmptyDirectories
    ? preloadedData.flattened
    : preloadedData.hierarchical;
  const panelWidth = widthMode === 'narrow' ? '440px' : '100%';

  return (
    <TreeExampleSection>
      <FeatureHeader
        id="middot-truncation"
        title="Middle truncation for long names"
        description={
          <>
            Tree rows use middle truncation to keep extensions and leaf names
            readable under tight widths. This includes extension-aware clipping
            and flattened directory segments. The behavior is powered by the
            same internals documented in{' '}
            <Link
              href={`${PRODUCTS.trees.docsPath}#styling`}
              className="inline-link"
            >
              <code>@pierre/trees</code>
            </Link>
            .
          </>
        }
      />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <ButtonGroup
            value={flattenEmptyDirectories ? 'flattened' : 'hierarchical'}
            onValueChange={(value) =>
              setFlattenEmptyDirectories(value === 'flattened')
            }
          >
            <ButtonGroupItem value="flattened">
              <code>flattened</code>
            </ButtonGroupItem>
            <ButtonGroupItem value="hierarchical">
              <code>hierarchical</code>
            </ButtonGroupItem>
          </ButtonGroup>
          <ButtonGroup
            value={widthMode}
            onValueChange={(value) => setWidthMode(value as 'narrow' | 'wide')}
          >
            <ButtonGroupItem value="narrow">
              <code>narrow</code>
            </ButtonGroupItem>
            <ButtonGroupItem value="wide">
              <code>wide</code>
            </ButtonGroupItem>
          </ButtonGroup>
        </div>
        <div
          style={{
            maxWidth: panelWidth,
            transition: 'max-width 120ms ease-out',
          }}
        >
          <FileTree
            key={flattenEmptyDirectories ? 'flattened' : 'hierarchical'}
            className={DEFAULT_FILE_TREE_PANEL_CLASS}
            model={activeModel}
            preloadedData={activePreloadedData}
            style={{
              ...middotPanelStyle,
              height: `${String(TREE_NEW_VIEWPORT_HEIGHTS.middotTruncation)}px`,
            }}
          />
        </div>
      </div>
    </TreeExampleSection>
  );
}
