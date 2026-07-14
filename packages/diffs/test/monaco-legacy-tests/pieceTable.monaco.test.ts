import { describe, expect, test } from 'bun:test';

import { PieceTable } from '../../src/editor/pieceTable';
import type { Position } from '../../src/types';

// Independent line-splitting oracle. Line breaks are `\n`, lone `\r`, and
// `\r\n` counted as ONE break — the same policy as computeLineOffsets, which
// is the buffer-level source of truth the PieceTable is supposed to agree
// with at the document level. Returns the start offset of every line.
function oracleLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 10) {
      starts.push(i + 1);
    } else if (code === 13) {
      if (i + 1 < text.length && text.charCodeAt(i + 1) === 10) {
        i++; // \r\n is a single break
      }
      starts.push(i + 1);
    }
  }
  return starts;
}

function oraclePositionAt(text: string, offset: number): Position {
  const clamped = Math.min(Math.max(offset, 0), text.length);
  const starts = oracleLineStarts(text);
  let line = 0;
  while (line + 1 < starts.length && starts[line + 1] <= clamped) {
    line++;
  }
  return { line, character: clamped - starts[line] };
}

function oracleOffsetAt(text: string, position: Position): number {
  if (position.line < 0 || text.length === 0) {
    return 0;
  }
  const starts = oracleLineStarts(text);
  const lineStart = starts[position.line];
  const lineEnd =
    position.line + 1 < starts.length ? starts[position.line + 1] : text.length;
  const character = Math.min(
    Math.max(position.character, 0),
    lineEnd - lineStart
  );
  return lineStart + character;
}

// Full line-metadata cross-check: content, line count, and both directions of
// the offset<->position mapping over the entire document.
function expectLineMetadataToMatch(table: PieceTable, text: string): void {
  expect(table.getText()).toBe(text);

  const starts = oracleLineStarts(text);
  expect(table.lineCount).toBe(starts.length);

  for (let offset = 0; offset <= text.length; offset++) {
    expect(table.positionAt(offset)).toEqual(oraclePositionAt(text, offset));
  }

  for (let line = 0; line < starts.length; line++) {
    const lineEnd = line + 1 < starts.length ? starts[line + 1] : text.length;
    for (let character = 0; character <= lineEnd - starts[line]; character++) {
      expect(table.offsetAt({ line, character })).toBe(
        oracleOffsetAt(text, { line, character })
      );
    }
  }
}

