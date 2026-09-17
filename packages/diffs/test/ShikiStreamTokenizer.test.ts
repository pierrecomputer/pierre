import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';
import { bundledLanguages } from 'shiki/langs';
import { bundledThemes } from 'shiki/themes';

import {
  getShikiOptions,
  ShikiStreamTokenizer,
} from '../src/highlighter/shiki';
import type { CodeToTokensOptions, ThemedToken } from '../src/types';

for (const [name, createEngine] of [
  ['shiki-wasm', () => createOnigurumaEngine(() => import('shiki/wasm'))],
  ['shiki-js', () => createJavaScriptRegexEngine({ forgiving: true })],
] as const) {
  describe(`${name} stream tokenizer`, () => {
    let highlighter: HighlighterCore;
    let options: CodeToTokensOptions;

    beforeAll(async () => {
      highlighter = await createHighlighterCore({
        engine: createEngine(),
        langs: [
          bundledLanguages.typescript,
          bundledLanguages.json,
          bundledLanguages.html,
        ],
        themes: [bundledThemes['github-dark'], bundledThemes['github-light']],
      });
      options = { lang: 'ts', theme: highlighter.getTheme('github-dark') };
    });

    afterAll(() => highlighter.dispose());

    test('emits completed lines and buffers unfinished text and CRLF', () => {
      const code = '/* open\r\nstill */ const x = "🙂";\n';
      const expected = highlighter.codeToTokens(code, getShikiOptions(options));
      const stream = new ShikiStreamTokenizer(highlighter, options);
      expect(stream.pushCode('/* open\r')).toEqual([]);
      expect(stream.pushCode('')).toEqual([]);
      expect(stream.pushCode('\nstill ')).toEqual([expected.tokens[0]]);
      expect(stream.pushCode('*/ const x = "🙂";\n')).toEqual([
        expected.tokens[1],
      ]);
      expect(stream.end()).toEqual([expected.tokens[2]]);
    });

    test('every UTF-16 split preserves empty lines, terminators, and surrogates', () => {
      for (const lang of ['ts', 'text', 'unknown-language']) {
        const streamOptions = { ...options, lang };
        for (const code of [
          '',
          '\n',
          '\r',
          '\r\n',
          '\n\n',
          'a\r\n\nb\r',
          '"é🙂"\r\n// 𝛼\n',
          '"\ud800"\n\udc00',
          'x\ud800',
        ]) {
          const expected = highlighter.codeToTokens(
            code.replace(/\r(?!\n)/g, '\n'),
            getShikiOptions(streamOptions)
          ).tokens;
          for (let at = 0; at <= code.length; at++) {
            const stream = new ShikiStreamTokenizer(highlighter, streamOptions);
            const actual = [
              ...stream.pushCode(code.slice(0, at)),
              ...stream.pushCode(''),
              ...stream.pushCode(code.slice(at)),
              ...stream.end(),
            ];
            expect(actual).toEqual(expected);
            for (const token of actual.flat()) {
              expect(
                code.slice(token.offset, token.offset + token.content.length)
              ).toBe(token.content);
            }
          }
        }
      }
    });

    test('retains multiline and embedded grammar state across small chunks', () => {
      for (const [lang, code] of [
        ['ts', '/* open\n\nstill */\rconst text = `one\ntwo`;\r\n// end\n'],
        ['json', '{\n  "key": true,\r\n  "emoji": "🙂"\n}\n'],
        [
          'html',
          '<script>\n/* open\nstill */ const x = "🙂";\n</script>\n<style>\na { color: red; }\n</style>\n',
        ],
      ]) {
        const streamOptions = { ...options, lang };
        const expected = highlighter.codeToTokens(
          code.replace(/\r(?!\n)/g, '\n'),
          getShikiOptions(streamOptions)
        ).tokens;
        for (const size of [1, 2, 7, 13]) {
          const stream = new ShikiStreamTokenizer(highlighter, streamOptions);
          const actual: ThemedToken[][] = [];
          for (let at = 0; at < code.length; at += size) {
            actual.push(...stream.pushCode(code.slice(at, at + size)));
          }
          actual.push(...stream.end());
          expect(actual).toEqual(expected);
        }
      }
    });

    test('preserves independent grammar and theme state in interleaved streams', () => {
      const leftOptions = {
        ...options,
        theme: {
          dark: highlighter.getTheme('github-dark'),
          light: highlighter.getTheme('github-light'),
        },
        defaultColor: false as const,
        cssVariablePrefix: '--stream-',
      };
      const rightOptions = {
        lang: 'json',
        theme: highlighter.getTheme('github-light'),
      };
      const leftCode = '/* open\nstill */ const x = "🙂";\n';
      const rightCode = '{\n  "key": true\n}\n';
      const left = new ShikiStreamTokenizer(highlighter, leftOptions);
      const right = new ShikiStreamTokenizer(highlighter, rightOptions);
      const leftTokens = left.pushCode('/* open\n');
      const rightTokens = right.pushCode('{\n');
      leftTokens.push(
        ...left.pushCode('still */ const x = "🙂";\n'),
        ...left.end()
      );
      rightTokens.push(...right.pushCode('  "key": true\n}\n'), ...right.end());
      expect(leftTokens).toEqual(
        highlighter.codeToTokens(leftCode, getShikiOptions(leftOptions)).tokens
      );
      expect(rightTokens).toEqual(
        highlighter.codeToTokens(rightCode, getShikiOptions(rightOptions))
          .tokens
      );
      expect(leftTokens[0][0].htmlStyle?.['--stream-dark']).toBeDefined();
      expect(leftTokens[0][0].htmlStyle?.['--stream-light']).toBeDefined();
    });

    test('preserves grammar state through skipped overlong lines', () => {
      const streamOptions = { ...options, tokenizeMaxLineLength: 12 };
      const code = '/* open\nignored */ const x = 1;\nstill */\n';
      const stream = new ShikiStreamTokenizer(highlighter, streamOptions);
      const actual = [
        ...stream.pushCode('/* open\n'),
        ...stream.pushCode('ignored */ const x = 1;\n'),
        ...stream.pushCode('still */\n'),
        ...stream.end(),
      ];
      expect(actual).toEqual(
        highlighter.codeToTokens(code, getShikiOptions(streamOptions)).tokens
      );
      expect(actual[1]).toHaveLength(1);
      expect(actual[2][0].type).toBe(1);
    });

    test('preserves custom theme font styles in both theme modes', () => {
      const styled = {
        name: 'stream-styled',
        type: 'dark' as const,
        colors: {
          'editor.foreground': '#ffffff',
          'editor.background': '#000000',
        },
        tokenColors: [
          {
            scope: 'comment',
            settings: { foreground: '#123456', fontStyle: 'italic bold' },
          },
        ],
      };
      highlighter.loadThemeSync(styled);
      for (const theme of [
        styled,
        { dark: styled, light: highlighter.getTheme('github-light') },
      ]) {
        const streamOptions = {
          ...options,
          theme,
          defaultColor: false as const,
          cssVariablePrefix: '--styled-',
        };
        const stream = new ShikiStreamTokenizer(highlighter, streamOptions);
        const code = '/* one\ntwo */\n';
        const actual = [
          ...stream.pushCode('/* one\n'),
          ...stream.pushCode('two */\n'),
          ...stream.end(),
        ];
        expect(actual).toEqual(
          highlighter.codeToTokens(code, getShikiOptions(streamOptions)).tokens
        );
        if ('name' in theme) {
          expect(actual[1][0].fontStyle).toBe(3);
        } else {
          expect(actual[1][0].htmlStyle?.['--styled-dark-font-style']).toBe(
            'italic'
          );
          expect(actual[1][0].htmlStyle?.['--styled-dark-font-weight']).toBe(
            'bold'
          );
        }
      }
    });

    test('retains ANSI colors and decorations across chunks and resets', () => {
      const code =
        '\u001b[31mred\nred again\n\u001b[1;3mstyled\r\n\u001b[39mdefault\n\u001b[0mplain\n';
      for (const theme of [
        options.theme,
        {
          dark: highlighter.getTheme('github-dark'),
          light: highlighter.getTheme('github-light'),
        },
      ]) {
        const streamOptions = { ...options, lang: 'ansi', theme };
        const expected = highlighter.codeToTokens(
          code,
          getShikiOptions(streamOptions)
        ).tokens;
        for (const size of [1, 3, 11]) {
          const stream = new ShikiStreamTokenizer(highlighter, streamOptions);
          const actual: ThemedToken[][] = [];
          for (let at = 0; at < code.length; at += size) {
            actual.push(...stream.pushCode(code.slice(at, at + size)));
          }
          actual.push(...stream.end());
          expect(actual).toEqual(expected);
        }
      }
    });

    test('only tokenizes new completed code and passes the previous grammar state', () => {
      const tokenize = spyOn(highlighter, 'codeToTokens');
      try {
        const stream = new ShikiStreamTokenizer(highlighter, options);
        expect(stream.pushCode('/* op')).toEqual([]);
        expect(stream.pushCode('en')).toEqual([]);
        expect(tokenize).not.toHaveBeenCalled();
        stream.pushCode('\n');
        stream.pushCode('still */\n');
        stream.pushCode('const x = 1;');
        stream.end();
        expect(tokenize.mock.calls.map(([code]) => code)).toEqual([
          '/* open\n',
          'still */\n',
          'const x = 1;',
        ]);
        expect(tokenize.mock.calls[0][1].grammarState).toBeUndefined();
        expect(tokenize.mock.calls[1][1].grammarState).toBeDefined();
        expect(tokenize.mock.calls[2][1].grammarState).toBeDefined();
      } finally {
        tokenize.mockRestore();
      }
    });

    test('end and dispose reject further input without disposing the shared highlighter', () => {
      const ended = new ShikiStreamTokenizer(highlighter, options);
      expect(ended.end()).toEqual([[]]);
      expect(() => ended.pushCode('')).toThrow('stream has ended');
      expect(() => ended.end()).toThrow('stream has ended');
      ended.dispose();
      const abandoned = new ShikiStreamTokenizer(highlighter, options);
      abandoned.pushCode('/* open\nbuffered');
      abandoned.dispose();
      abandoned.dispose();
      expect(() => abandoned.pushCode('next')).toThrow('stream has ended');
      expect(() => abandoned.end()).toThrow('stream has ended');
      const next = new ShikiStreamTokenizer(highlighter, options);
      const code = 'const x = 1;\n';
      expect([...next.pushCode(code), ...next.end()]).toEqual(
        highlighter.codeToTokens(code, getShikiOptions(options)).tokens
      );
    });
  });
}
