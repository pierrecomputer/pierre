import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { bundledThemes } from 'shiki/themes';

import { getShikiAnsiTokens, getShikiOptions } from '../src/highlighter/shiki';
import type { CodeToTokensOptions, ThemedToken } from '../src/types';

describe('Shiki ANSI continuation', () => {
  let highlighter: HighlighterCore;

  beforeAll(async () => {
    highlighter = await createHighlighterCore({
      engine: createJavaScriptRegexEngine(),
      langs: [],
      themes: [bundledThemes['github-dark'], bundledThemes['github-light']],
    });
  });

  afterAll(() => highlighter.dispose());

  for (const paired of [false, true]) {
    for (const [name, lines] of [
      [
        'colors and selective resets',
        ['\x1b[31;44mred', 'still red', '\x1b[39mdefault', '\x1b[49mnormal'],
      ],
      [
        'decorations',
        [
          '\x1b[1;2;3;4;7;8;9;53mstyled',
          '',
          'continued',
          '\x1b[22;23;24;27;28;29;55mnormal',
        ],
      ],
      [
        'indexed and RGB colors',
        [
          '\x1b[38;5;123;48;2;4;8;12mcolors',
          'continued',
          '\x1b[38;2;400;-4;10;48;5;0mchanged',
          'continued',
        ],
      ],
      [
        'bright colors and full reset',
        ['\x1b[93;104mbright', 'continued', '\x1b[0mnormal', 'continued'],
      ],
      [
        'reset ordering within one sequence',
        [
          '\x1b[31;1mred',
          '\x1b[32;0;1;21mgreen bold',
          'continued',
          '\x1b[39;34;49;41mblue red',
          'continued',
        ],
      ],
      [
        'malformed escape sequences',
        [
          '\x1b[31mred',
          '\x1bx\x1b[32mignored',
          'still red',
          '\x1b[38;2;1;bad;3mno change',
          'still red',
        ],
      ],
    ] as const) {
      test(`${paired ? 'paired' : 'single'} themes preserve ${name}`, () => {
        const theme: CodeToTokensOptions['theme'] = paired
          ? {
              dark: highlighter.getTheme('github-dark'),
              light: highlighter.getTheme('github-light'),
            }
          : highlighter.getTheme('github-dark');
        const options = getShikiOptions({
          lang: 'ansi',
          theme,
          defaultColor: false,
          cssVariablePrefix: '--token-',
        });
        const expected = highlighter.codeToTokens(
          lines.join('\n'),
          options
        ).tokens;
        const actual: ThemedToken[][] = [];
        let state = '';
        let offset = 0;
        for (const line of lines) {
          const result = getShikiAnsiTokens(highlighter, line, options, state);
          for (const token of result.tokens[0]) token.offset += offset;
          actual.push(result.tokens[0]);
          state = result.state;
          offset += line.length + 1;
        }
        expect(actual).toEqual(expected);
      });
    }
  }

  test('state stays bounded and converges after redundant settings', () => {
    const options = getShikiOptions({
      lang: 'ansi',
      theme: highlighter.getTheme('github-dark'),
    });
    const first = getShikiAnsiTokens(highlighter, '\x1b[31;1;44m', options);
    const repeated = getShikiAnsiTokens(
      highlighter,
      '\x1b[44;31;1m'.repeat(1000),
      options,
      first.state
    );
    expect(repeated.state).toBe(first.state);
    expect(repeated.state.length).toBeLessThan(20);
    expect(
      getShikiAnsiTokens(highlighter, '\x1b[0m', options, first.state).state
    ).toBe('');
  });
});
