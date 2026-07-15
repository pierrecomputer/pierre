import { describe, expect, test } from 'bun:test';

import { DirectionNone } from '../src/editor/selection';
import { TextDocument } from '../src/editor/textDocument';
import type {
  DiffLineAnnotation,
  EditorSelection,
  TextEdit,
} from '../src/types';

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

// Inserts `text` at `character` on line 0 with history recording enabled, like a
// single keystroke. `caretCharacter` is where the caret sits before the insert
// (defaults to the insert position); pass a different value to model a caret
// that moved away from the previous edit before typing.
function typeAt(
  d: ReturnType<typeof doc>,
  character: number,
  text: string,
  caretCharacter = character
) {
  d.applyEdits(
    [
      {
        range: {
          start: { line: 0, character },
          end: { line: 0, character },
        },
        newText: text,
      },
    ],
    true,
    [caret(0, caretCharacter)]
  );
}

// Runs undo (or redo) to exhaustion. The number of history steps depends on how
// edits coalesced, so tests that only care about the end-to-end result use these
// instead of asserting a fixed step count.
function undoAll(d: ReturnType<typeof doc>) {
  while (d.canUndo) {
    d.undo();
  }
}

function redoAll(d: ReturnType<typeof doc>) {
  while (d.canRedo) {
    d.redo();
  }
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
      endCharacter: 5,
      endLine: 0,
      endedAtDocumentEnd: true,
      previousLineCount: 2,
      lineCount: 1,
      lineDelta: -1,
      changedLineRanges: [[0, 0]],
      changedLineChanges: [[0, 0, -1, 0, 5, true]],
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

  test('positionsAt maps a batch of offsets to positions', () => {
    const d = doc('ab\ncd');
    expect(d.positionsAt([0, 1, 3, 4])).toEqual([
      { line: 0, character: 0 },
      { line: 0, character: 1 },
      { line: 1, character: 0 },
      { line: 1, character: 1 },
    ]);
  });

  test('charAt reads a character by offset or by clamped position', () => {
    const d = doc('ab\ncd');
    expect(d.charAt(0)).toBe('a');
    expect(d.charAt(4)).toBe('d');
    expect(d.charAt({ line: 1, character: 1 })).toBe('d');
    // A position past the end of its line is normalized before lookup; here it
    // clamps to the end of the document, which has no character.
    expect(d.charAt({ line: 1, character: 99 })).toBe('');
  });

  test('getTextSlice returns the substring between two offsets', () => {
    const d = doc('hello world');
    expect(d.getTextSlice(0, 5)).toBe('hello');
    expect(d.getTextSlice(6, 11)).toBe('world');
    expect(d.getTextSlice(3, 3)).toBe('');
  });

  test('search returns match ranges for the query', () => {
    const d = doc('foo bar foo');
    expect(
      d.search({
        text: 'foo',
        replaceText: '',
        caseSensitive: false,
        wholeWord: false,
        regex: false,
      })
    ).toEqual([
      [0, 3],
      [8, 11],
    ]);
  });

  test('findNextNonOverlappingSubstring skips occupied ranges', () => {
    const d = doc('foo foo foo');
    // The first "foo" is occupied, so the next match starts at offset 4.
    expect(d.findNextNonOverlappingSubstring('foo', [[0, 3]])).toBe(4);
  });

  test('eol reports the document line ending', () => {
    expect(doc('a\nb').eol).toBe('\n');
    expect(doc('a\r\nb').eol).toBe('\r\n');
    expect(doc('a\rb').eol).toBe('\r');
    // A single-line document has no break to detect and defaults to \n.
    expect(doc('abc').eol).toBe('\n');
  });

  test('normalizeEol rewrites mixed line endings to the document EOL', () => {
    const d = doc('a\r\nb');
    expect(d.normalizeEol('x\ny\rz\r\nw')).toBe('x\r\ny\r\nz\r\nw');
  });

  test('normalizePosition clamps line and character into range', () => {
    const d = doc('ab\ncd');
    expect(d.normalizePosition({ line: 0, character: 1 })).toEqual({
      line: 0,
      character: 1,
    });
    // A character past the line content clamps to the line length, which
    // excludes the trailing line break.
    expect(d.normalizePosition({ line: 0, character: 99 })).toEqual({
      line: 0,
      character: 2,
    });
    // A line past the document clamps to the last line.
    expect(d.normalizePosition({ line: 9, character: 0 })).toEqual({
      line: 1,
      character: 0,
    });
    // Negative values clamp to zero.
    expect(d.normalizePosition({ line: -3, character: -5 })).toEqual({
      line: 0,
      character: 0,
    });
  });

  test('getText clamps an overshooting range column so it excludes the line break', () => {
    const d = doc('first\nsecond');
    // A range end whose character overshoots the line (a preserved vertical-move
    // goal column) clamps to the line content, so the trailing newline is not
    // pulled into the copied text.
    expect(
      d.getText({
        start: { line: 0, character: 0 },
        end: { line: 0, character: 99 },
      })
    ).toBe('first');
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
      endCharacter: 11,
      endLine: 0,
      endedAtDocumentEnd: true,
      previousLineCount: 1,
      lineCount: 1,
      lineDelta: 0,
      changedLineRanges: [[0, 0]],
      changedLineChanges: [[0, 0, 0, 6, 11, true]],
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
      endCharacter: 1,
      endLine: 1,
      endedAtDocumentEnd: false,
      previousLineCount: 3,
      lineCount: 3,
      lineDelta: 0,
      changedLineRanges: [[1, 1]],
      changedLineChanges: [[1, 1, 0, 0, 1, false]],
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
      endCharacter: 1,
      endLine: 1,
      endedAtDocumentEnd: true,
      previousLineCount: 1,
      lineCount: 2,
      lineDelta: 1,
      changedLineRanges: [[0, 1]],
      changedLineChanges: [[0, 1, 1, 1, 1, true]],
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
      endCharacter: 0,
      endLine: 0,
      endedAtDocumentEnd: false,
      previousLineCount: 3,
      lineCount: 1,
      lineDelta: -2,
      changedLineRanges: [[0, 0]],
      changedLineChanges: [[0, 0, -2, 1, 0, false]],
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
      endCharacter: 1,
      endLine: 1,
      endedAtDocumentEnd: true,
      previousLineCount: 1,
      lineCount: 2,
      lineDelta: 1,
      changedLineRanges: [[0, 1]],
      changedLineChanges: [[0, 1, 1, 1, 1, true]],
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
      endCharacter: 5,
      endLine: 2,
      endedAtDocumentEnd: true,
      previousLineCount: 1,
      lineCount: 3,
      lineDelta: 2,
      changedLineRanges: [[0, 2]],
      changedLineChanges: [[0, 2, 2, 5, 5, true]],
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

  test('redo restores buffer order after typing at the left edge of an insert', () => {
    const d = doc('');
    typeAt(d, 0, 'a'); // "a", caret now after it
    typeAt(d, 0, 'b', 0); // caret moved to the far left, type "b" -> "ba"

    expect(d.getText()).toBe('ba');

    undoAll(d);
    expect(d.getText()).toBe('');

    redoAll(d);
    expect(d.getText()).toBe('ba');
  });

  test('redo restores buffer order after typing inside a coalesced insert run', () => {
    const d = doc('');
    typeAt(d, 0, 'a'); // "a"
    typeAt(d, 1, 'b'); // "ab" (normal contiguous typing, coalesces)
    typeAt(d, 1, 'c', 1); // caret moved between a and b, type "c" -> "acb"

    expect(d.getText()).toBe('acb');

    undoAll(d);
    expect(d.getText()).toBe('');

    redoAll(d);
    expect(d.getText()).toBe('acb');
  });

  test('redo restores buffer after typing at the end of an insert run', () => {
    const d = doc('');
    typeAt(d, 0, 'a'); // "a"
    typeAt(d, 1, 'b'); // "ab", continuing at the end

    expect(d.getText()).toBe('ab');

    undoAll(d);
    expect(d.getText()).toBe('');

    redoAll(d);
    expect(d.getText()).toBe('ab');
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
      endCharacter: 2,
      endLine: 0,
      endedAtDocumentEnd: true,
      previousLineCount: 1,
      lineCount: 1,
      lineDelta: 0,
      changedLineRanges: [[0, 0]],
      changedLineChanges: [[0, 0, 0, 1, 2, true]],
    });
    expect(d.canUndo).toBe(false);
    expect(d.canRedo).toBe(true);

    const redoResult = d.redo();
    expect(d.getText()).toBe('ab');
    expect(redoResult?.[0]).toEqual({
      startLine: 0,
      startCharacter: 1,
      endCharacter: 1,
      endLine: 0,
      endedAtDocumentEnd: true,
      previousLineCount: 1,
      lineCount: 1,
      lineDelta: 0,
      changedLineRanges: [[0, 0]],
      changedLineChanges: [[0, 0, 0, 1, 1, true]],
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

// Replaces the range spanning exactly one line break (from the end of `line`'s
// content through the start of the next line) with `newText`.
function replaceLineBreak(
  d: ReturnType<typeof doc>,
  line: number,
  newText: string
) {
  const edit: TextEdit = {
    range: {
      start: { line, character: d.getLineLength(line) },
      end: { line: line + 1, character: 0 },
    },
    newText,
  };
  const change = d.applyEdits([edit]);
  // applyEdits only returns undefined for an empty edit list; narrow the type
  // so tests can assert on the change record directly.
  if (change === undefined) {
    throw new Error('applyEdits returned no change for a non-empty edit list');
  }
  return change;
}

describe('TextDocument edge cases', () => {
  test('eol detection uses the first line break, not a whole-file majority vote', () => {
    // DIVERGENCE: a common alternative picks the EOL by majority vote across
    // the whole file (a document whose breaks are mostly \r\n reports \r\n
    // even if the first break is \n). pierre-fe deliberately reads only the
    // FIRST line's break (see the eol getter's comment in textDocument.ts):
    // it is cheaper, stable under edits below line 0, and mixed-EOL files
    // are an edge case for a diff-oriented editor.
    const firstLfRestCrlf = doc('red\ngreen\r\nblue\r\nteal\r\npink');
    expect(firstLfRestCrlf.lineCount).toBe(5);
    // A majority vote would report '\r\n' here; pierre-fe reports '\n'.
    expect(firstLfRestCrlf.eol).toBe('\n');

    const firstCrlfRestLf = doc('red\r\ngreen\nblue\nteal\npink');
    // A majority vote would report '\n' here; pierre-fe reports '\r\n'.
    expect(firstCrlfRestLf.eol).toBe('\r\n');

    // The consequence: pasted text is normalized to the first line's style.
    expect(firstLfRestCrlf.normalizeEol('x\r\ny')).toBe('x\ny');
    expect(firstCrlfRestLf.normalizeEol('x\ny')).toBe('x\r\ny');
  });

  test('replacing a selected line break with a newline is a stable no-op', () => {
    // The edit range runs from end-of-line-0 content through start-of-line-1,
    // covering exactly the "\n", and the replacement recreates the same break.
    const d = doc('stanza\nrefrain');
    const change = replaceLineBreak(d, 0, '\n');

    // Buffer and line structure are unchanged (and the document did not lock
    // up computing the change — the regression this test pins).
    expect(d.getText()).toBe('stanza\nrefrain');
    expect(d.lineCount).toBe(2);
    expect(d.getLineText(0)).toBe('stanza');
    expect(d.getLineText(1)).toBe('refrain');

    // The changed-line bookkeeping stays within the two touched lines and
    // reports no net line growth.
    expect(change.lineDelta).toBe(0);
    expect(change.previousLineCount).toBe(2);
    expect(change.lineCount).toBe(2);
    expect(change.changedLineRanges).toEqual([[0, 1]]);

    // Subsequent edits still work on the untouched structure.
    d.applyEdits([
      {
        range: {
          start: { line: 1, character: 7 },
          end: { line: 1, character: 7 },
        },
        newText: '!',
      },
    ]);
    expect(d.getText()).toBe('stanza\nrefrain!');
    expect(d.lineCount).toBe(2);
  });

  test('replacing a selected CRLF break with CRLF is a stable no-op', () => {
    const d = doc('stanza\r\nrefrain');
    const change = replaceLineBreak(d, 0, '\r\n');

    expect(d.getText()).toBe('stanza\r\nrefrain');
    expect(d.lineCount).toBe(2);
    expect(d.getLineText(0)).toBe('stanza');
    expect(d.getLineText(1)).toBe('refrain');
    expect(change.lineDelta).toBe(0);
    expect(change.changedLineRanges).toEqual([[0, 1]]);

    // A follow-up edit crossing the same break still resolves correctly.
    d.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 1, character: 0 },
        },
        newText: '',
      },
    ]);
    expect(d.getText()).toBe('refrain');
    expect(d.lineCount).toBe(1);
  });

  test('replacing a selected line break with a different break style keeps the line structure', () => {
    // Same boundary-straddling range, but the replacement swaps \n for \r\n:
    // the byte content changes while the logical line structure does not.
    const d = doc('stanza\nrefrain');
    const change = replaceLineBreak(d, 0, '\r\n');

    expect(d.getText()).toBe('stanza\r\nrefrain');
    expect(d.lineCount).toBe(2);
    expect(d.getLineText(0)).toBe('stanza');
    expect(d.getLineText(1)).toBe('refrain');
    expect(change.lineDelta).toBe(0);
    expect(change.changedLineRanges).toEqual([[0, 1]]);

    // Line 1 offsets shifted by one byte; edits addressed by position must
    // still land correctly.
    d.applyEdits([
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 },
        },
        newText: '> ',
      },
    ]);
    expect(d.getText()).toBe('stanza\r\n> refrain');
  });

  test('normalizePosition clamps both coordinates when line and character overshoot together', () => {
    // Normalizing a far-out-of-range position like (99, 99) on a 2-line
    // document must land at the end of the last line — the character is
    // clamped against the CLAMPED line's length, not the requested
    // (nonexistent) line.
    const d = doc('ab\r\ncdef');
    expect(d.normalizePosition({ line: 99, character: 99 })).toEqual({
      line: 1,
      character: 4,
    });
  });

  test('normalizePosition cannot land inside a CRLF pair', () => {
    // On a line ending in \r\n, an overshooting character clamps to the line
    // content length: character 3 on "ab\r\n" would sit between \r and \n.
    const d = doc('ab\r\ncdef');
    expect(d.normalizePosition({ line: 0, character: 3 })).toEqual({
      line: 0,
      character: 2,
    });
    expect(d.normalizePosition({ line: 0, character: 4 })).toEqual({
      line: 0,
      character: 2,
    });
  });

  test('normalizePosition clamps to character 0 on the empty trailing line', () => {
    // A document ending in a newline has an empty final logical line; any
    // character overshoot there clamps to 0 (the document end).
    const d = doc('ab\n');
    expect(d.lineCount).toBe(2);
    expect(d.normalizePosition({ line: 1, character: 7 })).toEqual({
      line: 1,
      character: 0,
    });
  });
});

