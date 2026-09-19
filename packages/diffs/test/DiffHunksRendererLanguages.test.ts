import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import {
  DiffHunksRenderer,
  disposeHighlighter,
  getHighlighterIfLoaded,
  getSharedHighlighter,
  parseDiffFromFile,
  preloadHighlighter,
} from '../src';
import { waitFor } from './domHarness';
import { assertDefined } from './testUtils';

beforeEach(disposeHighlighter);
afterEach(disposeHighlighter);

const python = { name: 'example.py', contents: 'print("python")\n' };
const javascript = {
  name: 'example.js',
  contents: 'console.log("javascript");\n',
};
const options = { theme: 'pierre-dark', diffStyle: 'split' } as const;

describe('DiffHunksRenderer languages', () => {
  test('Terraform and its aliases highlight without loading individual grammars', async () => {
    const renderer = new DiffHunksRenderer(options);
    try {
      const diff = parseDiffFromFile(
        { name: 'example.tf', contents: 'locals {\n  label = "before"\n}\n' },
        { name: 'example.tf', contents: 'locals {\n  label = "after"\n}\n' }
      );
      expect(await renderer.asyncRender(diff)).toBeDefined();
      const highlighter = getHighlighterIfLoaded();
      assertDefined(highlighter, 'expected the highlighter to be initialized');
      for (const lang of ['terraform', 'tf', 'tfvars'] as const) {
        const { tokens } = highlighter.codeToTokens(
          'locals { label = "after" }',
          {
            lang,
            theme: highlighter.getTheme(options.theme),
          }
        );
        expect(
          new Set(tokens[0].map((token) => token.color)).size
        ).toBeGreaterThan(1);
      }
    } finally {
      renderer.cleanUp();
    }
  });

  for (const [oldFile, newFile, languages] of [
    [python, javascript, ['python', 'javascript']],
    [javascript, python, ['javascript', 'python']],
  ] as const) {
    test(`renames highlight each side using its own filename: ${oldFile.name} to ${newFile.name}`, async () => {
      const highlighter = await getSharedHighlighter({
        themes: [options.theme],
      });
      const tokenize = spyOn(highlighter, 'codeToTokens');
      const renderer = new DiffHunksRenderer(options);
      try {
        await renderer.asyncRender(parseDiffFromFile(oldFile, newFile));
        expect(tokenize.mock.calls.map(([, config]) => config.lang)).toEqual([
          ...languages,
        ]);
      } finally {
        tokenize.mockRestore();
        renderer.cleanUp();
      }
    });
  }

  for (const lang of ['json', 'text', 'unknown-language'] as const) {
    test(`explicit ${lang} overrides both filenames and unsupported languages render as text`, async () => {
      const highlighter = await getSharedHighlighter({
        themes: [options.theme],
      });
      const tokenize = spyOn(highlighter, 'codeToTokens');
      const renderer = new DiffHunksRenderer(options);
      try {
        const diff = {
          ...parseDiffFromFile(python, javascript),
          lang,
        };
        const result = await renderer.asyncRender(diff);
        expect(
          new Set(tokenize.mock.calls.map(([, config]) => config.lang))
        ).toEqual(new Set([lang]));
        if (lang === 'unknown-language') {
          const plain = await renderer.asyncRender({ ...diff, lang: 'text' });
          expect(result.deletionsContentAST).toEqual(plain.deletionsContentAST);
          expect(result.additionsContentAST).toEqual(plain.additionsContentAST);
        }
      } finally {
        tokenize.mockRestore();
        renderer.cleanUp();
      }
    });
  }

  test('renders plain text at once when only the grammar is missing', async () => {
    await preloadHighlighter({ themes: [options.theme] });
    const zig = (contents: string) => ({ name: 'example.zig', contents });
    const diff = parseDiffFromFile(
      zig('const a = 1;\n'),
      zig('const a = 2;\n')
    );
    expect(
      getHighlighterIfLoaded({ theme: options.theme, langs: ['zig'] })
    ).toBeUndefined();
    let updated = false;
    const renderer = new DiffHunksRenderer(options, undefined, () => {
      updated = true;
    });
    const cache = renderer as unknown as {
      renderCache?: { highlighted: boolean };
    };
    try {
      // Themes are ready, so the first pass paints plain text instead of
      // nothing while the grammar loads.
      expect(renderer.renderDiff(diff)).toBeDefined();
      expect(cache.renderCache?.highlighted).toBe(false);
      await waitFor(() => updated);
      expect(updated).toBe(true);
      expect(renderer.renderDiff(diff)).toBeDefined();
      expect(cache.renderCache?.highlighted).toBe(true);
    } finally {
      renderer.cleanUp();
    }
  });

  test('files above the tokenization size threshold use plain text', async () => {
    const highlighter = await getSharedHighlighter({ themes: [options.theme] });
    const tokenize = spyOn(highlighter, 'codeToTokens');
    const renderer = new DiffHunksRenderer({
      ...options,
      tokenizeMaxLength: 0,
    });
    try {
      await renderer.asyncRender(parseDiffFromFile(python, javascript));
      expect(
        new Set(tokenize.mock.calls.map(([, config]) => config.lang))
      ).toEqual(new Set(['text']));
    } finally {
      tokenize.mockRestore();
      renderer.cleanUp();
    }
  });
});
