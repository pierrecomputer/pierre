import { linesFromFileContents } from '../utils/computeFileOffsets';
import type { TextDocument, TextDocumentChange } from './textDocument';

// Get the current text of all lines affected by an edit, even outside the visible
// area, so the diff keeps the same text as the editor. Adding or removing lines
// can change the line numbers between edits, so include those lines too.
export function getChangedDocumentLines(
  document: Pick<TextDocument, 'getLineText' | 'getText' | 'lineCount'>,
  change: TextDocumentChange
): Map<number, string> {
  const ranges =
    change.changedLineChanges?.some(([, , delta]) => delta !== 0) === true
      ? [[change.startLine, change.endLine]]
      : change.changedLineRanges;
  const lines = new Map<number, string>();
  for (const [start, end] of ranges) {
    const lastLine = Math.min(end, document.lineCount - 1);
    if (lastLine < start) continue;
    if (lastLine === start) {
      lines.set(start, document.getLineText(start, true));
      continue;
    }
    // Read a whole range at once to avoid searching the piece table for every
    // line. Single-line edits above keep the cheaper direct lookup.
    const endPosition =
      lastLine + 1 < document.lineCount
        ? { line: lastLine + 1, character: 0 }
        : { line: lastLine, character: document.getLineText(lastLine).length };
    const contents = document.getText({
      start: { line: start, character: 0 },
      end: endPosition,
    });
    const rangeLines = linesFromFileContents(contents);
    for (let line = start; line <= lastLine; line++) {
      lines.set(line, rangeLines[line - start]);
    }
  }
  return lines;
}
