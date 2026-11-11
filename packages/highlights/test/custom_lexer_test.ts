import {
  codeToHtml,
  codeToTokens,
  createHighlighter,
  type Language,
  registerLanguages,
} from '@pierre/highlights';
import c from '@pierre/highlights/langs/c';
import markdown from '@pierre/highlights/langs/markdown';
import { cssVariables } from '@pierre/highlights/themes';
import { buildHighlightsLexer } from '@pierre/wat-tools';
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { HighlightsHighlighter } from '../lib/highlighter';

const custom: Language = buildHighlightsLexer({
  name: 'example-language',
  alias: { example: 0 },
  wat: `(module
    (memory-region $mem.exampleStack 131072)
    (func $highlight
      (call $emitTok
        (enum.get $Token.keyword)
        (global.get $ptr)
        (global.get $end))))`,
});

test('custom lexer descriptors work through the public API with their own memory layout', async () => {
  const highlighter = await createHighlighter({
    langs: [custom],
    themes: [cssVariables],
  });
  const code = 'hello 你好🙂 <&>';
  for (const lang of ['example-language', 'example', 'EXAMPLE']) {
    for (const input of [code, new TextEncoder().encode(code)]) {
      const result = highlighter.codeToTokens(input, {
        lang,
        theme: 'css-variables',
      });
      expect(result.tokens[0]).toEqual([
        { content: code, offset: 0, color: 'var(--hls-keyword)', fontStyle: 0 },
      ]);
      expect(
        new TextDecoder().decode(
          highlighter.codeToHtml(input, {
            lang,
            theme: 'css-variables',
          })
        )
      ).toContain('hello 你好🙂 &lt;&amp;&gt;');
    }
  }
});

test('Markdown fences resolve registered custom names and aliases', async () => {
  const highlighter = await createHighlighter({
    langs: [markdown, custom],
    themes: [cssVariables],
  });
  for (const lang of ['example-language', 'example']) {
    const code = `> \`\`\`${lang}\n> 你好🙂\n> hello\n> \`\`\`\n`;
    const result = highlighter.codeToTokens(code, {
      lang: 'markdown',
      theme: 'css-variables',
    });
    for (const content of ['你好🙂', 'hello']) {
      expect(
        result.tokens.flat().find((token) => token.content === content)?.color
      ).toBe('var(--hls-keyword)');
    }
    expect(result.tokens[1].at(-1)?.offset).toBe(code.indexOf('你好🙂'));
  }
  const withoutCustom = await createHighlighter({
    langs: [markdown],
    themes: [cssVariables],
  });
  expect(() =>
    withoutCustom.codeToTokens('hello', {
      lang: 'example',
      theme: 'css-variables',
    })
  ).toThrow(/not loaded/);
  const result = withoutCustom.codeToTokens('```example\nhello\n```', {
    lang: 'markdown',
    theme: 'css-variables',
  });
  expect(result.tokens[1][0].color).toBe('var(--hls-text-literal)');
});

test.each([
  ['short', '(i32.add (global.get $ptr) (i32.const 3))'],
  ['long', '(i32.add (global.get $end) (i32.const 40))'],
  ['silent', '(global.get $ptr)'],
])(
  'output covers the input once when a custom lexer reports a %s end',
  async (kind, end) => {
    const language = buildHighlightsLexer({
      name: `${kind}-language`,
      wat: `(module
        (func $highlight
          (call $emitTok (enum.get $Token.keyword) (global.get $ptr) ${end})))`,
    });
    const highlighter = await createHighlighter({
      langs: [markdown, language],
      themes: [cssVariables],
    });
    const options = { lang: language.name, theme: 'css-variables' };
    // A longer input first: its bytes must not show up in the next output.
    highlighter.codeToHtml('previous input that must not leak', options);
    const code = 'abcdef <ghi>';
    const html = new TextDecoder().decode(
      highlighter.codeToHtml(code, options)
    );
    expect(
      html
        .replace(/<[^>]+>/g, '')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
    ).toBe(code);
    const { tokens } = highlighter.codeToTokens(code, options);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].map((token) => token.content).join('')).toBe(code);
    const fenced = highlighter.codeToTokens(
      `\`\`\`${language.name}\n${code}\n\`\`\`\ntail`,
      { lang: 'markdown', theme: 'css-variables' }
    ).tokens;
    expect(fenced[1].map((token) => token.content).join('')).toBe(code);
    expect(fenced[2]).toEqual([
      { ...fenced[0][0], content: '```', offset: fenced[2][0].offset },
    ]);
    expect(fenced[3].map((token) => token.content).join('')).toBe('tail');
  }
);

