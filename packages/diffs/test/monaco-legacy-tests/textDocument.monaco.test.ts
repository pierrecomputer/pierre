import { describe, expect, test } from 'bun:test';

import { TextDocument } from '../../src/editor/textDocument';
import type { TextEdit } from '../../src/types';

function doc(text: string) {
  return new TextDocument('inmemory://1', text, 'plain');
}

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

describe('TextDocument (monaco-legacy)', () => {
  // monaco-legacy: src/vs/editor/test/common/model/textModel.test.ts — "multiline text"
  test('eol detection uses the first line break, not a whole-file majority vote', () => {
    // DIVERGENCE: vscode's TextModelData.fromString picks the EOL by majority
    // vote across the whole file (a document whose breaks are mostly \r\n
    // reports \r\n even if the first break is \n). pierre-fe deliberately
    // reads only the FIRST line's break (see the eol getter's comment in
    // textDocument.ts): it is cheaper, stable under edits below line 0, and
    // mixed-EOL files are an edge case for a diff-oriented editor.
    const firstLfRestCrlf = doc('red\ngreen\r\nblue\r\nteal\r\npink');
    expect(firstLfRestCrlf.lineCount).toBe(5);
    // vscode (majority vote) would report '\r\n' here; pierre-fe reports '\n'.
    expect(firstLfRestCrlf.eol).toBe('\n');

    const firstCrlfRestLf = doc('red\r\ngreen\nblue\nteal\npink');
    // vscode (majority vote) would report '\n' here; pierre-fe reports '\r\n'.
    expect(firstCrlfRestLf.eol).toBe('\r\n');

    // The consequence: pasted text is normalized to the first line's style.
    expect(firstLfRestCrlf.normalizeEol('x\r\ny')).toBe('x\ny');
    expect(firstCrlfRestLf.normalizeEol('x\ny')).toBe('x\r\ny');
  });

  // monaco-legacy: src/vs/editor/test/common/model/editableTextModel.test.ts — "issue #2586 Replacing selected end-of-line with newline locks up the document"
  test('replacing a selected line break with a newline is a stable no-op', () => {
    // The edit range runs from end-of-line-0 content through start-of-line-1,
    // covering exactly the "\n", and the replacement recreates the same break.
    const d = doc('stanza\nrefrain');
    const change = replaceLineBreak(d, 0, '\n');

    // Buffer and line structure are unchanged (and, per the original vscode
    // regression, the model did not lock up computing the change).
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

  // monaco-legacy: src/vs/editor/test/common/model/editableTextModel.test.ts — "issue #2586 Replacing selected end-of-line with newline locks up the document"
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

  // monaco-legacy: src/vs/editor/test/common/model/editableTextModel.test.ts — "issue #2586 Replacing selected end-of-line with newline locks up the document"
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

  // monaco-legacy: src/vs/editor/test/common/model/textModel.test.ts — "validatePosition"
  test('normalizePosition clamps both coordinates when line and character overshoot together', () => {
    // vscode: validatePosition(new Position(30, 30)) on a 2-line model lands
    // at the end of the last line — the character must be clamped against the
    // CLAMPED line's length, not the requested (nonexistent) line.
    const d = doc('ab\r\ncdef');
    expect(d.normalizePosition({ line: 99, character: 99 })).toEqual({
      line: 1,
      character: 4,
    });
  });

  // monaco-legacy: src/vs/editor/test/common/model/textModel.test.ts — "validatePosition"
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

  // monaco-legacy: src/vs/editor/test/common/model/textModel.test.ts — "validatePosition"
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
