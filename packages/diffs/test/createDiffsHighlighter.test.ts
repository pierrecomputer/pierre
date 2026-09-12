import { codeToTokens, type Theme } from '@pierre/highlights';
import { pierreDark, pierreLight } from '@pierre/highlights/themes';
import { expect, mock, test } from 'bun:test';

import { createDiffsHighlighter } from '../src/highlighter/createDiffsHighlighter';

test('bundling named theme loading keeps theme data in separate chunks', async () => {
  const bundle = await Bun.build({
    entrypoints: [
      new URL('../src/highlighter/createDiffsHighlighter.ts', import.meta.url)
        .pathname,
    ],
    target: 'browser',
    format: 'esm',
    splitting: true,
  });
  expect(bundle.success).toBe(true);
  const entry = bundle.outputs.find((output) => output.kind === 'entry-point');
  expect(entry).toBeDefined();
  expect(await entry?.text()).not.toContain('#2e3440');
  const chunks = bundle.outputs.filter((output) => output.kind === 'chunk');
  expect(chunks.length).toBeGreaterThan(1);
  expect(
    (await Promise.all(chunks.map((chunk) => chunk.text()))).some((chunk) =>
      chunk.includes('#2e3440')
    )
  ).toBe(true);
});

test('loads named themes on demand and retains them for synchronous rendering', async () => {
  const highlighter = createDiffsHighlighter();
  expect(highlighter.themeResolver.hasResolvedTheme('nord')).toBe(false);
  expect(() => highlighter.getTheme('nord')).toThrow('is not loaded');

  const theme = await highlighter.themeResolver.resolveTheme('nord');

  expect(theme.name).toBe('nord');
  expect(highlighter.themeResolver.hasResolvedTheme('nord')).toBe(true);
  expect(highlighter.getTheme('nord')).toBe(theme);
  expect(await highlighter.themeResolver.resolveTheme('nord')).toBe(theme);
});

test('registering themes is synchronous and does not run a named loader', async () => {
  const name = 'registered-theme-without-loading';
  const loader = mock(() => Promise.resolve(pierreLight));
  const highlighter = createDiffsHighlighter();
  highlighter.themeResolver.registerTheme(name, loader);
  const theme = { ...pierreDark, name };
  highlighter.themeResolver.seedResolvedTheme(name, theme);

  expect(await highlighter.themeResolver.resolveTheme(name)).toBe(theme);
  expect(loader).not.toHaveBeenCalled();
});

test('deduplicates within a resolver and isolates rendering contexts', async () => {
  const name = 'concurrent-lazy-theme';
  const loader = mock(() => Promise.resolve({ default: pierreDark }));
  expect(loader).not.toHaveBeenCalled();
  const first = createDiffsHighlighter();
  const second = createDiffsHighlighter();
  first.themeResolver.registerTheme(name, loader);
  second.themeResolver.registerTheme(name, () => Promise.resolve(pierreLight));

  const themes = await Promise.all([
    first.themeResolver.resolveTheme(name),
    second.themeResolver.resolveTheme(name),
    first.themeResolver.resolveTheme(name),
  ]);

  expect(loader).toHaveBeenCalledTimes(1);
  expect(themes[0]).not.toBe(themes[1]);
  expect(themes[0]).toBe(themes[2]);
  expect(themes[0].name).toBe(name);
});

test('a failed theme load can be retried', async () => {
  const name = 'retry-lazy-theme';
  const error = new Error('Theme chunk failed to load');
  const loader = mock(() => Promise.reject<Theme>(error));
  const highlighter = createDiffsHighlighter();
  highlighter.themeResolver.registerTheme(name, loader);
  let caughtError: unknown;
  try {
    await highlighter.themeResolver.resolveTheme(name);
  } catch (error) {
    caughtError = error;
  }
  expect(caughtError).toBe(error);
  expect(highlighter.themeResolver.hasResolvedTheme(name)).toBe(false);

  loader.mockImplementation(() => Promise.resolve(pierreDark));
  expect((await highlighter.themeResolver.resolveTheme(name)).name).toBe(name);
  expect(loader).toHaveBeenCalledTimes(2);
});

test('translates paired raw themes and line limits to native tokenization', () => {
  const highlighter = createDiffsHighlighter();
  const code = 'const x = 1;\nconst longLine = 1234567890;';
  const options = {
    lang: 'ts',
    defaultColor: false,
    cssVariablePrefix: '--diffs-token-',
    tokenizeMaxLineLength: 20,
  } as const;
  expect(
    highlighter.codeToTokens(code, {
      ...options,
      theme: { dark: pierreDark, light: pierreLight },
    })
  ).toEqual(
    codeToTokens(code, {
      ...options,
      themes: { dark: pierreDark, light: pierreLight },
    })
  );
});

test('rejects an incompatible raw theme at the Highlights boundary', () => {
  const highlighter = createDiffsHighlighter();
  expect(() =>
    highlighter.themeResolver.seedResolvedTheme('invalid-theme', {
      name: 'invalid-theme',
    })
  ).toThrow('is not a Highlights theme');
  expect(highlighter.themeResolver.hasResolvedTheme('invalid-theme')).toBe(
    false
  );
});
