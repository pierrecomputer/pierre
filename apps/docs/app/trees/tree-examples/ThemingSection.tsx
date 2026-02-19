'use client';

import { FileTree } from '@pierre/trees/react';
import type { CSSProperties } from 'react';

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
    ['--ft-color-foreground' as string]: 'oklch(14.5% 0 0)',
    ['--ft-background-color-muted' as string]: 'oklch(96% 0 0)',
    ['--ft-search-background' as string]: 'oklch(100% 0 0)',
    ['--ft-color-border' as string]: 'oklch(92% 0 0)',
    ['--ft-selected-background-color' as string]: 'oklch(92% 0.06 250)',
    ['--ft-selected-border-color' as string]: 'oklch(65% 0.15 250)',
    ['--ft-selected-focused-border-color' as string]: 'oklch(55% 0.2 250)',
    ['--ft-focus-ring-color' as string]: 'oklch(50% 0.15 250)',
    ['--color-muted-foreground' as string]: 'oklch(45% 0 0)',
  };
}

function darkTheme(): CSSProperties {
  return {
    colorScheme: 'dark',
    ['--ft-color-foreground' as string]: 'oklch(98.5% 0 0)',
    ['--ft-background-color-muted' as string]: 'oklch(26.9% 0 0)',
    ['--ft-search-background' as string]: 'oklch(20% 0 0)',
    ['--ft-color-border' as string]: 'oklch(100% 0 0 / 0.12)',
    ['--ft-selected-background-color' as string]: 'oklch(35% 0.08 250)',
    ['--ft-selected-border-color' as string]: 'oklch(65% 0.2 250)',
    ['--ft-selected-focused-border-color' as string]: 'oklch(75% 0.2 250)',
    ['--ft-focus-ring-color' as string]: 'oklch(70% 0.15 250)',
    ['--color-muted-foreground' as string]: 'oklch(75% 0 0)',
  };
}

function synthwaveTheme(): CSSProperties {
  return {
    colorScheme: 'dark',
    ['--ft-color-foreground' as string]: '#e2e0ec',
    ['--ft-background-color-muted' as string]: 'rgba(255, 126, 219, 0.12)',
    ['--ft-search-background' as string]: '#2b213a',
    ['--ft-color-border' as string]: 'rgba(255, 126, 219, 0.35)',
    ['--ft-selected-background-color' as string]: 'rgba(249, 42, 173, 0.25)',
    ['--ft-selected-border-color' as string]: '#f92aad',
    ['--ft-selected-focused-border-color' as string]: '#ff7edb',
    ['--ft-focus-ring-color' as string]: '#36f9f6',
    ['--color-muted-foreground' as string]: '#b8a9c4',
  };
}

export function ThemingSection() {
  return (
    <TreeExampleSection id="theming">
      <FeatureHeader
        title="Style with CSS variables"
        description={
          <>
            Modify CSS custom properties on <code>FileTree</code> via the{' '}
            <code>style</code> prop to override our colors and even theme
            colors. For example, below are three examples that override our
            default values and the CSS we used to style the tree. Custom light,
            dark, and Synthwave &apos;84.
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
    </TreeExampleSection>
  );
}
