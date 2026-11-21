import { describe, expect, test } from 'bun:test';

import { PieceTable } from '../src/editor/pieceTable';
import { TextDocument } from '../src/editor/textDocument';
import {
  buildSearchReplacementText,
  type MatchRange,
  type SearchableDocument,
  searchDocument,
  type SearchParams,
} from '../src/search';
import { CodeViewSearchScan } from '../src/search/codeViewSearch';

function createSearchDocument(text: string): SearchableDocument {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      lineStarts.push(i + 1);
    }
  }

  const getLineStartOffset = (line: number) => lineStarts[line] ?? text.length;

  return {
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

describe('searchDocument', () => {
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
    const ranges = searchDocument(
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

    expect(searchDocument(document, searchParams({ text: 'alpha' }))).toEqual([
      [0, 5],
      [11, 16],
    ]);
  });

  test('supports whole-word matching', () => {
    const document = createSearchDocument('foo food (foo)');

    expect(
      searchDocument(document, searchParams({ text: 'foo', wholeWord: true }))
    ).toEqual([
      [0, 3],
      [10, 13],
    ]);
  });

  test('returns no results for invalid regex input', () => {
    const document = createSearchDocument('foo');

    expect(
      searchDocument(document, searchParams({ text: '[', regex: true }))
    ).toEqual([]);
  });

  test('matches whole words at both edges of first, middle CRLF, and last lines', () => {
    const text = 'foo foo\nfoo foo\r\nfoo foo';
    const params = searchParams({ text: 'foo', wholeWord: true });
    const expected: MatchRange[] = [
      [0, 3],
      [4, 7],
      [8, 11],
      [12, 15],
      [17, 20],
      [21, 24],
    ];

    expect(searchDocument(createSearchDocument(text), params)).toEqual(
      expected
    );
    expect(new PieceTable('foo foo\nfoo foo\nfoo foo').search(params)).toEqual([
      [0, 3],
      [4, 7],
      [8, 11],
      [12, 15],
      [16, 19],
      [20, 23],
    ]);
  });

  test('stops at the limit part-way through a line', () => {
    const document = createSearchDocument('foo foo foo\nfoo');
    const visited: number[][] = [];

    expect(
      searchDocument(
        document,
        searchParams({ text: 'foo', wholeWord: true }),
        2,
        (_range, _index, line, startCharacter, endCharacter) => {
          visited.push([line, startCharacter, endCharacter]);
        }
      )
    ).toEqual([
      [0, 3],
      [4, 7],
    ]);
    expect(visited).toEqual([
      [0, 0, 3],
      [0, 4, 7],
    ]);
  });

  test('matches whole words at CodeView line edges after trimming CRLF', () => {
    const scan = new CodeViewSearchScan(
      searchParams({ text: 'foo', wholeWord: true }),
      1,
      () => ({
        itemId: 'word-boundaries',
        type: 'file',
        contents: 'foo foo\nfoo foo\r\nfoo foo',
      }),
      100
    );
    scan.advance();
    const matches = scan.getMatches();

    expect(
      matches.map(({ lineIndex, startCharacter, endCharacter }) => [
        lineIndex,
        startCharacter,
        endCharacter,
      ])
    ).toEqual([
      [0, 0, 3],
      [0, 4, 7],
      [1, 0, 3],
      [1, 4, 7],
      [2, 0, 3],
      [2, 4, 7],
    ]);
  });

  test('does not match newline-spanning queries', () => {
    const document = createSearchDocument('foo\nbar');

    expect(
      searchDocument(document, searchParams({ text: 'foo\nbar' }))
    ).toEqual([]);
    expect(
      searchDocument(document, searchParams({ text: 'foo\\nbar', regex: true }))
    ).toEqual([]);
  });

  test('expands regex capture replacements', () => {
    const text = 'const answer = 42';
    const document = createSearchDocument(text);
    const positionAt = (offset: number) => ({ line: 0, character: offset });

    expect(
      buildSearchReplacementText(
        {
          positionAt,
          offsetAt: (position) => position.character,
          getLineText: (line) => document.getLineText(line),
        },
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

  test('keeps replacement text literal when the regex query cannot be searched', () => {
    const document = new TextDocument('inmemory://replacement-fallback', 'foo');
    for (const text of ['', '[', '(foo)|\\n', '(foo)|\n']) {
      expect(
        buildSearchReplacementText(
          document,
          searchParams({ text, replaceText: '$1!', regex: true }),
          0,
          3
        )
      ).toBe('$1!');
    }
  });
});
