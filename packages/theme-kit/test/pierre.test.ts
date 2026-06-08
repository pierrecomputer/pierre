import { describe, expect, test } from 'bun:test';

import { createThemeResolver } from '../src';
import { pierreThemes } from '../src/themes';

describe('pierreThemes', () => {
  test('returns first-party Pierre descriptors with known metadata', () => {
    expect(pierreThemes.getThemeNames()).toEqual([
      'pierre-light',
      'pierre-light-soft',
      'pierre-dark',
      'pierre-dark-soft',
    ]);
    expect(pierreThemes.getThemeNames({ colorScheme: 'light' })).toEqual([
      'pierre-light',
      'pierre-light-soft',
    ]);
    expect(pierreThemes.getThemeNames({ colorScheme: 'dark' })).toEqual([
      'pierre-dark',
      'pierre-dark-soft',
    ]);
    expect(pierreThemes.getThemes()[0]).toMatchObject({
      name: 'pierre-light',
      colorScheme: 'light',
      collection: 'pierre',
      displayName: 'Pierre Light',
    });
  });

  test('registers into a resolver with the same lazy loader behavior', async () => {
    const resolver = createThemeResolver();
    pierreThemes.registerInto(resolver);

    const theme = await resolver.resolveTheme('pierre-light');

    expect(theme.colors).toBeDefined();
    expect(Object.keys(theme.colors ?? {}).length).toBeGreaterThan(0);
    expect(theme.fg).toBeTruthy();
    expect(theme.bg).toBeTruthy();
    expect(theme.name).toBe('pierre-light');
  });

  test('each first-party descriptor resolves by its registry slug', async () => {
    for (const descriptor of pierreThemes.getThemes()) {
      const loaded = await descriptor.load();
      const theme = 'default' in loaded ? loaded.default : loaded;

      expect(theme.name).toBe(descriptor.name);
      expect(theme.colors).toBeDefined();
      expect(Object.keys(theme.colors ?? {}).length).toBeGreaterThan(0);
    }
  });
});
