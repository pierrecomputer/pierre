import { describe, expect, test } from 'bun:test';

import { TextDocument } from '../src/editor/textDocument';
import { FileLayout } from '../src/layout/FileLayout';
import { FileModel } from '../src/model/FileModel';
import { RowSource } from '../src/rows/RowSource';
import type { FileContents, RenderRange } from '../src/types';
import { getLineAnnotationName } from '../src/utils/getLineAnnotationName';
import { hastToHtml } from '../src/utils/hastToHtml';

const FILE: FileContents = {
  name: 'model.ts',
  contents: 'alpha\nbravo\ncharlie\n',
};

const ALL: RenderRange = {
  startingLine: 0,
  totalLines: 100,
  bufferBefore: 0,
  bufferAfter: 0,
};

function makeDocument(file: FileContents): TextDocument<'file', undefined> {
  return new TextDocument<'file', undefined>(
    'inmemory://file-model',
    file.contents,
    'typescript'
  );
}

function layoutFor(): FileLayout<undefined> {
  return new FileLayout();
}

function plainRows(model: FileModel): RowSource {
  return new RowSource({
    deletionRows: [],
    additionRows: [],
    additionLines: [],
    lineIds: model.live ? model.lineIds() : undefined,
  });
}

describe('FileModel', () => {
  test('a model has the editor document lines, with the empty last line', () => {
    const model = FileModel.fromFile(FILE);
    expect(model.live).toBe(false);
    expect(model.lineCount).toBe(4);
    expect(model.lines).toEqual(['alpha\n', 'bravo\n', 'charlie\n', '']);
    expect(model.lineText(1)).toBe('bravo\n');
    expect(model.lineId(2)).toBe(2);
    expect(model.lineOf(5)).toBeUndefined();
    expect(FileModel.fromFile({ ...FILE, contents: '' }).lineCount).toBe(1);
    expect(FileModel.fromFile({ ...FILE, contents: 'x' }).lineCount).toBe(1);
  });

  test('a session copies the file without its cache key', () => {
    const model = FileModel.startEditSession({ ...FILE, cacheKey: 'k' });
    expect(model.live).toBe(true);
    expect(model.lineCount).toBe(4);
    expect(model.file).toEqual(FILE);
    expect(model.file.cacheKey).toBeUndefined();
  });

  test('a session started from retained edits takes their lines', () => {
    const model = FileModel.startEditSession(FILE, {
      name: 'renamed.ts',
      contents: 'one\ntwo',
    });
    expect(model.lineCount).toBe(2);
    expect(model.file).toEqual({
      name: 'renamed.ts',
      contents: 'one\ntwo',
    });
  });

  test('edits keep ids, report changed lines and removed ids, and keep the file current', () => {
    const document = makeDocument(FILE);
    const model = FileModel.startEditSession(FILE);
    const idOfCharlie = model.lineId(2);
    const typed = document.applyEdits([
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 },
        },
        newText: 'X',
      },
    ])!;
    expect(model.applyChange(typed, document)).toEqual({
      changedLines: [1],
      removedLineIds: [],
      lineDelta: 0,
    });
    expect(model.lineText(1)).toBe('Xbravo\n');

    const split = document.applyEdits([
      {
        range: {
          start: { line: 1, character: 1 },
          end: { line: 1, character: 1 },
        },
        newText: '\n',
      },
    ])!;
    const change = model.applyChange(split, document);
    expect(change.lineDelta).toBe(1);
    expect(change.changedLines).toEqual([1, 2]);
    expect(model.lineCount).toBe(5);
    expect(model.lineId(3)).toBe(idOfCharlie);
    expect(model.lineOf(idOfCharlie)).toBe(3);

    const removed = document.applyEdits([
      {
        range: {
          start: { line: 2, character: 0 },
          end: { line: 3, character: 0 },
        },
        newText: '',
      },
    ])!;
    expect(model.applyChange(removed, document).removedLineIds).toHaveLength(1);
    expect(model.file.contents).toBe(document.getText());
  });

  test('a line break completed across a line keeps the file current', () => {
    const file: FileContents = { name: 'crlf.ts', contents: 'a\rb' };
    const document = makeDocument(file);
    const model = FileModel.startEditSession(file);
    const paired = document.applyEdits([
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 },
        },
        newText: '\n',
      },
    ])!;
    expect(model.applyChange(paired, document).lineDelta).toBe(0);
    expect(model.file.contents).toBe('a\r\nb');
    expect(model.lineText(0)).toBe('a\r\n');
  });
});

describe('FileLayout', () => {
  test('lays out one context row per line with single line numbers', () => {
    const model = FileModel.fromFile(FILE);
    const { column, rowCount, totalLines } = layoutFor().layout({
      model,
      rows: plainRows(model),
      renderRange: ALL,
      annotations: {},
      annotationSlotName: getLineAnnotationName,
    });
    expect(totalLines).toBe(4);
    expect(rowCount).toBe(4);
    expect(column.map((spec) => spec.key)).toEqual(['a0', 'a1', 'a2', 'a3']);
    expect(hastToHtml(column[1].content)).toBe(
      '<div data-line="2" data-line-type="context" data-line-index="1"><span data-char="0">bravo</span></div>'
    );
    expect(hastToHtml(column[1].gutter)).toContain('data-column-number="2"');
    expect(hastToHtml(column[1].gutter)).not.toContain('data-alt-line');
  });

  test('renders the file-level and per-line annotation rows in order', () => {
    const model = FileModel.fromFile(FILE);
    const { column, rowCount } = layoutFor().layout({
      model,
      rows: plainRows(model),
      renderRange: ALL,
      annotations: {
        0: [{ lineNumber: 0, metadata: undefined }],
        2: [{ lineNumber: 2, metadata: undefined }],
      },
      annotationSlotName: getLineAnnotationName,
    });
    expect(rowCount).toBe(6);
    expect(column.map((spec) => spec.key)).toEqual([
      'ann:file',
      'a0',
      'a1',
      'ann:a1',
      'a2',
      'a3',
    ]);
    expect(hastToHtml(column[3].content)).toContain('contenteditable="false"');
  });

  test('keys rows by line id in a session and keeps rows for unchanged lines', () => {
    const document = makeDocument(FILE);
    const model = FileModel.startEditSession(FILE);
    const layout = layoutFor();
    const input = {
      model,
      rows: plainRows(model),
      renderRange: ALL,
      annotations: {},
      annotationSlotName: getLineAnnotationName,
    };
    const before = layout.layout(input);
    expect(before.column.map((spec) => spec.key)).toEqual([
      'a0',
      'a1',
      'a2',
      'a3',
    ]);
    const change = document.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        newText: 'new\n',
      },
    ])!;
    model.applyChange(change, document);
    const after = layout.layout(input);
    expect(after.column.map((spec) => spec.key)).toEqual([
      'a0',
      'a4',
      'a1',
      'a2',
      'a3',
    ]);
    // A line below the insert keeps its row text and only renumbers.
    expect(hastToHtml(after.column[2].content)).toContain('data-line="3"');
    expect(hastToHtml(after.column[2].content)).toContain('bravo');
  });
});
