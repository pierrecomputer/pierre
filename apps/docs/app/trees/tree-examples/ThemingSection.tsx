'use client';

import { FileTree } from '@pierre/file-tree/react';
import type { CSSProperties } from 'react';

import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { baseTreeOptions } from './demo-data';
import { TreeExampleSection } from './TreeExampleSection';

/** Theme vars applied to the panel wrapper and to the FileTree host so shadow DOM sees them. */
function lightTheme(): CSSProperties {
  return {
    colorScheme: 'light',
    ['--ft-color-foreground' as string]: 'oklch(14.5% 0 0)',
    ['--ft-background-color-muted' as string]: 'oklch(96% 0 0)',
    ['--ft-search-background' as string]: 'oklch(98% 0 0)',
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
        title="Theming"
        description={
          <>
            Modify CSS custom properties on <code>FileTree</code> via the{' '}
            <code>style</code> prop: <code>--ft-color-foreground</code>,{' '}
            <code>--ft-search-background</code>, <code>--ft-color-border</code>,{' '}
            <code>--ft-selected-background-color</code>, and more can be used to
            customize the tree&apos;s appearance. For example, below are light,
            dark, and Synthwave &apos;84 themes.
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <h3 className="mb-3 text-lg font-medium">Light mode</h3>
          <div
            className="min-h-[320px] overflow-auto rounded-lg border border-neutral-200 bg-neutral-50 p-3"
            style={lightTheme()}
          >
            <FileTree
              options={{
                ...baseTreeOptions,
                id: 'theming-demo-light',
                config: {
                  ...baseTreeOptions.config,
                  initialState: {
                    ...baseTreeOptions.config?.initialState,
                    selectedItems: ['package.json'],
                  },
                },
              }}
              style={lightTheme()}
            />
          </div>
        </div>
        <div>
          <h3 className="mb-3 text-lg font-medium">Dark mode</h3>
          <div
            className="min-h-[320px] overflow-auto rounded-lg border border-neutral-700 bg-neutral-900 p-3"
            style={darkTheme()}
          >
            <FileTree
              options={{
                ...baseTreeOptions,
                id: 'theming-demo-dark',
                config: {
                  ...baseTreeOptions.config,
                  initialState: {
                    ...baseTreeOptions.config?.initialState,
                    selectedItems: ['package.json'],
                  },
                },
              }}
              style={darkTheme()}
            />
          </div>
        </div>
        <div>
          <h3 className="mb-3 text-lg font-medium">Synthwave &apos;84</h3>
          <div
            className="min-h-[320px] overflow-auto rounded-lg border border-[#f92aad]/40 bg-[#1e1b2b] p-3 shadow-[inset_0_0_60px_rgba(249,42,173,0.08)]"
            style={synthwaveTheme()}
          >
            <FileTree
              options={{
                ...baseTreeOptions,
                id: 'theming-demo-synthwave',
                config: {
                  ...baseTreeOptions.config,
                  initialState: {
                    ...baseTreeOptions.config?.initialState,
                    selectedItems: ['package.json'],
                  },
                },
              }}
              style={synthwaveTheme()}
            />
          </div>
        </div>
      </div>
    </TreeExampleSection>
  );
}
