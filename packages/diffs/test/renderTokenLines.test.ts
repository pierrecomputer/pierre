import { expect, test } from 'bun:test';
import { toHtml } from 'hast-util-to-html';
import { JSDOM } from 'jsdom';

import type { DecorationItem, ThemedToken } from '../src/types';
import { renderTokenLines } from '../src/utils/renderTokenLines';

function decoration(name: string, start: number, end: number): DecorationItem {
  return {
    start: { line: 0, character: start },
    end: { line: 0, character: end },
    properties: { 'data-range': name },
  };
}

function tokens(contents: string[]): ThemedToken[] {
  let offset = 0;
  return contents.map((content) => {
    const token = { content, offset };
    offset += content.length;
    return token;
  });
}

test('crossing decorations preserve their text across token boundaries', () => {
  const fragment = JSDOM.fragment(
    toHtml(
      renderTokenLines([tokens(['ab', 'cd', 'ef', 'gh'])], {
        decorations: [decoration('a', 1, 5), decoration('b', 3, 7)],
      })
    )
  );
  expect(fragment.textContent).toBe('abcdefgh');
  expect(fragment.querySelector('[data-range="a"]')?.textContent).toBe('bcde');
  const fragments = [...fragment.querySelectorAll('[data-range="b"]')];
  expect(fragments.map((node) => node.textContent)).toEqual(['de', 'fg']);
  expect(fragments[0].parentElement?.getAttribute('data-range')).toBe('a');
});

test('markers join the following range at shared boundaries and the last range at EOF', () => {
  const fragment = JSDOM.fragment(
    toHtml(
      renderTokenLines([tokens(['ab', 'cd', 'ef'])], {
        decorations: [
          decoration('first', 0, 3),
          decoration('second', 3, 6),
          decoration('middle-marker', 3, 3),
          decoration('end-marker', 6, 6),
        ],
      })
    )
  );
  expect(fragment.querySelector('[data-range="first"]')?.textContent).toBe(
    'abc'
  );
  const second = fragment.querySelector('[data-range="second"]');
  expect(second?.textContent).toBe('def');
  expect(
    second?.querySelector('[data-range="middle-marker"]')?.textContent
  ).toBe('');
  expect(second?.querySelector('[data-range="end-marker"]')?.textContent).toBe(
    ''
  );
  expect(fragment.querySelectorAll('[data-range="second"]')).toHaveLength(1);
});

test('undecorated editor lines retain whitespace positions and empty-line placeholders', () => {
  const input = tokens(['  abc ', '\t', 'de', '']);
  for (const token of input) Object.freeze(token);
  Object.freeze(input);
  const fragment = JSDOM.fragment(
    toHtml(renderTokenLines([input, []], { useTokenTransformer: true }))
  );
  expect(fragment.textContent).toBe('  abc \tde');
  expect(
    [...fragment.querySelectorAll('[data-char]')].map((node) => [
      node.getAttribute('data-char'),
      node.textContent,
    ])
  ).toEqual([
    ['0', '  '],
    ['2', 'abc'],
    ['5', ' '],
    ['6', '\t'],
    ['7', 'de'],
  ]);
  expect(fragment.querySelectorAll('[data-char] [data-char]')).toHaveLength(0);
  expect(fragment.querySelectorAll('.line:last-child > br')).toHaveLength(1);
});
