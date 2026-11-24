import { describe, expect, mock, test } from 'bun:test';

import { TextDocument } from '../src/editor/textDocument';
import type { DiffLineMetadata } from '../src/layout/RowSpec';
import { LineCuts } from '../src/rows/LineCuts';
import { MAX_SEARCH_MATCHES, type SearchParams } from '../src/search';
import {
  type CodeViewSearchDiff,
  CodeViewSearchDiffCursor,
  type CodeViewSearchItem,
  type CodeViewSearchMatch,
  CodeViewSearchScan,
  CodeViewSearchTextCursor,
} from '../src/search/codeViewSearch';
import type { FileDiffMetadata, SelectionSide } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { processPatch } from '../src/utils/parsePatchFiles';
import { collectDiffRows, createDiffFixtures } from './testUtils';

// Records source coordinates as well as text so resume cannot silently change a side.
type VisitedLine = [string, SelectionSide | undefined, number, number];

const params: SearchParams = {
  text: 'line',
  replaceText: '',
  regex: false,
  wholeWord: false,
  caseSensitive: false,
};

// Lists source lines in search order, including edited addition text.
function expectedDiffLines(
  diff: FileDiffMetadata,
  diffStyle: 'split' | 'unified',
  scoped: boolean,
  additionContents?: string
): VisitedLine[] {
  const lines: VisitedLine[] = [];
  const additions =
    additionContents != null
      ? new TextDocument('file:///expected-additions', additionContents)
      : undefined;
  if (scoped && additions != null) {
    return Array.from({ length: additions.lineCount }, (_, index) => [
      additions.getLineText(index),
      'additions',
      index + 1,
      index,
    ]);
  }
  const add = (
    side: SelectionSide,
    line: DiffLineMetadata | undefined
  ): void => {
    if (line == null) return;
    const text =
      side === 'additions' && additions != null
        ? additions.getLineText(line.lineIndex)
        : (side === 'additions' ? diff.additionLines : diff.deletionLines)[
            line.lineIndex
          ];
    if (text != null)
      lines.push([
        text.replace(/[\r\n]+$/, ''),
        side,
        line.lineNumber,
        line.lineIndex,
      ]);
  };
  for (const { additionLine, deletionLine } of collectDiffRows({
    diff,
    diffStyle,
    expandedHunks: true,
  })) {
    if (scoped) add('additions', additionLine);
    else if (diffStyle === 'unified') {
      if (
        additionLine != null &&
        diff.additionLines[additionLine.lineIndex] != null
      )
        add('additions', additionLine);
      else add('deletions', deletionLine);
    } else {
      add('deletions', deletionLine);
      add('additions', additionLine);
    }
  }
  return lines;
}

// Expands a shared row into the same ordered source lines as separate visits.
function recordVisitedLine(
  lines: VisitedLine[],
  text: string,
  side: SelectionSide | undefined,
  lineNumber: number,
  lineIndex: number,
  additionLineNumber?: number,
  additionLineIndex?: number
): void {
  const lineText = text.replace(/[\r\n]+$/, '');
  lines.push([lineText, side, lineNumber, lineIndex]);
  if (additionLineNumber != null && additionLineIndex != null) {
    lines.push([lineText, 'additions', additionLineNumber, additionLineIndex]);
  }
}

// Searches one real item to completion, optionally stopping at a match limit.
function scanItem(
  item: CodeViewSearchItem,
  searchParams: SearchParams = params,
  limit = MAX_SEARCH_MATCHES
): CodeViewSearchScan {
  const scan = new CodeViewSearchScan(searchParams, 1, () => item, limit);
  scan.advance();
  return scan;
}

// Searches each source line separately to preserve both sides' result order.
function expectedDiffMatches(
  item: CodeViewSearchDiff,
  searchParams: SearchParams
): CodeViewSearchMatch[] {
  const matches: CodeViewSearchMatch[] = [];
  for (const [contents, side, lineNumber, lineIndex] of expectedDiffLines(
    item.fileDiff,
    item.diffStyle,
    item.additionsOnly,
    item.additionContents
  )) {
    const scan = scanItem(
      { type: 'file', itemId: item.itemId, contents },
      searchParams
    );
    for (const match of scan.getMatches()) {
      matches.push({ ...match, itemType: 'diff', side, lineNumber, lineIndex });
    }
  }
  return matches;
}

