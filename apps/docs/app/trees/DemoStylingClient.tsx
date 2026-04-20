'use client';

import { IconBulbFill } from '@pierre/icons';
import {
  FileTree,
  type FileTreePreloadedData,
  useFileTree,
} from '@pierre/trees/react';
import Link from 'next/link';
import type { CSSProperties } from 'react';

import { IconFootnote } from '../components/IconFootnote';
import { TreeExampleHeading } from '../components/TreeExampleHeading';
import { FeatureHeader } from '../diff-examples/FeatureHeader';
import { sampleFileList } from './demo-data';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';
import { styleObjectToCss } from './tree-examples/styleToCss';
import { TreeCssViewer } from './tree-examples/TreeCssViewer';
import { TreeExampleSection } from './tree-examples/TreeExampleSection';
import { PRODUCTS } from '@/app/product-config';

function lightTheme(): CSSProperties {
  return {
    colorScheme: 'light',
    ['--trees-fg-override' as string]: 'oklch(14.5% 0 0)',
    ['--trees-fg-muted-override' as string]: 'oklch(45% 0 0)',
    ['--trees-bg-muted-override' as string]: 'oklch(96% 0 0)',
    ['--trees-search-fg-override' as string]: 'oklch(30% 0 0)',
    ['--trees-search-bg-override' as string]: 'oklch(100% 0 0)',
    ['--trees-border-color-override' as string]: 'oklch(92% 0 0)',
    ['--trees-selected-fg-override' as string]: 'oklch(20% 0.08 250)',
    ['--trees-selected-bg-override' as string]: 'oklch(92% 0.06 250)',
    ['--trees-selected-border-color-override' as string]: 'oklch(65% 0.15 250)',
    ['--trees-selected-focused-border-color-override' as string]:
      'oklch(55% 0.2 250)',
    ['--trees-focus-ring-color-override' as string]: 'oklch(50% 0.15 250)',
  };
}

function darkTheme(): CSSProperties {
  return {
    colorScheme: 'dark',
    ['--trees-fg-override' as string]: 'oklch(98.5% 0 0)',
    ['--trees-fg-muted-override' as string]: 'oklch(75% 0 0)',
    ['--trees-bg-muted-override' as string]: 'oklch(26.9% 0 0)',
    ['--trees-search-fg-override' as string]: 'oklch(85% 0 0)',
    ['--trees-search-bg-override' as string]: 'oklch(20% 0 0)',
    ['--trees-border-color-override' as string]: 'oklch(100% 0 0 / 0.12)',
    ['--trees-selected-fg-override' as string]: 'oklch(97% 0.04 250)',
    ['--trees-selected-bg-override' as string]: 'oklch(35% 0.08 250)',
    ['--trees-selected-border-color-override' as string]: 'oklch(65% 0.2 250)',
    ['--trees-selected-focused-border-color-override' as string]:
      'oklch(75% 0.2 250)',
    ['--trees-focus-ring-color-override' as string]: 'oklch(70% 0.15 250)',
  };
}

function synthwaveTheme(): CSSProperties {
  return {
    colorScheme: 'dark',
    ['--trees-fg-override' as string]: 'oklch(91.2% 0.016 294)',
    ['--trees-fg-muted-override' as string]: 'oklch(75.6% 0.04 310)',
    ['--trees-bg-muted-override' as string]: 'oklch(76.9% 0.19 339 / 0.12)',
    ['--trees-search-fg-override' as string]: 'oklch(84.4% 0.04 310)',
    ['--trees-search-bg-override' as string]: 'oklch(27.2% 0.05 302)',
    ['--trees-border-color-override' as string]: 'oklch(76.9% 0.19 339 / 0.35)',
    ['--trees-selected-fg-override' as string]: 'oklch(76.9% 0.19 339)',
    ['--trees-selected-bg-override' as string]: 'oklch(66.3% 0.26 348 / 0.25)',
    ['--trees-selected-border-color-override' as string]:
      'oklch(66.3% 0.26 348)',
    ['--trees-selected-focused-border-color-override' as string]:
      'oklch(76.9% 0.19 339)',
    ['--trees-focus-ring-color-override' as string]: 'oklch(89.2% 0.14 193)',
  };
}