test('a custom lexer that reports ends out of order still covers the input once', async () => {
  const language = buildHighlightsLexer({
    name: 'backward-language',
    wat: `(module
      (func $highlight
        (call $emitTok (enum.get $Token.keyword)
          (i32.add (global.get $ptr) (i32.const 6)) (global.get $end))
        (call $emitTok (enum.get $Token.string)
          (global.get $ptr) (i32.add (global.get $ptr) (i32.const 3)))))`,
  });
  const highlighter = await createHighlighter({
    langs: [language],
    themes: [cssVariables],
  });
  const code = 'abcdef ghi';
  const { tokens } = highlighter.codeToTokens(code, {
    lang: language.name,
    theme: 'css-variables',
  });
  expect(tokens[0].map((token) => token.content).join('')).toBe(code);
});

test('a custom alias takes only its own name from a built-in language', async () => {
  const header = buildHighlightsLexer({
    name: 'header-language',
    alias: { h: 0, text: 0 },
    wat: `(module
      (func $highlight
        (call $emitTok (enum.get $Token.keyword) (global.get $ptr) (global.get $end))))`,
  });
  const reference = new HighlightsHighlighter(
    new WebAssembly.Module(
      readFileSync(new URL('../dist/highlights.wasm', import.meta.url))
    )
  );
  const code = 'int a = 1; // x';
  const builtIn = reference.codeToTokens(code, {
    lang: 'c',
    theme: cssVariables,
  });
  const custom = [
    { content: code, offset: 0, color: 'var(--hls-keyword)', fontStyle: 0 },
  ];
  const tokens = (
    highlighter: Awaited<ReturnType<typeof createHighlighter>>,
    lang: string
  ) => highlighter.codeToTokens(code, { lang, theme: 'css-variables' });
  // `c` and `h` share one built-in ID.
  const after = await createHighlighter({
    langs: [c, header],
    themes: [cssVariables],
  });
  expect(tokens(after, 'c')).toEqual(builtIn);
  expect(tokens(after, 'h').tokens[0]).toEqual(custom);
  expect(tokens(after, 'header-language').tokens[0]).toEqual(custom);
  expect(tokens(after, 'text').tokens[0]).toEqual(custom);
  // The later registration wins a name.
  const before = await createHighlighter({
    langs: [header, c],
    themes: [cssVariables],
  });
  expect(tokens(before, 'c')).toEqual(builtIn);
  expect(tokens(before, 'h')).toEqual(builtIn);
  expect(tokens(before, 'header-language').tokens[0]).toEqual(custom);
  const reserved = await createHighlighter({
    langs: [{ ...header, aliases: { ansi: 0 } }],
    themes: [cssVariables],
  }).catch((error: unknown) => error);
  expect(reserved).toBeInstanceOf(RangeError);
  expect(String(reserved)).toMatch(/reserved/);
});

test('registerLanguages adds lexers to the shared functions of the full bundle', async () => {
  const override = buildHighlightsLexer({
    name: 'shared-override',
    alias: { go: 0 },
    wat: `(module
      (func $highlight
        (call $emitTok
          (enum.get $Token.string)
          (global.get $ptr)
          (global.get $end))))`,
  });
  const options = { theme: cssVariables } as const;
  const builtIn = codeToTokens('hello', { ...options, lang: 'go' });
  expect(() => codeToTokens('hello', { ...options, lang: 'example' })).toThrow(
    /unknown lang/
  );
  registerLanguages([custom]);
  registerLanguages([override, custom]);
  const reference = await createHighlighter({
    langs: [custom, override],
    themes: [cssVariables],
  });
  for (const lang of ['example', 'EXAMPLE-LANGUAGE', 'go']) {
    for (const input of ['hello <&>\n你好🙂', new TextEncoder().encode('x')]) {
      expect(codeToTokens(input, { ...options, lang })).toEqual(
        reference.codeToTokens(input, { ...options, lang })
      );
      expect(codeToHtml(input, { ...options, lang })).toEqual(
        reference.codeToHtml(input, { ...options, lang })
      );
    }
  }
  expect(codeToTokens('hello', { ...options, lang: 'go' })).not.toEqual(
    builtIn
  );
});