describe('CodeView search walkers', () => {
  test('text resumes after every line and trims LF, CRLF, CR and trailing empty text', () => {
    for (const contents of [
      '',
      'line\n',
      'line\r\nnext\rlast',
      'line\n\n',
      '\n',
      '\r',
      '\r\n',
      '\r\r\n',
      'line\r',
      'one\r\n\r\ntwo',
      'one\n\rtwo\r',
    ]) {
      const expected = new TextDocument('file:///text', contents);
      const cursor = new CodeViewSearchTextCursor(contents);
      const lines: VisitedLine[] = [];
      while (
        !cursor.walk((text, side, lineNumber, lineIndex) => {
          lines.push([text, side, lineNumber, lineIndex]);
          return true;
        })
      ) {}
      expect(lines).toEqual(
        Array.from({ length: expected.lineCount }, (_, index) => [
          expected.getLineText(index),
          undefined,
          index + 1,
          index,
        ])
      );
    }
  });

  test('a text much longer than one block keeps every kind of line ending in step', () => {
    for (const endings of [['\n'], ['\r\n'], ['\r'], ['\n', '\r\n', '\r']]) {
      let contents = '';
      for (let line = 0; line < 4000; line++) {
        contents += `line ${line} ${'x'.repeat(line % 97)}${endings[line % endings.length]}`;
      }
      const expected = new TextDocument('file:///text', contents);
      const cursor = new CodeViewSearchTextCursor(contents);
      const lines: string[] = [];
      cursor.walk((text) => {
        lines.push(text);
        return false;
      });
      expect(contents.length).toBeGreaterThan(131_072);
      expect(lines).toEqual(
        Array.from({ length: expected.lineCount }, (_, index) =>
          expected.getLineText(index)
        )
      );
    }
  });

  test('a text with only \\r line endings is walked about as fast as one with \\n', () => {
    // The best of three walks over 200,000 short lines.
    const time = (ending: string): number => {
      const contents = `blank abcdefghijklmnopqrstuvwxyz${ending}`.repeat(
        200_000
      );
      let best = Infinity;
      for (let run = 0; run < 3; run++) {
        const cursor = new CodeViewSearchTextCursor(contents);
        const start = performance.now();
        cursor.walk(() => false);
        best = Math.min(best, performance.now() - start);
      }
      return best;
    };
    expect(time('\r')).toBeLessThan(time('\n') * 10 + 10);
  });

  test('text lines can be read in any order, and a line past the end is rejected', () => {
    const contents = 'zero\r\none\rtwo\n\nfour';
    const expected = new TextDocument('file:///text', contents);
    for (const order of [
      [4, 0, 2, 1, 3],
      [2, 2, 0, 4],
      [0, 1, 2, 3, 4],
    ]) {
      const cursor = new CodeViewSearchTextCursor(contents);
      for (const lineIndex of order) {
        expect(cursor.readLine(lineIndex)).toBe(
          expected.getLineText(lineIndex)
        );
      }
      expect(() => cursor.readLine(5)).toThrow('out of range');
    }
  });

  test('stopping on the last line returns false until the next walk reaches the end', () => {
    const fileDiff = parseDiffFromFile(
      { name: 'a', contents: '' },
      { name: 'a', contents: 'line' },
      { disableLineMatching: true }
    );
    for (const cursor of [
      new CodeViewSearchTextCursor('line'),
      new CodeViewSearchDiffCursor(
        {
          type: 'diff',
          itemId: 'a',
          fileDiff,
          diffStyle: 'split',
          additionsOnly: false,
        },
        false
      ),
    ]) {
      const texts: string[] = [];
      expect(
        cursor.walk((text) => {
          texts.push(text);
          return true;
        })
      ).toBe(false);
      expect(texts).toEqual(['line']);
      expect(
        cursor.walk((text) => {
          texts.push(text);
          return true;
        })
      ).toBe(true);
      expect(texts).toEqual(['line']);
    }
  });

  test('text reads reject negative and past-end line indices', () => {
    const document = new TextDocument('file:///bounds', 'line one\nline two');
    const cursor = new CodeViewSearchTextCursor(document.getText());
    expect(cursor.readLine(1)).toBe('line two');
    expect(() => cursor.readLine(-1)).toThrow('line index -1 is out of range');
    expect(() => cursor.readLine(2)).toThrow('line index 2 is out of range');
  });

  test('an edited diff rejects a row outside its addition text', () => {
    const document = new TextDocument('file:///short', 'line edited');
    const cursor = new CodeViewSearchDiffCursor(
      {
        type: 'diff',
        itemId: 'a',
        fileDiff: createLargeDiff(),
        diffStyle: 'split',
        additionsOnly: false,
        additionContents: document.getText(),
      },
      false
    );
    expect(() => cursor.walk(() => false)).toThrow(
      'line index 1 is out of range'
    );
  });

  test('every source-line stopping position preserves full and partial diff order', () => {
    for (const diff of createDiffFixtures()) {
      for (const diffStyle of ['split', 'unified'] satisfies (
        | 'split'
        | 'unified'
      )[]) {
        for (const scoped of [false, true]) {
          const expected = expectedDiffLines(diff, diffStyle, scoped);
          for (let stopAt = 0; stopAt < expected.length; stopAt++) {
            const cursor = new CodeViewSearchDiffCursor(
              {
                type: 'diff',
                itemId: 'a',
                fileDiff: diff,
                diffStyle,
                additionsOnly: scoped,
              },
              false
            );
            const lines: VisitedLine[] = [];
            let visited = 0;
            cursor.walk((...line) => {
              recordVisitedLine(lines, ...line);
              return ++visited === stopAt + 1;
            });
            cursor.walk((...line) => {
              recordVisitedLine(lines, ...line);
              return false;
            });
            expect(lines).toEqual(expected);
          }
          const cursor = new CodeViewSearchDiffCursor(
            {
              type: 'diff',
              itemId: 'a',
              fileDiff: diff,
              diffStyle,
              additionsOnly: scoped,
            },
            false
          );
          const lines: VisitedLine[] = [];
          while (
            !cursor.walk((...line) => {
              recordVisitedLine(lines, ...line);
              return true;
            })
          ) {}
          expect(lines).toEqual(expected);
        }
      }
    }
  });
});

