import { afterEach, describe, expect, test } from 'bun:test';

import {
  createThemeCatalog,
  createThemeController,
  createThemeResolver,
  type ThemeLike,
} from '../src';

// A dark-ish and a light-ish theme with enough color keys to drive a full
// active-theme resolution.
const DARK: ThemeLike = {
  name: 'test-dark',
  type: 'dark',
  fg: '#ffffff',
  bg: '#000000',
  colors: {
    'editor.background': '#000000',
    'editor.foreground': '#ffffff',
  },
};
const LIGHT: ThemeLike = {
  name: 'test-light',
  type: 'light',
  fg: '#000000',
  bg: '#ffffff',
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#000000',
  },
};

function makeResolver() {
  const resolver = createThemeResolver();
  resolver.registerTheme('test-dark', () => Promise.resolve(DARK));
  resolver.registerTheme('test-light', () => Promise.resolve(LIGHT));
  return resolver;
}

function makeCatalog() {
  return createThemeCatalog({
    themes: [
      {
        name: 'catalog-light',
        colorScheme: 'light',
        load: () => Promise.resolve({ ...LIGHT, name: 'catalog-light' }),
      },
      {
        name: 'catalog-dark',
        colorScheme: 'dark',
        load: () => Promise.resolve({ ...DARK, name: 'catalog-dark' }),
      },
    ],
    defaultLightThemeName: 'catalog-light',
    defaultDarkThemeName: 'catalog-dark',
  });
}

// Wait a microtask turn so the controller's async resolveTheme settles.
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

