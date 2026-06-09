import { describe, expect, test } from 'bun:test';

import { colorUtils, normalizeThemeColors } from '../src/color';
import type { ThemeLike } from '../src/index';
import {
  auroraX,
  ayuDark,
  catppuccin,
  slackOchin,
  vesper,
} from './__fixtures__/themes';

// Reads the resolved workbench `colors` map from a normalized theme.
function colorsOf(theme: ThemeLike): Record<string, string> {
  return normalizeThemeColors(theme).colors ?? {};
}

describe('color entry surface', () => {
  test('exposes normalizeThemeColors and the colorUtils transform bag', () => {
    expect(typeof normalizeThemeColors).toBe('function');
    expect(typeof colorUtils).toBe('object');
    for (const name of [
      'compositeOverBg',
      'contrastRatio',
      'deriveMutedFg',
      'hoverWouldEraseText',
      'isDarkSurface',
      'isFullyTransparent',
      'pickReadableForeground',
      'relativeLuminance',
      'surfacesMatch',
    ]) {
      expect(typeof colorUtils[name as keyof typeof colorUtils]).toBe(
        'function'
      );
    }
  });
});

describe('normalizeThemeColors: shape, memoization, idempotency', () => {
  test('returns the same frozen object for the same input theme', () => {
    const first = normalizeThemeColors(ayuDark);
    const second = normalizeThemeColors(ayuDark);
    expect(first).toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.colors)).toBe(true);
  });

  test('preserves the same-shape top-level fields', () => {
    const n = normalizeThemeColors(ayuDark);
    expect(n.type).toBe('dark');
    expect(n.fg).toBe('#BFBDB6');
    expect(n.bg).toBe('#0B0E14');
  });

  test('is idempotent: normalizing an already-normalized theme is a no-op', () => {
    const once = normalizeThemeColors(slackOchin);
    const twice = normalizeThemeColors(once);
    expect(twice.colors).toEqual(once.colors);
    expect(twice.fg).toBe(once.fg);
    expect(twice.bg).toBe(once.bg);
  });

  test('undefined theme.colors does not throw and yields filled base surfaces', () => {
    const c = colorsOf({ type: 'light', fg: '#111', bg: '#fff' });
    expect(c['editor.background']).toBe('#fff');
    expect(c['editor.foreground']).toBe('#111');
    expect(c['sideBar.background']).toBe('#fff');
    expect(c['sideBar.foreground']).toBe('#111');
  });
});

describe('normalizeThemeColors: surface fallback fills', () => {
  test('sideBar.background uses sideBar.background when present', () => {
    expect(colorsOf(catppuccin)['sideBar.background']).toBe('#181825');
  });

  test('sideBar.background falls through to editor.background', () => {
    const c = colorsOf({
      bg: '#000000',
      colors: { 'editor.background': '#101010' },
    });
    expect(c['sideBar.background']).toBe('#101010');
  });

  test('sideBar.background falls all the way through to theme.bg', () => {
    expect(colorsOf({ bg: '#202020', colors: {} })['sideBar.background']).toBe(
      '#202020'
    );
  });

  test('sideBar.foreground falls through editor.foreground then theme.fg', () => {
    expect(
      colorsOf({ fg: '#aaa', colors: { 'editor.foreground': '#bbb' } })[
        'sideBar.foreground'
      ]
    ).toBe('#bbb');
    expect(colorsOf({ fg: '#aaa', colors: {} })['sideBar.foreground']).toBe(
      '#aaa'
    );
  });

  test('sideBarSectionHeader.foreground falls back to the resolved sidebar fg', () => {
    expect(colorsOf(catppuccin)['sideBarSectionHeader.foreground']).toBe(
      '#CDD6F4'
    );
    const c = colorsOf({
      colors: {
        'sideBar.foreground': '#aaaaaa',
        'sideBarSectionHeader.foreground': '#ff00ff',
      },
    });
    expect(c['sideBarSectionHeader.foreground']).toBe('#ff00ff');
  });

  test('list.activeSelectionForeground falls back to the resolved sidebar fg', () => {
    expect(colorsOf(catppuccin)['list.activeSelectionForeground']).toBe(
      '#CDD6F4'
    );
    expect(colorsOf(slackOchin)['list.activeSelectionForeground']).toBe(
      '#FFFFFF'
    );
  });

  test('input.background falls back to the resolved sidebar background', () => {
    expect(colorsOf(catppuccin)['input.background']).toBe('#181825');
    const c = colorsOf({
      bg: '#000',
      colors: { 'sideBar.background': '#111', 'input.background': '#222' },
    });
    expect(c['input.background']).toBe('#222');
  });
});

