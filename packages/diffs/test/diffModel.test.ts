import { afterAll, describe, expect, test } from 'bun:test';

import {
  TextDocument,
  type TextDocumentChange,
} from '../src/editor/textDocument';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import { DiffModel } from '../src/model/DiffModel';
import { LineMap } from '../src/model/LineMap';
import type { FileDiffMetadata } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';

afterAll(async () => {
  await disposeHighlighter();
});

type Document = TextDocument<'file-diff', undefined>;

function makeLines(
  count: number,
  edits: Record<number, string> = {}
): string[] {
  return Array.from(
    { length: count },
    (_, index) => (edits[index + 1] ?? `line ${index + 1}`) + '\n'
  );
}

const OLD_LINES = makeLines(30);
const NEW_LINES = makeLines(30, { 3: 'changed 3', 20: 'changed 20' });

function makeDiff(
  newLines: string[] = NEW_LINES,
  oldLines: string[] = OLD_LINES
): FileDiffMetadata {
  return parseDiffFromFile(
    { name: 'a.ts', contents: oldLines.join('') },
    { name: 'a.ts', contents: newLines.join('') }
  );
}

function makeDocument(diff: FileDiffMetadata): Document {
  return new TextDocument<'file-diff', undefined>(
    'inmemory://diff-model',
    diff.additionLines.join(''),
    'typescript'
  );
}

function edit(
  document: Document,
  line: number,
  start: number,
  end: number,
  newText: string
): TextDocumentChange {
  const change = document.applyEdits([
    {
      range: {
        start: { line, character: start },
        end: { line, character: end },
      },
      newText,
    },
  ]);
  if (change == null) throw new Error('edit applied nothing');
  return change;
}

