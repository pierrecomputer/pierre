import { test } from 'bun:test';
import assert from 'node:assert/strict';

import type { Lang, ThemedToken } from '../lib/index';
import {
  codeToHtml,
  codeToTokens,
  LiveTokenizer,
  StreamTokenizer,
} from '../lib/index';
import { zonSample } from './_samples';
import {
  assertLineFedParity,
  distinctTheme,
  initFullModule,
  loadSplitLang,
  makeRand,
  spansOf,
  textOf,
} from './_util';

const fixtures = [
  {
    lang: 'zig',
    code: zonSample,
    delimiter: '"',
    fragments: ['//', '"', '@"', '\\\\', '\\u{', '.{', '}', 'inf', 'nan'],
    open: '.{ .text = "λ😀',
  },
  {
    lang: 'batch',
    code: '@echo off\ncall :render %~dp0\necho "λ😀 %PATH% !x!" ^\n REM argument\n:render\nREM done\n',
    delimiter: '^',
    fragments: ['%', '%%~', '%~$PATH:', '!open', '^', '"', 'REM ', '::', '&'],
    open: 'echo "λ😀 %PATH%',
  },
  {
    lang: 'elm',
    code: 'import Json.Decode as D\ntext = """λ😀 \\u{1F600}\n-- still text\n"""\n{- a {- b -} c -}\nnext = True\n',
    delimiter: '"""',
    fragments: ['{-', '{-|', '-}', '"""', '"', '\\u{', '\\u{1F600}', '--', '$'],
    open: 'text = """λ😀 {-',
  },
  {
    lang: 'cuda',
    code: 'const char *s = R"tag(λ😀\n// text)tag";\n__global__ void f() {}\nf<<<1, 32>>>(p);\n',
    delimiter: ')tag"',
    fragments: [
      '/*',
      '*/',
      'R"tag(',
      ')tag"',
      '"',
      '\\',
      '<<<',
      '>>>',
      '__shared__',
    ],
    open: 'const char *s = R"tag(λ😀 /*',
  },
  {
    lang: 'fortran',
    code: 'character(*) :: s = "λ😀 &\n! comment\n  &tail"\nvalue = .5D-2\nif (.true.) print *, s\n',
    delimiter: '&',
    fragments: ['"', "'", "''", '&', '! comment', '.TRUE.', '1.d0', "Z'", '%'],
    open: 'text = "λ😀 &',
  },
  {
    lang: 'solidity',
    code: '/** λ😀\n * documentation\n */\ncontract C {\nfunction f() external { require(true); }\n}\n',
    delimiter: '*/',
    fragments: [
      '/*',
      '*/',
      '/**',
      '///',
      '"',
      '\\',
      'unicode"',
      'hex"',
      'assembly {',
    ],
    open: '/** λ😀',
  },
] satisfies {
  lang: Lang;
  code: string;
  delimiter: string;
  fragments: string[];
  open: string;
}[];

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Compare text and relative token offsets after each edit, including changes
// that propagate a string or comment state into later lines.
function assertLiveMatches(
  live: LiveTokenizer,
  code: string,
  lang: Lang,
  label: string
) {
  const lines = code.split('\n');
  const expected = codeToTokens(code, { lang, theme: distinctTheme }).tokens;
  assert.equal(live.lineCount, lines.length, label);
  let offset = 0;
  for (const [line, text] of lines.entries()) {
    assert.equal(live.getLineText(line), text, `${label}: line ${line} text`);
    assert.deepEqual(
      live.getLineTokens(line).tokens,
      expected[line].map((token) => ({
        ...token,
        offset: token.offset - offset,
      })),
      `${label}: line ${line} tokens`
    );
    offset += text.length + 1;
  }
}

