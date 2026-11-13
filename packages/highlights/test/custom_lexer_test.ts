import {
  codeToHtml,
  codeToTokens,
  createHighlighter,
  isRegisteredLanguage,
  isSupportedLanguage,
  type Language,
  registerLanguages,
} from '@pierre/highlights';
import c from '@pierre/highlights/langs/c';
import go from '@pierre/highlights/langs/go';
import html from '@pierre/highlights/langs/html';
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
const combined = new HighlightsHighlighter(
  new WebAssembly.Module(
    readFileSync(new URL('../dist/highlights.wasm', import.meta.url))
  )
);

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

test.each([80, 200, 100000])(
  'a custom lexer that reports token type %d emits plain text',
  async (type) => {
    const language = buildHighlightsLexer({
      name: 'bad-type-language',
      wat: `(module
        (func $highlight
          (call $recTok (i32.const ${type}) (global.get $end))))`,
    });
    const highlighter = await createHighlighter({
      langs: [language],
      themes: [cssVariables],
    });
    const options = { lang: language.name, theme: 'css-variables' };
    const code = '<img src=x onerror=alert(1)>'.repeat(40);
    const html = new TextDecoder().decode(
      highlighter.codeToHtml(code, options)
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(highlighter.codeToTokens(code, options).tokens).toEqual(
      highlighter.codeToTokens(code, { ...options, lang: 'text' }).tokens
    );
  }
);

test('a custom alias takes only its own name from a built-in language', async () => {
  const header = buildHighlightsLexer({
    name: 'header-language',
    alias: { h: 0, text: 0 },
    wat: `(module
      (func $highlight
        (call $emitTok (enum.get $Token.keyword) (global.get $ptr) (global.get $end))))`,
  });
  const code = 'int a = 1; // x';
  const builtIn = combined.codeToTokens(code, {
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
  // A free built-in ID stays free: `<script>` does not reach a custom `mjs`.
  const script = await createHighlighter({
    langs: [{ ...header, aliases: { mjs: 0 } }, html],
    themes: [cssVariables],
  });
  expect(tokens(script, 'mjs').tokens[0]).toEqual(custom);
  expect(
    script
      .codeToTokens('<script>let a = 1</script>', {
        lang: 'html',
        theme: 'css-variables',
      })
      .tokens[0].find((token) => token.content.includes('let'))?.color
  ).not.toBe('var(--hls-keyword)');
  const reserved = await createHighlighter({
    langs: [{ ...header, aliases: { ansi: 0 } }],
    themes: [cssVariables],
  }).catch((error: unknown) => error);
  expect(reserved).toBeInstanceOf(RangeError);
  expect(String(reserved)).toMatch(/reserved/);
});

test('registerLanguages adds lexers to the shared functions of the main entry', async () => {
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
  expect(isRegisteredLanguage('GO')).toBe(true);
  expect(isRegisteredLanguage('example')).toBe(true);
  expect(isSupportedLanguage('example')).toBe(false);
  expect(isRegisteredLanguage('rust')).toBe(false);
  // WARNING: Registration is global and Bun runs every test file in one
  // process. The later lexer wins a name, so the built-in module gives `go`
  // back to the Go lexer for the other files.
  registerLanguages([go]);
  expect(codeToTokens('hello', { ...options, lang: 'go' })).toEqual(builtIn);
});

test('a registered built-in module still embeds the other built-in languages', () => {
  const options = { lang: 'html', theme: cssVariables } as const;
  const code =
    '<script>let a = 1</script>\n<style>a { color: red }</style>\n<p>x</p>';
  const builtIn = codeToTokens(code, options);
  registerLanguages([html]);
  expect(isRegisteredLanguage('html')).toBe(true);
  expect(codeToTokens(code, options)).toEqual(builtIn);
  expect(codeToHtml(code, options)).toEqual(combined.codeToHtml(code, options));
});

test('the package exports the combined module for init()', () => {
  expect(import.meta.resolve('@pierre/highlights/highlights.wasm')).toBe(
    new URL('../dist/highlights.wasm', import.meta.url).href
  );
});
