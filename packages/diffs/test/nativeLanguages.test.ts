import { isSupportedLanguage } from '@pierre/highlights';
import { afterEach, describe, expect, test } from 'bun:test';

import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import { toHtml } from '../src/utils/html';
import { renderFileWithHighlighter } from '../src/utils/renderFileWithHighlighter';

afterEach(disposeHighlighter);

describe('native language support', () => {
  test('highlights built-in aliases without loading grammars', async () => {
    const highlighter = await getSharedHighlighter({ themes: ['pierre-dark'] });
    for (const lang of ['tf', 'hcl', 'terraform'] as const) {
      expect(isSupportedLanguage(lang)).toBe(true);
      const result = highlighter.codeToTokens('locals { label = "example" }', {
        lang,
        theme: highlighter.getTheme('pierre-dark'),
      });
      expect(
        result.tokens
          .flat()
          .map((t) => t.content)
          .join('')
      ).toBe('locals { label = "example" }');
      expect(
        new Set(result.tokens.flat().map((t) => t.color)).size
      ).toBeGreaterThan(1);
    }
  });
  test('renders unsupported language input as escaped plain text', async () => {
    const highlighter = await getSharedHighlighter({ themes: ['pierre-dark'] });
    const result = renderFileWithHighlighter(
      {
        name: 'sample.unknown',
        lang: 'unknown-language',
        contents: '<script>&',
      },
      highlighter,
      {
        theme: 'pierre-dark',
        tokenizeMaxLineLength: 1000,
        useTokenTransformer: false,
      }
    );
    const html = toHtml(result.code);
    expect(html).toContain('&lt;script&gt;&amp;');
    expect(html).not.toContain('<script>');
  });
});
