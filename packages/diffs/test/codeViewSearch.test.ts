import { describe, expect, mock, test } from 'bun:test';

import { TextDocument } from '../src/editor/textDocument';
import { MAX_SEARCH_MATCHES, type SearchParams } from '../src/search';
import {
  CodeViewSearchDiffCursor,
  type CodeViewSearchItem,
  CodeViewSearchScan,
  CodeViewSearchTextCursor,
} from '../src/search/codeViewSearch';
import type { FileDiffMetadata, SelectionSide } from '../src/types';
import {
  type DiffLineCallbackProps,
  type DiffLineMetadata,
  iterateOverDiff,
} from '../src/utils/iterateOverDiff';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { processPatch } from '../src/utils/parsePatchFiles';

// Includes separated hunks, unequal change sides, and unchanged trailing rows.
function createDiffFixtures(): FileDiffMetadata[] {
  const before = Array.from({ length: 35 }, (_, index) => `line ${index}\n`);
  const after = [...before];
  after.splice(4, 2, 'replacement one\n', 'replacement two\n', 'added\n');
  after.splice(23, 1, 'replacement later\n');
  const full = parseDiffFromFile(
    { name: 'search.txt', contents: before.join('') },
    { name: 'search.txt', contents: after.join('') },
    { context: 1, disableLineMatching: true }
  );
  const partial = processPatch(
    '--- a/search.txt\n+++ b/search.txt\n@@ -4,4 +4,5 @@\n context\n-old one\n-old two\n+new one\n+new two\n+added\n context end\n@@ -20,3 +21,3 @@\n later context\n-old later\n+new later\n final context\n'
  ).files[0];
  if (partial == null) throw new Error('Expected parsed patch fixture');
  return [full, partial];
}

describe('CodeView search diff resume contract', () => {
  test('every starting row reproduces the entire remaining callback metadata', () => {
    for (const diff of createDiffFixtures()) {
      for (const diffStyle of ['split', 'unified'] satisfies (
        | 'split'
        | 'unified'
      )[]) {
        const full: DiffLineCallbackProps[] = [];
        iterateOverDiff({
          diff,
          diffStyle,
          expandedHunks: true,
          callback: (row) => {
            full.push(row);
          },
        });
        expect(full.length).toBeGreaterThan(0);
        for (
          let startingLine = 0;
          startingLine <= full.length;
          startingLine++
        ) {
          const resumed: DiffLineCallbackProps[] = [];
          iterateOverDiff({
            diff,
            diffStyle,
            expandedHunks: true,
            startingLine,
            callback: (row) => {
              resumed.push(row);
            },
          });
          expect(resumed).toEqual(full.slice(startingLine));
        }
      }
    }
  });
});

// Records source coordinates as well as text so resume cannot silently change a side.
type VisitedLine = [string, SelectionSide | undefined, number, number];

const params: SearchParams = {
  text: 'line',
  replaceText: '',
  regex: false,
  wholeWord: false,
  caseSensitive: false,
};

// Uses the existing row iterator to describe the source lines each style searches.
function expectedDiffLines(
  diff: FileDiffMetadata,
  diffStyle: 'split' | 'unified',
  scoped: boolean
): VisitedLine[] {
  const lines: VisitedLine[] = [];
  const add = (
    side: SelectionSide,
    line: DiffLineMetadata | undefined
  ): void => {
    if (line == null) return;
    const text = (
      side === 'additions' ? diff.additionLines : diff.deletionLines
    )[line.lineIndex];
    if (text != null)
      lines.push([
        text.replace(/[\r\n]+$/, ''),
        side,
        line.lineNumber,
        line.lineIndex,
      ]);
  };
  iterateOverDiff({
    diff,
    diffStyle,
    expandedHunks: true,
    callback: ({ additionLine, deletionLine }) => {
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
    },
  });
  return lines;
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
        !cursor.walk((...line) => {
          lines.push(line);
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
      new CodeViewSearchDiffCursor({
        type: 'diff',
        itemId: 'a',
        fileDiff,
        diffStyle: 'split',
        additionsOnly: false,
      }),
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
    const cursor = new CodeViewSearchDiffCursor({
      type: 'diff',
      itemId: 'a',
      fileDiff: createLargeDiff(),
      diffStyle: 'split',
      additionsOnly: false,
      additionContents: document.getText(),
    });
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
            const cursor = new CodeViewSearchDiffCursor({
              type: 'diff',
              itemId: 'a',
              fileDiff: diff,
              diffStyle,
              additionsOnly: scoped,
            });
            const lines: VisitedLine[] = [];
            cursor.walk((...line) => {
              lines.push(line);
              return lines.length === stopAt + 1;
            });
            cursor.walk((...line) => {
              lines.push(line);
              return false;
            });
            expect(lines).toEqual(expected);
          }
          const cursor = new CodeViewSearchDiffCursor({
            type: 'diff',
            itemId: 'a',
            fileDiff: diff,
            diffStyle,
            additionsOnly: scoped,
          });
          const lines: VisitedLine[] = [];
          while (
            !cursor.walk((...line) => {
              lines.push(line);
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

  test('publishes complete items, prepares lazily once, and joins constructor item order', () => {
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
      expect(matches.map(({ itemId }) => itemId)).toEqual(['b', 'a', 'a']);
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

  test('joins matched items across the wrap and adjusts indices after earlier matches arrive', () => {
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
        'item-0',
        'item-2',
        'item-4',
        'item-7',
      ]);
      expect(scan.getMatchIndex(7, later)).toBe(3);
      expect(scan.getMatchIndex(7, { ...later })).toBe(3);
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
