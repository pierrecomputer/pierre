import { describe, expect, test } from 'bun:test';

import {
  createThemeCatalog,
  createThemeCollection,
  type ThemeCatalog,
  type ThemeCollection,
  type ThemeDescriptor,
} from '../src';
import type { ThemeLike } from '../src';
import { createThemeResolver } from '../src';

function theme(type: ThemeLike['type']): ThemeLike {
  return {
    type,
    fg: type === 'light' ? '#111111' : '#eeeeee',
    bg: type === 'light' ? '#ffffff' : '#111111',
    colors: {},
  };
}

describe('createThemeCatalog', () => {
  test('keeps defaults and filters names by color scheme', () => {
    const catalog = createThemeCatalog({
      themes: [
        {
          name: 'acme-light',
          colorScheme: 'light',
          collection: 'acme',
          load: () => Promise.resolve(theme('light')),
        },
        {
          name: 'acme-dark',
          colorScheme: 'dark',
          collection: 'acme',
          load: () => Promise.resolve(theme('dark')),
        },
        {
          name: 'acme-neutral',
          collection: 'other',
          load: () => Promise.resolve(theme('dark')),
        },
      ],
      defaultLightThemeName: 'acme-light',
      defaultDarkThemeName: 'acme-dark',
    });

    expect(catalog.defaultLightThemeName).toBe('acme-light');
    expect(catalog.defaultDarkThemeName).toBe('acme-dark');
    expect(catalog.getThemeNames()).toEqual([
      'acme-light',
      'acme-dark',
      'acme-neutral',
    ]);
    expect(catalog.getThemeNames({ colorScheme: 'light' })).toEqual([
      'acme-light',
    ]);
    expect(catalog.getThemeNames({ colorScheme: 'dark' })).toEqual([
      'acme-dark',
    ]);
    expect(
      catalog.getThemes({ colorScheme: 'light' }).map((t) => t.name)
    ).toEqual(['acme-light']);
    expect(catalog.getThemeNames({ collection: 'acme' })).toEqual([
      'acme-light',
      'acme-dark',
    ]);
    expect(
      catalog
        .getThemes({ collection: 'acme', colorScheme: 'dark' })
        .map((t) => t.name)
    ).toEqual(['acme-dark']);
  });

  test('flattens nested catalogs while preserving descriptor order', () => {
    const base = createThemeCatalog({
      themes: [
        {
          name: 'base-light',
          colorScheme: 'light',
          displayName: 'Base Light',
          load: () => Promise.resolve(theme('light')),
        },
      ],
      defaultLightThemeName: 'base-light',
      defaultDarkThemeName: 'base-light',
    });
    const catalog = createThemeCatalog({
      themes: [
        base,
        {
          name: 'app-dark',
          colorScheme: 'dark',
          load: () => Promise.resolve(theme('dark')),
        },
      ],
      defaultLightThemeName: 'base-light',
      defaultDarkThemeName: 'app-dark',
    });

    expect(catalog.getThemes().map((descriptor) => descriptor.name)).toEqual([
      'base-light',
      'app-dark',
    ]);
  });

  test('accepts one collection directly as the catalog input', () => {
    const collection = createThemeCollection({
      themes: [
        {
          name: 'single-light',
          colorScheme: 'light',
          load: () => Promise.resolve(theme('light')),
        },
        {
          name: 'single-dark',
          colorScheme: 'dark',
          load: () => Promise.resolve(theme('dark')),
        },
      ],
    });

    const catalog = createThemeCatalog({
      themes: collection,
      defaultLightThemeName: 'single-light',
      defaultDarkThemeName: 'single-dark',
    });

    expect(catalog.getThemeNames()).toEqual(['single-light', 'single-dark']);
  });

  test('composes larger collections from smaller collections', () => {
    const baseThemes = createThemeCollection({
      themes: [
        {
          name: 'base-light',
          colorScheme: 'light',
          collection: 'base',
          load: () => Promise.resolve(theme('light')),
        },
      ],
    });
    const appThemes = createThemeCollection({
      themes: [
        {
          name: 'app-dark',
          colorScheme: 'dark',
          collection: 'app',
          load: () => Promise.resolve(theme('dark')),
        },
      ],
    });

    const combined = createThemeCollection({
      themes: [baseThemes, appThemes],
    });

    expect(combined.getThemeNames()).toEqual(['base-light', 'app-dark']);
    expect(combined.getThemeNames({ collection: 'base' })).toEqual([
      'base-light',
    ]);
    expect(combined.getThemeNames({ collection: 'app' })).toEqual(['app-dark']);
  });

  test('fails fast when descriptors have duplicate names', () => {
    expect(() =>
      createThemeCatalog({
        themes: [
          {
            name: 'duplicate',
            load: () => Promise.resolve(theme('light')),
          },
          {
            name: 'duplicate',
            load: () => Promise.resolve(theme('dark')),
          },
        ],
        defaultLightThemeName: 'duplicate',
        defaultDarkThemeName: 'duplicate',
      })
    ).toThrow('Theme collection already contains theme "duplicate"');
  });

  test('fails fast when defaults are not in the catalog', () => {
    expect(() =>
      createThemeCatalog({
        themes: [
          {
            name: 'only-theme',
            load: () => Promise.resolve(theme('light')),
          },
        ],
        defaultLightThemeName: 'missing-light',
        defaultDarkThemeName: 'only-theme',
      })
    ).toThrow('Default light theme "missing-light" is not in the catalog');

    expect(() =>
      createThemeCatalog({
        themes: [
          {
            name: 'only-theme',
            load: () => Promise.resolve(theme('dark')),
          },
        ],
        defaultLightThemeName: 'only-theme',
        defaultDarkThemeName: 'missing-dark',
      })
    ).toThrow('Default dark theme "missing-dark" is not in the catalog');
  });

  test('registers descriptors into a resolver idempotently', async () => {
    const first = theme('light');
    let loadCount = 0;
    const catalog = createThemeCatalog({
      themes: [
        {
          name: 'registered-light',
          load: () => {
            loadCount++;
            return Promise.resolve(first);
          },
        },
      ],
      defaultLightThemeName: 'registered-light',
      defaultDarkThemeName: 'registered-light',
    });
    const resolver = createThemeResolver();

    catalog.registerInto(resolver);
    catalog.registerInto(resolver);

    expect(resolver.hasRegisteredTheme('registered-light')).toBe(true);
    expect(await resolver.resolveTheme('registered-light')).toBe(first);
    expect(loadCount).toBe(1);
  });

  test('uses registerThemeIfAbsent so existing resolver entries win', async () => {
    const catalogTheme = theme('light');
    const existingTheme = theme('dark');
    const catalog = createThemeCatalog({
      themes: [
        {
          name: 'already-present',
          load: () => Promise.resolve(catalogTheme),
        },
      ],
      defaultLightThemeName: 'already-present',
      defaultDarkThemeName: 'already-present',
    });
    const resolver = createThemeResolver();
    resolver.registerTheme('already-present', () =>
      Promise.resolve(existingTheme)
    );

    catalog.registerInto(resolver);

    expect(await resolver.resolveTheme('already-present')).toBe(existingTheme);
  });
});

