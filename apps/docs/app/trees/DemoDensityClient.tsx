'use client';

import {
  FileTree,
  type FileTreePreloadedData,
  useFileTree,
} from '@pierre/trees/react';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { useEffect } from 'react';

import { TreeExampleHeading } from '../components/TreeExampleHeading';
import { FeatureHeader } from '../diff-examples/FeatureHeader';
import { sampleFileList } from './demo-data';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';
import { getDefaultFileTreePanelClass } from './tree-examples/demo-data';
import { TreeExampleSection } from './tree-examples/TreeExampleSection';
import { PRODUCTS } from '@/app/product-config';

const PRESELECTED_FILE = 'src/components/Button.tsx';

const DENSITY_PRESETS = [
  {
    density: 0.8,
    description: '24px rows, density 0.8',
    height: 24,
    id: 'trees-density-demo-compact',
    key: 'compact',
    label: 'Compact',
    viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.densityCompact,
  },
  {
    density: 1,
    description: '30px rows, density 1',
    height: 30,
    id: 'trees-density-demo-default',
    key: 'default',
    label: 'Default',
    viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.densityDefault,
  },
  {
    density: 1.2,
    description: '36px rows, density 1.2',
    height: 36,
    id: 'trees-density-demo-relaxed',
    key: 'relaxed',
    label: 'Relaxed',
    viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.densityRelaxed,
  },
] as const;

function densityStyle(
  density: number,
  height: number,
  viewportHeight: number
): CSSProperties {
  return {
    colorScheme: 'dark',
    height: `${String(viewportHeight)}px`,
    ['--trees-density-override' as string]: density,
    ['--trees-row-height-override' as string]: `${String(height)}px`,
  };
}

function DensityTree({
  density,
  itemHeight,
  id,
  preloadedData,
  viewportHeight,
}: {
  density: number;
  itemHeight: number;
  id: string;
  preloadedData: FileTreePreloadedData;
  viewportHeight: number;
}) {
  const { model } = useFileTree({
    flattenEmptyDirectories: true,
    id,
    itemHeight,
    paths: sampleFileList,
    initialVisibleRowCount: viewportHeight / itemHeight,
  });

  useEffect(() => {
    model.focusPath(PRESELECTED_FILE);
    model.getItem(PRESELECTED_FILE)?.select();
  }, [model]);

  return (
    <FileTree
      className={getDefaultFileTreePanelClass()}
      model={model}
      preloadedData={preloadedData}
      style={densityStyle(density, itemHeight, viewportHeight)}
    />
  );
}

interface DemoDensityClientProps {
  preloadedData: {
    compact: FileTreePreloadedData;
    default: FileTreePreloadedData;
    relaxed: FileTreePreloadedData;
  };
}

export function DemoDensityClient({ preloadedData }: DemoDensityClientProps) {
  return (
    <TreeExampleSection>
      <FeatureHeader
        id="density"
        title="Adjustable density"
        description={
          <>
            Pair a row height with a density preset to tune the tree&apos;s
            proportions. Use <code>--trees-row-height-override</code> for the
            row size, <code>--trees-density-override</code> for spacing, and
            keep <code>itemHeight</code> aligned with the chosen row height.
            Density now scales spacing around the rows rather than height
            itself. See the{' '}
            <Link
              href={`${PRODUCTS.trees.docsPath}#styling-and-theming`}
              className="inline-link"
            >
              styling and theming reference
            </Link>{' '}
            for more info.
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {DENSITY_PRESETS.map((preset) => (
          <div key={preset.id}>
            <TreeExampleHeading description={preset.description}>
              {preset.label}
            </TreeExampleHeading>
            <DensityTree
              density={preset.density}
              id={preset.id}
              itemHeight={preset.height}
              preloadedData={preloadedData[preset.key]}
              viewportHeight={preset.viewportHeight}
            />
          </div>
        ))}
      </div>
    </TreeExampleSection>
  );
}