// Mirrors the tokenizer's clock control without letting real elapsed time affect slices.
function withClock(run: () => void): void {
  const original = performance.now;
  let reads = 0;
  Object.defineProperty(performance, 'now', {
    configurable: true,
    value: () => reads++,
  });
  try {
    run();
  } finally {
    Object.defineProperty(performance, 'now', {
      configurable: true,
      value: original,
    });
  }
}

// Large individual lines force clock checks while keeping result coordinates small.
function createLargeDiff(): FileDiffMetadata {
  const padding = ' '.repeat(65_536);
  return parseDiffFromFile(
    { name: 'large', contents: `line old${padding}\nline context${padding}\n` },
    { name: 'large', contents: `line new${padding}\nline context${padding}\n` },
    { disableLineMatching: true }
  );
}

describe('find on cut lines', () => {
  // Reads the source coordinates that stepping through the results will visit.
  function coordinates(item: CodeViewSearchItem, query = params) {
    return scanItem(item, query)
      .getMatches()
      .map(({ lineNumber, startCharacter, endCharacter }) => [
        lineNumber,
        startCharacter,
        endCharacter,
      ]);
  }

  test('keeps visible matches and the first hidden or crossing match', () => {
    const cuts = new LineCuts();
    const item: CodeViewSearchItem = {
      type: 'file',
      itemId: 'file',
      contents: 'line line line line\nline-----none\n--------line line',
      lineCuts: { cutLength: 9, expandedLines: cuts.expandedLines },
    };
    expect(coordinates(item)).toEqual([
      [1, 0, 4],
      [1, 5, 9],
      [1, 10, 14],
      [2, 0, 4],
      [3, 8, 12],
    ]);
    cuts.expand({ additionLineNumber: 1 });
    expect(coordinates(item)).toEqual([
      [1, 0, 4],
      [1, 5, 9],
      [1, 10, 14],
      [1, 15, 19],
      [2, 0, 4],
      [3, 8, 12],
    ]);
    expect(
      coordinates({
        ...item,
        lineCuts: { cutLength: Infinity, expandedLines: cuts.expandedLines },
      })
    ).toEqual([
      [1, 0, 4],
      [1, 5, 9],
      [1, 10, 14],
      [1, 15, 19],
      [2, 0, 4],
      [3, 8, 12],
      [3, 13, 17],
    ]);
  });

  test('word boundaries and end anchors see past the cut', () => {
    const item: CodeViewSearchItem = {
      type: 'file',
      itemId: 'words',
      contents: 'lines of text\nlines on a line',
      lineCuts: { cutLength: 4, expandedLines: new LineCuts().expandedLines },
    };
    expect(coordinates(item, { ...params, wholeWord: true })).toEqual([
      [2, 11, 15],
    ]);
    expect(
      coordinates(item, { ...params, text: 'line$', regex: true })
    ).toEqual([[2, 11, 15]]);
  });

  test('split context shares its hidden match and changed lines keep their own', () => {
    const matches = scanItem({
      type: 'diff',
      itemId: 'diff',
      diffStyle: 'split',
      additionsOnly: false,
      fileDiff: parseDiffFromFile(
        { name: 'a', contents: 'old line line\nline line line' },
        {
          name: 'a',
          contents: 'new text here\nadded line line\nline line line',
        },
        { disableLineMatching: true }
      ),
      lineCuts: { cutLength: 4, expandedLines: new LineCuts().expandedLines },
    }).getMatches();
    expect(
      matches.map(({ side, lineNumber, startCharacter }) => [
        side,
        lineNumber,
        startCharacter,
      ])
    ).toEqual([
      ['deletions', 1, 4],
      ['additions', 2, 6],
      ['deletions', 2, 0],
      ['deletions', 2, 5],
      ['additions', 3, 0],
      ['additions', 3, 5],
    ]);
  });
});

