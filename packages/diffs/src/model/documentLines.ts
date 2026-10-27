import { linesFromFileContents } from '../utils/computeFileOffsets';
import type { DocumentLineChange, DocumentLines } from './types';

// Reads the text of every line an edit touched from the editor's document,
// keyed by line index. The model holds every line of the file, so lines
// outside the rendered window are read too.
export function readChangedLines(
  document: DocumentLines,
  change: DocumentLineChange
): Map<number, string> {
  // A batch that adds lines in one place and removes as many in another
  // keeps the line count but moves every line between the two, so the whole
  // span is read in that case.
  const ranges =
    change.changedLineChanges?.some(([, , lineDelta]) => lineDelta !== 0) ===
    true
      ? [[change.startLine, change.endLine] as const]
      : change.changedLineRanges;
  const lines = new Map<number, string>();
  for (const [start, end] of ranges) {
    const last = Math.min(end, document.lineCount - 1);
    if (last < start) continue;
    if (last === start) {
      lines.set(start, document.getLineText(start, true));
      continue;
    }
    const endPosition =
      last + 1 < document.lineCount
        ? { line: last + 1, character: 0 }
        : { line: last, character: document.getLineText(last).length };
    const contents = document.getText({
      start: { line: start, character: 0 },
      end: endPosition,
    });
    const rangeLines = linesFromFileContents(contents);
    for (let line = start; line <= last; line++) {
      lines.set(line, rangeLines[line - start]);
    }
  }
  return lines;
}

// Reads every line of the editor's document, with its line break, and
// returns them with their total length.
export function readAllLines(document: DocumentLines): {
  lines: string[];
  characterCount: number;
} {
  const lines: string[] = [];
  let characterCount = 0;
  for (let line = 0; line < document.lineCount; line++) {
    const text = document.getLineText(line, true);
    lines.push(text);
    characterCount += text.length;
  }
  return { lines, characterCount };
}
