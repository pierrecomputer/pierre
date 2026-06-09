import { themeNames } from '@shikijs/themes';
import { describe, expect, test } from 'bun:test';

import { createThemeResolver } from '../src';
import type { ThemeLike } from '../src/modules/types';
import { createTheme, shikiThemes, themes } from '../src/themes';

type BundledThemeEntry = {
  name: string;
  type: 'dark' | 'light';
};

async function loadBundledThemeEntries(): Promise<BundledThemeEntry[]> {
  return Promise.all(
    themeNames.map(async (name) => {
      const themeModule = (await import(`@shikijs/themes/${name}`)) as {
        default: ThemeLike;
      };
      if (
        themeModule.default.type !== 'dark' &&
        themeModule.default.type !== 'light'
      ) {
        throw new Error(`Expected @shikijs/themes/${name} to declare a type`);
      }
      return { name, type: themeModule.default.type };
    })
  );
}

function sortNames(names: readonly string[]): string[] {
  return [...names].sort((a, b) => a.localeCompare(b));
}

describe('shikiThemes', () => {
  test('matches @shikijs/themes light and dark theme lists alphabetically', async () => {
    const bundled = await loadBundledThemeEntries();
    const expectedLightNames = sortNames(
      bundled
        .filter((theme) => theme.type === 'light')
        .map((theme) => theme.name)
    );
    const expectedDarkNames = sortNames(
      bundled
        .filter((theme) => theme.type === 'dark')
        .map((theme) => theme.name)
    );

    expect(shikiThemes.getThemeNames({ colorScheme: 'light' })).toEqual(
      expectedLightNames
    );
    expect(shikiThemes.getThemeNames({ colorScheme: 'dark' })).toEqual(
      expectedDarkNames
    );
    expect(sortNames(shikiThemes.getThemeNames())).toEqual(
      sortNames([...themeNames])
    );
  });

  test('exports every bundled Shiki theme with the matching color scheme', async () => {
    const bundled = [...themeNames].sort((a, b) => a.localeCompare(b));
    const descriptors = [...shikiThemes.getThemes()].sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    expect(descriptors.map((theme) => theme.name)).toEqual(bundled);
    for (const descriptor of descriptors) {
      const theme = (await descriptor.load()) as ThemeLike;
      expect(descriptor.colorScheme).toBe(theme.type);
    }
  });

  test('returns descriptors with names and known color schemes', () => {
    const collection = shikiThemes;

    expect(collection.getThemeNames({ colorScheme: 'light' })).toContain(
      'catppuccin-latte'
    );
    expect(collection.getThemeNames({ colorScheme: 'dark' })).toContain('nord');
    expect(collection.getThemeNames()).not.toContain('pierre-dark');
    expect(
      collection.getThemes().find((theme) => theme.name === 'nord')
    ).toMatchObject({
      name: 'nord',
      colorScheme: 'dark',
      collection: 'shiki',
    });
  });

  test('picks only the requested packaged descriptors', () => {
    const picked = shikiThemes.pick(['github-light', 'solarized-dark']);

    expect(picked.getThemeNames()).toEqual(['github-light', 'solarized-dark']);
    expect(picked.getThemeNames({ colorScheme: 'light' })).toEqual([
      'github-light',
    ]);
    expect(picked.getThemeNames({ colorScheme: 'dark' })).toEqual([
      'solarized-dark',
    ]);
  });

  test('registers packaged descriptors with normalized loaders', async () => {
    const resolver = createThemeResolver();
    shikiThemes.pick(['nord']).registerInto(resolver);

    const theme = await resolver.resolveTheme('nord');

    expect(theme.type).toBe('dark');
    expect(typeof theme.bg).toBe('string');
    expect(theme.bg).toBeTruthy();
  });
});

