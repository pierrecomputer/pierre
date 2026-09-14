import type { Theme } from '@pierre/highlights';
import { pierreDark } from '@pierre/highlights/themes';
import { afterEach, describe, expect, spyOn, test } from 'bun:test';

import {
  defaultHighlighter,
  disposeHighlighter,
  getHighlighterIfLoaded,
  getSharedHighlighter,
  highlighters,
  isHighlighterLoading,
  registerCustomTheme,
} from '../src/highlighter';
import { createDeferred } from './testUtils';

afterEach(async () => {
  await disposeHighlighter();
});

describe('shared highlighter cache lifecycle', () => {
  test('a duplicate custom theme leaves every backend registry unchanged', async () => {
    const shiki = await getSharedHighlighter({
      themes: [],
      preferredHighlighter: 'shiki-js',
    });
    await getSharedHighlighter({ themes: ['nord'] });
    const error = spyOn(console, 'error').mockImplementation(() => {});
    try {
      registerCustomTheme('nord', () => Promise.resolve({ name: 'nord' }));
      expect(error).toHaveBeenCalledTimes(1);
      expect(shiki.themeResolver.hasRegisteredTheme('nord')).toBe(false);
    } finally {
      error.mockRestore();
    }
  });
  test('deduplicates lazy backend creation and tracks loading state', async () => {
    const first = getSharedHighlighter({ themes: ['pierre-dark'] });
    expect(isHighlighterLoading()).toBe(true);
    expect(getHighlighterIfLoaded()).toBeUndefined();
    const second = getSharedHighlighter({ themes: ['pierre-light'] });
    expect(await first).toBe(await second);
    expect(isHighlighterLoading()).toBe(false);
  });

  test('retries a backend import after a failed load', async () => {
    const loader = highlighters[defaultHighlighter];
    const error = new Error('Backend chunk failed to load');
    highlighters[defaultHighlighter] = () => Promise.reject(error);
    try {
      const caught = await getSharedHighlighter({
        themes: ['pierre-dark'],
      }).catch((error: unknown) => error);
      expect(caught).toBe(error);
      expect(getHighlighterIfLoaded()).toBeUndefined();
    } finally {
      highlighters[defaultHighlighter] = loader;
    }
    expect((await getSharedHighlighter({ themes: ['pierre-dark'] })).name).toBe(
      defaultHighlighter
    );
  });

  test('isolates backends and checks readiness for their requested grammars', async () => {
    const highlights = await getSharedHighlighter({ themes: ['nord'] });
    expect(
      getHighlighterIfLoaded({
        theme: 'nord',
        preferredHighlighter: 'shiki-js',
      })
    ).toBeUndefined();
    const shiki = await getSharedHighlighter({
      themes: ['nord'],
      preferredHighlighter: 'shiki-js',
    });
    expect(shiki).not.toBe(highlights);
    expect(getHighlighterIfLoaded()).toBe(highlights);
    expect(
      getHighlighterIfLoaded({
        theme: 'nord',
        preferredHighlighter: 'shiki-js',
        langs: ['typescript'],
      })
    ).toBeUndefined();
    expect(
      await getSharedHighlighter({
        themes: ['nord'],
        preferredHighlighter: 'shiki-js',
        langs: ['typescript'],
      })
    ).toBe(shiki);
    expect(
      getHighlighterIfLoaded({
        theme: 'nord',
        preferredHighlighter: 'shiki-js',
        langs: ['ts'],
      })
    ).toBe(shiki);
  });

  test('returns a cached highlighter instance until disposed', async () => {
    const first = await getSharedHighlighter({
      themes: ['pierre-dark'],
    });

    const second = await getSharedHighlighter({
      themes: ['pierre-dark'],
    });

    expect(second).toBe(first);
    expect(getHighlighterIfLoaded()).toBe(first);
  });

  test('disposeHighlighter clears the cache so the next getSharedHighlighter creates a fresh instance', async () => {
    const first = await getSharedHighlighter({
      themes: ['pierre-dark'],
    });

    await disposeHighlighter();
    expect(getHighlighterIfLoaded()).toBeUndefined();

    const second = await getSharedHighlighter({
      themes: ['pierre-dark'],
    });

    expect(second).not.toBe(first);
    expect(getHighlighterIfLoaded()).toBe(second);
  });
});

test('custom module-style theme loaders retain the registered alias', async () => {
  const name = 'test-module-theme-alias';
  registerCustomTheme(name, () => Promise.resolve({ default: pierreDark }));
  const highlighter = await getSharedHighlighter({ themes: [name] });
  const theme = highlighter.getTheme(name);
  expect(theme).toMatchObject({ name, style: pierreDark.style });
  expect(
    highlighter.codeToTokens('const x = 1;', { lang: 'ts', theme }).tokens[0]
      .length
  ).toBeGreaterThan(1);
});

test('a theme request completed after disposal does not attach to the new shared instance', async () => {
  const name = 'test-stale-disposed-theme';
  const pendingTheme = createDeferred<Theme>();
  registerCustomTheme(name, () => pendingTheme.promise);
  const staleRequest = getSharedHighlighter({ themes: [name] });
  await disposeHighlighter();
  const active = await getSharedHighlighter({ themes: ['pierre-dark'] });
  pendingTheme.resolve({ ...pierreDark, name });
  const stale = await staleRequest;
  expect(stale).not.toBe(active);
  expect(stale.getTheme(name).name).toBe(name);
  expect(getHighlighterIfLoaded()).toBe(active);
  expect(getHighlighterIfLoaded({ theme: name })).toBeUndefined();
  expect(active.themeResolver.hasResolvedTheme(name)).toBe(false);
  expect(() => active.themeResolver.getResolvedThemes([name])).toThrow();
});

test('themes attached to a retained instance do not change shared-instance readiness', async () => {
  const retained = await getSharedHighlighter({ themes: ['pierre-dark'] });
  await disposeHighlighter();
  const active = await getSharedHighlighter({ themes: ['pierre-dark'] });
  retained.themeResolver.seedResolvedTheme('retained-pool-theme', {
    ...pierreDark,
    name: 'retained-pool-theme',
  });
  expect(retained.themeResolver.hasResolvedTheme('retained-pool-theme')).toBe(
    true
  );
  expect(active.themeResolver.hasResolvedTheme('retained-pool-theme')).toBe(
    false
  );
  expect(
    getHighlighterIfLoaded({ theme: 'retained-pool-theme' })
  ).toBeUndefined();
});

test('retained instances can load custom themes registered after shared disposal', async () => {
  const retained = await getSharedHighlighter({ themes: ['pierre-dark'] });
  await disposeHighlighter();
  const name = 'custom-theme-after-disposal';
  registerCustomTheme(name, () => Promise.resolve(pierreDark));

  const theme = await retained.themeResolver.resolveTheme(name);
  expect(theme.name).toBe(name);
  expect(retained.getTheme(name)).toBe(theme);
  expect(getHighlighterIfLoaded()).toBeUndefined();

  const active = await getSharedHighlighter({ themes: [name] });
  expect(active.getTheme(name)).toEqual(theme);
  expect(active.getTheme(name)).not.toBe(theme);
});
