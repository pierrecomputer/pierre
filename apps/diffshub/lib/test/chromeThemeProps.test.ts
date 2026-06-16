import darkSoftTheme from '@pierre/theme/pierre-dark-soft';
import lightSoftTheme from '@pierre/theme/pierre-light-soft';
import type { ThemeLike } from '@pierre/theming';
import { describe, expect, test } from 'bun:test';
import type { CSSProperties } from 'react';

import { chromeThemeProps } from '../theme/chromeThemeProps';
import { diffshubChromeMapping } from '../theme/diffshubChromeMapping';

// Golden chrome styles captured from the pre-theming buildThemeChromeStyle for
// the two default Pierre soft themes. These are identical to the fixtures in
// apps/docs/test/themeChromeStyle.test.ts and lock that the new
// chromeThemeProps + diffshubChromeMapping pipeline is byte-for-byte identical.
const LIGHT_SOFT_CHROME: Record<string, string> = {
  backgroundColor: '#f7f7f7',
  color: '#737373',
  '--color-foreground': '#737373',
  '--foreground': '#737373',
  '--color-muted-foreground': '#737373',
  '--muted-foreground': '#737373',
  '--color-border': 'color-mix(in srgb, #737373 20%, transparent)',
  '--border': 'color-mix(in srgb, #737373 20%, transparent)',
  '--color-border-opaque': 'color-mix(in srgb, #737373 22%, #f7f7f7)',
  '--border-opaque': 'color-mix(in srgb, #737373 22%, #f7f7f7)',
  '--diffshub-card-bg': 'color-mix(in srgb, #737373 6%, #f7f7f7)',
  '--diffshub-card-hover-bg': 'color-mix(in srgb, #737373 12%, #f7f7f7)',
  '--diffshub-card-border': 'color-mix(in srgb, #737373 12%, #f7f7f7)',
  '--diffshub-popover-bg': 'color-mix(in srgb, #737373 7%, #f7f7f7)',
  '--diffshub-popover-fg': '#737373',
  '--diffshub-popover-muted-fg': '#737373',
  '--diffshub-popover-hover-bg': 'color-mix(in srgb, #737373 14%, #f7f7f7)',
  '--diffshub-popover-selected-bg': 'color-mix(in srgb, #737373 20%, #f7f7f7)',
  '--diffshub-popover-border': 'color-mix(in srgb, #737373 18%, #f7f7f7)',
  '--diffshub-popover-shadow':
    '0 8px 16px rgb(0 0 0 / 0.07), 0 2px 4px rgb(0 0 0 / 0.05)',
  '--diffshub-annotation-bg': 'color-mix(in srgb, #737373 7%, #f7f7f7)',
  '--diffshub-annotation-fg': '#737373',
  '--diffshub-annotation-border': 'color-mix(in srgb, #737373 18%, #f7f7f7)',
  '--diffshub-annotation-hover-border':
    'color-mix(in srgb, #737373 28%, #f7f7f7)',
  '--diffshub-annotation-shadow':
    '0 8px 16px rgb(0 0 0 / 0.07), 0 2px 4px rgb(0 0 0 / 0.05)',
  '--color-popover': 'color-mix(in srgb, #737373 7%, #f7f7f7)',
  '--popover': 'color-mix(in srgb, #737373 7%, #f7f7f7)',
  '--color-popover-foreground': '#737373',
  '--popover-foreground': '#737373',
  '--color-card': 'color-mix(in srgb, #737373 7%, #f7f7f7)',
  '--card': 'color-mix(in srgb, #737373 7%, #f7f7f7)',
  '--color-card-foreground': '#737373',
  '--card-foreground': '#737373',
  '--color-background': '#f7f7f7',
  '--background': '#f7f7f7',
  '--color-accent': 'color-mix(in srgb, #737373 14%, #f7f7f7)',
  '--accent': 'color-mix(in srgb, #737373 14%, #f7f7f7)',
  '--color-accent-foreground': '#737373',
  '--accent-foreground': '#737373',
  '--color-secondary': 'color-mix(in srgb, #737373 14%, #f7f7f7)',
  '--secondary': 'color-mix(in srgb, #737373 14%, #f7f7f7)',
  '--color-secondary-foreground': '#737373',
  '--secondary-foreground': '#737373',
  '--color-input': 'color-mix(in srgb, #737373 14%, #f7f7f7)',
  '--input': 'color-mix(in srgb, #737373 14%, #f7f7f7)',
  '--color-muted': 'color-mix(in srgb, #737373 14%, #f7f7f7)',
  '--muted': 'color-mix(in srgb, #737373 14%, #f7f7f7)',
  '--color-primary': '#737373',
  '--primary': '#737373',
  '--color-primary-foreground': '#f7f7f7',
  '--primary-foreground': '#f7f7f7',
  '--color-ring': '#737373',
  '--ring': '#737373',
  '--diffshub-comment-add-fg': '#047857',
  '--diffshub-comment-del-fg': '#be123c',
  '--diffshub-diff-separator': 'color-mix(in srgb, #525252 22%, #ffffff)',
  '--diffshub-scrollbar-thumb-bg': 'color-mix(in lab, #ffffff 85%, black)',
  '--diffshub-scrollbar-track-bg': '#ffffff',
};

