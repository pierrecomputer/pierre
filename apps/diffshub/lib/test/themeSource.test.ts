import type {
  ThemeController,
  ThemeControllerState,
  ThemeResolver,
} from '@pierre/theming';
import { describe, expect, test } from 'bun:test';

import {
  type ActiveThemeSnapshot,
  controllerSource,
  fixedSource,
} from '../theme/ThemeSource';

// A minimal resolver fake. Themes are plain objects keyed by name. `resolveTheme`
// is async (a microtask) to mirror the real lazy load; `getResolvedTheme` only
// returns a theme after it has been resolved at least once (warm cache).
function makeResolver(
  themes: Record<string, { name: string; type: 'dark' | 'light' }>
): ThemeResolver {
  const warm = new Map<string, { name: string; type: 'dark' | 'light' }>();
  return {
    getResolvedTheme(name) {
      return warm.get(name) as never;
    },
    resolveTheme(name) {
      const theme = themes[name];
      if (theme == null) return Promise.reject(new Error(`no theme ${name}`));
      warm.set(name, theme);
      return Promise.resolve(theme as never);
    },
    getResolvedOrResolveTheme(name) {
      const cached = warm.get(name);
      if (cached != null) return cached as never;
      return this.resolveTheme(name);
    },
    // Unused by the adapters; present to satisfy the interface.
    seedResolvedTheme() {},
    seedResolvedThemes() {},
    clearResolvedThemes() {},
    getResolvedThemes() {
      return [];
    },
    hasRegisteredTheme() {
      return false;
    },
    hasResolvedTheme(name) {
      return warm.has(name);
    },
    hasResolvedThemes() {
      return false;
    },
    registerTheme() {},
    registerThemeIfAbsent() {
      return false;
    },
    resolveThemes() {
      return Promise.resolve([]);
    },
  } satisfies ThemeResolver;
}

// A minimal controller fake driving only the fields the adapter reads. `set`
// mutates state and notifies subscribers, mirroring the real controller's
// new-state-object-per-change contract.
function makeController(initial: ThemeControllerState): ThemeController & {
  set(next: Partial<ThemeControllerState>): void;
} {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    resolver: makeResolver({}),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState() {
      return state;
    },
    setColorMode() {},
    setThemeNameForScheme() {},
    destroy() {},
    set(next) {
      state = { ...state, ...next };
      for (const listener of listeners) listener();
    },
  };
}

const lightTheme = { name: 'l', type: 'light' as const };
const darkTheme = { name: 'd', type: 'dark' as const };

describe('controllerSource', () => {
  test('maps controller state to a singular active theme snapshot', () => {
    const controller = makeController({
      darkThemeName: 'd',
      lightThemeName: 'l',
      mode: 'light',
      resolvedTheme: lightTheme,
      resolvedColorScheme: 'light',
    });
    const source = controllerSource(controller);
    const active: ActiveThemeSnapshot = source.getSnapshot();
    expect(active.colorScheme).toBe('light');
    expect(active.theme).toBe(lightTheme);
  });

  test('exposes the selected theme names for diffs consumers', () => {
    const controller = makeController({
      darkThemeName: 'dark-name',
      lightThemeName: 'light-name',
      mode: 'light',
      resolvedTheme: lightTheme,
      resolvedColorScheme: 'light',
    });
    const source = controllerSource(controller);
    expect(source.getThemeNameSelection()).toEqual({
      darkThemeName: 'dark-name',
      lightThemeName: 'light-name',
      colorScheme: 'light',
    });
  });

  test('notifies subscribers and reflects the new active theme', () => {
    const controller = makeController({
      darkThemeName: 'd',
      lightThemeName: 'l',
      mode: 'light',
      resolvedTheme: lightTheme,
      resolvedColorScheme: 'light',
    });
    const source = controllerSource(controller);
    let calls = 0;
    const unsubscribe = source.subscribe(() => {
      calls++;
    });
    controller.set({ resolvedTheme: darkTheme, resolvedColorScheme: 'dark' });
    expect(calls).toBe(1);
    expect(source.getSnapshot().theme).toBe(darkTheme);
    expect(source.getSnapshot().colorScheme).toBe('dark');
    unsubscribe();
    controller.set({ resolvedTheme: lightTheme, resolvedColorScheme: 'light' });
    expect(calls).toBe(1);
  });

  test('keeps the previous resolved theme until the cold one settles', () => {
    // resolvedTheme is undefined (cold) but a previous one was shown: the source
    // must not flash undefined. We model "previous shown" by starting resolved,
    // then flipping resolvedTheme to undefined as the controller would during a
    // cold swap — the source keeps the last non-undefined theme.
    const controller = makeController({
      darkThemeName: 'd',
      lightThemeName: 'l',
      mode: 'light',
      resolvedTheme: lightTheme,
      resolvedColorScheme: 'light',
    });
    const source = controllerSource(controller);
    expect(source.getSnapshot().theme).toBe(lightTheme);
    controller.set({ resolvedTheme: undefined, resolvedColorScheme: 'dark' });
    // Scheme follows immediately, but the theme object stays on the last
    // resolved value so chrome/tree don't flash the default palette.
    const mid = source.getSnapshot();
    expect(mid.colorScheme).toBe('dark');
    expect(mid.theme).toBe(lightTheme);
    controller.set({ resolvedTheme: darkTheme, resolvedColorScheme: 'dark' });
    expect(source.getSnapshot().theme).toBe(darkTheme);
  });
});

describe('fixedSource', () => {
  test('pins a resolved object mode-independently (scheme from its own type)', () => {
    const source = fixedSource(darkTheme, { resolver: makeResolver({}) });
    const active = source.getSnapshot();
    expect(active.theme).toBe(darkTheme);
    expect(active.colorScheme).toBe('dark');
  });

  test('lazily resolves a name and notifies when it settles', async () => {
    const resolver = makeResolver({ ayu: { name: 'ayu', type: 'dark' } });
    const source = fixedSource('ayu', { resolver });
    expect(source.getSnapshot().theme).toBeUndefined();
    let calls = 0;
    source.subscribe(() => {
      calls++;
    });
    // Let the resolve microtask settle.
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(source.getSnapshot().theme).toEqual({
      name: 'ayu',
      type: 'dark',
    });
    expect(source.getSnapshot().colorScheme).toBe('dark');
  });

  test('a { light, dark } pair resolves the slot matching the provider mode', () => {
    const resolver = makeResolver({});
    const source = fixedSource(
      { light: lightTheme, dark: darkTheme },
      { resolver, colorScheme: 'dark' }
    );
    const active = source.getSnapshot();
    expect(active.theme).toBe(darkTheme);
    expect(active.colorScheme).toBe('dark');
  });

  test('a named { light, dark } pair exposes both names for diffs consumers', () => {
    const resolver = makeResolver({});
    const source = fixedSource(
      { light: 'light-name', dark: 'dark-name' },
      { resolver, colorScheme: 'dark' }
    );
    expect(source.getThemeNameSelection()).toEqual({
      lightThemeName: 'light-name',
      darkThemeName: 'dark-name',
      colorScheme: 'dark',
    });
  });
});
