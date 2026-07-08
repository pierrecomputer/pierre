import { describe, expect, test } from 'bun:test';

import { applyDocumentChangeToLineAnnotations } from '../src/editor/lineAnnotations';
import { TextDocument } from '../src/editor/textDocument';
import type { DiffLineAnnotation } from '../src/types';

describe('applyDocumentChangeToLineAnnotations', () => {
  test('drops annotations attached to deleted lines', () => {
    const textDocument = new TextDocument('inmemory://1', 'one\ntwo\nthree');
    const annotations: DiffLineAnnotation<string>[] = [
      { side: 'additions', lineNumber: 1, metadata: 'one' },
      { side: 'additions', lineNumber: 2, metadata: 'two' },
      { side: 'additions', lineNumber: 3, metadata: 'three' },
    ];

    const change = textDocument.applyEdits([
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 2, character: 0 },
        },
        newText: '',
      },
    ]);

    expect(applyDocumentChangeToLineAnnotations(change!, annotations)).toEqual([
      { side: 'additions', lineNumber: 1, metadata: 'one' },
      { side: 'additions', lineNumber: 2, metadata: 'three' },
    ]);
  });

  test('drops a deleted line annotation when later lines keep its line number', () => {
    const textDocument = new TextDocument('inmemory://1', 'one\ntwo\nthree');
    const annotations: DiffLineAnnotation<string>[] = [
      { side: 'additions', lineNumber: 2, metadata: 'two' },
    ];

    const change = textDocument.applyEdits([
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 2, character: 0 },
        },
        newText: '',
      },
    ]);
    const nextAnnotations = applyDocumentChangeToLineAnnotations(
      change!,
      annotations
    );

    expect(nextAnnotations).not.toBe(annotations);
    expect(nextAnnotations).toEqual([]);
  });

  test('drops all addition annotations when all document text is deleted', () => {
    const textDocument = new TextDocument('inmemory://1', 'one\ntwo\nthree');
    const annotations: DiffLineAnnotation<string>[] = [
      { side: 'additions', lineNumber: 1, metadata: 'one' },
      { side: 'additions', lineNumber: 2, metadata: 'two' },
      { side: 'additions', lineNumber: 3, metadata: 'three' },
      { side: 'deletions', lineNumber: 1, metadata: 'old one' },
    ];

    const change = textDocument.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 2, character: 5 },
        },
        newText: '',
      },
    ]);

    expect(textDocument.getText()).toBe('');
    expect(applyDocumentChangeToLineAnnotations(change!, annotations)).toEqual([
      { side: 'deletions', lineNumber: 1, metadata: 'old one' },
    ]);
  });

  test('does not restore deleted addition annotations when new lines are inserted', () => {
    const textDocument = new TextDocument('inmemory://1', 'one\ntwo\nthree');
    const annotations: DiffLineAnnotation<string>[] = [
      { side: 'additions', lineNumber: 1, metadata: 'one' },
      { side: 'additions', lineNumber: 2, metadata: 'two' },
      { side: 'additions', lineNumber: 3, metadata: 'three' },
      { side: 'deletions', lineNumber: 1, metadata: 'old one' },
    ];

    const deleteChange = textDocument.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 2, character: 5 },
        },
        newText: '',
      },
    ]);
    const afterDelete = applyDocumentChangeToLineAnnotations(
      deleteChange!,
      annotations
    )!;

    const insertChange = textDocument.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        newText: 'new one\nnew two',
      },
    ]);

    expect(
      applyDocumentChangeToLineAnnotations(insertChange!, afterDelete) ??
        afterDelete
    ).toEqual([{ side: 'deletions', lineNumber: 1, metadata: 'old one' }]);
  });

  test('moves annotations on a merged line instead of deleting them', () => {
    const textDocument = new TextDocument('inmemory://1', 'one\ntwo\nthree');
    const annotations: DiffLineAnnotation<string>[] = [
      { side: 'additions', lineNumber: 2, metadata: 'two' },
      { side: 'additions', lineNumber: 3, metadata: 'three' },
    ];

    const change = textDocument.applyEdits([
      {
        range: {
          start: { line: 0, character: 3 },
          end: { line: 1, character: 0 },
        },
        newText: '',
      },
    ]);

    expect(applyDocumentChangeToLineAnnotations(change!, annotations)).toEqual([
      { side: 'additions', lineNumber: 1, metadata: 'two' },
      { side: 'additions', lineNumber: 2, metadata: 'three' },
    ]);
  });

  test('moves annotations down when lines are inserted above them', () => {
    const textDocument = new TextDocument('inmemory://1', 'one\ntwo\nthree');
    const annotations: DiffLineAnnotation<string>[] = [
      { side: 'additions', lineNumber: 1, metadata: 'one' },
      { side: 'additions', lineNumber: 2, metadata: 'two' },
      { side: 'additions', lineNumber: 3, metadata: 'three' },
    ];

    const change = textDocument.applyEdits([
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 },
        },
        newText: 'inserted\n',
      },
    ]);

    expect(applyDocumentChangeToLineAnnotations(change!, annotations)).toEqual([
      { side: 'additions', lineNumber: 1, metadata: 'one' },
      { side: 'additions', lineNumber: 3, metadata: 'two' },
      { side: 'additions', lineNumber: 4, metadata: 'three' },
    ]);
  });

  test('returns undefined when annotations do not move', () => {
    const textDocument = new TextDocument('inmemory://1', 'one\ntwo\nthree');
    const annotations: DiffLineAnnotation<string>[] = [
      { side: 'additions', lineNumber: 1, metadata: 'one' },
    ];

    const change = textDocument.applyEdits([
      {
        range: {
          start: { line: 2, character: 0 },
          end: { line: 2, character: 0 },
        },
        newText: 'inserted\n',
      },
    ]);

    expect(
      applyDocumentChangeToLineAnnotations(change!, annotations)
    ).toBeUndefined();
  });

  test('moves annotations through net-zero multi-edits', () => {
    const textDocument = new TextDocument(
      'inmemory://1',
      'one\ntwo\nthree\nfour\nfive'
    );
    const annotations: DiffLineAnnotation<string>[] = [
      { side: 'additions', lineNumber: 2, metadata: 'two' },
      { side: 'additions', lineNumber: 3, metadata: 'three' },
      { side: 'additions', lineNumber: 4, metadata: 'four' },
      { side: 'additions', lineNumber: 5, metadata: 'five' },
    ];

    const change = textDocument.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
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

    expect(change?.lineDelta).toBe(0);
    expect(applyDocumentChangeToLineAnnotations(change!, annotations)).toEqual([
      { side: 'additions', lineNumber: 3, metadata: 'two' },
      { side: 'additions', lineNumber: 4, metadata: 'three' },
      { side: 'additions', lineNumber: 5, metadata: 'five' },
    ]);
  });

  test('preserves deletions in coalesced net-zero multi-edits', () => {
    const textDocument = new TextDocument(
      'inmemory://1',
      'one\ntwo\nthree\nfour'
    );
    const annotations: DiffLineAnnotation<string>[] = [
      { side: 'additions', lineNumber: 2, metadata: 'two' },
      { side: 'additions', lineNumber: 3, metadata: 'three' },
      { side: 'additions', lineNumber: 4, metadata: 'four' },
    ];

    const change = textDocument.applyEdits([
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 },
        },
        newText: 'inserted\n',
      },
      {
        range: {
          start: { line: 2, character: 0 },
          end: { line: 3, character: 0 },
        },
        newText: '',
      },
    ]);

    expect(change?.lineDelta).toBe(0);
    expect(change?.changedLineRanges).toEqual([[1, 3]]);
    expect(applyDocumentChangeToLineAnnotations(change!, annotations)).toEqual([
      { side: 'additions', lineNumber: 3, metadata: 'two' },
      { side: 'additions', lineNumber: 4, metadata: 'four' },
    ]);
  });
});
