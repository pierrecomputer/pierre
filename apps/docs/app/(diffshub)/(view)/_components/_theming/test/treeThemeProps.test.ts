import type { ThemeLike } from '@pierre/theme-kit';
import { themeToTreeStyles } from '@pierre/trees';
import { describe, expect, test } from 'bun:test';

import { deriveChromeTokens } from '../js/deriveChromeTokens';
import { treeThemeProps } from '../js/treeThemeProps';

// A theme with a deliberately dim sideBar.foreground on a dark sidebar, so the
// contrast-based pick in deriveChromeTokens upgrades the tree foreground. This
// is the exact scenario the reference buildResolvedTheme guards.
const DIM_FG_THEME: ThemeLike = {
  name: 'dim-fg',
  type: 'dark',
  colors: {
    'editor.background': '#101010',
    'editor.foreground': '#e0e0e0',
    'sideBar.background': '#101010',
    'sideBar.foreground': '#222222',
  },
};

// Reproduces the reference buildResolvedTheme fg-upgrade so the test asserts
// exact parity rather than a hand-written golden.
function referenceUpgradedTreeStyles(theme: ThemeLike): Record<string, string> {
  const c = theme.colors ?? {};
  const primaryFg = deriveChromeTokens(theme)?.fg;
  const treeStyles = themeToTreeStyles(theme);
  if (
    primaryFg != null &&
    primaryFg !== c['sideBar.foreground'] &&
    primaryFg !== ''
  ) {
    treeStyles.color = primaryFg;
    treeStyles['--trees-theme-sidebar-fg'] = primaryFg;
    if (c['sideBarSectionHeader.foreground'] == null) {
      treeStyles['--trees-theme-sidebar-header-fg'] = primaryFg;
    }
    if (c['list.activeSelectionForeground'] == null) {
      treeStyles['--trees-theme-list-active-selection-fg'] = primaryFg;
    }
    if (
      c['list.focusOutline'] == null &&
      c['focusBorder'] == null &&
      c['sideBar.foreground'] == null
    ) {
      treeStyles['--trees-theme-focus-ring'] = primaryFg;
    }
  }
  return treeStyles;
}

describe('treeThemeProps', () => {
  test('without reconcileForegroundFromChrome, returns raw themeToTreeStyles', () => {
    const { style } = treeThemeProps({
      theme: DIM_FG_THEME,
      colorScheme: 'dark',
    });
    expect(style).toEqual(themeToTreeStyles(DIM_FG_THEME));
  });

  test('with reconcileForegroundFromChrome, matches reference fg-upgrade', () => {
    const { style } = treeThemeProps(
      { theme: DIM_FG_THEME, colorScheme: 'dark' },
      { reconcileForegroundFromChrome: true }
    );
    expect(style).toEqual(referenceUpgradedTreeStyles(DIM_FG_THEME));
  });

  test('returns an empty style when no theme is resolved yet', () => {
    expect(
      treeThemeProps({ theme: undefined, colorScheme: 'light' }).style
    ).toEqual({});
  });
});
