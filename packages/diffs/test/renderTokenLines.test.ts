import { expect, test } from 'bun:test';

import { getTokenStyle } from '../src/utils/getTokenStyle';
import { toHtml } from '../src/utils/html';
import { renderTokenLines } from '../src/utils/renderTokenLines';
import { collectAllElements, getTextContent } from './testUtils';

test('inline changes preserve text, token offsets, and one span across tokens', () => {
  const rows = renderTokenLines(
    [
      [
        { content: 'hello', offset: 0, color: '#123456' },
        { content: ' world', offset: 5 },
      ],
    ],
    [{ type: 'change-addition', lineIndex: '0,0', lineNumber: 1 }],
    true,
    [{ line: 0, start: 2, end: 9 }]
  );
  const elements = collectAllElements(rows);
  const changes = elements.filter(
    (node) => node.properties['data-diff-span'] === ''
  );
  expect(changes).toHaveLength(1);
  expect(getTextContent(changes[0])).toBe('llo wor');
  expect(getTextContent(rows[0])).toBe('hello world');
  expect(
    elements
      .filter((node) => node.properties['data-char'] != null)
      .map((node) => node.properties['data-char'])
  ).toEqual([0, 0, 5, 5]);
  expect(toHtml(rows)).toContain('color:#123456');
});

test('a token split by several inline changes retains one editor wrapper', () => {
  const rows = renderTokenLines(
    [[{ content: 'hello world', offset: 0 }]],
    [{ type: 'change-deletion', lineIndex: '0,0', lineNumber: 1 }],
    true,
    [
      { line: 0, start: 1, end: 3 },
      { line: 0, start: 5, end: 8 },
    ]
  );
  const elements = collectAllElements(rows);
  expect(
    elements.filter((node) => node.properties['data-char'] != null)
  ).toHaveLength(1);
  expect(
    elements
      .filter((node) => node.properties['data-diff-span'] === '')
      .map(getTextContent)
  ).toEqual(['el', ' wo']);
});

test('empty editor rows use br and plain rows retain a copyable newline', () => {
  const info = [{ type: 'context', lineIndex: 0, lineNumber: 1 }] as const;
  expect(renderTokenLines([[]], [...info], true)[0].children).toEqual([
    { type: 'element', tagName: 'br', properties: {}, children: [] },
  ]);
  expect(renderTokenLines([[]], [...info], false)[0].children).toEqual([
    { type: 'text', value: '\n' },
  ]);
});

test('styles preserve both theme variables and font decorations', () => {
  expect(
    getTokenStyle({
      content: '',
      offset: 0,
      htmlStyle: {
        '--diffs-token-dark': '#abcdef',
        '--diffs-token-light': '#123456',
      },
    })
  ).toBe('--diffs-token-dark:#abcdef;--diffs-token-light:#123456');
  expect(getTokenStyle({ content: '', offset: 0, fontStyle: 15 })).toBe(
    'font-style:italic;font-weight:bold;text-decoration:underline line-through'
  );
});
