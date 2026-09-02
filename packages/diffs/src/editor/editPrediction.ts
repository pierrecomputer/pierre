import type { TextDocumentChangeTransaction } from './textDocumentChangeTransaction';
import type { Position, ResolvedTextEdit, TextEdit } from './types';

export interface EditPredictRequest {
  /** Current file name/path as supplied to the File or FileDiff component. */
  readonly path: string;
  /** Document version. */
  readonly version: number;
  /** Document end-of-line sequence. */
  readonly eol: '\n' | '\r\n' | '\r';
  /** Bounded slice of the file around the cursor (not the whole file). */
  readonly excerptText: string;
  /** Zero-based document line where the excerpt starts. */
  readonly excerptStartLine: number;
  /** UTF-16 cursor offset relative to `excerptText`. */
  readonly cursorOffsetInExcerpt: number;
  /** Half-open UTF-16 range within `excerptText` that may be edited. */
  readonly editableRange: { readonly start: number; readonly end: number };
  /** Chronological, bounded edit history for this document. */
  readonly editHistory: ReadonlyArray<{
    /** Edit in unified-diff format. */
    readonly diff: string;
    /** Edit source. */
    readonly source: 'user' | 'prediction';
  }>;
}

export interface EditPredictContext {
  /** Aborted when the document or cursor changes. */
  readonly signal: AbortSignal;
}

export interface EditPredictResponse {
  /** Non-overlapping edits using absolute document positions. */
  readonly edits: readonly TextEdit[];
  /** Absolute post-edit cursor position. */
  readonly newCursor: Position;
}

export interface EditPredictProvider {
  /** Predicts the next edit for the given request. */
  predict: (
    request: EditPredictRequest,
    context: EditPredictContext
  ) => Promise<EditPredictResponse>;
}

export interface EditPredictionHistoryRecord {
  readonly path: string;
  readonly hunk: string;
  readonly start: number;
  readonly end: number;
  readonly at: number;
  readonly source: 'user' | 'prediction';
  readonly fragment?: EditPredictionHistoryFragment;
}

interface EditPredictionDocument {
  readonly version: number;
  readonly eol: '\n' | '\r\n' | '\r';
  readonly lineCount: number;
  positionAt(offset: number): Position;
  positionsAt(offsets: readonly number[]): Position[];
  offsetAt(position: Position): number;
  getLineText(line: number): string;
  getLineLength(line: number): number;
  getTextSlice(start: number, end: number): string;
  charAt(offset: number): string;
}

interface EditPredictionHistoryFragment {
  readonly baseText: string;
  readonly currentText: string;
  readonly currentStart: number;
  readonly currentEnd: number;
  readonly startLine: number;
}

interface EditPredictionTransactionFragment {
  readonly beforeText: string;
  readonly afterText: string;
  readonly startOffset: number;
  readonly startLine: number;
  readonly bounds: LineDiffBounds;
}

interface LineDiffBounds {
  readonly oldLineCount: number;
  readonly newLineCount: number;
  readonly prefixLines: number;
  readonly suffixLines: number;
}

const EDITABLE_TOKENS = 350;
const CONTEXT_TOKENS = 150;
const MAX_EDITABLE_TOKENS = 512;
const MAX_CONTEXT_TOKENS = 662;
const MAX_REQUEST_BYTES = 128 * 1024;
const MAX_HISTORY_ENTRIES = 10;
const MAX_CAPTURE_BYTES = 6144;
const COALESCE_MS = 1000;
const COALESCE_LINES = 8;
const DIFF_CONTEXT_LINES = 3;
const CAPTURE_CONTEXT_LINES = DIFF_CONTEXT_LINES + COALESCE_LINES;
const CAPTURE_CONTEXT_OPTIONS = [
  CAPTURE_CONTEXT_LINES,
  DIFF_CONTEXT_LINES,
] as const;
const textEncoder = new TextEncoder();

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 13 && text.charCodeAt(index + 1) === 10) {
      index++;
    }
    if (text.charCodeAt(index) === 10 || text.charCodeAt(index) === 13) {
      starts.push(index + 1);
    }
  }
  return starts;
}

function lineEnd(
  text: string,
  starts: readonly number[],
  line: number
): number {
  const next = starts[line + 1];
  return next === undefined
    ? text.length
    : next -
        (text.charCodeAt(next - 1) === 10 && text.charCodeAt(next - 2) === 13
          ? 2
          : 1);
}