describe('normalizeThemeColors: git status chains', () => {
  test('gitDecoration.* wins over later tiers', () => {
    const c = colorsOf(ayuDark);
    expect(c['gitDecoration.addedResourceForeground']).toBe('#7FD962');
    expect(c['gitDecoration.modifiedResourceForeground']).toBe('#73B8FF');
    expect(c['gitDecoration.deletedResourceForeground']).toBe('#F26D78');
  });

  test('terminal.ansi* used when gitDecoration.* absent', () => {
    const c = colorsOf({
      colors: {
        'terminal.ansiGreen': '#0f0',
        'terminal.ansiBlue': '#00f',
        'terminal.ansiRed': '#f00',
      },
    });
    expect(c['gitDecoration.addedResourceForeground']).toBe('#0f0');
    expect(c['gitDecoration.modifiedResourceForeground']).toBe('#00f');
    expect(c['gitDecoration.deletedResourceForeground']).toBe('#f00');
  });

  test('editorGutter.* tail used for a gutter-only theme (vesper)', () => {
    const c = colorsOf(vesper);
    expect(c['gitDecoration.addedResourceForeground']).toBe('#15ABA0');
    expect(c['gitDecoration.modifiedResourceForeground']).toBe('#A0A0A0');
    expect(c['gitDecoration.deletedResourceForeground']).toBe('#FF8080');
  });

  test('git keys stay absent when no source tier is present', () => {
    const c = colorsOf(auroraX);
    expect(c['gitDecoration.addedResourceForeground']).toBe('#7FD962');
    expect(c['gitDecoration.modifiedResourceForeground']).toBeUndefined();
    expect(c['gitDecoration.deletedResourceForeground']).toBeUndefined();
  });
});

describe('normalizeThemeColors: focus ring chain + repair', () => {
  test('transparent list.focusOutline falls through to focusBorder (catppuccin)', () => {
    expect(colorsOf(catppuccin)['list.focusOutline']).toBe('#B4BEFE');
  });

  test('opaque list.focusOutline is kept', () => {
    const c = colorsOf({
      colors: { 'list.focusOutline': '#FF00FF', focusBorder: '#00FF00' },
    });
    expect(c['list.focusOutline']).toBe('#FF00FF');
  });

  test('both transparent leaves list.focusOutline unresolved', () => {
    const c = colorsOf({
      colors: { 'list.focusOutline': '#00000000', focusBorder: 'transparent' },
    });
    expect(c['list.focusOutline']).toBeUndefined();
  });

  test('focusBorder alone resolves the focus ring (auroraX)', () => {
    expect(colorsOf(auroraX)['list.focusOutline']).toBe('#4C7EFF');
  });
});

describe('normalizeThemeColors: hover repair', () => {
  test('kept when valid (sits between surface and text)', () => {
    expect(colorsOf(ayuDark)['list.hoverBackground']).toBe('#1A1F29');
  });

  test('dropped when equal to the sidebar surface (case-insensitive)', () => {
    const c = colorsOf({
      type: 'dark',
      colors: {
        'sideBar.background': '#1e1e1e',
        'sideBar.foreground': '#cccccc',
        'list.hoverBackground': '#1E1E1E',
      },
    });
    expect(c['list.hoverBackground']).toBeUndefined();
  });

  test('dropped when it would erase row text (slackOchin)', () => {
    expect(colorsOf(slackOchin)['list.hoverBackground']).toBeUndefined();
  });

  test('non-hex hover (rgba) is kept (luminance check skipped)', () => {
    const c = colorsOf({
      type: 'dark',
      colors: {
        'sideBar.background': '#1e1e1e',
        'sideBar.foreground': '#cccccc',
        'list.hoverBackground': 'rgba(255, 255, 255, 0.1)',
      },
    });
    expect(c['list.hoverBackground']).toBe('rgba(255, 255, 255, 0.1)');
  });
});

