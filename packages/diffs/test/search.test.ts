import { describe, expect, test } from 'bun:test';

import { TextDocument } from '../src/editor/textDocument';
import {
  buildSearchReplacementText,
  type LineByLineSearchDocument,
  type MatchRange,
  searchLineByLine,
  type SearchParams,
} from '../src/search';

function createSearchDocument(text: string): LineByLineSearchDocument {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      lineStarts.push(i + 1);
    }
  }

  const getLineStartOffset = (line: number) => lineStarts[line] ?? text.length;

  return {
    textLength: text.length,
    lineCount: lineStarts.length,
    getLineStartOffset,
    getLineText(line) {
      const start = getLineStartOffset(line);
      const nextStart = lineStarts[line + 1] ?? text.length;
      let end = nextStart;
      while (end > start && isLineEnding(text.charCodeAt(end - 1))) {
        end--;
      }
      return text.slice(start, end);
    },
    charAt(offset) {
      return text.charAt(offset);
    },
  };
}

function searchParams(overrides: Partial<SearchParams>): SearchParams {
  return {
    text: '',
    replaceText: '',
    caseSensitive: false,
    wholeWord: false,
    regex: false,
    ...overrides,
  };
}

function isLineEnding(charCode: number): boolean {
  return charCode === 10 || charCode === 13;
}

describe('searchLineByLine', () => {
  test('visits accepted matches in order while collecting the complete limited result', () => {
    const document = new TextDocument(
      'inmemory://search-visitor',
      'targeting target\ntarget target'
    );
    const visited: {
      match: MatchRange;
      index: number;
      line: number;
      startCharacter: number;
      endCharacter: number;
    }[] = [];
    const result = document.search(
      searchParams({ text: 'target', wholeWord: true }),
      2,
      (match, index, line, startCharacter, endCharacter) => {
        visited.push({ match, index, line, startCharacter, endCharacter });
      }
    );
    expect(result).toEqual([
      [10, 16],
      [17, 23],
    ]);
    expect(visited).toEqual([
      {
        match: [10, 16],
        index: 0,
        line: 0,
        startCharacter: 10,
        endCharacter: 16,
      },
      {
        match: [17, 23],
        index: 1,
        line: 1,
        startCharacter: 0,
        endCharacter: 6,
      },
    ]);
  });

  test('visits UTF-16 line coordinates for regex matches across CRLF lines', () => {
    const document = createSearchDocument('😀 aa\r\n\r\n😀 bbb cc');
    const positions: number[][] = [];
    const ranges = searchLineByLine(
      document,
      searchParams({ text: '[a-z]+', regex: true }),
      3,
      (_range, _index, line, startCharacter, endCharacter) => {
        positions.push([line, startCharacter, endCharacter]);
      }
    );

    expect(ranges).toEqual([
      [3, 5],
      [12, 15],
      [16, 18],
    ]);
    expect(positions).toEqual([
      [0, 3, 5],
      [2, 3, 6],
      [2, 7, 9],
    ]);
  });

  test('searches a string document without TextDocument', () => {
    const document = createSearchDocument('Alpha beta\nalpha BETA');

    expect(searchLineByLine(document, searchParams({ text: 'alpha' }))).toEqual(
      [
        [0, 5],
        [11, 16],
      ]
    );
  });

  test('supports whole-word matching', () => {
    const document = createSearchDocument('foo food (foo)');

    expect(
      searchLineByLine(document, searchParams({ text: 'foo', wholeWord: true }))
    ).toEqual([
      [0, 3],
      [10, 13],
    ]);
  });

  test('returns no results for invalid regex input', () => {
    const document = createSearchDocument('foo');

    expect(
      searchLineByLine(document, searchParams({ text: '[', regex: true }))
    ).toEqual([]);
  });

  test('does not match newline-spanning queries', () => {
    const document = createSearchDocument('foo\nbar');

    expect(
      searchLineByLine(document, searchParams({ text: 'foo\nbar' }))
    ).toEqual([]);
    expect(
      searchLineByLine(
        document,
        searchParams({ text: 'foo\\nbar', regex: true })
      )
    ).toEqual([]);
  });

  test('expands regex capture replacements', () => {
    const text = 'const answer = 42';
    const document = createSearchDocument(text);
    const positionAt = (offset: number) => ({ line: 0, character: offset });

    expect(
      buildSearchReplacementText(
        positionAt,
        (position) => position.character,
        (line) => document.getLineText(line),
        searchParams({
          text: '(answer) = (\\d+)',
          replaceText: '$1: $2',
          regex: true,
        }),
        6,
        text.length
      )
    ).toBe('answer: 42');
  });
});