function linesEqual(
  left: string,
  leftStarts: readonly number[],
  leftLine: number,
  right: string,
  rightStarts: readonly number[],
  rightLine: number
): boolean {
  const leftStart = leftStarts[leftLine];
  const rightStart = rightStarts[rightLine];
  const length = lineEnd(left, leftStarts, leftLine) - leftStart;
  if (length !== lineEnd(right, rightStarts, rightLine) - rightStart) {
    return false;
  }
  for (let index = 0; index < length; index++) {
    if (
      left.charCodeAt(leftStart + index) !==
      right.charCodeAt(rightStart + index)
    ) {
      return false;
    }
  }
  return true;
}

function lineDiffBounds(
  oldText: string,
  oldStarts: readonly number[],
  newText: string,
  newStarts: readonly number[]
): LineDiffBounds {
  const oldLineCount = oldText.length === 0 ? 0 : oldStarts.length;
  const newLineCount = newText.length === 0 ? 0 : newStarts.length;
  let prefixLines = 0;
  while (prefixLines < oldLineCount && prefixLines < newLineCount) {
    if (
      !linesEqual(
        oldText,
        oldStarts,
        prefixLines,
        newText,
        newStarts,
        prefixLines
      )
    ) {
      break;
    }
    prefixLines++;
  }

  let suffixLines = 0;
  while (
    suffixLines < oldLineCount - prefixLines &&
    suffixLines < newLineCount - prefixLines
  ) {
    const oldLine = oldLineCount - 1 - suffixLines;
    const newLine = newLineCount - 1 - suffixLines;
    if (!linesEqual(oldText, oldStarts, oldLine, newText, newStarts, newLine)) {
      break;
    }
    suffixLines++;
  }
  return { oldLineCount, newLineCount, prefixLines, suffixLines };
}