describe('LineMap', () => {
  test('a change that removes most of a large file reports every removed id', () => {
    const document = new TextDocument<'file-diff', undefined>(
      'inmemory://large',
      'x\n'.repeat(1_000_000),
      'typescript'
    );
    const map = new LineMap(document.lineCount);
    const change = document.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 999_999, character: 0 },
        },
        newText: '',
      },
    ])!;
    const removed = map.applyChange(change);
    expect(map.lineCount).toBe(document.lineCount);
    expect(removed.length).toBe(999_999);
  });

  test('starts as the identity', () => {
    const map = new LineMap(3);
    expect([0, 1, 2].map((line) => map.idAt(line))).toEqual([0, 1, 2]);
    expect(() => map.idAt(3)).toThrow();
  });

  test('typing keeps every id', () => {
    const document = makeDocument(makeDiff());
    const map = new LineMap(document.lineCount);
    map.applyChange(edit(document, 2, 0, 0, 'x'));
    expect(map.idAt(2)).toBe(2);
    expect(map.lineCount).toBe(document.lineCount);
  });

  test('lineOf follows an id through edits that keep and change the line count', () => {
    const document = makeDocument(makeDiff());
    const map = new LineMap(document.lineCount);
    const idOfLine3 = map.idAt(3);
    expect(map.lineOf(idOfLine3)).toBe(3);
    map.applyChange(edit(document, 1, 0, 0, 'x'));
    expect(map.lineOf(idOfLine3)).toBe(3);
    map.applyChange(edit(document, 0, 0, 0, 'new\n'));
    expect(map.lineOf(idOfLine3)).toBe(4);
    map.applyChange(edit(document, 0, 0, 0, 'other\n'));
    expect(map.lineOf(idOfLine3)).toBe(5);
  });

  test('Enter gives the new line a fresh id and shifts the rest', () => {
    const document = makeDocument(makeDiff());
    const map = new LineMap(document.lineCount);
    const idOfLine3 = map.idAt(3);
    map.applyChange(edit(document, 2, 4, 4, '\n'));
    expect(map.idAt(2)).toBe(2);
    expect(map.idAt(3)).toBe(31);
    expect(map.idAt(4)).toBe(idOfLine3);
    expect(map.lineCount).toBe(document.lineCount);
  });

  test('a change reports the ids of the lines it removed', () => {
    const document = makeDocument(makeDiff());
    const map = new LineMap(document.lineCount);
    const idOfLine4 = map.idAt(4);
    const idOfLine5 = map.idAt(5);
    expect(map.applyChange(edit(document, 1, 0, 0, 'x'))).toEqual([]);
    // Deleting lines 3 and 4: the first line of the span keeps its id for
    // the text that follows, and the ids of the two lines after it go.
    const removed = map.applyChange(
      document.applyEdits([
        {
          range: {
            start: { line: 3, character: 0 },
            end: { line: 5, character: 0 },
          },
          newText: '',
        },
      ])!
    );
    expect(removed).toEqual([idOfLine4, idOfLine5]);
  });

  test('joining lines drops the removed id and keeps the ones below', () => {
    const document = makeDocument(makeDiff());
    const map = new LineMap(document.lineCount);
    const idOfLine6 = map.idAt(6);
    // Delete the line break at the end of line 5, joining lines 5 and 6.
    map.applyChange(
      document.applyEdits([
        {
          range: {
            start: { line: 4, character: 'line 5'.length },
            end: { line: 5, character: 0 },
          },
          newText: '',
        },
      ])!
    );
    expect(map.idAt(4)).toBe(4);
    expect(map.idAt(5)).toBe(idOfLine6);
    expect(map.lineCount).toBe(document.lineCount);
  });

  test('a paste keeps the first replaced line’s id and adds the rest', () => {
    const document = makeDocument(makeDiff());
    const map = new LineMap(document.lineCount);
    const idOfLine1 = map.idAt(1);
    map.applyChange(edit(document, 0, 0, 6, 'a\nb\nc'));
    expect(map.idAt(0)).toBe(0);
    expect(map.idAt(1)).toBe(31);
    expect(map.idAt(2)).toBe(32);
    expect(map.idAt(3)).toBe(idOfLine1);
  });

  test('a batch applies its edits from the last line up', () => {
    const document = makeDocument(makeDiff());
    const map = new LineMap(document.lineCount);
    const idOfLine10 = map.idAt(10);
    const idOfLine20 = map.idAt(20);
    const change = document.applyEdits([
      {
        range: {
          start: { line: 5, character: 0 },
          end: { line: 5, character: 0 },
        },
        newText: 'inserted\n',
      },
      {
        range: {
          start: { line: 15, character: 0 },
          end: { line: 16, character: 0 },
        },
        newText: '',
      },
    ])!;
    map.applyChange(change);
    expect(change.lineDelta).toBe(0);
    expect(map.idAt(5)).toBe(5);
    expect(map.idAt(11)).toBe(idOfLine10);
    expect(map.idAt(20)).toBe(idOfLine20);
    expect(map.lineCount).toBe(document.lineCount);
  });

  test('an inserted carriage return is a line break like any other', () => {
    const document = new TextDocument<'file-diff', undefined>(
      'inmemory://crlf',
      'a\nb',
      'typescript'
    );
    const map = new LineMap(document.lineCount);
    map.applyChange(edit(document, 0, 1, 1, '\r'));
    expect(document.getText()).toBe('a\n\nb');
    expect(document.lineCount).toBe(3);
    expect(map.lineCount).toBe(3);
    expect([map.idAt(0), map.idAt(2)]).toEqual([0, 1]);
  });

  test('a batch of inserted breaks keeps the ids of the lines below', () => {
    const document = new TextDocument<'file-diff', undefined>(
      'inmemory://crlf-batch',
      'a\nb\nc\nd',
      'typescript'
    );
    const map = new LineMap(document.lineCount);
    const change = document.applyEdits([
      {
        range: {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 1 },
        },
        newText: '\r',
      },
      {
        range: {
          start: { line: 2, character: 1 },
          end: { line: 2, character: 1 },
        },
        newText: '\r',
      },
    ])!;
    expect(document.lineCount).toBe(6);
    map.applyChange(change);
    expect(map.lineCount).toBe(6);
    expect(map.idAt(3)).toBe(2);
    expect(map.idAt(5)).toBe(3);
  });

  test('undo restores the line count with fresh ids for restored lines', () => {
    const document = makeDocument(makeDiff());
    const map = new LineMap(document.lineCount);
    map.applyChange(edit(document, 2, 4, 4, '\n'));
    const [undoChange] = document.undo()!;
    map.applyChange(undoChange);
    expect(map.lineCount).toBe(document.lineCount);
    expect(map.idAt(2)).toBe(2);
    expect(map.idAt(3)).toBe(3);
  });
});

