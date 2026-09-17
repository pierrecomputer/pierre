import { expect, test } from 'bun:test';

import { codeToTokens, type Lang } from '../lib/index';
import languages from '../lib/languages';
import { samples, zonSample } from './_samples';
import {
  assertLineFedParity,
  distinctTheme,
  initFullModule,
  kindOfColor,
  tokenKinds,
} from './_util';

const additions = [
  ['batch', ['batch', 'bat', 'batchfile', 'cmd', 'dos']],
  ['elm', ['elm']],
  ['cuda', ['cuda', 'cu', 'cuh']],
  ['fortran', ['fortran', 'fortran-free-form', 'f90', 'f95', 'f03', 'f08']],
  ['fortran-fixed-form', ['fortran-fixed-form', 'f', 'for', 'f77']],
  ['solidity', ['solidity', 'sol']],
  ['zig', ['zig', 'zon']],
] as const satisfies readonly (readonly [Lang, readonly Lang[]])[];

test('plain text aliases retain ID zero and bypass language syntax', () => {
  for (const alias of ['plain', 'plaintext', 'text', 'txt'] as const) {
    expect(languages[alias]).toBe(0);
    expect(tokenKinds(alias, 'if "λ😀" /* text */ <tag>')).toEqual([
      ['if "λ😀" /* text */ <tag>', null],
    ]);
  }
});

for (const [lang, aliases] of additions) {
  test(`${lang}: aliases and Markdown fences use the same lexer`, () => {
    initFullModule();
    const code = lang === 'zig' ? zonSample : samples[lang].code;
    const expected = codeToTokens(code, { lang, theme: distinctTheme })
      .tokens.slice(0, -1)
      .map((line) =>
        line.map((token) => [token.content, kindOfColor(token.color)])
      );
    for (const alias of aliases) {
      expect(tokenKinds(alias, code)).toEqual(tokenKinds(lang, code));
      for (const markup of ['markdown', 'mdx'] as const) {
        const fence = `\`\`\`${alias}\n${code}\`\`\`\n`;
        const actual = assertLineFedParity(markup, fence)
          .slice(1, expected.length + 1)
          .map((line) =>
            line.map((token) => [token.content, kindOfColor(token.color)])
          );
        expect(actual).toEqual(expected);
      }
    }
  });
}

test('CUDA words do not change ordinary C++ highlighting', () => {
  expect(tokenKinds('cpp', '__global__ int value;')).toContainEqual([
    '__global__',
    'variable',
  ]);
});
