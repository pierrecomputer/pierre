import { describe, expect, test } from 'bun:test';
import type { CSSProperties } from 'react';

import { buildAnnotationThemeStyle } from '../app/(diffshub)/(view)/_components/CodeViewWrapper';
import { buildThemeChromeStyle } from '../app/(diffshub)/(view)/_components/useResolvedTreeThemeStyles';

describe('buildThemeChromeStyle', () => {
  test('exports themed tokens for popovers, controls, and inline comments', () => {
    const style = buildThemeChromeStyle({
      mutedFg: '#b0c2c8',
      primaryFg: '#d8eef4',
      treeStyles: {
        backgroundColor: '#20313a',
        color: '#d8eef4',
      },
    });

    // Snapshot raw token values before toMatchObject runs: it mutates the
    // received object (swapping matched values for the matcher in its diff
    // output), so reading style[...] afterwards would return the matcher,
    // not the string.
    const tokens = (style ?? {}) as Record<string, string>;
    const separator = tokens['--diffshub-diff-separator'];
    const borderOpaque = tokens['--color-border-opaque'];
    const popoverShadow = tokens['--diffshub-popover-shadow'];
    const annotationShadow = tokens['--diffshub-annotation-shadow'];

    expect(style).toMatchObject({
      '--color-accent': expect.stringContaining('#d8eef4'),
      '--color-input': expect.stringContaining('#d8eef4'),
      '--color-popover': expect.stringContaining('#d8eef4'),
      '--color-popover-foreground': '#d8eef4',
      '--diffshub-annotation-bg': expect.stringContaining('#d8eef4'),
      '--diffshub-annotation-border': expect.stringContaining('#d8eef4'),
      '--diffshub-annotation-fg': '#d8eef4',
      '--diffshub-popover-bg': expect.stringContaining('#d8eef4'),
      '--diffshub-popover-border': expect.stringContaining('#d8eef4'),
      '--diffshub-popover-hover-bg': expect.stringContaining('#d8eef4'),
      // Segmented-control track sits a step above the popover surface so it
      // reads as a connected control rather than vanishing into the menu.
      '--color-secondary': expect.stringContaining('#d8eef4'),
      // Inter-file separator reuses the themed border-opaque value so it
      // matches the surrounding chrome borders' weight on every theme.
      '--diffshub-diff-separator': expect.stringContaining('#20313a'),
    });

    // On a shared editor/sidebar surface the file separator reuses the
    // chrome border verbatim, so the two lines carry identical weight.
    expect(separator).toBe(borderOpaque);

    // The popover/annotation shadow is a real, surface-independent drop
    // shadow (occlusion-black, visible on light themes too) and does NOT
    // bake in a `0 0 0 1px` ring — every consumer already paints its own
    // 1px border, so a ring would double it into a too-thick edge.
    for (const shadow of [popoverShadow, annotationShadow]) {
      expect(shadow).toContain('rgb(0 0 0');
      expect(shadow).not.toContain('0 0 0 1px');
    }
  });

  test('scopes inline comment theming without changing code-view chrome tokens', () => {
    const themeChromeStyle = {
      backgroundColor: '#101010',
      color: '#f8fafc',
      '--background': '#101010',
      '--color-background': '#101010',
      '--color-border': 'color-mix(in srgb, #f8fafc 20%, transparent)',
      '--color-border-opaque': 'color-mix(in srgb, #f8fafc 15%, #101010)',
      '--diffshub-annotation-bg': 'color-mix(in srgb, #f8fafc 7%, #101010)',
      '--diffshub-annotation-border':
        'color-mix(in srgb, #f8fafc 18%, #101010)',
      '--diffshub-annotation-fg': '#f8fafc',
      '--diffshub-annotation-hover-border':
        'color-mix(in srgb, #f8fafc 28%, #101010)',
      '--diffshub-annotation-shadow':
        '0 18px 44px color-mix(in srgb, #101010 72%, transparent)',
      '--diffshub-popover-muted-fg': '#cbd5e1',
    } as CSSProperties & Record<string, string>;
    const annotationStyle = buildAnnotationThemeStyle(themeChromeStyle);

    expect(annotationStyle).toMatchObject({
      '--diffshub-annotation-bg': 'color-mix(in srgb, #f8fafc 7%, #101010)',
      '--diffshub-annotation-border':
        'color-mix(in srgb, #f8fafc 18%, #101010)',
      '--diffshub-annotation-fg': '#f8fafc',
      '--diffshub-annotation-hover-border':
        'color-mix(in srgb, #f8fafc 28%, #101010)',
      '--diffshub-annotation-shadow':
        '0 18px 44px color-mix(in srgb, #101010 72%, transparent)',
      '--diffshub-popover-muted-fg': '#cbd5e1',
    });
    expect(annotationStyle).not.toHaveProperty('backgroundColor');
    expect(annotationStyle).not.toHaveProperty('color');
    expect(annotationStyle).not.toHaveProperty('--background');
    expect(annotationStyle).not.toHaveProperty('--color-background');
    expect(annotationStyle).not.toHaveProperty('--color-border');
    expect(annotationStyle).not.toHaveProperty('--color-border-opaque');
  });
});
