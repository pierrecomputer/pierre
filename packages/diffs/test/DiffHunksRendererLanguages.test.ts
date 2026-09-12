import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import {
  DiffHunksRenderer,
  disposeHighlighter,
  getHighlighterIfLoaded,
  getSharedHighlighter,
  parseDiffFromFile,
} from '../src';
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
        await renderer.asyncRender({
          ...parseDiffFromFile(python, javascript),
          lang,
        });
        expect(
          new Set(tokenize.mock.calls.map(([, config]) => config.lang))
        ).toEqual(new Set([lang === 'unknown-language' ? 'text' : lang]));
      } finally {
        tokenize.mockRestore();
        renderer.cleanUp();
      }
    });
  }

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
