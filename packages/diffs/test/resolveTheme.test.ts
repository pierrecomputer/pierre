import { afterEach, describe, expect, test } from 'bun:test';

import { cleanUpResolvedThemes } from '../src/highlighter/themes/cleanUpResolvedThemes';
import { getResolvedThemes } from '../src/highlighter/themes/getResolvedThemes';
import { hasResolvedThemes } from '../src/highlighter/themes/hasResolvedThemes';
import { resolveTheme } from '../src/highlighter/themes/resolveTheme';
import { resolveThemes } from '../src/highlighter/themes/resolveThemes';
import { customThemes } from '../src/highlighter/themes/themeResolver';
import type { DiffsTheme } from '../src/highlighter/themes/types';

afterEach(() => {
  cleanUpResolvedThemes();
});

describe('resolveTheme contract', () => {
  test('resolves a registered pierre theme to a normalized theme', async () => {
    const theme = await resolveTheme('pierre-dark');
    // normalizeTheme derives fg/bg from the colors map (the raw bundle leaves
    // them undefined), and the registry slug is preserved as the name.
    expect(theme.name).toBe('pierre-dark');
    expect(theme.fg).toBe('#fafafa');
    expect(theme.bg).toBe('#0a0a0a');
  });

  test('caches the resolved theme for synchronous reuse', async () => {
    await resolveTheme('pierre-dark');
    expect(hasResolvedThemes(['pierre-dark'])).toBe(true);
    const [cached] = getResolvedThemes(['pierre-dark']);
    expect(cached.name).toBe('pierre-dark');
  });

  test('dedupes concurrent loads of the same theme', async () => {
    const [a, b] = await Promise.all([
      resolveTheme('pierre-light'),
      resolveTheme('pierre-light'),
    ]);
    expect(a).toBe(b);
  });

  test('resolveThemes preserves input order when mixing cold and cached themes', async () => {
    await resolveTheme('pierre-dark');

    const themes = await resolveThemes(['nord', 'pierre-dark']);

    expect(themes.map((theme) => theme.name)).toEqual(['nord', 'pierre-dark']);
  });

  test('rejects a name with no registered or bundled loader', async () => {
    let caughtErr: unknown;
    try {
      await resolveTheme('definitely-not-a-real-theme-xyz');
    } catch (err) {
      caughtErr = err;
    }
    expect(caughtErr).toBeInstanceOf(Error);
    expect((caughtErr as Error).message).toContain(
      'No valid theme loader registered'
    );
  });

  test('cleanUpResolvedThemes clears the resolved cache', async () => {
    await resolveTheme('pierre-dark');
    expect(hasResolvedThemes(['pierre-dark'])).toBe(true);
    cleanUpResolvedThemes();
    expect(hasResolvedThemes(['pierre-dark'])).toBe(false);
  });
});

describe('backend theme resolution', () => {
  test('portable factory themes can attach directly without registration', async () => {
    const { createHighlighter } =
      await import('../src/highlighter/shared_highlighter');
    const { attachResolvedThemes } =
      await import('../src/highlighter/themes/attachResolvedThemes');
    const { createCSSVariablesTheme } =
      await import('../src/highlighter/themes/createCSSVariablesTheme');
    const theme = createCSSVariablesTheme({
      name: 'direct-css-theme',
      variableDefaults: { 'token-keyword': '#c084fc' },
    });
    for (const preferredHighlighter of ['shiki-js', 'highlights'] as const) {
      const highlighter = await createHighlighter({ preferredHighlighter });
      try {
        attachResolvedThemes(theme, highlighter);
        await highlighter.loadLanguages?.(['javascript']);
        const { tokens } = highlighter.codeToTokens('const value = 1;', {
          lang: 'javascript',
          theme: theme.name,
        });
        expect(
          tokens.flat().find((token) => token.content.includes('const'))?.color
        ).toBe('var(--diffs-token-keyword, #c084fc)');
      } finally {
        highlighter.dispose();
      }
    }
  });

  test('preserves shared colors and both palettes in a default-exported Diffs theme', async () => {
    const { normalizeTheme } = await import('shiki/core');
    const { registerCustomTheme } =
      await import('../src/highlighter/themes/registerCustomTheme');
    const name = 'backend-specific-theme';
    const portable: DiffsTheme = {
      name,
      type: 'dark',
      fg: '#ddeeff',
      bg: '#001122',
      colors: {
        'editor.foreground': '#ddeeff',
        'editor.background': '#001122',
        'editor.selectionBackground': '#abcdef',
        'editorCursor.foreground': '#fedcba',
      },
      textmate: normalizeTheme({
        name,
        type: 'light',
        colors: {
          'editor.foreground': '#112233',
          'editor.background': '#ffffff',
        },
        tokenColors: [],
      }),
      zed: {
        name,
        appearance: 'dark',
        style: { text: '#ddeeff', background: '#001122', created: '#00ff00' },
      },
    };
    registerCustomTheme(
      name,
      () => Promise.resolve({ default: portable }),
      'diffs'
    );
    try {
      for (const backend of ['shiki-js', 'shiki-wasm', 'highlights'] as const) {
        const theme = await resolveTheme(name, backend);
        expect(theme.type).toBe(portable.type);
        expect(theme.fg).toBe(portable.fg);
        expect(theme.bg).toBe(portable.bg);
        expect(theme.colors).toEqual(portable.colors);
        expect(theme.textmate).toEqual(portable.textmate);
        expect(theme.zed).toEqual(portable.zed);
      }
    } finally {
      customThemes.delete(name);
    }
  });

  test('resolves bundled Highlights themes without a TextMate palette', async () => {
    const theme = await resolveTheme('pierre-dark', 'highlights');
    expect(theme.fg).toBe('#fafafa');
    expect(theme.bg).toBe('#0a0a0a');
    expect(theme.zed).toBeDefined();
    expect(theme.textmate).toBeUndefined();
  });

  test('portable CSS themes preserve palette names and defaults on both backends', async () => {
    const { registerCustomCSSVariableTheme } =
      await import('../src/highlighter/themes/registerCustomCSSVariableTheme');
    const { getSharedHighlighter } =
      await import('../src/highlighter/shared_highlighter');
    const name = 'portable-css-theme';
    registerCustomCSSVariableTheme(name, {
      'token-keyword': '#ff0000',
      foreground: '#111111',
    });
    for (const preferredHighlighter of ['shiki-js', 'highlights'] as const) {
      const highlighter = await getSharedHighlighter({
        themes: [name],
        langs: ['javascript'],
        preferredHighlighter,
      });
      const result = highlighter.codeToTokens('const answer = 42;', {
        lang: 'javascript',
        theme: name,
      });
      expect(
        result.tokens.flat().find((token) => token.content.includes('const'))
          ?.color
      ).toBe('var(--diffs-token-keyword, #ff0000)');
      expect(result.fg).toBe('var(--diffs-foreground, #111111)');
      expect(
        highlighter.codeToHtml('const answer = 42;', {
          lang: 'javascript',
          theme: name,
        })
      ).toContain('var(--diffs-token-keyword, #ff0000)');
    }
  });

  test('rejects TextMate-only custom themes on Highlights with an actionable error', async () => {
    const { registerCustomTheme } =
      await import('../src/highlighter/themes/registerCustomTheme');
    registerCustomTheme('textmate-only-test', () =>
      Promise.resolve({
        name: 'textmate-only-test',
        type: 'dark',
        tokenColors: [],
      })
    );
    expect(resolveTheme('textmate-only-test', 'highlights')).rejects.toThrow(
      'registerCustomTheme'
    );
  });
});
