import { afterEach, describe, expect, test } from 'bun:test';
import { bundledLanguages } from 'shiki';

import { disposeHighlighter, getSharedHighlighter } from '../src';
import { HighlightsOnlyLanguages } from '../src/highlighter/languages/constants';
import { preloadDiffHTML, preloadFile } from '../src/ssr';
import {
  EXTENSION_TO_FILE_FORMAT,
  getFiletypeFromFileName,
} from '../src/utils/getFiletypeFromFileName';

afterEach(async () => {
  await disposeHighlighter();
});

describe('Highlights-only languages', () => {
  test('every detected language has a Shiki grammar or a plain-text fallback', () => {
    const missing = Object.values(EXTENSION_TO_FILE_FORMAT).filter(
      (lang) =>
        lang != null &&
        !Object.hasOwn(bundledLanguages, lang) &&
        !HighlightsOnlyLanguages.has(lang)
    );
    expect(missing).toEqual([]);
  });

  test('Shiki renders a Silk file as plain text', async () => {
    expect(getFiletypeFromFileName('src/main.silk')).toBe('silk');
    const highlighter = await getSharedHighlighter({
      preferredHighlighter: 'shiki-js',
      themes: ['pierre-dark'],
      langs: ['silk'],
    });
    expect(highlighter.hasLoadedLanguages(['silk'])).toBe(true);
    const { tokens } = highlighter.codeToTokens('let x = 1\nfn main() {}', {
      lang: 'silk',
      theme: 'pierre-dark',
    });
    expect(tokens.map((line) => line.map((token) => token.content))).toEqual([
      ['let x = 1'],
      ['fn main() {}'],
    ]);
  });

  test('preloading Silk files with the default Shiki backend succeeds', async () => {
    const { prerenderedHTML } = await preloadFile({
      file: { name: 'main.silk', contents: 'let answer = 42\n' },
      options: { theme: 'pierre-dark' },
    });
    expect(prerenderedHTML).toContain('let answer = 42');

    const diffHTML = await preloadDiffHTML({
      oldFile: { name: 'main.silk', contents: 'let answer = 41\n' },
      newFile: { name: 'main.silk', contents: 'let answer = 42\n' },
      options: { theme: 'pierre-dark' },
    });
    expect(diffHTML).toContain('main.silk');
    expect(diffHTML).toContain('let answer = ');
  });
});