describe('shikiThemes descriptors', () => {
  test('returns a single packaged Shiki descriptor with known metadata', async () => {
    const descriptor = shikiThemes.getTheme('github-light');

    expect(descriptor).toMatchObject({
      name: 'github-light',
      colorScheme: 'light',
    });
    if (descriptor == null) throw new Error('Expected github-light descriptor');

    const theme = (await descriptor.load()) as ThemeLike;
    expect('default' in theme).toBe(false);
    expect(theme.type).toBe('light');
    expect(typeof theme.bg).toBe('string');
  });

  test('returns undefined for unknown names', () => {
    expect(shikiThemes.getTheme('not-real')).toBeUndefined();
  });
});

describe('themes', () => {
  test('combines Pierre first, then Shiki, preserving filtered order', () => {
    expect(themes.getThemeNames().slice(0, 6)).toEqual([
      'pierre-light',
      'pierre-light-soft',
      'pierre-dark',
      'pierre-dark-soft',
      'ayu-light',
      'catppuccin-latte',
    ]);
    expect(themes.getThemeNames({ colorScheme: 'light' }).slice(0, 4)).toEqual([
      'pierre-light',
      'pierre-light-soft',
      'ayu-light',
      'catppuccin-latte',
    ]);
    expect(themes.getThemeNames({ colorScheme: 'dark' }).slice(0, 4)).toEqual([
      'pierre-dark',
      'pierre-dark-soft',
      'andromeeda',
      'aurora-x',
    ]);
    expect(themes.getThemeNames({ collection: 'pierre' })).toEqual([
      'pierre-light',
      'pierre-light-soft',
      'pierre-dark',
      'pierre-dark-soft',
    ]);
  });

  test('supports app-level ordering from the combined collection', () => {
    const reverse = themes
      .pick(['pierre-light', 'github-light', 'solarized-dark'])
      .orderBy((a, b) => b.name.localeCompare(a.name));

    expect(reverse.getThemeNames()).toEqual([
      'solarized-dark',
      'pierre-light',
      'github-light',
    ]);
  });
});

describe('createTheme', () => {
  test('creates a custom descriptor with metadata and normalized loader', async () => {
    const descriptor = createTheme({
      name: 'custom-light',
      colorScheme: 'light',
      collection: 'acme',
      displayName: 'Custom Light',
      load: () =>
        Promise.resolve({
          name: 'custom-light',
          type: 'light' as const,
          colors: {
            'editor.foreground': '#101010',
            'editor.background': '#ffffff',
          },
        }),
    });

    expect(descriptor).toMatchObject({
      name: 'custom-light',
      colorScheme: 'light',
      collection: 'acme',
      displayName: 'Custom Light',
    });

    const theme = (await descriptor.load()) as ThemeLike;
    expect(theme.fg).toBe('#101010');
    expect(theme.bg).toBe('#ffffff');
  });
});

describe('createTheme registration', () => {
  test('normalizes a raw theme so fg/bg are derived after direct registration', async () => {
    const resolver = createThemeResolver();
    // A minimal raw VS Code-style theme: only `colors` is provided; fg/bg are
    // derived by normalizeTheme from editor.foreground/editor.background.
    const rawTheme = {
      name: 'custom',
      type: 'dark' as const,
      colors: {
        'editor.foreground': '#abcdef',
        'editor.background': '#123456',
      },
    };
    const descriptor = createTheme({
      name: 'custom',
      load: () => Promise.resolve(rawTheme),
    });
    resolver.registerTheme(descriptor.name, descriptor.load);

    const theme = await resolver.resolveTheme('custom');

    expect(theme.fg).toBe('#abcdef');
    expect(theme.bg).toBe('#123456');
    expect(theme.type).toBe('dark');
  });

  test('unwraps a { default } module-shaped loader result', async () => {
    const resolver = createThemeResolver();
    const rawTheme = {
      name: 'wrapped',
      type: 'light' as const,
      colors: {
        'editor.foreground': '#000000',
        'editor.background': '#ffffff',
      },
    };
    const descriptor = createTheme({
      name: 'wrapped',
      load: () => Promise.resolve({ default: rawTheme }),
    });
    resolver.registerTheme(descriptor.name, descriptor.load);

    const theme = await resolver.resolveTheme('wrapped');

    expect(theme.fg).toBe('#000000');
    expect(theme.bg).toBe('#ffffff');
  });
});