afterEach(() => {
  // Clean any stubbed browser globals between tests.
  Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('createThemeController', () => {
  test('registers catalog loaders without an external resolver', async () => {
    const controller = createThemeController({
      catalog: makeCatalog(),
      defaultMode: 'dark',
    });

    expect(controller.getState().lightThemeName).toBe('catalog-light');
    expect(controller.getState().darkThemeName).toBe('catalog-dark');
    expect(controller.resolver.hasRegisteredTheme('catalog-light')).toBe(true);
    expect(controller.resolver.hasRegisteredTheme('catalog-dark')).toBe(true);

    await tick();
    expect(controller.getState().resolvedTheme?.name).toBe('catalog-dark');
  });

  test('uses an isolated resolver for catalog-only controllers', async () => {
    const catalog = createThemeCatalog({
      themes: [
        {
          name: 'isolated-light',
          colorScheme: 'light',
          load: () => Promise.resolve({ ...LIGHT, name: 'isolated-light' }),
        },
      ],
      defaultLightThemeName: 'isolated-light',
      defaultDarkThemeName: 'isolated-light',
    });

    const controller = createThemeController({
      catalog,
      defaultMode: 'light',
    });

    await tick();
    expect(controller.getState().resolvedTheme?.name).toBe('isolated-light');
    expect(controller.resolver.hasRegisteredTheme('isolated-light')).toBe(true);

    const unrelatedResolver = createThemeResolver();
    expect(unrelatedResolver.hasRegisteredTheme('isolated-light')).toBe(false);
  });

  test('registers catalog loaders into a supplied resolver before initial resolution', async () => {
    const resolver = createThemeResolver();
    const controller = createThemeController({
      catalog: makeCatalog(),
      resolver,
      defaultMode: 'light',
    });

    expect(controller.resolver).toBe(resolver);
    expect(resolver.hasRegisteredTheme('catalog-light')).toBe(true);
    expect(resolver.hasRegisteredTheme('catalog-dark')).toBe(true);

    await tick();
    expect(controller.getState().resolvedTheme?.name).toBe('catalog-light');
  });

  test('exposes initial selection and resolves the active theme', async () => {
    const controller = createThemeController({
      resolver: makeResolver(),
      defaultMode: 'dark',
      defaultLightThemeName: 'test-light',
      defaultDarkThemeName: 'test-dark',
    });

    const initial = controller.getState();
    expect(initial.mode).toBe('dark');
    expect(initial.lightThemeName).toBe('test-light');
    expect(initial.darkThemeName).toBe('test-dark');

    await tick();
    expect(controller.getState().resolvedTheme?.name).toBe('test-dark');
  });

  test('notifies subscribers when the active theme resolves', async () => {
    const controller = createThemeController({
      resolver: makeResolver(),
      defaultMode: 'light',
      defaultLightThemeName: 'test-light',
      defaultDarkThemeName: 'test-dark',
    });

    let notifications = 0;
    const unsubscribe = controller.subscribe(() => {
      notifications++;
    });

    await tick();
    expect(notifications).toBeGreaterThan(0);
    expect(controller.getState().resolvedTheme?.name).toBe('test-light');

    unsubscribe();
    const before = notifications;
    controller.setColorMode('dark');
    await tick();
    expect(notifications).toBe(before);
  });

  test('setColorMode switches the active theme', async () => {
    const controller = createThemeController({
      resolver: makeResolver(),
      defaultMode: 'light',
      defaultLightThemeName: 'test-light',
      defaultDarkThemeName: 'test-dark',
    });
    await tick();
    expect(controller.getState().resolvedTheme?.name).toBe('test-light');

    controller.setColorMode('dark');
    await tick();
    expect(controller.getState().mode).toBe('dark');
    expect(controller.getState().resolvedTheme?.name).toBe('test-dark');
  });

  test('setThemeNameForScheme on the active slot re-resolves', async () => {
    const resolver = makeResolver();
    resolver.registerTheme('test-dark-2', () =>
      Promise.resolve({ ...DARK, name: 'test-dark-2' })
    );
    const controller = createThemeController({
      resolver,
      defaultMode: 'dark',
      defaultLightThemeName: 'test-light',
      defaultDarkThemeName: 'test-dark',
    });
    await tick();
    expect(controller.getState().resolvedTheme?.name).toBe('test-dark');

    controller.setThemeNameForScheme('dark', 'test-dark-2');
    await tick();
    expect(controller.getState().darkThemeName).toBe('test-dark-2');
    expect(controller.getState().resolvedTheme?.name).toBe('test-dark-2');
  });

  test('setThemeNameForScheme keeps the active selection when resolution fails', async () => {
    const resolver = makeResolver();
    const error = new Error('failed to load theme');
    resolver.registerTheme('broken-dark', () => Promise.reject(error));
    const savedSelections: unknown[] = [];
    const reportedErrors: unknown[] = [];
    const controller = createThemeController({
      resolver,
      persistence: {
        load: () => null,
        save: (selection) => {
          savedSelections.push(selection);
        },
      },
      onResolutionError: (resolutionError, context) => {
        reportedErrors.push({ resolutionError, context });
      },
      defaultMode: 'dark',
      defaultLightThemeName: 'test-light',
      defaultDarkThemeName: 'test-dark',
    });
    await tick();
    expect(controller.getState().resolvedTheme?.name).toBe('test-dark');

    controller.setThemeNameForScheme('dark', 'broken-dark');
    await tick();

    expect(controller.getState().darkThemeName).toBe('test-dark');
    expect(controller.getState().resolvedTheme?.name).toBe('test-dark');
    expect(controller.getState().pendingThemeResolution).toBeUndefined();
    expect(controller.getState().resolutionError).toEqual({
      colorScheme: 'dark',
      error,
      name: 'broken-dark',
    });
    expect(savedSelections).toEqual([]);
    expect(reportedErrors).toEqual([
      {
        resolutionError: error,
        context: { colorScheme: 'dark', name: 'broken-dark' },
      },
    ]);
  });

  test('setColorMode keeps the active mode when the next theme fails', async () => {
    const resolver = createThemeResolver();
    const error = new Error('failed to load light theme');
    resolver.registerTheme('test-dark', () => Promise.resolve(DARK));
    resolver.registerTheme('broken-light', () => Promise.reject(error));
    const reportedErrors: unknown[] = [];
    const controller = createThemeController({
      resolver,
      onResolutionError: (resolutionError, context) => {
        reportedErrors.push({ resolutionError, context });
      },
      defaultMode: 'dark',
      defaultLightThemeName: 'broken-light',
      defaultDarkThemeName: 'test-dark',
    });
    await tick();
    expect(controller.getState().mode).toBe('dark');
    expect(controller.getState().resolvedTheme?.name).toBe('test-dark');

    controller.setColorMode('light');
    await tick();

    expect(controller.getState().mode).toBe('dark');
    expect(controller.getState().resolvedColorScheme).toBe('dark');
    expect(controller.getState().resolvedTheme?.name).toBe('test-dark');
    expect(controller.getState().resolutionError).toEqual({
      colorScheme: 'light',
      error,
      name: 'broken-light',
    });
    expect(reportedErrors).toEqual([
      {
        resolutionError: error,
        context: { colorScheme: 'light', name: 'broken-light' },
      },
    ]);
  });

  test('logs active theme resolution failures by default', async () => {
    const resolver = makeResolver();
    const error = new Error('failed to load theme');
    resolver.registerTheme('broken-dark', () => Promise.reject(error));
    const originalConsoleError = console.error;
    const loggedErrors: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      loggedErrors.push(args);
    };
    try {
      const controller = createThemeController({
        resolver,
        defaultMode: 'dark',
        defaultLightThemeName: 'test-light',
        defaultDarkThemeName: 'test-dark',
      });
      await tick();

      controller.setThemeNameForScheme('dark', 'broken-dark');
      await tick();

      expect(loggedErrors).toHaveLength(1);
      expect(loggedErrors[0]?.[0]).toBe(
        '[theming] Failed to resolve theme "broken-dark" for dark color scheme'
      );
      expect(loggedErrors[0]?.[1]).toBe(error);
    } finally {
      console.error = originalConsoleError;
    }
  });

  test('persists selection to storage and rehydrates', async () => {
    const store = new Map<string, string>();
    const mockStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    Object.assign(globalThis, { localStorage: mockStorage });

    const first = createThemeController({
      resolver: makeResolver(),
      storageKey: 'theming-test',
      defaultMode: 'light',
      defaultLightThemeName: 'test-light',
      defaultDarkThemeName: 'test-dark',
    });
    first.setColorMode('dark');
    first.setThemeNameForScheme('dark', 'test-dark');
    await tick();

    // A fresh controller with the same storageKey rehydrates the selection.
    const second = createThemeController({
      resolver: makeResolver(),
      storageKey: 'theming-test',
      defaultMode: 'light',
      defaultLightThemeName: 'test-light',
      defaultDarkThemeName: 'test-dark',
    });
    expect(second.getState().mode).toBe('dark');
  });

  test('preloadInactive resolves both themes', async () => {
    const resolver = makeResolver();
    createThemeController({
      resolver,
      defaultMode: 'dark',
      defaultLightThemeName: 'test-light',
      defaultDarkThemeName: 'test-dark',
      preloadInactive: true,
    });
    await tick();
    // Both the active (dark) and inactive (light) themes are cached.
    expect(resolver.getResolvedTheme('test-dark')).toBeDefined();
    expect(resolver.getResolvedTheme('test-light')).toBeDefined();
  });

  test('exposes resolvedColorScheme as the concrete light/dark for the mode', async () => {
    const controller = createThemeController({
      resolver: makeResolver(),
      defaultMode: 'dark',
      defaultLightThemeName: 'test-light',
      defaultDarkThemeName: 'test-dark',
    });
    expect(controller.getState().resolvedColorScheme).toBe('dark');
    controller.setColorMode('light');
    await tick();
    expect(controller.getState().resolvedColorScheme).toBe('light');
  });

  test('resolvedColorScheme follows the OS preference in system mode', () => {
    // Stub matchMedia to report a dark OS preference.
    const mql = {
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    Object.assign(globalThis, { matchMedia: () => mql });
    try {
      const controller = createThemeController({
        resolver: makeResolver(),
        defaultMode: 'system',
        defaultLightThemeName: 'test-light',
        defaultDarkThemeName: 'test-dark',
      });
      expect(controller.getState().resolvedColorScheme).toBe('dark');
    } finally {
      Reflect.deleteProperty(globalThis, 'matchMedia');
    }
  });

  test('uses a custom persistence adapter for load and save', async () => {
    const store: { sel?: unknown } = {};
    const persistence = {
      load: () => (store.sel ?? null) as never,
      save: (s: unknown) => {
        store.sel = s;
      },
    };
    const first = createThemeController({
      resolver: makeResolver(),
      persistence,
      defaultMode: 'light',
      defaultLightThemeName: 'test-light',
      defaultDarkThemeName: 'test-dark',
    });
    first.setColorMode('dark');
    first.setThemeNameForScheme('dark', 'test-dark');
    await tick();
    expect(store.sel).toEqual({
      mode: 'dark',
      lightThemeName: 'test-light',
      darkThemeName: 'test-dark',
    });

    // A fresh controller with the same adapter rehydrates the selection.
    const second = createThemeController({
      resolver: makeResolver(),
      persistence,
      defaultMode: 'light',
      defaultLightThemeName: 'test-light',
      defaultDarkThemeName: 'test-dark',
    });
    expect(second.getState().mode).toBe('dark');
  });
});