describe('CodeViewSearchScan diff line matching', () => {
  test('plain text and escaped regex match separate source-line searches across diff modes', () => {
    const diffs = [
      ...createDiffFixtures(),
      parseDiffFromFile(
        { name: 'a', contents: 'old\nline.* line.*\nline\n' },
        { name: 'a', contents: 'new\ninserted\nline.* line.*\nline\n' },
        { disableLineMatching: true }
      ),
    ];
    for (const fileDiff of diffs) {
      for (const diffStyle of ['split', 'unified'] satisfies (
        | 'split'
        | 'unified'
      )[]) {
        for (const additionsOnly of [false, true]) {
          for (const additionContents of [
            undefined,
            fileDiff.additionLines
              .join('')
              .replaceAll('line', 'edited line line'),
          ]) {
            const item: CodeViewSearchDiff = {
              type: 'diff',
              itemId: 'a',
              fileDiff,
              diffStyle,
              additionsOnly,
              additionContents,
            };
            for (const text of [
              'line',
              'LINE',
              'context',
              'line.*',
              'line ',
              'missing',
            ]) {
              for (const wholeWord of [false, true]) {
                const searchParams = { ...params, text, wholeWord };
                const expected = expectedDiffMatches(item, searchParams);
                expect(scanItem(item, searchParams).getMatches()).toEqual(
                  expected
                );
                expect(
                  scanItem(item, {
                    ...searchParams,
                    regex: true,
                    text: text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
                  }).getMatches()
                ).toEqual(expected);
              }
            }
          }
        }
      }
    }
  });

  test('unchanged split rows keep old-side matches first and each sides line spans', () => {
    const item: CodeViewSearchDiff = {
      type: 'diff',
      itemId: 'a',
      diffStyle: 'split',
      additionsOnly: false,
      fileDiff: parseDiffFromFile(
        { name: 'a', contents: 'old\nline line line\nline\nlast\n' },
        { name: 'a', contents: 'new\ninserted\nline line line\nline\nlast\n' },
        { disableLineMatching: true }
      ),
    };
    const scan = scanItem(item);
    expect(
      scan
        .getMatches()
        .map(
          ({ side, lineNumber, lineIndex, startCharacter, endCharacter }) => [
            side,
            lineNumber,
            lineIndex,
            startCharacter,
            endCharacter,
          ]
        )
    ).toEqual([
      ['deletions', 2, 1, 0, 4],
      ['deletions', 2, 1, 5, 9],
      ['deletions', 2, 1, 10, 14],
      ['additions', 3, 2, 0, 4],
      ['additions', 3, 2, 5, 9],
      ['additions', 3, 2, 10, 14],
      ['deletions', 3, 2, 0, 4],
      ['additions', 4, 3, 0, 4],
    ]);
    const entry = scan.getFirstMatchedEntryAtOrAfter(0);
    expect(entry?.deletionLines).toEqual([
      { lineNumber: 2, startIndex: 0, endIndex: 3 },
      { lineNumber: 3, startIndex: 6, endIndex: 7 },
    ]);
    expect(entry?.additionLines).toEqual([
      { lineNumber: 3, startIndex: 3, endIndex: 6 },
      { lineNumber: 4, startIndex: 7, endIndex: 8 },
    ]);
    for (const regex of [false, true]) {
      const searchParams = { ...params, regex };
      const unlimited = scanItem(item, searchParams, Infinity).getMatches();
      for (const limit of [3, 4, 5, 6, 8]) {
        const capped = scanItem(item, searchParams, limit);
        expect(capped.finished).toBe(true);
        expect(capped.atLimit).toBe(true);
        expect(capped.getMatches()).toHaveLength(limit);
        expect(capped.getMatches()).toEqual(unlimited.slice(0, limit));
        expect(capped.getLineMatches(0, 2, 'deletions')).toEqual({
          lineNumber: 2,
          startIndex: 0,
          endIndex: 3,
        });
        expect(capped.getLineMatches(0, 3, 'additions')).toEqual(
          limit > 3
            ? { lineNumber: 3, startIndex: 3, endIndex: Math.min(limit, 6) }
            : undefined
        );
      }
    }
  });

  test('unchanged rows with unequal stored final endings still find both sides', () => {
    for (const ending of ['\n', '\r\n']) {
      for (const reverse of [false, true]) {
        const fileDiff = parseDiffFromFile(
          { name: 'a', contents: `old\nline line${reverse ? '' : ending}` },
          { name: 'a', contents: `new\nline line${reverse ? ending : ''}` },
          { disableLineMatching: true, ignoreWhitespace: true }
        );
        const item: CodeViewSearchDiff = {
          type: 'diff',
          itemId: 'a',
          fileDiff,
          diffStyle: 'split',
          additionsOnly: false,
        };
        for (const regex of [false, true]) {
          const searchParams = { ...params, regex };
          const matches = scanItem(item, searchParams).getMatches();
          expect(matches).toEqual(expectedDiffMatches(item, searchParams));
          expect(
            matches.map(
              ({ side, lineNumber, startCharacter, endCharacter }) => [
                side,
                lineNumber,
                startCharacter,
                endCharacter,
              ]
            )
          ).toEqual([
            ['deletions', 2, 0, 4],
            ['deletions', 2, 5, 9],
            ['additions', 2, 0, 4],
            ['additions', 2, 5, 9],
          ]);
        }
      }
    }
  });

  test('literal end-of-line and whole-word matches keep coordinates for LF, CRLF and CR', () => {
    for (const ending of ['\n', '\r\n', '\r']) {
      const fileDiff = parseDiffFromFile(
        { name: 'a', contents: `old\nprefix target${ending}` },
        { name: 'a', contents: `new\nprefix target${ending}` },
        { disableLineMatching: true }
      );
      for (const diffStyle of ['split', 'unified'] satisfies (
        | 'split'
        | 'unified'
      )[]) {
        for (const additionsOnly of [false, true]) {
          const item: CodeViewSearchDiff = {
            type: 'diff',
            itemId: 'a',
            fileDiff,
            diffStyle,
            additionsOnly,
          };
          for (const wholeWord of [false, true]) {
            const searchParams = { ...params, text: 'target', wholeWord };
            const matches = scanItem(item, searchParams).getMatches();
            expect(matches).toEqual(expectedDiffMatches(item, searchParams));
            expect(
              matches.map(
                ({ side, lineNumber, startCharacter, endCharacter }) => [
                  side,
                  lineNumber,
                  startCharacter,
                  endCharacter,
                ]
              )
            ).toEqual(
              diffStyle === 'split' && !additionsOnly
                ? [
                    ['deletions', 2, 7, 13],
                    ['additions', 2, 7, 13],
                  ]
                : [['additions', 2, 7, 13]]
            );
            expect(
              scanItem(item, { ...searchParams, regex: true }).getMatches()
            ).toEqual(matches);
            expect(
              scanItem(item, { ...searchParams, text: 'target ' }).getMatches()
            ).toEqual([]);
          }
        }
      }
    }
  });

  test('regex whitespace, negated classes and empty anchors still exclude diff endings', () => {
    for (const ending of ['\n', '\r\n', '\r']) {
      const fileDiff = parseDiffFromFile(
        { name: 'a', contents: `x old\nx  ${ending}` },
        { name: 'a', contents: `x new\nx  ${ending}` },
        { disableLineMatching: true }
      );
      for (const diffStyle of ['split', 'unified'] satisfies (
        | 'split'
        | 'unified'
      )[]) {
        for (const additionsOnly of [false, true]) {
          const item: CodeViewSearchDiff = {
            type: 'diff',
            itemId: 'a',
            fileDiff,
            diffStyle,
            additionsOnly,
          };
          for (const text of ['\\s+$', '[^x]+', '$']) {
            const searchParams = { ...params, text, regex: true };
            const matches = scanItem(item, searchParams).getMatches();
            expect(matches).toEqual(expectedDiffMatches(item, searchParams));
            expect(
              matches
                .filter(({ lineNumber }) => lineNumber === 2)
                .map(({ startCharacter, endCharacter }) => [
                  startCharacter,
                  endCharacter,
                ])
            ).toEqual(
              text === '$'
                ? []
                : diffStyle === 'split' && !additionsOnly
                  ? [
                      [1, 3],
                      [1, 3],
                    ]
                  : [[1, 3]]
            );
          }
        }
      }
    }
  });
});

