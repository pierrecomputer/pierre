import { describe, expect, test } from 'bun:test';

import type { ThemeLike } from '../src';
import {
  createThemeResolver,
  DuplicateThemeError,
  UnregisteredThemeError,
  UnresolvedThemeError,
} from '../src';

const makeTheme = (name: string): ThemeLike => ({
  name,
  type: 'dark',
  fg: '#ffffff',
  bg: '#000000',
});

describe('createThemeResolver', () => {
  test('resolver.registerTheme duplicate throws DuplicateThemeError naming the theme', () => {
    const resolver = createThemeResolver();
    resolver.registerTheme('dup', () => Promise.resolve(makeTheme('dup')));

    expect(() => {
      resolver.registerTheme('dup', () => Promise.resolve(makeTheme('dup')));
    }).toThrow(DuplicateThemeError);

    expect(() => {
      resolver.registerTheme('dup', () => Promise.resolve(makeTheme('dup')));
    }).toThrow('"dup"');
  });

  test('resolver.resolveTheme of unregistered name rejects with UnregisteredThemeError', async () => {
    const resolver = createThemeResolver();

    let caught: unknown;
    try {
      await resolver.resolveTheme('no-such-theme');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnregisteredThemeError);
    expect((caught as Error).message).toContain('"no-such-theme"');
  });

  test('resolver.registerTheme/resolveTheme returns the loaded theme', async () => {
    const resolver = createThemeResolver();
    const theme = makeTheme('my-theme');
    resolver.registerTheme('my-theme', () => Promise.resolve(theme));

    const result = await resolver.resolveTheme('my-theme');
    expect(result).toBe(theme);
  });

  test('resolver.resolveTheme unwraps { default: theme }', async () => {
    const resolver = createThemeResolver();
    const inner = makeTheme('wrapped-theme');
    resolver.registerTheme('wrapped-theme', () =>
      Promise.resolve({ default: inner })
    );

    const result = await resolver.resolveTheme('wrapped-theme');
    expect(result).toBe(inner);
  });

  test('resolver.getResolvedTheme returns theme synchronously after resolveTheme', async () => {
    const resolver = createThemeResolver();
    const theme = makeTheme('sync-theme');
    resolver.registerTheme('sync-theme', () => Promise.resolve(theme));

    expect(resolver.getResolvedTheme('sync-theme')).toBeUndefined();
    await resolver.resolveTheme('sync-theme');
    expect(resolver.getResolvedTheme('sync-theme')).toBe(theme);
  });

  test('resolver.getResolvedOrResolveTheme returns object (not promise) when warm', async () => {
    const resolver = createThemeResolver();
    const theme = makeTheme('warm-theme');
    resolver.registerTheme('warm-theme', () => Promise.resolve(theme));

    await resolver.resolveTheme('warm-theme');

    const result = resolver.getResolvedOrResolveTheme('warm-theme');
    expect(result instanceof Promise).toBe(false);
    expect(result).toBe(theme);
  });

  test('resolver.getResolvedTheme returns undefined before resolve', () => {
    const resolver = createThemeResolver();
    resolver.registerTheme('cold-theme', () =>
      Promise.resolve(makeTheme('cold-theme'))
    );

    expect(resolver.getResolvedTheme('cold-theme')).toBeUndefined();
  });

  test('resolver.getResolvedOrResolveTheme returns a Promise before resolve', () => {
    const resolver = createThemeResolver();
    resolver.registerTheme('cold-promise-theme', () =>
      Promise.resolve(makeTheme('cold-promise-theme'))
    );

    const result = resolver.getResolvedOrResolveTheme('cold-promise-theme');
    expect(result instanceof Promise).toBe(true);
  });

  test('resolver.resolveTheme concurrent calls dedupe — loader runs exactly once', async () => {
    const resolver = createThemeResolver();
    const theme = makeTheme('deduped-theme');
    let callCount = 0;

    resolver.registerTheme('deduped-theme', () => {
      callCount++;
      return Promise.resolve(theme);
    });

    const [a, b] = await Promise.all([
      resolver.resolveTheme('deduped-theme'),
      resolver.resolveTheme('deduped-theme'),
    ]);

    expect(callCount).toBe(1);
    expect(a).toBe(theme);
    expect(b).toBe(theme);
    expect(a).toBe(b);
  });

  test('resolver.resolveTheme failing loader clears inflight so a retry can succeed', async () => {
    const resolver = createThemeResolver();
    const theme = makeTheme('retry-theme');
    let attempt = 0;

    resolver.registerTheme('retry-theme', () => {
      attempt++;
      if (attempt === 1) {
        return Promise.reject(new Error('load failed'));
      }
      return Promise.resolve(theme);
    });

    let caughtErr: unknown;
    try {
      await resolver.resolveTheme('retry-theme');
    } catch (err) {
      caughtErr = err;
    }
    expect((caughtErr as Error).message).toContain('load failed');

    // Second call should succeed because inflight was cleared.
    const result = await resolver.resolveTheme('retry-theme');
    expect(result).toBe(theme);
    expect(attempt).toBe(2);
  });

  test('resolver.clearResolvedThemes clears cache but keeps loader', async () => {
    const resolver = createThemeResolver();
    const theme = makeTheme('clearable-theme');
    let loadCount = 0;

    resolver.registerTheme('clearable-theme', () => {
      loadCount++;
      return Promise.resolve(theme);
    });

    await resolver.resolveTheme('clearable-theme');
    expect(resolver.getResolvedTheme('clearable-theme')).toBe(theme);

    resolver.clearResolvedThemes();

    // Cache is cleared.
    expect(resolver.getResolvedTheme('clearable-theme')).toBeUndefined();

    // Loader is still present — resolve works again and re-runs it.
    const result = await resolver.resolveTheme('clearable-theme');
    expect(result).toBe(theme);
    expect(loadCount).toBe(2);
  });

  test('resolver.seedResolvedTheme seeds the cache without a registered loader', async () => {
    const resolver = createThemeResolver();
    const theme = makeTheme('injected-theme');

    // Seed a pre-resolved theme directly — no loader is registered for this
    // name. This is the path a worker uses when it receives an already-resolved
    // theme object and cannot run a loader itself.
    resolver.seedResolvedTheme('injected-theme', theme);

    expect(resolver.getResolvedTheme('injected-theme')).toBe(theme);
    expect(resolver.getResolvedOrResolveTheme('injected-theme')).toBe(theme);
    expect(await resolver.resolveTheme('injected-theme')).toBe(theme);
  });

  test('resolver.seedResolvedTheme short-circuits a registered loader', async () => {
    const resolver = createThemeResolver();
    const loaded = makeTheme('precedence-theme');
    const injected = makeTheme('precedence-theme');
    let loadCount = 0;
    resolver.registerTheme('precedence-theme', () => {
      loadCount++;
      return Promise.resolve(loaded);
    });

    // A seeded theme is served from the cache, so the loader never runs.
    resolver.seedResolvedTheme('precedence-theme', injected);

    expect(await resolver.resolveTheme('precedence-theme')).toBe(injected);
    expect(loadCount).toBe(0);
  });

  test('resolver.clearResolvedThemes also clears in-flight promises', async () => {
    const resolver = createThemeResolver();
    const theme = makeTheme('inflight-clear-theme');

    let resolveLoader!: (t: ThemeLike) => void;
    const loaderPromise = new Promise<ThemeLike>((res) => {
      resolveLoader = res;
    });

    resolver.registerTheme('inflight-clear-theme', () => loaderPromise);

    // Kick off a resolve (now inflight) but don't await.
    const pendingResolve = resolver.resolveTheme('inflight-clear-theme');

    // Clear while inflight.
    resolver.clearResolvedThemes();

    // Settle the original loader — but the inflight map was cleared, so
    // the original promise will resolve but won't update the (now-cleared)
    // cache in a detached way. A NEW resolve call must succeed independently.
    resolveLoader(theme);

    // The new resolve after clear re-runs the loader (which now resolves).
    const freshResult = await resolver.resolveTheme('inflight-clear-theme');
    expect(freshResult).toBe(theme);

    // Await the detached promise so no pending microtask outlives the test.
    await pendingResolve;
  });

  test('resolver.clearResolvedThemes prevents stale in-flight resolves from reseeding cache', async () => {
    const resolver = createThemeResolver();
    const theme = makeTheme('stale-inflight-theme');

    let resolveLoader!: (t: ThemeLike) => void;
    const loaderPromise = new Promise<ThemeLike>((res) => {
      resolveLoader = res;
    });

    resolver.registerTheme('stale-inflight-theme', () => loaderPromise);

    const pendingResolve = resolver.resolveTheme('stale-inflight-theme');
    resolver.clearResolvedThemes();
    resolveLoader(theme);

    expect(await pendingResolve).toBe(theme);
    expect(resolver.getResolvedTheme('stale-inflight-theme')).toBeUndefined();
  });

  test('resolver.registerThemeIfAbsent registers once and reports whether it added a loader', async () => {
    const resolver = createThemeResolver();
    const first = makeTheme('once-theme-first');
    const second = makeTheme('once-theme-second');

    expect(resolver.hasRegisteredTheme('once-theme')).toBe(false);
    expect(
      resolver.registerThemeIfAbsent('once-theme', () => Promise.resolve(first))
    ).toBe(true);
    expect(resolver.hasRegisteredTheme('once-theme')).toBe(true);
    expect(
      resolver.registerThemeIfAbsent('once-theme', () =>
        Promise.resolve(second)
      )
    ).toBe(false);

    expect(await resolver.resolveTheme('once-theme')).toBe(first);
  });

  test('resolver.seedResolvedTheme and seedResolvedThemes warm the cache without loaders', async () => {
    const resolver = createThemeResolver();
    const first = makeTheme('seeded-one');
    const second = makeTheme('seeded-two');
    const third = makeTheme('seeded-three');

    resolver.seedResolvedTheme('seeded-one', first);
    resolver.seedResolvedThemes([
      ['seeded-two', second],
      ['seeded-three', third],
    ]);

    expect(resolver.hasResolvedTheme('seeded-one')).toBe(true);
    expect(resolver.hasResolvedThemes(['seeded-one', 'seeded-two'])).toBe(true);
    expect(resolver.hasResolvedThemes(['seeded-one', 'missing'])).toBe(false);
    expect(resolver.getResolvedThemes(['seeded-one', 'seeded-three'])).toEqual([
      first,
      third,
    ]);
    expect(await resolver.resolveTheme('seeded-two')).toBe(second);
  });

  test('resolver.getResolvedThemes throws UnresolvedThemeError for a missing cache entry', () => {
    const resolver = createThemeResolver();

    expect(() => resolver.getResolvedThemes(['missing-theme'])).toThrow(
      UnresolvedThemeError
    );
  });

  test('resolver.resolveThemes preserves order and dedupes duplicate cold names', async () => {
    const resolver = createThemeResolver();
    const first = makeTheme('batch-first');
    const second = makeTheme('batch-second');
    let firstLoadCount = 0;

    resolver.registerTheme('batch-first', () => {
      firstLoadCount++;
      return Promise.resolve(first);
    });
    resolver.registerTheme('batch-second', () => Promise.resolve(second));

    const themes = await resolver.resolveThemes([
      'batch-first',
      'batch-second',
      'batch-first',
    ]);
    expect(themes).toEqual([first, second, first]);
    expect(firstLoadCount).toBe(1);
  });
});
