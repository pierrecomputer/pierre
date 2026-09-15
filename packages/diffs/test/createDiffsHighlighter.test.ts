import { codeToTokens, type Theme } from '@pierre/highlights';
import { pierreDark, pierreLight } from '@pierre/highlights/themes';
import { expect, mock, test } from 'bun:test';

import { TextDocument } from '../src/editor/textDocument';
import { createDiffsHighlighter } from '../src/highlighter/highlights';

test.each([
  'pierre-dark-protanopia-deuteranopia',
  'pierre-dark-vibrant',
  'pierre-light-protanopia-deuteranopia',
  'pierre-light-vibrant',
])('loads and renders the bundled %s theme', async (name) => {
  const highlighter = createDiffsHighlighter();
  const theme = (await highlighter.themeResolver.resolveTheme(name)) as Theme;
  expect(theme.name).toBe(name);
  expect(highlighter.getTheme(name)).toBe(theme);
  const result = highlighter.codeToTokens('const value = "hello";', {
    lang: 'ts',
    theme,
  });
  expect(result.fg).toBe(theme.style['editor.foreground']);
  expect(result.bg).toBe(theme.style['editor.background']);
  const stringStyle = theme.style.syntax?.string;
  const stringColor =
    typeof stringStyle === 'string' ? stringStyle : stringStyle?.color;
  expect(stringColor).toBeDefined();
  expect(
    result.tokens.flat().find((token) => token.content.includes('hello'))?.color
  ).toBe(stringColor);
});

test('bundling named theme loading keeps theme data in separate chunks', async () => {
  const bundle = await Bun.build({
    entrypoints: [
      new URL('../src/highlighter/highlights.ts', import.meta.url).pathname,
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

test('streamed mixed line endings preserve tokens and offsets at every chunk boundary', () => {
  const highlighter = createDiffsHighlighter();
  const options = { lang: 'ts', theme: pierreDark } as const;
  const code = '/* first\rsecond */\r\nconst value = "🙂";\nlast\r';
  const expected = codeToTokens(
    code.replace(/\r(?!\n)/g, '\n'),
    options
  ).tokens;
  expect(highlighter.codeToTokens(code, options).tokens).toEqual(expected);
  for (let split = 0; split <= code.length; split++) {
    const stream = highlighter.createStreamTokenizer(options);
    try {
      expect([
        ...stream.pushCode(code.slice(0, split)),
        ...stream.pushCode(''),
        ...stream.pushCode(code.slice(split)),
        ...stream.end(),
      ]).toEqual(expected);
    } finally {
      stream.dispose();
    }
  }
});

test.each([
  { name: 'remove CR', edits: [{ start: 12, end: 13, text: '' }] },
  { name: 'remove LF', edits: [{ start: 13, end: 14, text: '' }] },
  { name: 'split CRLF', edits: [{ start: 13, end: 13, text: '/*' }] },
  {
    name: 'split and join CRLF',
    edits: [
      { start: 13, end: 13, text: '/*' },
      { start: 40, end: 40, text: '\n' },
    ],
  },
])('live tokens follow raw edits that $name', ({ edits }) => {
  const highlighter = createDiffsHighlighter();
  const document = new TextDocument(
    'example.ts',
    'const a = 1;\r\nconst b = 2;\nconst c = 3;\rconst d = 4;'
  );
  const options = { lang: 'ts', theme: pierreDark } as const;
  const tokenizer = highlighter.createLiveTokenizer({
    ...options,
    textDocument: document,
  });
  try {
    for (const action of ['edit', 'undo', 'redo']) {
      const change =
        action === 'edit'
          ? document.applyResolvedEdits([...edits])!
          : action === 'undo'
            ? document.undo()![0]
            : document.redo()![0];
      tokenizer.tokenize(change);
      const expected = codeToTokens(
        document.getText().replace(/\r(?!\n)/g, '\n'),
        options
      ).tokens;
      let offset = 0;
      for (let line = 0; line < document.lineCount; line++) {
        expect(tokenizer.getLineTokens(line).tokens).toEqual(
          expected[line].map((token) => ({
            ...token,
            offset: token.offset - offset,
          }))
        );
        offset += document.getLineText(line, true).length;
      }
      expect(() => tokenizer.getLineTokens(document.lineCount)).toThrow();
    }
  } finally {
    tokenizer.dispose();
  }
});