describe('CodeViewSearchScan', () => {
  test('budgeted scans match full scans across files, diff styles, scopes and edited documents', () => {
    const full = createLargeDiff();
    const padding = ' '.repeat(65_536);
    const partial = processPatch(
      `--- a/large\n+++ b/large\n@@ -4,2 +4,2 @@\n-line old${padding}\n+line new${padding}\n line context${padding}\n`
    ).files[0];
    if (partial == null) throw new Error('Expected partial diff');
    const contents = `line edited${' '.repeat(65_536)}\r\nline last`;
    const document = new TextDocument('file:///edited', contents);
    document.applyEdits(
      [
        {
          range: {
            start: { line: 1, character: 5 },
            end: { line: 1, character: 9 },
          },
          newText: 'changed',
        },
      ],
      false
    );
    const items: CodeViewSearchItem[] = [
      { type: 'file', itemId: 'a', contents },
      { type: 'file', itemId: 'a', contents: document.getText() },
    ];
    for (const fileDiff of [full, partial]) {
      for (const diffStyle of ['split', 'unified'] satisfies (
        | 'split'
        | 'unified'
      )[]) {
        for (const scoped of [false, true]) {
          items.push({
            type: 'diff',
            itemId: 'a',
            fileDiff,
            diffStyle,
            additionsOnly: scoped,
          });
          items.push({
            type: 'diff',
            itemId: 'a',
            fileDiff,
            diffStyle,
            additionsOnly: scoped,
            additionContents: document.getText(),
          });
        }
      }
    }
    for (const item of items) {
      const full = new CodeViewSearchScan(
        params,
        1,
        () => item,
        MAX_SEARCH_MATCHES
      );
      full.advance();
      withClock(() => {
        const sliced = new CodeViewSearchScan(
          params,
          1,
          () => item,
          MAX_SEARCH_MATCHES
        );
        let slices = 0;
        while (!sliced.finished) {
          sliced.advance(1);
          slices++;
        }
        expect(slices).toBeGreaterThan(1);
        expect(sliced.getMatches()).toEqual(full.getMatches());
      });
    }
  });

  test('publishes complete items, prepares lazily once, and joins matches from the starting item', () => {
    const contents = `line${' '.repeat(65_536)}\nline${' '.repeat(65_536)}`;
    const documents = new Map([
      ['a', new TextDocument('file:///a', contents)],
      ['b', new TextDocument('file:///b', 'line b')],
    ]);
    const prepared: string[] = [];
    withClock(() => {
      const scan = new CodeViewSearchScan(
        params,
        2,
        (position) => {
          const id = position === 0 ? 'b' : 'a';
          prepared.push(id);
          const document = documents.get(id);
          if (document == null) throw new Error(`Missing test document ${id}`);
          return { itemId: id, type: 'file', contents: document.getText() };
        },
        MAX_SEARCH_MATCHES,
        1
      );
      expect(prepared).toEqual([]);
      scan.advance(1);
      expect(prepared).toEqual(['a']);
      expect(scan.finished).toBe(false);
      expect(scan.getItemMatches(1)).toBeUndefined();
      expect(scan.getLineMatches(1, 1)).toBeUndefined();
      expect(scan.getMatches()).toEqual([]);
      while (!scan.finished) scan.advance(1);
      expect(prepared).toEqual(['a', 'b']);
      const matches = scan.getMatches();
      expect(matches.map(({ itemId }) => itemId)).toEqual(['a', 'a', 'b']);
      expect(scan.getMatches()).toBe(matches);
      const lines = scan.getLineMatches(1, 1);
      expect(lines).toEqual({ lineNumber: 1, startIndex: 0, endIndex: 1 });
      const itemMatches = scan.getItemMatches(1);
      if (lines == null || itemMatches == null)
        throw new Error('Expected the completed first line');
      const lineMatches = [];
      for (let index = lines.startIndex; index < lines.endIndex; index++)
        lineMatches.push(itemMatches[index]);
      expect(lineMatches).toEqual(itemMatches.slice(0, 1));
      expect(scan.getLineMatches(1, 1)).toBe(lines);
      scan.advance(1);
      expect(prepared).toEqual(['a', 'b']);
    });
  });

  test('joins matched items across the wrap and finds them by document position', () => {
    const contents = [
      'line before first',
      'missing',
      'line before second',
      'missing',
      'line after first',
      'missing',
      'missing',
      'line after second',
    ];
    const padding = ' '.repeat(65_536);
    withClock(() => {
      const scan = new CodeViewSearchScan(
        params,
        contents.length,
        (position) => ({
          itemId: `item-${position}`,
          type: 'file',
          contents: `${contents[position]}${padding}`,
        }),
        MAX_SEARCH_MATCHES,
        4
      );
      while (scan.getItemMatches(7) == null) scan.advance(1);
      const later = scan.getItemMatches(7)?.[0];
      if (later == null) throw new Error('Expected later match');
      expect(scan.getMatches().map(({ itemId }) => itemId)).toEqual([
        'item-4',
        'item-7',
      ]);
      expect(scan.getMatchIndex(7, later)).toBe(1);
      expect(scan.getFirstMatchedEntryAtOrAfter(0)?.position).toBe(4);
      expect(scan.hasPendingItems(0, 8)).toBe(true);
      expect(scan.hasPendingItems(4, 8)).toBe(false);
      while (!scan.finished) scan.advance(1);
      expect(scan.getMatches().map(({ itemId }) => itemId)).toEqual([
        'item-4',
        'item-7',
        'item-0',
        'item-2',
      ]);
      expect(scan.getMatchIndex(7, later)).toBe(1);
      expect(scan.getMatchIndex(7, { ...later })).toBe(1);
      expect(scan.getFirstMatchedEntryAtOrAfter(0)?.position).toBe(0);
      expect(scan.getFirstMatchedEntryAtOrAfter(1)?.position).toBe(2);
      expect(scan.getFirstMatchedEntryAtOrAfter(3)?.position).toBe(4);
      expect(scan.getFirstMatchedEntryAtOrAfter(5)?.position).toBe(7);
      expect(scan.getFirstMatchedEntryAtOrAfter(8)).toBeUndefined();
      expect(scan.hasPendingItems(0, 8)).toBe(false);
      expect(scan.getItemMatches(1)).toBeUndefined();
      expect(scan.getItemMatches(3)).toBeUndefined();
      expect(scan.getItemMatches(5)).toBeUndefined();
      expect(scan.getItemMatches(6)).toBeUndefined();
    });
  });

  test('matches in the starting item keep their indexes when the scan wraps', () => {
    withClock(() => {
      const ids = ['first', 'second', 'middle', 'last'];
      const contents = `line line${' '.repeat(65_536)}`;
      const scan = new CodeViewSearchScan(
        params,
        ids.length,
        (position) => ({ type: 'file', itemId: ids[position], contents }),
        MAX_SEARCH_MATCHES,
        2
      );
      while (scan.getMatches().length === 0 && !scan.finished) scan.advance(1);
      const startingMatches = scan.getMatches();
      expect(startingMatches.map(({ itemId }) => itemId)).toEqual([
        'middle',
        'middle',
      ]);
      for (const [index, match] of startingMatches.entries()) {
        expect(scan.getMatchIndex(2, match)).toBe(index);
      }

      while (!scan.finished) scan.advance(1);
      expect(scan.getMatches().map(({ itemId }) => itemId)).toEqual([
        'middle',
        'middle',
        'last',
        'last',
        'first',
        'first',
        'second',
        'second',
      ]);
      for (const [index, match] of startingMatches.entries()) {
        expect(scan.getMatches()[index]).toBe(match);
        expect(scan.getMatchIndex(2, match)).toBe(index);
      }
    });
  });

  test('publishes capped partial items and never prepares later items', () => {
    const prepared: string[] = [];
    const scan = new CodeViewSearchScan(
      params,
      2,
      (position) => {
        const id = position === 0 ? 'a' : 'b';
        prepared.push(id);
        return { itemId: id, type: 'file', contents: 'line line\nline line' };
      },
      3
    );
    scan.advance();
    expect(scan.finished).toBe(true);
    expect(prepared).toEqual(['a']);
    expect(
      scan
        .getItemMatches(0)
        ?.map(({ lineNumber, startCharacter }) => [lineNumber, startCharacter])
    ).toEqual([
      [1, 0],
      [1, 5],
      [2, 0],
    ]);
    expect(scan.getItemMatches(1)).toBeUndefined();
  });

  test('empty and invalid queries, empty item lists and zero caps never prepare items', () => {
    const prepare = mock(
      (): CodeViewSearchItem => ({
        itemId: 'a',
        type: 'file',
        contents: 'line',
      })
    );
    for (const searchParams of [
      { ...params, text: '' },
      { ...params, text: '[', regex: true },
    ]) {
      const scan = new CodeViewSearchScan(
        searchParams,
        1,
        prepare,
        MAX_SEARCH_MATCHES
      );
      scan.advance(1);
      expect(scan.finished).toBe(true);
      expect(scan.getMatches()).toEqual([]);
    }
    for (const scan of [
      new CodeViewSearchScan(params, 0, prepare, MAX_SEARCH_MATCHES),
      new CodeViewSearchScan(params, 1, prepare, 0),
    ]) {
      scan.advance(1);
      expect(scan.finished).toBe(true);
    }
    expect(prepare).not.toHaveBeenCalled();
  });

  test('a file of only empty lines is still sliced', () => {
    const document = new TextDocument(
      'file:///empty-lines',
      '\n'.repeat(131_072)
    );
    const getItem = (): CodeViewSearchItem => ({
      itemId: 'a',
      type: 'file',
      contents: document.getText(),
    });
    const full = new CodeViewSearchScan(params, 1, getItem, MAX_SEARCH_MATCHES);
    full.advance();
    withClock(() => {
      const scan = new CodeViewSearchScan(
        params,
        1,
        getItem,
        MAX_SEARCH_MATCHES
      );
      scan.advance(1);
      expect(scan.finished).toBe(false);
      expect(scan.getItemMatches(0)).toBeUndefined();
      while (!scan.finished) scan.advance(1);
      expect(scan.getMatches()).toEqual(full.getMatches());
    });
  });
});

