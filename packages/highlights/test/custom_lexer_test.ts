import { createHighlighter, type Language } from '@pierre/highlights';
import markdown from '@pierre/highlights/langs/markdown';
import { cssVariables } from '@pierre/highlights/themes';
import { buildHighlightsLexer } from '@pierre/wat-tools';
import { expect, test } from 'bun:test';

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
