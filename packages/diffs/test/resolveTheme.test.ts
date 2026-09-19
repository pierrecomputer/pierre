import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import {
  disposeHighlighter,
  getHighlighterIfLoaded,
  registerCustomTheme,
  resolveTheme,
} from '../src';
import { createDiffsHighlighter } from '../src/highlighter/highlights';
import type { DiffsHighlighter } from '../src/types';

let resolver: DiffsHighlighter['themeResolver'];
beforeEach(() => {
  resolver = createDiffsHighlighter().themeResolver;
});

describe('public resolveTheme', () => {
  beforeEach(disposeHighlighter);
  afterEach(disposeHighlighter);

  test('defaults to a normalized Shiki theme', async () => {
    expect(await resolveTheme('pierre-dark')).toMatchObject({
      name: 'pierre-dark',
      type: 'dark',
      fg: '#fafafa',
      bg: '#0a0a0a',
    });
    expect(getHighlighterIfLoaded()?.name).toBe('shiki-wasm');
  });

  test.each(['highlights', 'shiki-js', 'shiki-wasm'] as const)(
    'shares resolved themes with the %s backend',
    async (preferredHighlighter) => {
      const [first, second] = await Promise.all([
        resolveTheme('pierre-dark', preferredHighlighter),
        resolveTheme('pierre-dark', preferredHighlighter),
      ]);
      const highlighter = getHighlighterIfLoaded({
        theme: 'pierre-dark',
        preferredHighlighter,
      });
      expect(highlighter?.name).toBe(preferredHighlighter);
      expect(first).toBe(second);
      expect(highlighter?.getTheme('pierre-dark')).toBe(first);
      expect(first).toMatchObject(
        preferredHighlighter === 'highlights'
          ? { appearance: 'dark', style: { 'editor.background': '#0a0a0a' } }
          : { type: 'dark', bg: '#0a0a0a' }
      );
    }
  );

  test('resolves registered custom themes and deduplicates their loader', async () => {
    const name = 'public-resolve-custom-theme';
    const loader = mock(() =>
      Promise.resolve({
        name,
        appearance: 'dark',
        style: { 'editor.background': '#123456' },
      })
    );
    registerCustomTheme(name, loader, 'zed');

    const [first, second] = await Promise.all([
      resolveTheme(name, 'highlights'),
      resolveTheme(name, 'highlights'),
    ]);
    expect(first).toMatchObject({
      name,
      style: { 'editor.background': '#123456' },
    });
    expect(first).toBe(second);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test('rejects unknown themes', async () => {
    const error = await resolveTheme('public-resolve-missing-theme').catch(
      (error: unknown) => error
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      message: 'No loader registered for theme "public-resolve-missing-theme"',
    });
  });
});

describe('resolveTheme contract', () => {
  test('resolves a bundled Highlights theme with its registry name', async () => {
    expect(await resolver.resolveTheme('pierre-dark')).toMatchObject({
      name: 'pierre-dark',
      style: {
        'editor.foreground': '#fafafa',
        'editor.background': '#0a0a0a',
      },
    });
  });

  test('caches the resolved theme for synchronous reuse', async () => {
    await resolver.resolveTheme('pierre-dark');
    expect(resolver.hasResolvedThemes(['pierre-dark'])).toBe(true);
    const [cached] = resolver.getResolvedThemes(['pierre-dark']);
    expect(cached.name).toBe('pierre-dark');
  });

  test('dedupes concurrent loads of the same theme', async () => {
    const [a, b] = await Promise.all([
      resolver.resolveTheme('pierre-light'),
      resolver.resolveTheme('pierre-light'),
    ]);
    expect(a).toBe(b);
  });

  test('resolveThemes preserves input order when mixing cold and cached themes', async () => {
    await resolver.resolveTheme('pierre-dark');

    const themes = await resolver.resolveThemes(['nord', 'pierre-dark']);

    expect(themes.map((theme) => theme.name)).toEqual(['nord', 'pierre-dark']);
  });

  test('rejects a name with no registered or bundled loader', async () => {
    let caughtErr: unknown;
    try {
      await resolver.resolveTheme('definitely-not-a-real-theme-xyz');
    } catch (err) {
      caughtErr = err;
    }
    expect(caughtErr).toBeInstanceOf(Error);
    expect((caughtErr as Error).message).toContain(
      'No loader registered for theme'
    );
  });

  test('resolver.clearResolvedThemes clears the resolved cache', async () => {
    await resolver.resolveTheme('pierre-dark');
    expect(resolver.hasResolvedThemes(['pierre-dark'])).toBe(true);
    resolver.clearResolvedThemes();
    expect(resolver.hasResolvedThemes(['pierre-dark'])).toBe(false);
  });
});
