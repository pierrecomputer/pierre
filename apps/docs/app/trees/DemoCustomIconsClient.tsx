'use client';

import { IconBrush, IconFileTreeFill, IconFire } from '@pierre/icons';
import type { FileTreeIcons } from '@pierre/trees';
import {
  FileTree,
  type FileTreePreloadedData,
  useFileTree,
} from '@pierre/trees/react';
import { type CSSProperties, type JSX, useState } from 'react';

import { PierreIconsFootnote } from '../components/PierreIconsFootnote';
import { TreeExampleHeading } from '../components/TreeExampleHeading';
import { FeatureHeader } from '../diff-examples/FeatureHeader';
import { sampleFileList } from './demo-data';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';
import {
  DEFAULT_FILE_TREE_PANEL_STYLE,
  getDefaultFileTreePanelClass,
} from './tree-examples/demo-data';
import { TreeExampleSection } from './tree-examples/TreeExampleSection';
import { PRODUCTS } from '@/app/product-config';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

const panelStyle = {
  ...DEFAULT_FILE_TREE_PANEL_STYLE,
  '--trees-search-bg-override': 'light-dark(#fff, oklch(14.5% 0 0))',
  height: TREE_NEW_VIEWPORT_HEIGHTS.customIcons,
} as CSSProperties;

interface IconDemoConfig {
  description: JSX.Element;
  icon: JSX.Element;
  icons: FileTreeIcons;
  id: string;
  title: string;
}

const ICON_DEMO_CONFIGS: readonly IconDemoConfig[] = [
  {
    description: <>Generic file, folder, and image icons with no file types.</>,
    icon: <IconFileTreeFill />,
    icons: 'minimal',
    id: 'trees-built-in-icons-minimal',
    title: 'Minimal',
  },
  {
    description: <>Icons for common languages and file types.</>,
    icon: <IconFire />,
    icons: 'standard',
    id: 'trees-built-in-icons-standard',
    title: 'Standard',
  },
  {
    description: <>Full, colored suite with brands and frameworks.</>,
    icon: <IconBrush />,
    icons: 'complete',
    id: 'trees-built-in-icons-complete',
    title: 'Complete',
  },
] as const;

function IconDemoTree({
  config,
  isMobileActive,
  preloadedData,
}: {
  config: IconDemoConfig;
  isMobileActive: boolean;
  preloadedData: FileTreePreloadedData;
}) {
  const { model } = useFileTree({
    dragAndDrop: {
      canDrag: (draggedPaths) =>
        draggedPaths.includes('package.json') === false,
    },
    flattenEmptyDirectories: true,
    icons: config.icons,
    id: config.id,
    initialExpandedPaths: ['src', 'src/components'],
    paths: sampleFileList,
    initialVisibleRowCount: TREE_NEW_VIEWPORT_HEIGHTS.customIcons / 30,
  });

  return (
    <div className={isMobileActive ? undefined : 'hidden md:block'}>
      <TreeExampleHeading icon={config.icon} description={config.description}>
        {config.title}
      </TreeExampleHeading>
      <FileTree
        className={getDefaultFileTreePanelClass()}
        model={model}
        preloadedData={preloadedData}
        style={panelStyle}
      />
    </div>
  );
}

interface DemoCustomIconsClientProps {
  preloadedDataById: Readonly<Record<string, FileTreePreloadedData>>;
}

export function DemoCustomIconsClient({
  preloadedDataById,
}: DemoCustomIconsClientProps) {
  const [mobileView, setMobileView] = useState<string>(ICON_DEMO_CONFIGS[0].id);

  return (
    <TreeExampleSection>
      <FeatureHeader
        id="custom-icons"
        title="Built-in icon sets"
        description={
          <>
            Choose between the shipped <code>minimal</code>,{' '}
            <code>standard</code>, and <code>complete</code> icon tiers. Each
            tier is cumulative. Override the built-in palette with CSS variables
            like <code>--trees-file-icon-color-javascript</code>, or fall back
            to a fully custom sprite. See the{' '}
            <a
              href={`${PRODUCTS.trees.docsPath}#icons-configuration-shape`}
              className="inline-link"
            >
              <code>FileTreeIconConfig</code> reference
            </a>{' '}
            for the full API.
          </>
        }
      />
      <ButtonGroup
        className="md:hidden"
        value={mobileView}
        onValueChange={setMobileView}
      >
        {ICON_DEMO_CONFIGS.map((config) => (
          <ButtonGroupItem
            key={config.id}
            value={config.id}
            aria-label={config.title}
          >
            {config.icon}
            {config.title}
          </ButtonGroupItem>
        ))}
      </ButtonGroup>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        {ICON_DEMO_CONFIGS.map((config) => (
          <IconDemoTree
            key={config.id}
            config={config}
            isMobileActive={mobileView === config.id}
            preloadedData={preloadedDataById[config.id]}
          />
        ))}
      </div>
      <PierreIconsFootnote />
    </TreeExampleSection>
  );
}
