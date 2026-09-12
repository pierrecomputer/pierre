import type { Theme } from '@pierre/highlights';
import { pierreDark } from '@pierre/highlights/themes';
import { afterEach, describe, expect, test } from 'bun:test';

import { getHighlightsTheme } from '../src/highlighter/getHighlightsTheme';
import {
  disposeHighlighter,
  getHighlighterIfLoaded,
  getSharedHighlighter,
  registerCustomTheme,
} from '../src/highlighter/shared_highlighter';
import { createDeferred } from './testUtils';

afterEach(async () => {
  await disposeHighlighter();
});

describe('shared highlighter cache lifecycle', () => {
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
  const theme = getHighlightsTheme(highlighter.getTheme(name));
  expect(theme.name).toBe(name);
  expect(theme.style).toEqual(pierreDark.style);
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