describe('CodeViewSearchScan edited diffs', () => {
  test('requests resolved diff data once and keeps its original source coordinates', () => {
    const fileDiff = parseDiffFromFile(
      { name: 'a', contents: 'line before\ncontext' },
      { name: 'a', contents: 'line after\ncontext' },
      { disableLineMatching: true }
    );
    const document = new TextDocument(
      'file:///edited-diff',
      'line edited\ncontext'
    );
    const provide = mock(
      (): CodeViewSearchItem => ({
        itemId: 'a',
        type: 'diff',
        fileDiff,
        additionContents: document.getText(),
        diffStyle: 'split',
        additionsOnly: false,
      })
    );
    const scan = new CodeViewSearchScan(params, 1, provide, MAX_SEARCH_MATCHES);
    expect(provide).not.toHaveBeenCalled();
    scan.advance();
    expect(provide).toHaveBeenCalledTimes(1);
    expect(
      scan
        .getMatches()
        .map(
          ({ side, lineNumber, lineIndex, startCharacter, endCharacter }) => [
            side,
            lineNumber,
            lineIndex,
            startCharacter,
            endCharacter,
          ]
        )
    ).toEqual([
      ['deletions', 1, 0, 0, 4],
      ['additions', 1, 0, 0, 4],
    ]);
    scan.advance();
    expect(provide).toHaveBeenCalledTimes(1);
  });
});

