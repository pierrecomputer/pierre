import { codeToTokens as highlightsCodeToTokens } from '@pierre/highlights';
import pierreDark from '@pierre/highlights/themes/pierre-dark';
import { transformerStyleToClass } from '@shikijs/transformers';
import { describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { codeToTokens as shikiCodeToTokens } from 'shiki';

import type { ThemedToken } from '../src/types';
import { createHTMLElement, renderRows } from '../src/utils/html';
import { renderTokenLines } from '../src/utils/renderTokenLines';
import type { TokensToHtmlOptions } from '../src/utils/tokensToHtml';
import { tokensToHtml } from '../src/utils/tokensToHtml';

const info = (line: number) => ({
  type: 'context' as const,
  lineNumber: line,
  lineIndex: line - 1,
});

describe('tokensToHtml', () => {
  test('accepts tokens from both highlighters with shared token hooks', async () => {
    const source = 'const text = "<&🎉>";\n';
    const shiki = await shikiCodeToTokens(source, {
      lang: 'ts',
      themes: { light: 'github-dark' },
    });
    const highlights = highlightsCodeToTokens(source, {
      lang: 'ts',
      themes: { light: pierreDark },
    });
    const transformer = transformerStyleToClass();
    const options: TokensToHtmlOptions = {
      transformers: [
        {
          tokens(lines) {
            return lines.map((line) =>
              line.map((token) => ({
                ...token,
                htmlAttrs: { 'data-token': '' },
              }))
            );
          },
        },
        transformer,
      ],
    };
    for (const tokens of [shiki.tokens, highlights.tokens]) {
      const html = tokensToHtml(tokens, options);
      const fragment = JSDOM.fragment(html);
      expect(fragment.textContent).toBe(source);
      expect(fragment.querySelectorAll('span:not([data-token])')).toHaveLength(
        0
      );
      expect(html).toContain('class="__shiki_');
      expect(html).not.toContain('style=');
    }
    expect(transformer.getCSS()).toContain('color:');
    const mixed: ThemedToken[][] = [...shiki.tokens, ...highlights.tokens];
    expect(JSDOM.fragment(tokensToHtml(mixed, options)).textContent).toBe(
      `${source}\n${source}`
    );
  });

  test('escapes source and attribute values without interpreting markup', () => {
    const content = `<img src=x onerror="boom"> & ' 🎉`;
    const html = tokensToHtml([
      [{ offset: 0, content, htmlAttrs: { title: '"<&', class: 'token' } }],
    ]);
    const fragment = JSDOM.fragment(html);
    expect(fragment.textContent).toBe(content);
    expect(fragment.querySelector('img')).toBeNull();
    expect(fragment.querySelector('span')?.getAttribute('title')).toBe('"<&');
    expect(() =>
      tokensToHtml([
        [{ offset: 0, content: 'a', htmlAttrs: { 'bad"name': 'x' } }],
      ])
    ).toThrow('Invalid HTML attribute');
  });

  test('preserves empty lines and adds no block wrappers', () => {
    expect(tokensToHtml([])).toBe('');
    expect(tokensToHtml([[], [], []])).toBe('\n\n');
    expect(
      tokensToHtml([
        [{ offset: 0, content: 'a' }],
        [],
        [{ offset: 2, content: 'b' }],
      ])
    ).toBe('<span>a</span>\n\n<span>b</span>');
  });

  test('renders foreground, background and every font flag', () => {
    const html = tokensToHtml([
      [
        {
          offset: 0,
          content: 'text',
          color: '#123456',
          bgColor: '#abcdef',
          fontStyle: 1 | 2 | 4 | 8,
        },
      ],
    ]);
    expect(html).toContain(
      'color:#123456;background-color:#abcdef;font-style:italic;font-weight:bold;text-decoration:underline line-through'
    );
  });

  test('explicit styles override token fields, including empty styles', () => {
    expect(
      tokensToHtml([
        [
          {
            offset: 0,
            content: 'x',
            color: 'red',
            htmlStyle: { '--dark': 'blue' },
          },
        ],
      ])
    ).toBe('<span style="--dark:blue">x</span>');
    expect(
      tokensToHtml([
        [
          {
            offset: 0,
            content: 'x',
            color: 'red',
            fontStyle: 1 | 2,
            htmlStyle: {},
          },
        ],
      ])
    ).toBe('<span>x</span>');
    expect(
      tokensToHtml([
        [{ offset: 0, content: 'x', htmlAttrs: { style: 'color:green' } }],
      ])
    ).toBe('<span style="color:green">x</span>');
  });

  test('runs ordered token hooks and chains replacements and mutations', () => {
    const calls: string[] = [];
    const tokens: ThemedToken[][] = [[{ offset: 0, content: 'a' }]];
    const html = tokensToHtml(tokens, {
      transformers: [
        {
          enforce: 'post',
          tokens(lines) {
            calls.push('post');
            lines[0][0].content += 'd';
          },
        },
        {
          tokens(lines) {
            calls.push('normal');
            return [[{ ...lines[0][0], content: lines[0][0].content + 'b' }]];
          },
        },
        {
          enforce: 'pre',
          tokens() {
            calls.push('pre');
          },
        },
        {
          tokens(lines) {
            calls.push('normal2');
            lines[0][0].content += 'c';
          },
        },
      ],
    });
    expect(calls).toEqual(['pre', 'normal', 'normal2', 'post']);
    expect(html).toBe('<span>abcd</span>');
    expect(tokens[0][0].content).toBe('a');
    expect(
      tokensToHtml(tokens, {
        transformers: [
          {
            tokens() {
              return [];
            },
          },
        ],
      })
    ).toBe('');
  });

  test('runs the Shiki style-to-class token hook without node hooks', () => {
    const transformer = transformerStyleToClass();
    const html = tokensToHtml(
      [[{ offset: 0, content: 'a', htmlStyle: { color: 'red' } }]],
      { transformers: [transformer] }
    );
    expect(html).toContain('class="__shiki_');
    expect(html).not.toContain('style=');
    expect(transformer.getCSS()).toContain('{color:red}');
  });

  test('renders HTML and SVG attributes consistently', () => {
    expect(createHTMLElement('br')).toBe('<br>');
    expect(createHTMLElement('div', null, 'one', '<span>two</span>')).toBe(
      '<div>one<span>two</span></div>'
    );
    expect(
      createHTMLElement('button', {
        disabled: true,
        hidden: false,
        className: ['a', 'b'],
        tabIndex: 0,
        title: undefined,
      })
    ).toBe('<button disabled class="a b" tabindex="0"></button>');
    expect(createHTMLElement('svg', { viewBox: '0 0 16 16' })).toContain(
      'viewBox="0 0 16 16"'
    );
  });
});

describe('renderTokenLines', () => {
  test('keeps UTF-16 token ranges across decoration boundaries', () => {
    const rows = renderTokenLines(
      [
        [
          { offset: 0, content: '🎉hello' },
          { offset: 7, content: '!' },
        ],
      ],
      info,
      true,
      [
        {
          start: { line: 0, character: 3 },
          end: { line: 0, character: 6 },
          properties: { 'data-diff-span': '' },
        },
      ]
    );
    const fragment = JSDOM.fragment(renderRows(rows));
    expect(
      Array.from(fragment.querySelectorAll('[data-char]'), (el) => [
        el.getAttribute('data-char'),
        el.textContent,
      ])
    ).toEqual([
      ['0', '🎉hello'],
      ['7', '!'],
    ]);
    expect(fragment.querySelector('[data-diff-span]')?.textContent).toBe('ell');
  });

  test('keeps a decoration spanning tokens in one wrapper', () => {
    const rows = renderTokenLines(
      [
        [
          { offset: 0, content: 'old', color: 'red' },
          { offset: 3, content: 'Value', color: 'blue' },
        ],
      ],
      info,
      false,
      [
        {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 5 },
          properties: { 'data-diff-span': '' },
        },
      ]
    );
    const fragment = JSDOM.fragment(renderRows(rows));
    expect(fragment.querySelectorAll('[data-diff-span]')).toHaveLength(1);
    expect(fragment.querySelector('[data-diff-span]')?.textContent).toBe(
      'ldVa'
    );
    expect(fragment.textContent).toBe('oldValue');
  });

  test('marks only range ends for rounding without splitting interactive tokens', () => {
    const rows = renderTokenLines(
      [
        [
          { offset: 0, content: '🎉old', color: 'red' },
          { offset: 5, content: '+', color: 'gray' },
          { offset: 6, content: 'Value', color: 'blue' },
        ],
      ],
      info,
      true,
      [
        {
          start: { line: 0, character: 3 },
          end: { line: 0, character: 8 },
          properties: { 'data-diff-span': '' },
        },
        {
          start: { line: 0, character: 9 },
          end: { line: 0, character: 11 },
          properties: { 'data-diff-span': '' },
        },
      ]
    );
    const fragment = JSDOM.fragment(renderRows(rows));
    expect(
      Array.from(fragment.querySelectorAll('[data-char]'), (el) => [
        el.getAttribute('data-char'),
        el.textContent,
      ])
    ).toEqual([
      ['0', '🎉old'],
      ['5', '+'],
      ['6', 'Value'],
    ]);
    expect(
      Array.from(fragment.querySelectorAll('[data-diff-span]'), (el) => [
        el.textContent,
        el.getAttribute('data-diff-span-start'),
        el.getAttribute('data-diff-span-end'),
      ])
    ).toEqual([
      ['ld', null, 'continued'],
      ['+', 'continued', 'continued'],
      ['Va', 'continued', null],
      ['ue', null, null],
    ]);
  });

  test('renders empty editor lines as br and plain lines with copy padding', () => {
    expect(renderTokenLines([[]], info, true)[0].html).toBe('<br>');
    expect(renderTokenLines([[]], info, false)[0].html).toBe('\n');
  });

  test('metadata changes do not replace cached token HTML', () => {
    const row = renderTokenLines(
      [[{ offset: 0, content: 'a&b' }]],
      info,
      false
    )[0];
    const before = row.html;
    row.properties['data-line'] = 20;
    expect(renderRows([row])).toContain('data-line="20"');
    expect(row.html).toBe(before);
  });
});