describe('DiffModel line endings', () => {
  test('normalizing a mixed-ending file at session start is a change', () => {
    const lines = ['aa\r\n', 'bb\n', 'cc\n'];
    const diff = makeDiff(lines, lines);
    expect(diff.hunks).toHaveLength(0);
    const model = DiffModel.startEditSession(diff);
    expect(model.diff.additionLines.join('')).toBe('aa\r\nbb\r\ncc\r\n');
    // The lines whose ending changed now differ from the old file.
    expect(model.diff.hunks.length).toBeGreaterThan(0);
    expect(model.diff.editSessionDirty).toBe(true);
    expect(model.finish(3).changed).toBe(true);
    expect(model.diff.hunks.length).toBeGreaterThan(0);
  });

  test('a session holds the text the editor document holds', () => {
    const diff = makeDiff(['aa\r\n', 'bb\n', 'cc\n'], ['aa\r\n', 'cc\n']);
    const model = DiffModel.startEditSession(diff);
    const contents = model.diff.additionLines.join('');
    expect(contents).toBe('aa\r\nbb\r\ncc\r\n');
    expect(contents).toBe(makeDocument(model.diff).getText());
    expect(model.diff.additionCharacterCount).toBe(contents.length);
  });
});

describe('DiffModel pairs', () => {
  test('pairs changed lines by position in their block', () => {
    const model = DiffModel.fromDiff(makeDiff());
    expect(model.live).toBe(false);
    expect(model.pairFor('additions', 2)).toBe(2);
    expect(model.pairFor('deletions', 2)).toBe(2);
    expect(model.pairFor('additions', 19)).toBe(19);
    expect(model.pairFor('additions', 1)).toBeUndefined();
    expect(model.blockAt('additions', 1)?.type).toBe('context');
    expect(model.lineId(7)).toBe(7);
  });

  test('leaves unpaired lines and lines between hunks alone', () => {
    // Lines 3 and 4 replace two old lines; line 31 is a pure insertion.
    const model = DiffModel.fromDiff(
      makeDiff(makeLines(31, { 3: 'changed 3', 4: 'new 4' }))
    );
    expect(model.pairFor('additions', 2)).toBe(2);
    expect(model.pairFor('additions', 3)).toBe(3);
    expect(model.pairFor('deletions', 3)).toBe(3);
    expect(model.blockAt('additions', 30)?.type).toBe('change');
    expect(model.pairFor('additions', 30)).toBeUndefined();
    expect(model.blockAt('additions', 15)).toBeUndefined();
    expect(model.pairFor('additions', 15)).toBeUndefined();
  });

  test('the empty line after a final line break is a document line with no entry', () => {
    // The last block has two old lines and one new line. The document's
    // empty line after the final line break is outside every block.
    const diff = makeDiff(
      makeLines(30, { 30: 'changed 30' }),
      makeLines(31, { 30: 'old 30', 31: 'old 31' })
    );
    const model = DiffModel.startEditSession(diff);
    expect(model.lineCount).toBe(31);
    expect(model.diff.additionLines).toHaveLength(30);
    expect(model.lineText(30)).toBe('');
    expect(model.blockAt('additions', 30)).toBeUndefined();
    expect(model.pairFor('additions', 29)).toBe(29);
    expect(model.pairFor('additions', 30)).toBeUndefined();
    expect(model.pairFor('deletions', 29)).toBe(29);
    expect(model.pairFor('deletions', 30)).toBeUndefined();
  });
});

describe('DiffModel.applyChange', () => {
  test('reports the lines each edit changed', () => {
    const model = DiffModel.startEditSession(makeDiff());
    const document = makeDocument(makeDiff());
    expect(
      model.applyChange(edit(document, 2, 9, 9, 'x'), document).changedLines
    ).toEqual([2]);
    expect(
      model.applyChange(edit(document, 2, 4, 4, '\n'), document).changedLines
    ).toEqual([2, 3]);
    expect(model.lineId(3)).toBe(31);
    expect(model.lineId(4)).toBe(3);
  });
});