function StyledTree({
  className,
  id,
  preloadedData,
  selectedPath,
  style,
}: {
  className: string;
  id: string;
  preloadedData: FileTreePreloadedData;
  selectedPath: string;
  style: CSSProperties;
}) {
  const { model } = useFileTree({
    flattenEmptyDirectories: true,
    id,
    initialSelectedPaths: [selectedPath],
    paths: sampleFileList,
    viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.styling,
  });

  return (
    <FileTree
      className={className}
      model={model}
      preloadedData={preloadedData}
      style={{
        ...style,
        height: `${String(TREE_NEW_VIEWPORT_HEIGHTS.styling)}px`,
      }}
    />
  );
}

interface DemoStylingClientProps {
  preloadedData: {
    dark: FileTreePreloadedData;
    light: FileTreePreloadedData;
    synthwave: FileTreePreloadedData;
  };
  selectedPaths: {
    dark: string;
    light: string;
    synthwave: string;
  };
}

export function DemoStylingClient({
  preloadedData,
  selectedPaths,
}: DemoStylingClientProps) {
  const lightThemeStyles = lightTheme();
  const darkThemeStyles = darkTheme();
  const synthwaveThemeStyles = synthwaveTheme();

  return (
    <TreeExampleSection>
      <FeatureHeader
        id="styling"
        title="Style with CSS variables"
        description={
          <>
            {'Modify CSS custom properties via the '}
            <code>style</code>
            {
              ' prop to override UI and theme colors. For example, below are three examples—custom light, dark, and Synthwave '
            }
            &apos;84
            {
              '—that override our default values and the CSS we use to style the tree. See the '
            }
            <Link
              href={`${PRODUCTS.trees.docsPath}#styling-and-theming`}
              className="inline-link"
            >
              styling and theming reference
            </Link>{' '}
            {'for more info.'}
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <TreeExampleHeading>Light mode</TreeExampleHeading>
          <StyledTree
            className="min-h-[320px] rounded-lg border border-neutral-200 bg-neutral-50 p-2"
            id="trees-styling-demo-light"
            preloadedData={preloadedData.light}
            selectedPath={selectedPaths.light}
            style={lightThemeStyles}
          />
          <TreeCssViewer
            contents={styleObjectToCss(lightThemeStyles)}
            filename="light-theme.css"
          />
        </div>
        <div>
          <TreeExampleHeading>Dark mode</TreeExampleHeading>
          <StyledTree
            className="min-h-[320px] rounded-lg border border-neutral-700 bg-neutral-900 p-2"
            id="trees-styling-demo-dark"
            preloadedData={preloadedData.dark}
            selectedPath={selectedPaths.dark}
            style={darkThemeStyles}
          />
          <TreeCssViewer
            contents={styleObjectToCss(darkThemeStyles)}
            filename="dark-theme.css"
          />
        </div>
        <div>
          <TreeExampleHeading>Synthwave &apos;84</TreeExampleHeading>
          <StyledTree
            className="min-h-[320px] rounded-lg border border-[#f92aad]/40 bg-[#1e1b2b] p-2 shadow-[inset_0_0_60px_rgba(249,42,173,0.08)]"
            id="trees-styling-demo-synthwave"
            preloadedData={preloadedData.synthwave}
            selectedPath={selectedPaths.synthwave}
            style={synthwaveThemeStyles}
          />
          <TreeCssViewer
            contents={styleObjectToCss(synthwaveThemeStyles)}
            filename="synthwave-theme.css"
          />
        </div>
      </div>
      <IconFootnote icon={<IconBulbFill />}>
        We’re using{' '}
        <a
          href="https://oklch.com"
          className="inline-link"
          target="_blank"
          rel="noopener noreferrer"
        >
          OKLCH colors
        </a>{' '}
        here—a modern color space that allows for more uniform colors and more
        consistent palettes.
      </IconFootnote>
    </TreeExampleSection>
  );
}
