'use client';

import { IconBulbFill } from '@pierre/icons';
import { FileTree } from '@pierre/trees/react';
import Link from 'next/link';
import type { CSSProperties } from 'react';

import { IconFootnote } from '../../components/IconFootnote';
import { TreeExampleHeading } from '../../components/TreeExampleHeading';
import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { baseTreeOptions } from './demo-data';
import { styleObjectToCss } from './styleToCss';
import { TreeCssViewer } from './TreeCssViewer';
import { TreeExampleSection } from './TreeExampleSection';

/** Theme vars applied to the panel wrapper and to the FileTree host so shadow DOM sees them. */
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
    ['--trees-fg-override' as string]: '#e2e0ec',
    ['--trees-fg-muted-override' as string]: '#b8a9c4',
    ['--trees-bg-muted-override' as string]: 'rgba(255, 126, 219, 0.12)',
    ['--trees-search-fg-override' as string]: '#d4c5e0',
    ['--trees-search-bg-override' as string]: '#2b213a',
    ['--trees-border-color-override' as string]: 'rgba(255, 126, 219, 0.35)',
    ['--trees-selected-fg-override' as string]: '#ff7edb',
    ['--trees-selected-bg-override' as string]: 'rgba(249, 42, 173, 0.25)',
    ['--trees-selected-border-color-override' as string]: '#f92aad',
    ['--trees-selected-focused-border-color-override' as string]: '#ff7edb',
    ['--trees-focus-ring-color-override' as string]: '#36f9f6',
  };
}

export function StylingSection() {
  return (
    <TreeExampleSection id="styling">
      <FeatureHeader
        title="Style with CSS variables"
        description={
          <>
            Modify CSS custom properties via the <code>style</code> prop to
            override UI and theme colors. For example, below are three
            examples—custom light, dark, and Synthwave &apos;84— that override
            our default values and the CSS we use to style the tree. See the{' '}
            <Link href="/trees/docs#styling" className="inline-link">
              Styling docs
            </Link>{' '}
            for more info.
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <TreeExampleHeading>Light mode</TreeExampleHeading>
          <FileTree
            className="min-h-[320px] rounded-lg border border-neutral-200 bg-neutral-50 p-2"
            options={{
              ...baseTreeOptions,
              id: 'theming-demo-light',
            }}
            initialSelectedItems={['package.json']}
            style={lightTheme()}
          />
          <TreeCssViewer
            contents={styleObjectToCss(lightTheme())}
            filename="light-theme.css"
          />
        </div>
        <div>
          <TreeExampleHeading>Dark mode</TreeExampleHeading>
          <FileTree
            className="min-h-[320px] rounded-lg border border-neutral-700 bg-neutral-900 p-2"
            options={{
              ...baseTreeOptions,
              id: 'theming-demo-dark',
            }}
            initialSelectedItems={['package.json']}
            style={darkTheme()}
          />
          <TreeCssViewer
            contents={styleObjectToCss(darkTheme())}
            filename="dark-theme.css"
          />
        </div>
        <div>
          <TreeExampleHeading>Synthwave &apos;84</TreeExampleHeading>
          <FileTree
            className="min-h-[320px] rounded-lg border border-[#f92aad]/40 bg-[#1e1b2b] p-2 shadow-[inset_0_0_60px_rgba(249,42,173,0.08)]"
            options={{
              ...baseTreeOptions,
              id: 'theming-demo-synthwave',
            }}
            initialSelectedItems={['package.json']}
            style={synthwaveTheme()}
          />
          <TreeCssViewer
            contents={styleObjectToCss(synthwaveTheme())}
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
