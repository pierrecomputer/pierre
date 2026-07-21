import { describe, expect, test } from 'bun:test';

import {
  applyDocumentChangeToLineAnnotations,
  renderLineAnnotations,
} from '../src/editor/lineAnnotations';
import { TextDocument } from '../src/editor/textDocument';
import type { DiffLineAnnotation } from '../src/types';
import { installDom, wait } from './domHarness';

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

  test('drops annotations on lines deleted through the end of the document', () => {
    const textDocument = new TextDocument('inmemory://1', 'l0\nl1\nl2\nl3');
    const annotations: DiffLineAnnotation<string>[] = [
      { side: 'additions', lineNumber: 1, metadata: 'l0' },
      { side: 'additions', lineNumber: 2, metadata: 'l1' },
      { side: 'additions', lineNumber: 3, metadata: 'l2' },
      { side: 'additions', lineNumber: 4, metadata: 'l3' },
    ];

    const change = textDocument.applyEdits([
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 3, character: 2 },
        },
        newText: '',
      },
    ]);

    expect(textDocument.getText()).toBe('l0\n');
    expect(applyDocumentChangeToLineAnnotations(change!, annotations)).toEqual([
      { side: 'additions', lineNumber: 1, metadata: 'l0' },
    ]);
  });

  test('keeps final-line annotations when part of that line survives', () => {
    const textDocument = new TextDocument('inmemory://1', 'l0\nl1\nl2\nl3');
    const annotations: DiffLineAnnotation<string>[] = [
      { side: 'additions', lineNumber: 4, metadata: 'l3' },
    ];

    const change = textDocument.applyEdits([
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 3, character: 1 },
        },
        newText: '',
      },
    ]);

    expect(textDocument.getText()).toBe('l0\n3');
    expect(applyDocumentChangeToLineAnnotations(change!, annotations)).toEqual([
      { side: 'additions', lineNumber: 2, metadata: 'l3' },
    ]);
  });

  test('keeps a final-line annotation when only its text is deleted', () => {
    const textDocument = new TextDocument('inmemory://1', 'one\ntwo\nthree');
    const annotations: DiffLineAnnotation<string>[] = [
      { side: 'additions', lineNumber: 3, metadata: 'three' },
    ];

    const change = textDocument.applyEdits([
      {
        range: {
          start: { line: 2, character: 0 },
          end: { line: 2, character: 5 },
        },
        newText: '',
      },
    ]);

    expect(textDocument.getText()).toBe('one\ntwo\n');
    expect(
      applyDocumentChangeToLineAnnotations(change!, annotations)
    ).toBeUndefined();
  });

  test('keeps an only-line annotation when all document text is deleted', () => {
    const textDocument = new TextDocument('inmemory://1', 'only');
    const annotations: DiffLineAnnotation<string>[] = [
      { side: 'additions', lineNumber: 1, metadata: 'only' },
    ];

    const change = textDocument.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 4 },
        },
        newText: '',
      },
    ]);

    expect(textDocument.getText()).toBe('');
    expect(
      applyDocumentChangeToLineAnnotations(change!, annotations)
    ).toBeUndefined();
  });

  test('drops a final-line annotation when its preceding line break is removed through EOF', () => {
    const textDocument = new TextDocument('inmemory://1', 'one\ntwo\nthree');
    const annotations: DiffLineAnnotation<string>[] = [
      { side: 'additions', lineNumber: 2, metadata: 'two' },
      { side: 'additions', lineNumber: 3, metadata: 'three' },
    ];

    const change = textDocument.applyEdits([
      {
        range: {
          start: { line: 1, character: 3 },
          end: { line: 2, character: 5 },
        },
        newText: '',
      },
    ]);

    expect(textDocument.getText()).toBe('one\ntwo');
    expect(applyDocumentChangeToLineAnnotations(change!, annotations)).toEqual([
      { side: 'additions', lineNumber: 2, metadata: 'two' },
    ]);
  });

  test('does not borrow EOF from a later insertion when remapping deleted lines', () => {
    const textDocument = new TextDocument('inmemory://1', 'l0\nl1\nl2\nl3');
    const annotations: DiffLineAnnotation<string>[] = [
      { side: 'additions', lineNumber: 4, metadata: 'l3' },
    ];

    const change = textDocument.applyEdits([
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 3, character: 0 },
        },
        newText: '',
      },
      {
        range: {
          start: { line: 3, character: 2 },
          end: { line: 3, character: 2 },
        },
        newText: '!',
      },
    ]);

    expect(textDocument.getText()).toBe('l0\nl3!');
    expect(applyDocumentChangeToLineAnnotations(change!, annotations)).toEqual([
      { side: 'additions', lineNumber: 2, metadata: 'l3' },
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

describe('renderLineAnnotations', () => {
  test('renders paired addition and deletion annotations', async () => {
    const { cleanup } = installDom();
    try {
      const { content, gutter, leftContent, leftGutter } =
        createSplitAnnotationHost(3);
      const staleContent = document.createElement('div');
      staleContent.dataset.lineAnnotation = 'stale';
      content.children[0].after(staleContent);
      const staleGutter = document.createElement('div');
      staleGutter.dataset.gutterBuffer = 'annotation';
      staleGutter.dataset.stale = '';
      gutter.children[0].after(staleGutter);

      renderLineAnnotations(
        [
          { side: 'additions', lineNumber: 2, metadata: 'new' },
          { side: 'deletions', lineNumber: 1, metadata: 'old' },
        ],
        content,
        gutter
      );
      await wait();

      expect(
        content.querySelector('[data-line-annotation="stale"]')
      ).toBeNull();
      expect(
        gutter.querySelector('[data-gutter-buffer="annotation"][data-stale]')
      ).toBeNull();
      expect(
        content.querySelector(
          '[data-line-annotation="0,1"] slot[name="annotation-additions-2"]'
        )
      ).not.toBeNull();
      expect(
        leftContent.querySelector(
          '[data-line-annotation="0,0"] slot[name="annotation-deletions-1"]'
        )
      ).not.toBeNull();
      expect(content.querySelectorAll('[data-line-annotation]')).toHaveLength(
        2
      );
      expect(
        leftContent.querySelectorAll('[data-line-annotation]')
      ).toHaveLength(2);
      expect(
        gutter.querySelectorAll('[data-gutter-buffer="annotation"]')
      ).toHaveLength(2);
      expect(
        leftGutter.querySelectorAll('[data-gutter-buffer="annotation"]')
      ).toHaveLength(2);
    } finally {
      cleanup();
    }
  });

  test('renders addition annotations when there is no paired deletions side', async () => {
    const { cleanup } = installDom();
    try {
      const { content, gutter } = createUnifiedAnnotationHost(3);

      renderLineAnnotations(
        [{ side: 'additions', lineNumber: 2, metadata: 'new' }],
        content,
        gutter
      );
      await wait();

      expect(
        content.querySelector(
          '[data-line-annotation="0,1"] slot[name="annotation-additions-2"]'
        )
      ).not.toBeNull();
      // Without a deletions sibling only the addition side renders: one content
      // annotation and one gutter buffer, and no left-side elements at all.
      expect(content.querySelectorAll('[data-line-annotation]')).toHaveLength(
        1
      );
      expect(
        gutter.querySelectorAll('[data-gutter-buffer="annotation"]')
      ).toHaveLength(1);
    } finally {
      cleanup();
    }
  });
});

function createSplitAnnotationHost(lineCount: number): {
  content: HTMLElement;
  gutter: HTMLElement;
  leftContent: HTMLElement;
  leftGutter: HTMLElement;
} {
  const root = document.createElement('div');
  const leftCode = document.createElement('div');
  leftCode.dataset.deletions = '';
  const leftGutter = document.createElement('div');
  leftGutter.dataset.gutter = '';
  const leftContent = document.createElement('div');
  leftContent.dataset.content = '';
  leftCode.append(leftGutter, leftContent);

  const code = document.createElement('div');
  const gutter = document.createElement('div');
  gutter.dataset.gutter = '';
  const content = document.createElement('div');
  content.dataset.content = '';
  code.append(gutter, content);
  root.append(leftCode, code);
  document.body.append(root);

  for (let lineNumber = 1; lineNumber <= lineCount; lineNumber++) {
    appendRenderedLine(leftContent, leftGutter, lineNumber);
    appendRenderedLine(content, gutter, lineNumber);
  }

  return { content, gutter, leftContent, leftGutter };
}

function appendRenderedLine(
  content: HTMLElement,
  gutter: HTMLElement,
  lineNumber: number
): void {
  const contentLine = document.createElement('div');
  contentLine.dataset.line = String(lineNumber);
  content.append(contentLine);

  const gutterLine = document.createElement('div');
  gutterLine.dataset.columnNumber = String(lineNumber);
  gutter.append(gutterLine);
}

// A single (unified) code element with no left [data-deletions] sibling, which
// drives renderLineAnnotations' additions-only path.
function createUnifiedAnnotationHost(lineCount: number): {
  content: HTMLElement;
  gutter: HTMLElement;
} {
  const root = document.createElement('div');
  const code = document.createElement('div');
  const gutter = document.createElement('div');
  gutter.dataset.gutter = '';
  const content = document.createElement('div');
  content.dataset.content = '';
  code.append(gutter, content);
  root.append(code);
  document.body.append(root);

  for (let lineNumber = 1; lineNumber <= lineCount; lineNumber++) {
    appendRenderedLine(content, gutter, lineNumber);
  }

  return { content, gutter };
}
