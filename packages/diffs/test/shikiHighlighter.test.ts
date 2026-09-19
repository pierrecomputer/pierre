import { beforeAll, describe, expect, test } from 'bun:test';

import { createDiffsHighlighter as createJavaScriptHighlighter } from '../src/highlighter/shiki-js';
import { createDiffsHighlighter as createWasmHighlighter } from '../src/highlighter/shiki-wasm';
import type { DiffsHighlighter } from '../src/types';

for (const [name, createHighlighter] of [
  ['shiki-wasm', createWasmHighlighter],
  ['shiki-js', createJavaScriptHighlighter],
] as const) {
  describe(name, () => {
    let highlighter: DiffsHighlighter;

    beforeAll(async () => {
      highlighter = await createHighlighter();
      await highlighter.themeResolver.resolveThemes([
        'pierre-dark',
        'pierre-light',
        'github-dark',
      ]);
    });

    test('loads requested grammars and aliases while unknown languages stay plain', async () => {
      expect(highlighter.name).toBe(name);
      expect(highlighter.hasLoadedLanguages?.(['typescript'])).toBe(false);
      expect(
        highlighter.hasLoadedLanguages?.(['text', 'unknown-language'])
      ).toBe(true);
      await Promise.all([
        highlighter.loadLanguages?.(['typescript']),
        highlighter.loadLanguages?.(['typescript', 'unknown-language']),
      ]);
      expect(highlighter.hasLoadedLanguages?.(['typescript', 'ts'])).toBe(true);
      expect(highlighter.hasLoadedLanguages?.(['python'])).toBe(false);
    });

    test('preserves token text, UTF-16 offsets, and editor token types', () => {
      const code = 'const greeting = "👋";\r\n// comment';
      const { tokens } = highlighter.codeToTokens(code, {
        lang: 'ts',
        theme: highlighter.getTheme('github-dark'),
      });
      expect(
        tokens.map((line) => line.map((token) => token.content).join(''))
      ).toEqual(code.split('\r\n'));
      for (const token of tokens.flat()) {
        expect(
          code.slice(token.offset, token.offset + token.content.length)
        ).toBe(token.content);
      }
      expect(tokens[0].some((token) => token.type === 2)).toBe(true);
      expect(tokens[1].every((token) => token.type === 1)).toBe(true);
      expect(
        new Set(tokens[0].map((token) => token.color)).size
      ).toBeGreaterThan(1);
    });

    test('renders dual Pierre themes using the requested CSS variable prefix', () => {
      const { tokens, rootStyle } = highlighter.codeToTokens(
        'const answer = 42;',
        {
          lang: 'typescript',
          theme: {
            dark: highlighter.getTheme('pierre-dark'),
            light: highlighter.getTheme('pierre-light'),
          },
          defaultColor: false,
          cssVariablePrefix: '--diffs-',
        }
      );
      expect(rootStyle).toContain('--diffs-dark:');
      expect(rootStyle).toContain('--diffs-light-bg:');
      expect(
        tokens[0].every(
          (token) =>
            token.htmlStyle?.['--diffs-dark'] !== undefined &&
            token.htmlStyle?.['--diffs-light'] !== undefined
        )
      ).toBe(true);
    });

    test('uses plain tokens for unknown languages and overlong lines', () => {
      const code = 'const answer = 42;';
      for (const options of [
        { lang: 'unknown-language' },
        { lang: 'ts', tokenizeMaxLineLength: 5 },
      ]) {
        const { tokens } = highlighter.codeToTokens(code, {
          ...options,
          theme: highlighter.getTheme('pierre-dark'),
        });
        expect(tokens[0]).toHaveLength(1);
        expect(tokens[0][0].content).toBe(code);
      }
    });

    test('normalizes registered and seeded themes under their registry names', async () => {
      const theme = {
        name: 'original-name',
        type: 'dark' as const,
        colors: {
          'editor.foreground': '#abcdef',
          'editor.background': '#123456',
        },
        tokenColors: [
          {
            scope: ['keyword', 'storage'],
            settings: { foreground: '#ff0000' },
          },
        ],
      };
      highlighter.themeResolver.registerTheme('custom-theme', () =>
        Promise.resolve({
          default: theme,
        })
      );
      const registered =
        await highlighter.themeResolver.resolveTheme('custom-theme');
      highlighter.themeResolver.seedResolvedTheme('worker-theme', registered);
      for (const themeName of ['custom-theme', 'worker-theme']) {
        const resolved = highlighter.getTheme(themeName);
        expect(resolved.name).toBe(themeName);
        expect(
          highlighter.codeToTokens('const value = 1;', {
            lang: 'ts',
            theme: resolved,
          }).tokens[0][0].color
        ).toBe('#FF0000');
      }
      expect(() =>
        highlighter.themeResolver.seedResolvedTheme('invalid', {
          name: 'invalid',
          ...{ appearance: 'dark', style: {} },
        })
      ).toThrow('not a Shiki theme');
    });
  });
}