const DARK_SOFT_CHROME: Record<string, string> = {
  backgroundColor: '#101010',
  color: '#8a8a8a',
  '--color-foreground': '#8a8a8a',
  '--foreground': '#8a8a8a',
  '--color-muted-foreground': '#7e7e7e',
  '--muted-foreground': '#7e7e7e',
  '--color-border': 'color-mix(in srgb, #8a8a8a 20%, transparent)',
  '--border': 'color-mix(in srgb, #8a8a8a 20%, transparent)',
  '--color-border-opaque': 'color-mix(in srgb, #8a8a8a 22%, #101010)',
  '--border-opaque': 'color-mix(in srgb, #8a8a8a 22%, #101010)',
  '--diffshub-card-bg': 'color-mix(in srgb, #8a8a8a 6%, #101010)',
  '--diffshub-card-hover-bg': 'color-mix(in srgb, #8a8a8a 12%, #101010)',
  '--diffshub-card-border': 'color-mix(in srgb, #8a8a8a 12%, #101010)',
  '--diffshub-popover-bg': 'color-mix(in srgb, #8a8a8a 7%, #101010)',
  '--diffshub-popover-fg': '#8a8a8a',
  '--diffshub-popover-muted-fg': '#7e7e7e',
  '--diffshub-popover-hover-bg': 'color-mix(in srgb, #8a8a8a 14%, #101010)',
  '--diffshub-popover-selected-bg': 'color-mix(in srgb, #8a8a8a 20%, #101010)',
  '--diffshub-popover-border': 'color-mix(in srgb, #8a8a8a 18%, #101010)',
  '--diffshub-popover-shadow':
    '0 8px 16px rgb(0 0 0 / 0.07), 0 2px 4px rgb(0 0 0 / 0.05)',
  '--diffshub-annotation-bg': 'color-mix(in srgb, #8a8a8a 7%, #101010)',
  '--diffshub-annotation-fg': '#8a8a8a',
  '--diffshub-annotation-border': 'color-mix(in srgb, #8a8a8a 18%, #101010)',
  '--diffshub-annotation-hover-border':
    'color-mix(in srgb, #8a8a8a 28%, #101010)',
  '--diffshub-annotation-shadow':
    '0 8px 16px rgb(0 0 0 / 0.07), 0 2px 4px rgb(0 0 0 / 0.05)',
  '--color-popover': 'color-mix(in srgb, #8a8a8a 7%, #101010)',
  '--popover': 'color-mix(in srgb, #8a8a8a 7%, #101010)',
  '--color-popover-foreground': '#8a8a8a',
  '--popover-foreground': '#8a8a8a',
  '--color-card': 'color-mix(in srgb, #8a8a8a 7%, #101010)',
  '--card': 'color-mix(in srgb, #8a8a8a 7%, #101010)',
  '--color-card-foreground': '#8a8a8a',
  '--card-foreground': '#8a8a8a',
  '--color-background': '#101010',
  '--background': '#101010',
  '--color-accent': 'color-mix(in srgb, #8a8a8a 14%, #101010)',
  '--accent': 'color-mix(in srgb, #8a8a8a 14%, #101010)',
  '--color-accent-foreground': '#8a8a8a',
  '--accent-foreground': '#8a8a8a',
  '--color-secondary': 'color-mix(in srgb, #8a8a8a 14%, #101010)',
  '--secondary': 'color-mix(in srgb, #8a8a8a 14%, #101010)',
  '--color-secondary-foreground': '#8a8a8a',
  '--secondary-foreground': '#8a8a8a',
  '--color-input': 'color-mix(in srgb, #8a8a8a 14%, #101010)',
  '--input': 'color-mix(in srgb, #8a8a8a 14%, #101010)',
  '--color-muted': 'color-mix(in srgb, #8a8a8a 14%, #101010)',
  '--muted': 'color-mix(in srgb, #8a8a8a 14%, #101010)',
  '--color-primary': '#8a8a8a',
  '--primary': '#8a8a8a',
  '--color-primary-foreground': '#101010',
  '--primary-foreground': '#101010',
  '--color-ring': '#8a8a8a',
  '--ring': '#8a8a8a',
  '--diffshub-comment-add-fg': '#34d399',
  '--diffshub-comment-del-fg': '#fb7185',
  '--diffshub-diff-separator': 'color-mix(in srgb, #8a8a8a 22%, #101010)',
  '--diffshub-scrollbar-thumb-bg': 'color-mix(in lab, #171717 80%, white)',
  '--diffshub-scrollbar-track-bg': '#171717',
};

describe('chromeThemeProps + diffshubChromeMapping', () => {
  test('matches the pre-theming chrome byte-for-byte (pierre-light-soft)', () => {
    const { style } = chromeThemeProps(
      { theme: lightSoftTheme as ThemeLike, colorScheme: 'light' },
      diffshubChromeMapping
    );
    expect(style).toEqual(LIGHT_SOFT_CHROME as CSSProperties);
  });

  test('matches the pre-theming chrome byte-for-byte (pierre-dark-soft)', () => {
    const { style } = chromeThemeProps(
      { theme: darkSoftTheme as ThemeLike, colorScheme: 'dark' },
      diffshubChromeMapping
    );
    expect(style).toEqual(DARK_SOFT_CHROME as CSSProperties);
  });

  test('returns an empty style when no theme is resolved yet', () => {
    expect(
      chromeThemeProps(
        { theme: undefined, colorScheme: 'light' },
        diffshubChromeMapping
      ).style
    ).toEqual({});
  });
});
