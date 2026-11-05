import { describe, expect, test } from 'bun:test';
import { toHtml } from 'hast-util-to-html';
import { JSDOM } from 'jsdom';

import {
  type DecorationItem,
  renderTokenLines,
  type ThemedToken,
} from '../src';

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

// Expected HTML was captured from the renderer before decoration handling
// moved into DecoratedLineBuilder, so these pin that output exactly.
describe('decoration edge cases match the previous renderer', () => {
  function coloredTokens(contents: string[]): ThemedToken[] {
    let offset = 0;
    return contents.map((content) => {
      const token = { content, offset, color: `#${content.length}00` };
      offset += content.length;
      return token;
    });
  }
  function range(
    name: string,
    [startLine, startCharacter]: [number, number],
    [endLine, endCharacter]: [number, number]
  ): DecorationItem {
    return {
      start: { line: startLine, character: startCharacter },
      end: { line: endLine, character: endCharacter },
      properties: { 'data-range': name },
    };
  }
  const lines = [
    coloredTokens(['const', ' ', 'value']),
    coloredTokens(['foo', '(', 'bar', ')']),
    [],
  ];
  const multiLine = [
    range('across', [0, 6], [1, 2]),
    range('past-end', [1, 4], [1, 99]),
  ];
  const empty = [
    range('start', [0, 0], [0, 0]),
    range('end', [0, 11], [0, 11]),
    range('empty-line', [2, 0], [2, 0]),
  ];

  test('a range across lines and a range past the line end', () => {
    expect(toHtml(renderTokenLines(lines, { decorations: multiLine }))).toBe(
      '<span class="line"><span style="color:#500">const</span><span style="color:#500"> </span><span data-range="across"><span style="color:#500">value</span></span></span>' +
        '<span class="line"><span data-range="across"><span style="color:#300">fo</span></span><span style="color:#300">o</span><span style="color:#100">(</span><span data-range="past-end"><span style="color:#300">bar</span><span style="color:#100">)</span></span></span>' +
        '<span class="line"></span>'
    );
    expect(
      toHtml(
        renderTokenLines(lines, {
          decorations: multiLine,
          useTokenTransformer: true,
        })
      )
    ).toBe(
      '<span class="line"><span style="color:#500" data-char="0">const</span><span style="color:#100" data-char="5"> </span><span data-range="across" data-char="6"><span style="color:#500">value</span></span></span>' +
        '<span class="line"><span data-char="0"><span data-range="across"><span style="color:#300">fo</span></span><span style="color:#300">o</span></span><span style="color:#100" data-char="3">(</span><span data-range="past-end"><span style="color:#300" data-char="4">bar</span><span style="color:#100" data-char="7">)</span></span></span>' +
        '<span class="line"><br></span>'
    );
  });

  test('empty ranges at the line start, the line end, and on an empty line', () => {
    expect(toHtml(renderTokenLines(lines, { decorations: empty }))).toBe(
      '<span class="line"><span data-range="start"></span><span style="color:#500">const</span><span style="color:#500"> value</span><span data-range="end"></span></span>' +
        '<span class="line"><span style="color:#300">foo</span><span style="color:#100">(</span><span style="color:#300">bar</span><span style="color:#100">)</span></span>' +
        '<span class="line"><span data-range="empty-line"></span></span>'
    );
    expect(
      toHtml(
        renderTokenLines(lines, {
          decorations: empty,
          useTokenTransformer: true,
        })
      )
    ).toBe(
      '<span class="line"><span data-range="start"></span><span style="color:#500" data-char="0">const</span><span style="color:#100" data-char="5"> </span><span style="color:#500" data-char="6">value</span><span data-range="end"></span></span>' +
        '<span class="line"><span style="color:#300" data-char="0">foo</span><span style="color:#100" data-char="3">(</span><span style="color:#300" data-char="4">bar</span><span style="color:#100" data-char="7">)</span></span>' +
        '<span class="line"><span data-range="empty-line"></span><br></span>'
    );
  });
});
