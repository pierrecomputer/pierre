'use client';

import {
  FILE_TREE_DENSITY_PRESETS,
  type FileTreeDensityKeyword,
} from '@pierre/trees';
import {
  FileTree,
  type FileTreePreloadedData,
  useFileTree,
} from '@pierre/trees/react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { TreeExampleHeading } from '../components/TreeExampleHeading';
import { FeatureHeader } from '../diff-examples/FeatureHeader';
import { sampleFileList } from './demo-data';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';
import { getDefaultFileTreePanelClass } from './tree-examples/demo-data';
import { TreeExampleSection } from './tree-examples/TreeExampleSection';
import { PRODUCTS } from '@/app/product-config';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

const PRESELECTED_FILE = 'src/components/Button.tsx';

const DENSITY_PRESETS = [
  {
    density: 'compact',
    description: '24px rows, 0.8 spacing',
    id: 'trees-density-demo-compact',
    label: 'Compact',
    viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.densityCompact,
  },
  {
    density: 'default',
    description: '30px rows, 1.0 spacing',
    id: 'trees-density-demo-default',
    label: 'Default',
    viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.densityDefault,
  },
  {
    density: 'relaxed',
    description: '36px rows, 1.2 spacing',
    id: 'trees-density-demo-relaxed',
    label: 'Relaxed',
    viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.densityRelaxed,
  },
] as const;

function DensityTree({
  density,
  id,
  preloadedData,
  viewportHeight,
}: {
  density: FileTreeDensityKeyword;
  id: string;
  preloadedData: FileTreePreloadedData;
  viewportHeight: number;
}) {
  const { model } = useFileTree({
    flattenEmptyDirectories: true,
    id,
    density,
    paths: sampleFileList,
    initialVisibleRowCount:
      viewportHeight / FILE_TREE_DENSITY_PRESETS[density].itemHeight,
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
      style={{
        colorScheme: 'dark',
        height: `${String(viewportHeight)}px`,
      }}
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
  const [mobileView, setMobileView] = useState<string>(
    DENSITY_PRESETS[0].density
  );

  return (
    <TreeExampleSection>
      <FeatureHeader
        id="density"
        title="Adjustable density"
        description={
          <>
            Pass <code>density=&quot;compact&quot;</code>,{' '}
            <code>&quot;default&quot;</code>, or{' '}
            <code>&quot;relaxed&quot;</code> (or a custom numeric factor) to{' '}
            <code>useFileTree</code> to tune the tree&apos;s proportions in one
            place — the keyword resolves both the row height and the spacing
            factor. See the{' '}
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
      <ButtonGroup
        className="md:hidden"
        value={mobileView}
        onValueChange={setMobileView}
      >
        {DENSITY_PRESETS.map((preset) => (
          <ButtonGroupItem key={preset.density} value={preset.density}>
            {preset.label}
          </ButtonGroupItem>
        ))}
      </ButtonGroup>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {DENSITY_PRESETS.map((preset) => (
          <div
            key={preset.id}
            className={
              mobileView === preset.density ? undefined : 'hidden md:block'
            }
          >
            <TreeExampleHeading description={preset.description}>
              {preset.label}
            </TreeExampleHeading>
            <DensityTree
              density={preset.density}
              id={preset.id}
              preloadedData={preloadedData[preset.density]}
              viewportHeight={preset.viewportHeight}
            />
          </div>
        ))}
      </div>
    </TreeExampleSection>
  );
}