// Expected records prove item identity and edited source coordinates independently of slicing.
test('file and scoped edited matches preserve every source field', () => {
  const document = new TextDocument(
    'file:///coordinates',
    'target stale\r\nold target'
  );
  document.applyEdits(
    [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 6 },
        },
        newText: 'new',
      },
    ],
    false
  );
  const fileDiff = parseDiffFromFile(
    { name: 'a', contents: 'target deleted' },
    { name: 'a', contents: 'target stale\r\nold target' },
    { disableLineMatching: true }
  );
  const fixtures: CodeViewSearchItem[] = [
    {
      type: 'file',
      itemId: 'coordinates',
      contents: 'target first\r\nlast target',
    },
    { type: 'file', itemId: 'coordinates', contents: document.getText() },
    {
      type: 'diff',
      itemId: 'coordinates',
      fileDiff,
      diffStyle: 'split',
      additionsOnly: true,
      additionContents: document.getText(),
    },
    {
      type: 'diff',
      itemId: 'coordinates',
      fileDiff,
      diffStyle: 'unified',
      additionsOnly: true,
      additionContents: document.getText(),
    },
  ];
  for (const [index, item] of fixtures.entries()) {
    const scan = new CodeViewSearchScan(
      { ...params, text: 'target' },
      1,
      () => item,
      MAX_SEARCH_MATCHES
    );
    scan.advance();
    expect(scan.getMatches()).toEqual(
      index === 0
        ? [
            {
              itemId: 'coordinates',
              itemType: 'file',
              side: undefined,
              lineNumber: 1,
              lineIndex: 0,
              startCharacter: 0,
              endCharacter: 6,
            },
            {
              itemId: 'coordinates',
              itemType: 'file',
              side: undefined,
              lineNumber: 2,
              lineIndex: 1,
              startCharacter: 5,
              endCharacter: 11,
            },
          ]
        : [
            {
              itemId: 'coordinates',
              itemType: item.type,
              side: item.type === 'diff' ? 'additions' : undefined,
              lineNumber: 2,
              lineIndex: 1,
              startCharacter: 4,
              endCharacter: 10,
            },
          ]
    );
  }
});
