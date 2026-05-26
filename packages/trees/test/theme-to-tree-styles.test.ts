import { describe, expect, test } from 'bun:test';

import { themeToTreeStyles } from '../src/utils/themeToTreeStyles';

const HOVER_KEY = '--trees-theme-list-hover-bg';

describe('themeToTreeStyles list.hoverBackground heuristic', () => {
  test('drops a near-foreground hover bg that would erase row text', () => {
    // slack-ochin's actual values: list.hoverBackground is designed for
    // the (white) editor surface, but the sidebar has a dark navy bg
    // with light gray text. The hover ends up the same luminance as the
    // text and would make hovered rows unreadable.
    const styles = themeToTreeStyles({
      type: 'light',
      colors: {
        'sideBar.background': '#2D3E4C',
        'sideBar.foreground': '#DCDEDF',
        'list.hoverBackground': '#d5e1ea',
      },
    });
    // Falls back to the computed default. The fallback picks the dark
    // variant because sideBar.background is dark, even though slack-ochin
    // declares type: 'light' for its editor palette.
    expect(styles[HOVER_KEY]).toBe('rgba(255,255,255,0.08)');
  });

  test('keeps a hover bg that sits between surface and text', () => {
    // Typical case: hover is a small offset from sideBar.background and
    // far from sideBar.foreground — should pass through unchanged.
    const styles = themeToTreeStyles({
      type: 'light',
      colors: {
        'sideBar.background': '#ffffff',
        'sideBar.foreground': '#333333',
        'list.hoverBackground': '#e8e8e8',
      },
    });
    expect(styles[HOVER_KEY]).toBe('#e8e8e8');
  });

  test('picks the dark hover fallback when the sidebar bg is dark but theme.type is light', () => {
    // slack-ochin pattern condensed: theme.type='light' but
    // sideBar.background is dark navy. The fallback must read sidebar
    // luminance instead of theme.type or a black-on-dark overlay
    // becomes invisible.
    const styles = themeToTreeStyles({
      type: 'light',
      colors: {
        'sideBar.background': '#2D3E4C',
        'sideBar.foreground': '#DCDEDF',
      },
    });
    expect(styles[HOVER_KEY]).toBe('rgba(255,255,255,0.08)');
  });

  test('still drops hover bg that equals the surface', () => {
    const styles = themeToTreeStyles({
      type: 'dark',
      colors: {
        'sideBar.background': '#1e1e1e',
        'sideBar.foreground': '#cccccc',
        'list.hoverBackground': '#1E1E1E',
      },
    });
    expect(styles[HOVER_KEY]).toBe('rgba(255,255,255,0.08)');
  });

  test('preserves non-hex hover bg (unknown format — trust the theme)', () => {
    // The luminance check only runs on parseable hex; rgba/transparent/
    // named colors pass through so we don't accidentally reject themes
    // that use modern color syntax.
    const styles = themeToTreeStyles({
      type: 'dark',
      colors: {
        'sideBar.background': '#1e1e1e',
        'sideBar.foreground': '#cccccc',
        'list.hoverBackground': 'rgba(255, 255, 255, 0.1)',
      },
    });
    expect(styles[HOVER_KEY]).toBe('rgba(255, 255, 255, 0.1)');
  });
});
