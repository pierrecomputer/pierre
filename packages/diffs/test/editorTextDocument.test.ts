import { describe, expect, test } from 'bun:test';

import type { EditorSelection } from '../src/editor/selection';
import { DirectionNone } from '../src/editor/selection';
import { TextDocument, type TextEdit } from '../src/editor/textDocument';
import type { DiffLineAnnotation } from '../src/types';

function doc(text: string) {
  return new TextDocument('inmemory://1', text, 'plain');
}

function caret(line: number, character: number) {
  const position = { line, character };
  return {
    start: position,
    end: position,
    direction: DirectionNone,
  } satisfies EditorSelection;
}

describe('TextDocument', () => {
  test('lang and lineCount', () => {
    const d = doc('a\nb\nc');
    expect(d.languageId).toBe('plain');
    expect(d.lineCount).toBe(3);
  });

  test('empty document keeps one logical line', () => {
    const d = doc('');
    expect(d.lineCount).toBe(1);
    expect(d.getLineText(0)).toBe('');
    expect(d.getText()).toBe('');
  });

  test('clearing all content keeps one logical line', () => {
    const d = doc('hello\nworld');
    const change = d.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 1, character: 5 },
        },
        newText: '',
      },
    ]);
    expect(d.getText()).toBe('');
    expect(d.lineCount).toBe(1);
    expect(d.getLineText(0)).toBe('');
    expect(change).toEqual({
      startLine: 0,
      startCharacter: 0,
      endLine: 0,
      previousLineCount: 2,
      lineCount: 1,
      lineDelta: -1,
      changedLineRanges: [[0, 0]],
    });
  });

  test('getText without range returns full buffer', () => {
    expect(doc('hello').getText()).toBe('hello');
  });

  test('getText with range', () => {
    const d = doc('aa\nbb\ncc');
    expect(
      d.getText({
        start: { line: 1, character: 0 },
        end: { line: 1, character: 1 },
      })
    ).toBe('b');
  });

  test('getLineText', () => {
    const d = doc('first\nsecond');
    expect(d.getLineText(0)).toBe('first');
    expect(d.getLineText(1)).toBe('second');
    expect(() => d.getLineText(-1)).toThrow('Line index out of range: -1');
    expect(() => d.getLineText(99)).toThrow('Line index out of range: 99');
  });

  test('getLineText trims line endings; getText range still includes them', () => {
    const d = doc('first\r\nsecond\n');
    expect(d.getLineText(0)).toBe('first');
    expect(d.getLineText(1)).toBe('second');
    expect(d.getLineText(2)).toBe('');
    expect(d.getLineLength(0)).toBe(5);
    expect(d.getLineLength(1)).toBe(6);
    expect(d.getLineLength(2)).toBe(0);
    expect(
      d.getText({
        start: { line: 0, character: 0 },
        end: { line: 1, character: 0 },
      })
    ).toBe('first\r\n');
    expect(
      d.getText({
        start: { line: 1, character: 0 },
        end: { line: 2, character: 0 },
      })
    ).toBe('second\n');
  });

  // test('offsetAt clamps to line and document bounds', () => {
  //   const d = doc('ab\nc');
  //   expect(d.offsetAt({ line: 0, character: 0 })).toBe(0);
  //   expect(d.offsetAt({ line: 0, character: 99 })).toBe(2);
  //   expect(d.offsetAt({ line: 1, character: 0 })).toBe(3);
  //   expect(() => d.offsetAt({ line: 99, character: 0 })).toThrow(
  //     'Line index out of range: 99'
  //   );
  // });

  test('positionAt is inverse of offsetAt for in-range columns', () => {
    const d = doc('ab\nc');
    expect(d.positionAt(0)).toEqual({ line: 0, character: 0 });
    expect(d.positionAt(3)).toEqual({ line: 1, character: 0 });
    expect(d.positionAt(d.getText().length)).toEqual({ line: 1, character: 1 });
    const { line, character } = d.positionAt(2);
    expect(d.offsetAt({ line, character })).toBe(2);
  });

  // test('positionAt and offsetAt clamp line endings', () => {
  //   const d = doc('a\r\r\nb\r');
  //   expect(d.positionAt(2)).toEqual({ line: 0, character: 1 });
  //   expect(d.positionAt(3)).toEqual({ line: 0, character: 1 });
  //   expect(d.positionAt(4)).toEqual({ line: 1, character: 0 });
  //   expect(d.positionAt(6)).toEqual({ line: 1, character: 1 });
  //   expect(d.offsetAt({ line: 0, character: 10 })).toBe(1);
  //   expect(d.offsetAt({ line: 1, character: 10 })).toBe(5);
  // });

  test('positionAt maps initial line offsets from zero', () => {
    const d = doc('first\nsecond\nthird');
    expect(d.positionAt(0)).toEqual({ line: 0, character: 0 });
    expect(d.positionAt(5)).toEqual({ line: 0, character: 5 });
    expect(d.positionAt(6)).toEqual({ line: 1, character: 0 });
    expect(d.offsetAt({ line: 2, character: 0 })).toBe(13);
  });

  test('applyEdits single replacement', () => {
    const d = doc('hello world');
    const change = d.applyEdits([
      {
        range: {
          start: { line: 0, character: 6 },
          end: { line: 0, character: 11 },
        },
        newText: 'you',
      },
    ]);
    expect(d.getText()).toBe('hello you');
    expect(change).toEqual({
      startLine: 0,
      startCharacter: 6,
      endLine: 0,
      previousLineCount: 1,
      lineCount: 1,
      lineDelta: 0,
      changedLineRanges: [[0, 0]],
    });
  });

  test('applyEdits swaps inverted start/end', () => {
    const d = doc('abcd');
    d.applyEdits([
      {
        range: {
          start: { line: 0, character: 3 },
          end: { line: 0, character: 1 },
        },
        newText: 'X',
      },
    ]);
    expect(d.getText()).toBe('aXd');
  });

  test('applyEdits multiple non-overlapping regions', () => {
    const d = doc('aa bb cc');
    const edits: TextEdit[] = [
      {
        range: {
          start: { line: 0, character: 6 },
          end: { line: 0, character: 8 },
        },
        newText: 'CC',
      },
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 2 },
        },
        newText: 'AA',
      },
    ];
    d.applyEdits(edits);
    expect(d.getText()).toBe('AA bb CC');
  });

  test('applyEdits preserves line breaks around edited line', () => {
    const d = doc('a\nb\nc');
    const change = d.applyEdits([
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 1 },
        },
        newText: 'B',
      },
    ]);
    expect(d.getText()).toBe('a\nB\nc');
    expect(d.lineCount).toBe(3);
    expect(change).toEqual({
      startLine: 1,
      startCharacter: 0,
      endLine: 1,
      previousLineCount: 3,
      lineCount: 3,
      lineDelta: 0,
      changedLineRanges: [[1, 1]],
    });
  });

  test('applyEdits reports inserted lines in returned change', () => {
    const d = doc('a');
    const change = d.applyEdits([
      {
        range: {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 1 },
        },
        newText: '\nb',
      },
    ]);
    expect(d.getText()).toBe('a\nb');
    expect(change).toEqual({
      startLine: 0,
      startCharacter: 1,
      endLine: 1,
      previousLineCount: 1,
      lineCount: 2,
      lineDelta: 1,
      changedLineRanges: [[0, 1]],
    });
  });

  test('applyEdits reports line deletions in returned change', () => {
    const d = doc('a\nb\nc');
    const change = d.applyEdits([
      {
        range: {
          start: { line: 0, character: 1 },
          end: { line: 2, character: 0 },
        },
        newText: '',
      },
    ]);
    expect(d.getText()).toBe('ac');
    expect(change).toEqual({
      startLine: 0,
      startCharacter: 1,
      endLine: 0,
      previousLineCount: 3,
      lineCount: 1,
      lineDelta: -2,
      changedLineRanges: [[0, 0]],
    });
  });

  test('applyEdits preserves CRLF after middle-line edit', () => {
    const d = doc('a\r\nb\r\nc');
    d.applyEdits([
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 1 },
        },
        newText: 'B',
      },
    ]);
    expect(d.getText()).toBe('a\r\nB\r\nc');
  });

  test('applyEdits reports inserted lines for a lone CR line ending', () => {
    const d = doc('a');
    const change = d.applyEdits([
      {
        range: {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 1 },
        },
        newText: '\rb',
      },
    ]);
    expect(d.getText()).toBe('a\rb');
    expect(d.lineCount).toBe(2);
    expect(change).toEqual({
      startLine: 0,
      startCharacter: 1,
      endLine: 1,
      previousLineCount: 1,
      lineCount: 2,
      lineDelta: 1,
      changedLineRanges: [[0, 1]],
    });
  });

  test('applyEdits reports inserted lines for multiple lone CR line endings', () => {
    const d = doc('hello');
    const change = d.applyEdits([
      {
        range: {
          start: { line: 0, character: 5 },
          end: { line: 0, character: 5 },
        },
        newText: '\rworld\rfoo',
      },
    ]);
    expect(d.getText()).toBe('hello\rworld\rfoo');
    expect(d.lineCount).toBe(3);
    expect(change).toEqual({
      startLine: 0,
      startCharacter: 5,
      endLine: 2,
      previousLineCount: 1,
      lineCount: 3,
      lineDelta: 2,
      changedLineRanges: [[0, 2]],
    });
  });

  test('getText(range) spans multiple lines correctly after edits', () => {
    const d = doc('foo\nbar\nbaz');
    d.applyEdits([
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 3 },
        },
        newText: 'BAR',
      },
    ]);
    expect(
      d.getText({
        start: { line: 0, character: 2 },
        end: { line: 2, character: 2 },
      })
    ).toBe('o\nBAR\nba');
  });

  test('undo restores batch with two disjoint edits', () => {
    const d = doc('aa bb cc');
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 6 },
            end: { line: 0, character: 8 },
          },
          newText: 'CC',
        },
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 2 },
          },
          newText: 'AA',
        },
      ],
      true,
      [caret(0, 0)]
    );
    d.undo();
    expect(d.getText()).toBe('aa bb cc');
  });

  test('undo multi-line replacement', () => {
    const d = doc('line1\nline2\nline3');
    d.applyEdits(
      [
        {
          range: {
            start: { line: 1, character: 0 },
            end: { line: 1, character: 5 },
          },
          newText: 'two',
        },
      ],
      true,
      [caret(1, 0)]
    );
    expect(d.getText()).toBe('line1\ntwo\nline3');
    d.undo();
    expect(d.getText()).toBe('line1\nline2\nline3');
  });

  test('undo stack depth for sequential edits', () => {
    const d = doc('x');
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: 'a',
        },
      ],
      true,
      [caret(0, 0)]
    );
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 1 },
            end: { line: 0, character: 1 },
          },
          newText: 'b',
        },
      ],
      true,
      [caret(0, 1)]
    );
    d.undo();
    expect(d.getText()).toBe('x');
  });

  test('undo keeps later multiline edit separate from typing group', () => {
    const d = doc('x');
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: 'a',
        },
      ],
      true,
      [caret(0, 0)]
    );
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 1 },
            end: { line: 0, character: 1 },
          },
          newText: 'b',
        },
      ],
      true,
      [caret(0, 1)]
    );
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 2 },
            end: { line: 0, character: 2 },
          },
          newText: '\n',
        },
      ],
      true,
      [caret(0, 2)]
    );

    expect(d.getText()).toBe('ab\nx');

    d.undo();
    expect(d.getText()).toBe('abx');

    d.undo();
    expect(d.getText()).toBe('x');
  });

  test('contiguous backspaces coalesce into one undo step', () => {
    const d = doc('abc');
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 2 },
            end: { line: 0, character: 3 },
          },
          newText: '',
        },
      ],
      true,
      [caret(0, 3)]
    );
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 1 },
            end: { line: 0, character: 2 },
          },
          newText: '',
        },
      ],
      true,
      [caret(0, 2)]
    );

    expect(d.getText()).toBe('a');

    d.undo();
    expect(d.getText()).toBe('abc');
  });

  test('replacement edits do not coalesce', () => {
    const d = doc('ab');
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 1 },
            end: { line: 0, character: 2 },
          },
          newText: 'X',
        },
      ],
      true,
      [caret(0, 2)]
    );
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 1 },
            end: { line: 0, character: 2 },
          },
          newText: 'Y',
        },
      ],
      true,
      [caret(0, 2)]
    );

    expect(d.getText()).toBe('aY');

    d.undo();
    expect(d.getText()).toBe('aX');

    d.undo();
    expect(d.getText()).toBe('ab');
  });

  test('typing after replacing a selection coalesces into one undo step', () => {
    const d = doc('hello');
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 5 },
          },
          newText: 'w',
        },
      ],
      true,
      [caret(0, 5)]
    );
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 1 },
            end: { line: 0, character: 1 },
          },
          newText: 'orld',
        },
      ],
      true,
      [caret(0, 1)]
    );

    expect(d.getText()).toBe('world');

    d.undo();
    expect(d.getText()).toBe('hello');
  });

  test('paste does not coalesce into the preceding typed character', () => {
    const d = doc('');
    // Type a single character (normal typing).
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: 'a',
        },
      ],
      true,
      [caret(0, 0)]
    );
    // Paste a single-line string at the caret. The trailing `true` marks it as
    // an undo boundary, like the editor's paste handler. Without it the paste
    // looks just like typing and would merge into the previous step.
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 1 },
            end: { line: 0, character: 1 },
          },
          newText: 'hello',
        },
      ],
      true,
      [caret(0, 1)],
      undefined,
      true
    );

    expect(d.getText()).toBe('ahello');

    d.undo();
    expect(d.getText()).toBe('a');

    d.undo();
    expect(d.getText()).toBe('');
  });

  test('typing after a paste does not coalesce into the pasted text', () => {
    const d = doc('');
    // Paste a single-line string (undo boundary).
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: 'hello',
        },
      ],
      true,
      [caret(0, 0)],
      undefined,
      true
    );
    // Type a character immediately after the paste.
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 5 },
            end: { line: 0, character: 5 },
          },
          newText: 'x',
        },
      ],
      true,
      [caret(0, 5)]
    );

    expect(d.getText()).toBe('hellox');

    d.undo();
    expect(d.getText()).toBe('hello');

    d.undo();
    expect(d.getText()).toBe('');
  });

  test('contiguous forward deletes coalesce into one undo step', () => {
    const d = doc('abc');
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 1 },
            end: { line: 0, character: 2 },
          },
          newText: '',
        },
      ],
      true,
      [caret(0, 1)]
    );
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 1 },
            end: { line: 0, character: 2 },
          },
          newText: '',
        },
      ],
      true,
      [caret(0, 1)]
    );

    expect(d.getText()).toBe('a');

    d.undo();
    expect(d.getText()).toBe('abc');
  });

  test('multi-cursor contiguous inserts coalesce into one undo step', () => {
    const d = doc('ab\ncd');
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 1 },
            end: { line: 0, character: 1 },
          },
          newText: 'X',
        },
        {
          range: {
            start: { line: 1, character: 1 },
            end: { line: 1, character: 1 },
          },
          newText: 'X',
        },
      ],
      true,
      [caret(0, 1), caret(1, 1)]
    );
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 2 },
            end: { line: 0, character: 2 },
          },
          newText: 'Y',
        },
        {
          range: {
            start: { line: 1, character: 2 },
            end: { line: 1, character: 2 },
          },
          newText: 'Y',
        },
      ],
      true,
      [caret(0, 2), caret(1, 2)]
    );

    expect(d.getText()).toBe('aXYb\ncXYd');

    d.undo();
    expect(d.getText()).toBe('ab\ncd');
  });

  test('multi-cursor contiguous backspaces coalesce into one undo step', () => {
    const d = doc('abc\ndef');
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 2 },
            end: { line: 0, character: 3 },
          },
          newText: '',
        },
        {
          range: {
            start: { line: 1, character: 2 },
            end: { line: 1, character: 3 },
          },
          newText: '',
        },
      ],
      true,
      [caret(0, 3), caret(1, 3)]
    );
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 1 },
            end: { line: 0, character: 2 },
          },
          newText: '',
        },
        {
          range: {
            start: { line: 1, character: 1 },
            end: { line: 1, character: 2 },
          },
          newText: '',
        },
      ],
      true,
      [caret(0, 2), caret(1, 2)]
    );

    expect(d.getText()).toBe('a\nd');

    d.undo();
    expect(d.getText()).toBe('abc\ndef');
  });

  test('multi-cursor contiguous forward deletes coalesce into one undo step', () => {
    const d = doc('abc\ndef');
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 1 },
            end: { line: 0, character: 2 },
          },
          newText: '',
        },
        {
          range: {
            start: { line: 1, character: 1 },
            end: { line: 1, character: 2 },
          },
          newText: '',
        },
      ],
      true,
      [caret(0, 1), caret(1, 1)]
    );
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 1 },
            end: { line: 0, character: 2 },
          },
          newText: '',
        },
        {
          range: {
            start: { line: 1, character: 1 },
            end: { line: 1, character: 2 },
          },
          newText: '',
        },
      ],
      true,
      [caret(0, 1), caret(1, 1)]
    );

    expect(d.getText()).toBe('a\nd');

    d.undo();
    expect(d.getText()).toBe('abc\ndef');
  });

  test('multi-cursor batches with different edit shapes do not coalesce', () => {
    const d = doc('ab\ncd');
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 1 },
            end: { line: 0, character: 1 },
          },
          newText: 'X',
        },
        {
          range: {
            start: { line: 1, character: 1 },
            end: { line: 1, character: 1 },
          },
          newText: 'X',
        },
      ],
      true,
      [caret(0, 1), caret(1, 1)]
    );
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 2 },
            end: { line: 0, character: 2 },
          },
          newText: 'Y',
        },
      ],
      true,
      [caret(0, 2)]
    );

    d.undo();
    expect(d.getText()).toBe('aXb\ncXd');

    d.undo();
    expect(d.getText()).toBe('ab\ncd');
  });

  test('applyEdits rejects overlapping ranges', () => {
    const d = doc('0123456789');
    expect(() =>
      d.applyEdits([
        {
          range: {
            start: { line: 0, character: 1 },
            end: { line: 0, character: 5 },
          },
          newText: 'X',
        },
        {
          range: {
            start: { line: 0, character: 4 },
            end: { line: 0, character: 7 },
          },
          newText: 'Y',
        },
      ])
    ).toThrow('Overlapping text edits are not supported');
  });

  test('applyEdits empty array does not touch history', () => {
    const d = doc('x');
    d.applyEdits([]);
    expect(d.canUndo).toBe(false);
  });

  test('applyEdits default does not record undo', () => {
    const d = doc('a');
    d.applyEdits([
      {
        range: {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 1 },
        },
        newText: 'b',
      },
    ]);
    expect(d.getText()).toBe('ab');
    expect(d.canUndo).toBe(false);
    expect(d.undo()).toBeUndefined();
  });

  test('undo and redo', () => {
    const d = doc('a');
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 1 },
            end: { line: 0, character: 1 },
          },
          newText: 'b',
        },
      ],
      true,
      [caret(0, 1)]
    );
    expect(d.getText()).toBe('ab');
    expect(d.canUndo).toBe(true);
    expect(d.canRedo).toBe(false);

    const undoResult = d.undo();
    expect(d.getText()).toBe('a');
    expect(undoResult?.[0]).toEqual({
      startLine: 0,
      startCharacter: 1,
      endLine: 0,
      previousLineCount: 1,
      lineCount: 1,
      lineDelta: 0,
      changedLineRanges: [[0, 0]],
    });
    expect(d.canUndo).toBe(false);
    expect(d.canRedo).toBe(true);

    const redoResult = d.redo();
    expect(d.getText()).toBe('ab');
    expect(redoResult?.[0]).toEqual({
      startLine: 0,
      startCharacter: 1,
      endLine: 0,
      previousLineCount: 1,
      lineCount: 1,
      lineDelta: 0,
      changedLineRanges: [[0, 0]],
    });
    expect(d.canUndo).toBe(true);
    expect(d.canRedo).toBe(false);
  });

  test('undo and redo restore history entry versions', () => {
    const d = new TextDocument('inmemory://1', 'a', 'plain', 7);
    expect(d.version).toBe(7);

    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 1 },
            end: { line: 0, character: 1 },
          },
          newText: 'b',
        },
      ],
      true,
      [caret(0, 1)]
    );
    expect(d.version).toBe(8);

    d.undo();
    expect(d.getText()).toBe('a');
    expect(d.version).toBe(7);

    d.redo();
    expect(d.getText()).toBe('ab');
    expect(d.version).toBe(8);
  });

  test('new edit after undo clears redo stack', () => {
    const d = doc('a');
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 1 },
            end: { line: 0, character: 1 },
          },
          newText: 'b',
        },
      ],
      true,
      [caret(0, 1)]
    );
    d.undo();
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 1 },
            end: { line: 0, character: 1 },
          },
          newText: 'c',
        },
      ],
      true,
      [caret(0, 1)]
    );
    expect(d.getText()).toBe('ac');
    expect(d.canRedo).toBe(false);
  });

  test('undo on empty stack returns false', () => {
    const d = doc('z');
    expect(d.undo()).toBeUndefined();
  });

  test('redo on empty stack returns false', () => {
    const d = doc('z');
    expect(d.redo()).toBeUndefined();
  });

  test('undo and redo return stored selections', () => {
    const d = doc('abc');
    const selectionBefore = caret(0, 1);
    const selectionAfter = caret(0, 2);
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 1 },
            end: { line: 0, character: 1 },
          },
          newText: 'x',
        },
      ],
      true,
      [selectionBefore],
      [selectionAfter]
    );

    expect(d.undo()?.[1]).toEqual([selectionBefore]);
    expect(d.redo()?.[1]).toEqual([selectionAfter]);
  });

  test('undo and redo preserve multiple selections', () => {
    const d = doc('a\nb');
    const selectionsBefore = [caret(0, 1), caret(1, 1)];
    const selectionsAfter = [caret(0, 2), caret(1, 2)];
    d.applyEdits(
      [
        {
          range: {
            start: { line: 1, character: 1 },
            end: { line: 1, character: 1 },
          },
          newText: '!',
        },
        {
          range: {
            start: { line: 0, character: 1 },
            end: { line: 0, character: 1 },
          },
          newText: '!',
        },
      ],
      true,
      selectionsBefore,
      selectionsAfter
    );

    expect(d.undo()?.[1]).toEqual(selectionsBefore);
    expect(d.redo()?.[1]).toEqual(selectionsAfter);
  });

  test('undo omits line annotations tuple entry when none were recorded', () => {
    const d = doc('abc');
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 1 },
            end: { line: 0, character: 1 },
          },
          newText: 'x',
        },
      ],
      true,
      [caret(0, 1)],
      [caret(0, 2)]
    );

    expect(d.undo()?.[2]).toBeUndefined();
    expect(d.redo()?.[2]).toBeUndefined();
  });

  test('setLastUndoLineAnnotationsAfter updates redo line annotations', () => {
    const d = doc('a');
    const annotationsBefore: DiffLineAnnotation<string>[] = [
      { side: 'additions', lineNumber: 1, metadata: 'initial' },
    ];
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 1 },
            end: { line: 0, character: 1 },
          },
          newText: 'b',
        },
      ],
      true,
      [caret(0, 1)],
      undefined
    );

    const patchedAfter: DiffLineAnnotation<string>[] = [
      { side: 'additions', lineNumber: 1, metadata: 'patched-after-edit' },
    ];
    d.setLastUndoLineAnnotations(annotationsBefore, patchedAfter);

    d.undo();
    expect(d.redo()?.[2]).toEqual(patchedAfter);
  });
});