// Deterministic LCG, same shape as the fuzz driver in editorPieceTable.test.ts.
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe('PieceTable CRLF and lone-CR line breaks (monaco-legacy)', () => {
  // monaco-legacy: src/vs/editor/test/common/model/model.test.ts — "Bug 13333:Model should line break on lonely CR too"
  test('lone \\r mixed with \\r\\n breaks reads back byte-for-byte untouched', () => {
    // DIVERGENCE: vscode's getValue() rewrites a lone \r to the document's
    // dominant EOL on read (the model normalizes line endings). pierre-fe is
    // diff-oriented and must preserve the original bytes exactly, so getText()
    // returns the lone \r untouched.
    const original = 'north\r\nsouth east\rwest\r\ncenter';
    const table = new PieceTable(original);

    expect(table.getText()).toBe(original);
  });

  // monaco-legacy: src/vs/editor/test/common/model/model.test.ts — "Bug 13333:Model should line break on lonely CR too"
  test('lone \\r mixed with \\r\\n breaks still counts as its own line break', () => {
    // The half of Bug 13333 pierre-fe shares with vscode: even though the lone
    // \r byte is preserved (see the divergence above), it is still a line
    // break for line counting and position mapping.
    const original = 'north\r\nsouth east\rwest\r\ncenter';
    const table = new PieceTable(original);

    expect(table.lineCount).toBe(4);
    expect(table.getLineText(0)).toBe('north');
    expect(table.getLineText(1)).toBe('south east');
    expect(table.getLineText(2)).toBe('west');
    expect(table.getLineText(3)).toBe('center');
    // Offset 18 sits right after the lone \r: the start of line 2.
    expect(table.positionAt(18)).toEqual({ line: 2, character: 0 });
    expect(table.offsetAt({ line: 2, character: 0 })).toBe(18);
  });

  // monaco-legacy: src/vs/editor/test/common/model/pieceTreeTextBuffer/pieceTreeTextBuffer.test.ts — "delete CR in CRLF 1"
  test('deleting exactly the \\r of a \\r\\n pair leaves a valid \\n break', () => {
    const table = new PieceTable('cat\r\ndog');

    table.delete(3, 1);

    expect(table.getText()).toBe('cat\ndog');
    expect(table.lineCount).toBe(2);
  });

  // monaco-legacy: src/vs/editor/test/common/model/pieceTreeTextBuffer/pieceTreeTextBuffer.test.ts — "delete CR in CRLF 2"
  // KNOWN BUG: deleting the \n out of \r\n leaves a lone \r that the piece's
  // buffer-based line metadata no longer counts as a break (the buffer counted
  // \r\n as one break ending after the \n, which is now outside the piece), so
  // lineCount collapses to 1 even though the text still has two lines.
  test.failing(
    'deleting exactly the \\n of a \\r\\n pair leaves a lone \\r break',
    () => {
      const table = new PieceTable('cat\r\ndog');

      table.delete(4, 1);

      expect(table.getText()).toBe('cat\rdog');
      expect(table.lineCount).toBe(2);
    }
  );

  // monaco-legacy: src/vs/editor/test/common/model/pieceTreeTextBuffer/pieceTreeTextBuffer.test.ts — CRLF suite "random bug 1"-"random bug 10" (minimal directed repro)
  // KNOWN BUG: a \r and a \n inserted separately land as distinct chunks in
  // the add buffer, each counted as its own line break, so the \r\n pair they
  // form in the document is double-counted and lineCount reads 3 instead of 2.
  test.failing(
    '\\r\\n assembled from two separate inserts counts as one break',
    () => {
      const table = new PieceTable('ab');

      table.insert('\r', 1);
      table.insert('\n', 2);

      expect(table.getText()).toBe('a\r\nb');
      expect(table.lineCount).toBe(2);
    }
  );

  // monaco-legacy: src/vs/editor/test/common/model/pieceTreeTextBuffer/pieceTreeTextBuffer.test.ts — CRLF suite "random bug 1"-"random bug 10" (minimal directed repro)
  // KNOWN BUG: inserting between the \r and \n of an existing pair splits the
  // piece, but the buffer's line metadata still records one break ending after
  // the \n, so the now-lone \r is not counted and lineCount reads 2 instead of 3.
  test.failing(
    'inserting between \\r and \\n promotes the \\r to its own break',
    () => {
      const table = new PieceTable('a\r\nb');

      table.insert('X', 2);

      expect(table.getText()).toBe('a\rX\nb');
      expect(table.lineCount).toBe(3);
    }
  );

  // monaco-legacy: src/vs/editor/test/common/model/pieceTreeTextBuffer/pieceTreeTextBuffer.test.ts — CRLF suite "random bug 1"-"random bug 10"
  // KNOWN BUG: CRLF pairs split or formed across piece boundaries corrupt the
  // piece-level line-break counts (see the two directed repros above), so
  // lineCount and positionAt/offsetAt drift from the string oracle under
  // CR/LF-biased editing even while getText() stays correct.
  test.failing(
    'line metadata matches a string oracle across CRLF-biased random edits',
    () => {
      const random = createRandom(20260713);
      const inserts = ['\r', '\n', '\r\n', '\n\r', '\r\nq', 'j\r', 'zz', ''];
      let text = 'aa\r\nbb\ncc\r\ndd';
      const table = new PieceTable(text);

      for (let i = 0; i < 200; i++) {
        if (random() < 0.65) {
          const insert = inserts[Math.floor(random() * inserts.length)];
          const offset = Math.floor(random() * (text.length + 1));
          table.insert(insert, offset);
          text = text.slice(0, offset) + insert + text.slice(offset);
        } else {
          const offset = Math.floor(random() * (text.length + 1));
          const length = Math.floor(random() * 4);
          table.delete(offset, length);
          text = text.slice(0, offset) + text.slice(offset + length);
        }

        expectLineMetadataToMatch(table, text);
      }
    }
  );
});