describe('DiffModel sessions', () => {
  test('the no-newline marker stays with a hunk that reaches the end of the file', () => {
    const lines = Array.from({ length: 12 }, (_, index) => `line ${index};`);
    const oldContents = lines.join('\n');
    const model = DiffModel.startEditSession(
      parseDiffFromFile(
        { name: 'eof.ts', contents: oldContents },
        {
          name: 'eof.ts',
          contents: oldContents.replace('line 5;', 'changed 5;'),
        }
      )
    );
    const document = makeDocument(model.diff);
    // Collapsed context separates the hunk from the end of the file.
    model.applyChange(edit(document, 5, 10, 10, '\nadded line;'), document);
    expect(model.diff.hunks.at(-1)?.noEOFCRAdditions).toBe(false);
    expect(model.diff.hunks.at(-1)?.noEOFCRDeletions).toBe(false);
    // An edit on the last line brings the hunk to the end of the file.
    model.applyChange(edit(document, 12, 0, 0, 'x'), document);
    expect(model.diff.hunks.at(-1)?.noEOFCRAdditions).toBe(true);
    expect(model.diff.hunks.at(-1)?.noEOFCRDeletions).toBe(true);
  });

  test('line edits copy the input lines once and then edit in place', () => {
    const input = makeDiff();
    const inputLines = input.additionLines;
    const model = DiffModel.startEditSession(input);
    const document = makeDocument(input);
    model.applyChange(edit(document, 10, 0, 0, '>> '), document);
    const owned = model.diff.additionLines;
    expect(owned).not.toBe(inputLines);
    expect(inputLines[10]).not.toContain('>> ');
    model.applyChange(edit(document, 11, 0, 0, '>> '), document);
    expect(model.diff.additionLines).toBe(owned);
    expect(owned[11]).toContain('>> ');
  });

  test('a snapshot resumes a draft against the same old file', () => {
    const input = makeDiff();
    const model = DiffModel.startEditSession(input);
    const document = makeDocument(input);
    model.applyChange(edit(document, 10, 0, 0, '>> '), document);
    expect(model.hasChanges).toBe(true);
    const snapshot = model.snapshot();
    const resumed = DiffModel.startEditSession(makeDiff(), {
      document: { name: 'a.ts', contents: document.getText() },
      snapshot,
    });
    expect(resumed.diff.additionLines).toEqual(model.diff.additionLines);
    expect(resumed.diff.hunks).toEqual(model.diff.hunks);
    expect(resumed.hasChanges).toBe(true);
  });

  test('a snapshot cannot resume against a different old file', () => {
    const input = makeDiff();
    const model = DiffModel.startEditSession(input);
    const other = makeDiff(NEW_LINES, makeLines(30, { 1: 'other' }));
    expect(() =>
      DiffModel.startEditSession(other, {
        document: { name: 'a.ts', contents: input.additionLines.join('') },
        snapshot: model.snapshot(),
      })
    ).toThrow('different old file');
  });

  test('retained edits need their session state', () => {
    expect(() =>
      DiffModel.startEditSession(makeDiff(), {
        document: { name: 'a.ts', contents: 'edited\n' },
      })
    ).toThrow('missing their diff session state');
  });

  test('an empty new file keeps one editable line', () => {
    const input = makeDiff([], OLD_LINES);
    const model = DiffModel.startEditSession(input);
    expect(model.diff.additionLines).toEqual(['']);
    expect(model.diff.hunks.length).toBeGreaterThan(0);
    expect(model.hasChanges).toBe(true);
    expect(input.additionLines).toEqual([]);
  });

  test('expansion survives an edit that keeps the regions', () => {
    const input = makeDiff();
    const model = DiffModel.startEditSession(input);
    const expandedHunks = new Map([[1, { fromStart: 5, fromEnd: 0 }]]);
    const document = makeDocument(input);
    const result = model.applyChange(edit(document, 2, 9, 9, 'x'), document, {
      expandedHunks,
    });
    expect(result.expandedHunks.get(1)).toEqual({ fromStart: 5, fromEnd: 0 });
  });

  test('a static model refuses changes', () => {
    const model = DiffModel.fromDiff(makeDiff());
    const document = makeDocument(makeDiff());
    expect(() =>
      model.applyChange(edit(document, 2, 9, 9, 'x'), document)
    ).toThrow('not live');
  });
});
