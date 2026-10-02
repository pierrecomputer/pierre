import { describe, expect, test } from 'bun:test';

import { getChangedDocumentLines } from '../src/editor/getChangedDocumentLines';
import { TextDocument } from '../src/editor/textDocument';

describe('changed document lines', () => {
  for (const contents of [
    'first\nsecond\nthird\n',
    'first\nsecond\nthird',
    'first\r\nsecond\r\nthird\r\n',
    'first\rsecond\rthird',
    'first\r\n\nthird\rfourth',
    '',
  ]) {
    test(`whole-document edits preserve line endings (${JSON.stringify(contents)})`, () => {
      const document = new TextDocument('lines.txt', contents);
      const change = document.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: {
              line: document.lineCount - 1,
              character: document.getLineLength(document.lineCount - 1),
            },
          },
          newText: `edited ${contents}`,
        },
      ]);
      if (change == null) throw new Error('Expected a document change');
      expect(Array.from(getChangedDocumentLines(document, change))).toEqual(
        Array.from({ length: document.lineCount }, (_, line) => [
          line,
          document.getLineText(line, true),
        ])
      );
    });
  }

  test('a multi-line range excludes the following untouched line', () => {
    const document = new TextDocument(
      'lines.txt',
      'first\nsecond\nthird\nfourth\n'
    );
    const change = document.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 1, character: 6 },
        },
        newText: 'changed first\nchanged second',
      },
    ]);
    if (change == null) throw new Error('Expected a document change');
    expect(Array.from(getChangedDocumentLines(document, change))).toEqual([
      [0, 'changed first\n'],
      [1, 'changed second\n'],
    ]);
  });

  test('separate same-line edits exclude the untouched lines between them', () => {
    const document = new TextDocument(
      'lines.txt',
      'first\nsecond\nthird\nfourth'
    );
    const change = document.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        newText: 'edited ',
      },
      {
        range: {
          start: { line: 3, character: 0 },
          end: { line: 3, character: 0 },
        },
        newText: 'edited ',
      },
    ]);
    if (change == null) throw new Error('Expected a document change');
    expect(Array.from(getChangedDocumentLines(document, change))).toEqual([
      [0, 'edited first\n'],
      [3, 'edited fourth'],
    ]);
  });

  test('adding and removing a line includes the lines whose numbers changed', () => {
    const document = new TextDocument(
      'lines.txt',
      'first\nsecond\nthird\nfourth\nfifth'
    );
    const change = document.applyEdits([
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 },
        },
        newText: 'inserted\n',
      },
      {
        range: {
          start: { line: 3, character: 0 },
          end: { line: 4, character: 0 },
        },
        newText: '',
      },
    ]);
    if (change == null) throw new Error('Expected a document change');
    expect(change.lineDelta).toBe(0);
    expect(Array.from(getChangedDocumentLines(document, change))).toEqual([
      [1, 'inserted\n'],
      [2, 'second\n'],
      [3, 'third\n'],
      [4, 'fifth'],
    ]);
  });
});
