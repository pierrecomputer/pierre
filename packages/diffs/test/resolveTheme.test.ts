import { beforeEach, describe, expect, test } from 'bun:test';

import { createDiffsHighlighter } from '../src/highlighter/createDiffsHighlighter';
import { getHighlightsTheme } from '../src/highlighter/getHighlightsTheme';
import type { DiffsHighlighter } from '../src/types';

let resolver: DiffsHighlighter['themeResolver'];
beforeEach(() => {
  resolver = createDiffsHighlighter().themeResolver;
});

describe('resolveTheme contract', () => {
  test('resolves a bundled Highlights theme with its registry name', async () => {
    const theme = getHighlightsTheme(
      await resolver.resolveTheme('pierre-dark')
    );
    expect(theme.name).toBe('pierre-dark');
    expect(theme.style['editor.foreground']).toBe('#fafafa');
    expect(theme.style['editor.background']).toBe('#0a0a0a');
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