for (const { lang, code, delimiter, fragments, open } of fixtures) {
  test(`${lang}: every UTF-16 stream cut preserves tokens and offsets`, () => {
    initFullModule();
    for (const input of [code, code.replaceAll('\n', '\r\n')]) {
      const options = { lang, theme: distinctTheme };
      const expected = codeToTokens(input, options).tokens;
      for (let cut = 0; cut <= input.length; cut++) {
        const stream = new StreamTokenizer(options);
        const actual = [
          ...stream.pushCode(input.slice(0, cut)),
          ...stream.pushCode(''),
          ...stream.pushCode(input.slice(cut)),
          ...stream.end(),
        ];
        assert.deepEqual(
          actual,
          expected,
          `${lang}: cut ${cut} of ${JSON.stringify(input)}`
        );
      }
      const stream = new StreamTokenizer(options);
      const actual: ThemedToken[][] = [];
      for (let index = 0; index < input.length; index++) {
        actual.push(...stream.pushCode(input[index]));
      }
      actual.push(...stream.end());
      assert.deepEqual(actual, expected, `${lang}: single UTF-16 units`);
    }
  });

  test(`${lang}: every byte scan boundary preserves Unicode and HTML specials`, () => {
    const split = loadSplitLang(lang);
    for (const input of [code, `${open}<>&\0`, ...fragments]) {
      const length = encoder.encode(input).length;
      for (let cut = 0; cut <= length; cut++) {
        const html = split(input, cut);
        assert.equal(
          textOf(html),
          input,
          `${lang}: byte ${cut} of ${JSON.stringify(input)}`
        );
        spansOf(html);
      }
    }
  });

  test(`${lang}: truncated constructs preserve text and leave no pooled state`, () => {
    initFullModule();
    const options = { lang, theme: distinctTheme };
    const pristine = codeToTokens(code, options).tokens;
    const bytes = encoder.encode(`${open}<>&\0😀`);
    for (let end = 0; end <= bytes.length; end++) {
      const input = bytes.subarray(0, end);
      const normalized = decoder.decode(input);
      const html = decoder.decode(codeToHtml(input, options));
      assert.equal(textOf(html), normalized, `${lang}: EOF byte ${end}`);
      spansOf(html);
      const tokens = codeToTokens(input, options).tokens;
      assert.equal(
        tokens
          .map((line) => line.map((token) => token.content).join(''))
          .join('\n'),
        normalized
      );
      const stream = new StreamTokenizer(options);
      stream.pushCode(normalized);
      stream.end();
      assert.deepEqual(
        codeToTokens(code, options).tokens,
        pristine,
        `${lang}: state after byte ${end}`
      );
    }
  });

  test(`${lang}: delimiter removal and restoration retokenize later lines`, () => {
    initFullModule();
    const live = new LiveTokenizer({ lang, theme: distinctTheme, code });
    let mirror = code;
    const start = code.lastIndexOf(delimiter);
    assert.ok(start >= 0);
    const before = code.slice(0, start).split('\n');
    const position = {
      line: before.length - 1,
      character: before.at(-1)!.length,
    };
    try {
      assertLiveMatches(live, mirror, lang, 'initial');
      for (const text of ['', delimiter]) {
        const length = text === '' ? delimiter.length : 0;
        live.applyEdits([
          {
            range: {
              start: position,
              end: { ...position, character: position.character + length },
            },
            newText: text,
          },
        ]);
        mirror = mirror.slice(0, start) + text + mirror.slice(start + length);
        assertLiveMatches(
          live,
          mirror,
          lang,
          text === '' ? 'remove delimiter' : 'restore delimiter'
        );
      }
      live.reset(open);
      assertLiveMatches(live, open, lang, 'reset to unterminated construct');
      live.reset(code);
      assertLiveMatches(live, code, lang, 'reset to original');
    } finally {
      live.dispose();
    }
  });

  test(`${lang}: seeded syntax edits match fresh tokenization after every edit`, () => {
    initFullModule();
    const live = new LiveTokenizer({ lang, theme: distinctTheme, code });
    const random = makeRand(0x715f + lang.length);
    let mirror = code;
    try {
      for (let round = 0; round < 40; round++) {
        // Pick code-point boundaries so the mirror never contains lone surrogates.
        const offsets = [0];
        for (const char of mirror) offsets.push(offsets.at(-1)! + char.length);
        const index = random() % offsets.length;
        const start = offsets[index];
        const end =
          offsets[Math.min(offsets.length - 1, index + (random() % 4))];
        const from = mirror.slice(0, start).split('\n');
        const to = mirror.slice(0, end).split('\n');
        const choices = ['', '\n', 'λ😀', ...fragments];
        const text = choices[random() % choices.length];
        live.applyEdits([
          {
            range: {
              start: { line: from.length - 1, character: from.at(-1)!.length },
              end: { line: to.length - 1, character: to.at(-1)!.length },
            },
            newText: text,
          },
        ]);
        mirror = mirror.slice(0, start) + text + mirror.slice(end);
        assertLiveMatches(
          live,
          mirror,
          lang,
          `edit ${round}: ${JSON.stringify(mirror)}`
        );
      }
    } finally {
      live.dispose();
    }
  });

  test(`${lang}: unterminated fenced constructs do not leak into later Markdown`, () => {
    const suffix = '\n# Heading\n\n```ts\nconst ready = true;\n```\n';
    for (const markup of ['markdown', 'mdx'] as const) {
      const prefix = `\`\`\`${lang}\n${open}\n\`\`\`\n`;
      const actual = assertLineFedParity(markup, prefix + suffix).slice(
        prefix.split('\n').length - 1
      );
      const expected = assertLineFedParity(markup, suffix);
      assert.deepEqual(
        actual.map((line) =>
          line.map((token) => ({
            ...token,
            offset: token.offset - prefix.length,
          }))
        ),
        expected,
        `${markup}: state after ${lang} fence`
      );
    }
  });
}
