import type { Theme } from '@pierre/highlights';
import { themes as bundledThemes } from '@pierre/highlights/themes/loader';
import { describe, expect, test } from 'bun:test';

import { createThemeResolver } from '../src';
import { highlightsThemes } from '../src/themes';

describe('highlightsThemes', () => {
  test('includes every bundled theme with matching metadata and native styling', async () => {
    const bundled = await Promise.all(
      Object.entries(bundledThemes).map(async ([name, load]) => ({
        name,
        theme: (await load()).default,
      }))
    );

    expect([...highlightsThemes.getThemeNames()].sort()).toEqual(
      bundled.map(({ name }) => name).sort()
    );
    for (const colorScheme of ['light', 'dark'] as const) {
      expect(highlightsThemes.getThemeNames({ colorScheme })).toEqual(
        bundled
          .filter(({ theme }) => theme.appearance === colorScheme)
          .map(({ name }) => name)
          .sort()
      );
    }
    for (const { name, theme } of bundled) {
      const descriptor = highlightsThemes.getTheme(name);
      expect(descriptor).toMatchObject({
        name,
        colorScheme: theme.appearance,
        collection: 'highlights',
      });
      if (descriptor == null) throw new Error(`Missing theme: ${name}`);
      expect(await descriptor.load()).toEqual({ ...theme, name });
    }
  });

  test('registers native themes into a typed resolver without loading them', async () => {
    const resolver = createThemeResolver<Theme>();
    highlightsThemes
      .pick(['pierre-light', 'pierre-dark'])
      .registerInto(resolver);

    expect(resolver.hasRegisteredTheme('pierre-light')).toBe(true);
    expect(resolver.hasResolvedTheme('pierre-light')).toBe(false);

    const theme = await resolver.resolveTheme('pierre-light');
    expect(theme.name).toBe('pierre-light');
    expect(theme.appearance).toBe('light');
    expect(theme.style.syntax).toBeDefined();
    expect(resolver.getResolvedTheme('pierre-light')).toBe(theme);
    expect(resolver.hasResolvedTheme('pierre-dark')).toBe(false);
  });
});