function formatEditHunk(
  path: string,
  oldText: string,
  newText: string,
  lineOffset = 0
): { readonly hunk: string; readonly bounds: LineDiffBounds } | undefined {
  if (oldText === newText) {
    return;
  }
  const oldStarts = lineStarts(oldText);
  const newStarts = lineStarts(newText);
  const bounds = lineDiffBounds(oldText, oldStarts, newText, newStarts);
  if (
    bounds.prefixLines === bounds.oldLineCount &&
    bounds.prefixLines === bounds.newLineCount
  ) {
    return;
  }
  const oldChangedEnd = bounds.oldLineCount - bounds.suffixLines;
  const newChangedEnd = bounds.newLineCount - bounds.suffixLines;
  const oldChanged = oldText.slice(
    oldStarts[bounds.prefixLines] ?? oldText.length,
    oldStarts[oldChangedEnd] ?? oldText.length
  );
  const newChanged = newText.slice(
    newStarts[bounds.prefixLines] ?? newText.length,
    newStarts[newChangedEnd] ?? newText.length
  );
  if (
    textEncoder.encode(oldChanged).byteLength > MAX_CAPTURE_BYTES ||
    textEncoder.encode(newChanged).byteLength > MAX_CAPTURE_BYTES
  ) {
    return;
  }

  const start = Math.max(0, bounds.prefixLines - DIFF_CONTEXT_LINES);
  const oldEnd = Math.min(
    bounds.oldLineCount,
    oldChangedEnd + DIFF_CONTEXT_LINES
  );
  const newEnd = Math.min(
    bounds.newLineCount,
    newChangedEnd + DIFF_CONTEXT_LINES
  );
  const oldCount = oldEnd - start;
  const newCount = newEnd - start;
  const line = start + lineOffset;
  const output = [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${oldCount === 0 ? line : line + 1},${oldCount} +${
      newCount === 0 ? line : line + 1
    },${newCount} @@`,
  ];
  for (let line = start; line < bounds.prefixLines; line++) {
    output.push(
      ` ${oldText.slice(oldStarts[line], lineEnd(oldText, oldStarts, line))}`
    );
  }
  for (let line = bounds.prefixLines; line < oldChangedEnd; line++) {
    output.push(
      `-${oldText.slice(oldStarts[line], lineEnd(oldText, oldStarts, line))}`
    );
  }
  for (let line = bounds.prefixLines; line < newChangedEnd; line++) {
    output.push(
      `+${newText.slice(newStarts[line], lineEnd(newText, newStarts, line))}`
    );
  }
  for (let line = oldChangedEnd; line < oldEnd; line++) {
    output.push(
      ` ${oldText.slice(oldStarts[line], lineEnd(oldText, oldStarts, line))}`
    );
  }
  const hunk = output.join('\n');
  return textEncoder.encode(hunk).byteLength <= MAX_CAPTURE_BYTES
    ? { hunk, bounds }
    : undefined;
}

// Applies offset edits to a bounded document slice without materializing the
// surrounding file. Returns undefined if the slice does not contain the edits.
function applyEditsToSlice(
  text: string,
  sliceStart: number,
  edits: readonly ResolvedTextEdit[]
): string | undefined {
  const chunks: string[] = [];
  let offset = 0;
  for (const edit of edits) {
    const start = edit.start - sliceStart;
    const end = edit.end - sliceStart;
    if (start < offset || end < start || end > text.length) {
      return;
    }
    chunks.push(text.slice(offset, start), edit.text);
    offset = end;
  }
  chunks.push(text.slice(offset));
  return chunks.join('');
}

// Captures a small post-edit window and reconstructs its pre-edit contents
// from the inverse edits already stored by the undo transaction.
function captureEditPredictionTransaction(
  document: EditPredictionDocument,
  transaction: TextDocumentChangeTransaction
): EditPredictionTransactionFragment | undefined {
  const inverseEdits = transaction.inverseEdits;
  if (inverseEdits.length === 0) {
    return;
  }
  let changedStart = inverseEdits[0].start;
  let changedEnd = inverseEdits[0].end;
  for (let index = 1; index < inverseEdits.length; index++) {
    changedStart = Math.min(changedStart, inverseEdits[index].start);
    changedEnd = Math.max(changedEnd, inverseEdits[index].end);
  }
  const [startPosition, endPosition] = document.positionsAt([
    changedStart,
    changedEnd,
  ]);
  for (const contextLines of CAPTURE_CONTEXT_OPTIONS) {
    const startLine = Math.max(0, startPosition.line - contextLines);
    const endLine = Math.min(
      document.lineCount - 1,
      endPosition.line + contextLines
    );
    const afterStart = document.offsetAt({
      line: startLine,
      character: 0,
    });
    const afterEnd =
      endLine + 1 < document.lineCount
        ? document.offsetAt({ line: endLine + 1, character: 0 })
        : document.offsetAt({
            line: endLine,
            character: document.getLineLength(endLine),
          });
    if (afterEnd - afterStart > MAX_CAPTURE_BYTES) {
      continue;
    }
    const afterText = document.getTextSlice(afterStart, afterEnd);
    if (textEncoder.encode(afterText).byteLength > MAX_CAPTURE_BYTES) {
      continue;
    }
    const beforeText = applyEditsToSlice(afterText, afterStart, inverseEdits);
    if (
      beforeText === undefined ||
      beforeText.length > MAX_CAPTURE_BYTES ||
      textEncoder.encode(beforeText).byteLength > MAX_CAPTURE_BYTES
    ) {
      continue;
    }
    const bounds = lineDiffBounds(
      beforeText,
      lineStarts(beforeText),
      afterText,
      lineStarts(afterText)
    );
    return {
      beforeText,
      afterText,
      startOffset: afterStart,
      startLine,
      bounds,
    };
  }
  return undefined;
}

export function recordEditPrediction(
  history: readonly EditPredictionHistoryRecord[],
  path: string,
  document: EditPredictionDocument,
  transaction: TextDocumentChangeTransaction,
  source: 'user' | 'prediction',
  at: number = Date.now()
): EditPredictionHistoryRecord[] {
  const kept = history.slice(-MAX_HISTORY_ENTRIES);
  const fragment = captureEditPredictionTransaction(document, transaction);
  if (fragment === undefined) {
    const previous = kept.at(-1);
    if (previous?.fragment !== undefined) {
      kept[kept.length - 1] = { ...previous, fragment: undefined };
    }
    return kept;
  }
  if (fragment.beforeText === fragment.afterText) {
    return kept;
  }
  const changedStartLine = fragment.startLine + fragment.bounds.prefixLines;
  const beforeChangedEndLine =
    fragment.startLine +
    fragment.bounds.oldLineCount -
    fragment.bounds.suffixLines;
  const last = kept.at(-1);
  const gap =
    last !== undefined && changedStartLine > last.end
      ? changedStartLine - last.end
      : last !== undefined && last.start > beforeChangedEndLine
        ? last.start - beforeChangedEndLine
        : 0;
  const canMerge =
    last !== undefined &&
    last.fragment !== undefined &&
    last.path === path &&
    last.source === source &&
    at - last.at < COALESCE_MS &&
    gap <= COALESCE_LINES;

  if (canMerge) {
    const previous = last.fragment;
    const beforeEnd = fragment.startOffset + fragment.beforeText.length;
    const overlapStart = Math.max(previous.currentStart, fragment.startOffset);
    const overlapEnd = Math.min(previous.currentEnd, beforeEnd);
    if (
      overlapStart <= overlapEnd &&
      previous.currentText.slice(
        overlapStart - previous.currentStart,
        overlapEnd - previous.currentStart
      ) ===
        fragment.beforeText.slice(
          overlapStart - fragment.startOffset,
          overlapEnd - fragment.startOffset
        )
    ) {
      const unionStart = Math.min(previous.currentStart, fragment.startOffset);
      const currentText =
        previous.currentStart <= fragment.startOffset
          ? previous.currentText +
            fragment.beforeText.slice(
              Math.max(0, previous.currentEnd - fragment.startOffset)
            )
          : fragment.beforeText +
            previous.currentText.slice(
              Math.max(0, beforeEnd - previous.currentStart)
            );
      const prefix = currentText.slice(0, previous.currentStart - unionStart);
      const suffix = currentText.slice(previous.currentEnd - unionStart);
      const baseText = prefix + previous.baseText + suffix;
      const nextText = applyEditsToSlice(
        currentText,
        unionStart,
        transaction.appliedEdits
      );
      const startLine =
        previous.currentStart <= fragment.startOffset
          ? previous.startLine
          : fragment.startLine;
      if (
        nextText !== undefined &&
        baseText.length <= MAX_CAPTURE_BYTES &&
        nextText.length <= MAX_CAPTURE_BYTES &&
        textEncoder.encode(baseText).byteLength <= MAX_CAPTURE_BYTES &&
        textEncoder.encode(nextText).byteLength <= MAX_CAPTURE_BYTES
      ) {
        if (baseText === nextText) {
          kept.pop();
          return kept;
        }
        const formatted = formatEditHunk(path, baseText, nextText, startLine);
        if (formatted !== undefined) {
          kept[kept.length - 1] = {
            path,
            hunk: formatted.hunk,
            start: startLine + formatted.bounds.prefixLines,
            end:
              startLine +
              formatted.bounds.newLineCount -
              formatted.bounds.suffixLines,
            at,
            source,
            fragment: {
              baseText,
              currentText: nextText,
              currentStart: unionStart,
              currentEnd: unionStart + nextText.length,
              startLine,
            },
          };
          return kept;
        }
      }
    }
  }
  const previous = kept.at(-1);
  if (previous?.fragment !== undefined) {
    kept[kept.length - 1] = { ...previous, fragment: undefined };
  }
  const formatted = formatEditHunk(
    path,
    fragment.beforeText,
    fragment.afterText,
    fragment.startLine
  );
  if (formatted === undefined) {
    return kept;
  }
  kept.push({
    path,
    hunk: formatted.hunk,
    start: changedStartLine,
    end:
      fragment.startLine +
      fragment.bounds.newLineCount -
      fragment.bounds.suffixLines,
    at,
    source,
    fragment: {
      baseText: fragment.beforeText,
      currentText: fragment.afterText,
      currentStart: fragment.startOffset,
      currentEnd: fragment.startOffset + fragment.afterText.length,
      startLine: fragment.startLine,
    },
  });
  return kept.slice(-MAX_HISTORY_ENTRIES);
}

function expandLinewise(
  lineCount: number,
  costForLine: (line: number) => number,
  first: number,
  last: number,
  remaining: number
): { first: number; last: number } {
  while (remaining > 0 && (first > 0 || last < lineCount - 1)) {
    let expanded = false;
    if (first > 0) {
      const cost = costForLine(first - 1);
      if (cost <= remaining) {
        first--;
        remaining -= cost;
        expanded = true;
      }
    }
    if (last < lineCount - 1) {
      const cost = costForLine(last + 1);
      if (cost <= remaining) {
        last++;
        remaining -= cost;
        expanded = true;
      }
    }
    if (!expanded) {
      break;
    }
  }
  return { first, last };
}

export function buildEditPredictionRequest(
  path: string,
  document: EditPredictionDocument,
  cursorOffset: number,
  history: readonly EditPredictionHistoryRecord[]
): EditPredictRequest | undefined {
  if (document.lineCount <= 0) {
    return;
  }
  const lastLine = document.lineCount - 1;
  const documentLength = document.offsetAt({
    line: lastLine,
    character: document.getLineLength(lastLine),
  });
  const normalizedCursor = Number.isFinite(cursorOffset)
    ? Math.trunc(cursorOffset)
    : 0;
  let cursor = Math.max(0, Math.min(normalizedCursor, documentLength));
  const previous = document.charAt(cursor - 1).charCodeAt(0);
  const next = document.charAt(cursor).charCodeAt(0);
  if (
    cursor > 0 &&
    cursor < documentLength &&
    ((previous === 13 && next === 10) ||
      (previous >= 0xd800 &&
        previous <= 0xdbff &&
        next >= 0xdc00 &&
        next <= 0xdfff))
  ) {
    cursor--;
  }
  const cursorLine = document.positionAt(cursor).line;
  const tokenCosts = new Map<number, number>();
  const costForLine = (line: number): number => {
    const cached = tokenCosts.get(line);
    if (cached !== undefined) {
      return cached;
    }
    const lineLength = document.getLineLength(line);
    if (Math.floor(lineLength / 3) > MAX_CONTEXT_TOKENS) {
      const cost = MAX_CONTEXT_TOKENS + 1;
      tokenCosts.set(line, cost);
      return cost;
    }
    const cost = Math.max(
      1,
      Math.floor(textEncoder.encode(document.getLineText(line)).byteLength / 3)
    );
    tokenCosts.set(line, cost);
    return cost;
  };

  let editableFirst = cursorLine;
  let editableLast = cursorLine;
  const initialBudget = Math.floor((EDITABLE_TOKENS * 3) / 4);
  let remaining = Math.max(0, initialBudget - costForLine(cursorLine));
  while (
    remaining > 0 &&
    (editableFirst > 0 || editableLast < document.lineCount - 1)
  ) {
    if (editableLast < document.lineCount - 1) {
      const cost = costForLine(editableLast + 1);
      if (cost > remaining) {
        break;
      }
      editableLast++;
      remaining -= cost;
    }
    if (editableFirst > 0 && remaining > 0) {
      const cost = costForLine(editableFirst - 1);
      if (cost > remaining) {
        break;
      }
      editableFirst--;
      remaining -= cost;
    }
  }
  remaining += EDITABLE_TOKENS - initialBudget;
  ({ first: editableFirst, last: editableLast } = expandLinewise(
    document.lineCount,
    costForLine,
    editableFirst,
    editableLast,
    remaining
  ));

  let contextFirst = editableFirst;
  let contextLast = editableLast;
  ({ first: contextFirst, last: contextLast } = expandLinewise(
    document.lineCount,
    costForLine,
    contextFirst,
    contextLast,
    CONTEXT_TOKENS
  ));
  let editableTokens = 0;
  for (let line = editableFirst; line <= editableLast; line++) {
    editableTokens += costForLine(line);
  }
  let contextTokens = 0;
  for (let line = contextFirst; line <= contextLast; line++) {
    contextTokens += costForLine(line);
  }
  if (
    editableTokens > MAX_EDITABLE_TOKENS ||
    contextTokens > MAX_CONTEXT_TOKENS
  ) {
    return;
  }

  const contextStart = document.offsetAt({
    line: contextFirst,
    character: 0,
  });
  const contextEnd = document.offsetAt({
    line: contextLast,
    character: document.getLineLength(contextLast),
  });
  const excerptText = document.getTextSlice(contextStart, contextEnd);
  const request: EditPredictRequest = {
    path,
    version: document.version,
    eol: document.eol,
    excerptText,
    excerptStartLine: contextFirst,
    cursorOffsetInExcerpt: cursor - contextStart,
    editableRange: {
      start:
        document.offsetAt({ line: editableFirst, character: 0 }) - contextStart,
      end:
        document.offsetAt({
          line: editableLast,
          character: document.getLineLength(editableLast),
        }) - contextStart,
    },
    editHistory: history
      .slice(-MAX_HISTORY_ENTRIES)
      .map(({ hunk, source }) => ({
        diff: hunk,
        source,
      })),
  };
  return textEncoder.encode(JSON.stringify(request)).byteLength <=
    MAX_REQUEST_BYTES
    ? request
    : undefined;
}

export function matchesEditPredictionPattern(
  path: string,
  pattern: string | RegExp
): boolean {
  if (typeof pattern !== 'string') {
    return new RegExp(pattern.source, pattern.flags).test(path);
  }

  pattern = pattern.replaceAll('\\', '/');
  let source = '^';
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index];
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        index++;
        if (pattern[index + 1] === '/') {
          index++;
          source += '(?:.*/)?';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
    } else if (character === '?') {
      source += '[^/]';
    } else {
      source += /[\\^$.*+?()[\]{}|]/.test(character)
        ? `\\${character}`
        : character;
    }
  }
  return new RegExp(`${source}$`).test(path);
}