// Applies a single insert whose range carries malformed numeric components,
// then reports whether the document survived. A correct implementation may
// either reject the edit (throw) or clamp the position to something valid —
// both count as surviving. What must never happen is unrelated content
// vanishing.
function insertAtMalformed(
  original: string,
  line: number,
  character: number
): { threw: boolean; text: string } {
  const d = doc(original);
  let threw = false;
  try {
    d.applyEdits([
      {
        range: {
          start: { line, character },
          end: { line, character },
        },
        newText: '#',
      },
    ]);
  } catch {
    threw = true;
  }
  return { threw, text: d.getText() };
}

describe('malformed numeric position components', () => {
  // normalizePosition sanitizes malformed components the same way it clamps
  // out-of-range ones: NaN and -Infinity act as 0, fractions floor, and
  // +Infinity clamps to the document/line end. An edit carrying a malformed
  // position therefore lands at a valid clamped spot instead of resolving to
  // a NaN offset (which used to degenerate into a whole-document replace).

  test('an insert with a NaN component never destroys unrelated content', () => {
    // A NaN component sanitizes to 0, so the insert lands at the start of
    // the resolved axis: [NaN, 1] keeps the intact character 1, [0, NaN] and
    // [NaN, NaN] land at the document start.
    for (const [line, character, expected] of [
      [Number.NaN, 1, 'h#arbor\nlantern'],
      [0, Number.NaN, '#harbor\nlantern'],
      [Number.NaN, Number.NaN, '#harbor\nlantern'],
    ] as const) {
      const { threw, text } = insertAtMalformed(
        'harbor\nlantern',
        line,
        character
      );
      expect(threw).toBe(false);
      expect(text).toBe(expected);
    }
  });

  test('an insert with fractional components floors to a valid position', () => {
    const { threw, text } = insertAtMalformed('harbor\nlantern', 0.5, 2.5);
    expect(threw).toBe(false);
    // line 0.5 floors to 0, character 2.5 floors to 2.
    expect(text).toBe('ha#rbor\nlantern');
  });

  test('Infinity components clamp to a valid position without data loss', () => {
    // DIVERGENCE: a stricter contract would reject non-finite components by
    // throwing; the sanitizing clamp bounds +Infinity to the last line
    // instead, keeping every position-taking API total.
    const { threw, text } = insertAtMalformed('harbor\nlantern', Infinity, 0);
    expect(threw).toBe(false);
    expect(text).toContain('harbor');
    expect(text).toContain('lantern');
    expect(text).toContain('#');
  });
});