describe('createThemeCollection', () => {
  test('picks named subsets without loading themes', () => {
    let loadCount = 0;
    const collection = createThemeCollection({
      themes: [
        {
          name: 'light-a',
          colorScheme: 'light',
          load: () => {
            loadCount++;
            return Promise.resolve(theme('light'));
          },
        },
        {
          name: 'dark-a',
          colorScheme: 'dark',
          load: () => {
            loadCount++;
            return Promise.resolve(theme('dark'));
          },
        },
      ],
    });

    const picked = collection.pick(['dark-a']);

    expect(loadCount).toBe(0);
    expect(picked.getThemeNames()).toEqual(['dark-a']);
    expect(picked.getThemeNames({ colorScheme: 'dark' })).toEqual(['dark-a']);
    expect(picked.getTheme('dark-a')).toBe(collection.getTheme('dark-a'));
  });

  test('pick preserves caller order and orderBy returns a reordered collection', () => {
    const collection = createThemeCollection({
      themes: [
        {
          name: 'zeta',
          load: () => Promise.resolve(theme('dark')),
        },
        {
          name: 'alpha',
          load: () => Promise.resolve(theme('light')),
        },
        {
          name: 'middle',
          load: () => Promise.resolve(theme('dark')),
        },
      ],
    });

    expect(collection.pick(['middle', 'zeta']).getThemeNames()).toEqual([
      'middle',
      'zeta',
    ]);
    expect(
      collection.orderBy((a, b) => a.name.localeCompare(b.name)).getThemeNames()
    ).toEqual(['alpha', 'middle', 'zeta']);
    expect(collection.getThemeNames()).toEqual(['zeta', 'alpha', 'middle']);
  });

  test('fails when picking unknown or duplicate names', () => {
    const collection = createThemeCollection({
      themes: [
        {
          name: 'known',
          load: () => Promise.resolve(theme('light')),
        },
      ],
    });

    expect(() => collection.pick(['missing'])).toThrow(
      'Theme collection does not contain theme "missing"'
    );
    expect(() => collection.pick(['known', 'known'])).toThrow(
      'Theme collection pick already includes theme "known"'
    );
  });
});

test('catalog types support custom ThemeLike extensions', () => {
  interface CustomTheme extends ThemeLike {
    custom: true;
  }

  const descriptor = {
    name: 'custom',
    load: () =>
      Promise.resolve({
        ...theme('dark'),
        custom: true,
      }),
  } satisfies ThemeDescriptor<CustomTheme>;
  const catalog: ThemeCatalog<CustomTheme> = createThemeCatalog({
    themes: [descriptor],
    defaultLightThemeName: 'custom',
    defaultDarkThemeName: 'custom',
  });
  const collection: ThemeCollection<CustomTheme> = createThemeCollection({
    themes: [descriptor],
  });

  expect(catalog.getThemes()[0]).toBe(descriptor);
  expect(collection.getTheme('custom')).toBe(descriptor);
});
