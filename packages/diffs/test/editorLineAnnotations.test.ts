import { describe, expect, test } from 'bun:test';

import { applyDocumentChangeToLineAnnotations } from '../src/editor/lineAnnotations';
import { TextDocument } from '../src/editor/textDocument';
import type { DiffLineAnnotation } from '../src/types';

describe('applyDocumentChangeToLineAnnotations', () => {
  test('keeps annotations attached to the nearest line when their line is deleted', () => {
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
      { side: 'additions', lineNumber: 2, metadata: 'two' },
      { side: 'additions', lineNumber: 2, metadata: 'three' },
    ]);
  });

  test('returns a refreshed annotation list when a deleted line keeps the same line number', () => {
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
    expect(nextAnnotations).toEqual([
      { side: 'additions', lineNumber: 2, metadata: 'two' },
    ]);
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
    ]);
  });
});