describe('normalizeThemeColors: untouched passthrough (no opinion)', () => {
  test('selection keys pass through raw — the chain stays a consumer concern', () => {
    // normalizeThemeColors must NOT collapse the selection lookup or merge
    // editor.selectionBackground into list.activeSelectionBackground; trees owns
    // that opinion and needs the raw keys.
    const c = colorsOf({
      colors: {
        'sideBar.background': '#1E1E1E',
        'list.activeSelectionBackground': '#094771',
        'list.focusBackground': '#2a2d2e',
        'editor.selectionBackground': '#264f78',
      },
    });
    expect(c['list.activeSelectionBackground']).toBe('#094771');
    expect(c['list.focusBackground']).toBe('#2a2d2e');
    expect(c['editor.selectionBackground']).toBe('#264f78');
  });

  test('border/scrollbar/description keys pass through verbatim', () => {
    const c = colorsOf({
      colors: {
        'sideBar.border': '#333',
        'input.border': '#444',
        'scrollbarSlider.background': '#55555580',
        descriptionForeground: '#888',
      },
    });
    expect(c['sideBar.border']).toBe('#333');
    expect(c['input.border']).toBe('#444');
    expect(c['scrollbarSlider.background']).toBe('#55555580');
    expect(c.descriptionForeground).toBe('#888');
  });

  test('absent passthrough keys stay absent (never coerced to empty string)', () => {
    const c = colorsOf(auroraX);
    expect(c['list.hoverBackground']).toBeUndefined();
    expect(c['list.activeSelectionBackground']).toBeUndefined();
    expect(c['sideBar.border']).toBeUndefined();
    expect(c['input.border']).toBeUndefined();
    expect(c['scrollbarSlider.background']).toBeUndefined();
    expect(c.descriptionForeground).toBeUndefined();
    // Surface-derived fills still happen.
    expect(c['sideBar.background']).toBe('#15161B');
    expect(c['input.background']).toBe('#15161B');
    expect(c['sideBarSectionHeader.foreground']).toBe('#E0E0E0');
    expect(c['list.activeSelectionForeground']).toBe('#E0E0E0');
  });
});

describe('colorUtils transforms', () => {
  test('pickReadableForeground promotes to the brighter readable candidate', () => {
    // sideBar.foreground #4B526D on #0F111A is ~2.4:1 (fails 3:1); editor.foreground
    // #A6ACCD is ~8.4:1, so the contrast pass skips the dim token.
    const fg = colorUtils.pickReadableForeground('#0F111A', [
      '#4B526D',
      '#A6ACCD',
      '#fff',
    ]);
    expect(fg).toBe('#A6ACCD');
  });

  test('pickReadableForeground returns the highest-contrast candidate when none clears 3:1', () => {
    // #707070 is ~1.27:1 and #a0a0a0 is ~2.40:1 on #606060 — both below 3:1, but
    // the brighter one must win rather than the first dim candidate.
    const fg = colorUtils.pickReadableForeground('#606060', [
      '#707070',
      '#a0a0a0',
    ]);
    expect(fg).toBe('#a0a0a0');
  });

  test('deriveMutedFg blends the foreground toward the bg until it clears 4.5:1', () => {
    expect(colorUtils.deriveMutedFg('#BFBDB6', '#0B0E14')).toBe('#898885');
  });

  test('deriveMutedFg returns primaryFg when no weight step clears 4.5:1', () => {
    expect(colorUtils.deriveMutedFg('#202020', '#1e1e1e')).toBe('#202020');
  });

  test('deriveMutedFg falls back to a color-mix expression for non-hex inputs', () => {
    expect(colorUtils.deriveMutedFg('var(--fg)', '#000')).toBe(
      'color-mix(in srgb, var(--fg) 70%, #000)'
    );
  });
});
