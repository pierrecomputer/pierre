import type { Position, TextEdit } from '../types';

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
  readonly base?: string;
  readonly hunk: string;
  readonly start: number;
  readonly end: number;
  readonly at: number;
  readonly source: 'user' | 'prediction';
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
): {
  oldLineCount: number;
  newLineCount: number;
  prefixLines: number;
  suffixLines: number;
} {
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
  newText: string
): string | undefined {
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

  const oldStart = Math.max(0, bounds.prefixLines - 3);
  const newStart = Math.max(0, bounds.prefixLines - 3);
  const oldEnd = Math.min(bounds.oldLineCount, oldChangedEnd + 3);
  const newEnd = Math.min(bounds.newLineCount, newChangedEnd + 3);
  const oldCount = oldEnd - oldStart;
  const newCount = newEnd - newStart;
  const output = [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${oldCount === 0 ? oldStart : oldStart + 1},${oldCount} +${
      newCount === 0 ? newStart : newStart + 1
    },${newCount} @@`,
  ];
  for (let line = oldStart; line < bounds.prefixLines; line++) {
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
    ? hunk
    : undefined;
}

export function recordEditPrediction(
  history: readonly EditPredictionHistoryRecord[],
  path: string,
  oldText: string,
  newText: string,
  source: 'user' | 'prediction',
  at: number = Date.now()
): EditPredictionHistoryRecord[] {
  const kept = history.slice(-MAX_HISTORY_ENTRIES);
  if (oldText === newText) {
    return kept;
  }
  const oldStarts = lineStarts(oldText);
  const initial = lineDiffBounds(
    oldText,
    oldStarts,
    newText,
    lineStarts(newText)
  );
  const start = initial.prefixLines;
  const end = initial.oldLineCount - initial.suffixLines;
  const last = kept.at(-1);
  const gap =
    last !== undefined && start > last.end
      ? start - last.end
      : last !== undefined && last.start > end
        ? last.start - end
        : 0;
  const mergeBase = last?.base;
  let merge =
    last !== undefined &&
    mergeBase !== undefined &&
    last.path === path &&
    last.source === source &&
    at - last.at < COALESCE_MS &&
    gap <= COALESCE_LINES;
  let base = merge ? mergeBase! : oldText;
  let hunk = formatEditHunk(path, base, newText);
  if (hunk === undefined) {
    if (merge && base === newText) {
      kept.pop();
    } else if (merge) {
      base = oldText;
      hunk = formatEditHunk(path, base, newText);
      merge = false;
    }
    if (hunk === undefined) {
      return kept;
    }
  }
  if (merge) {
    kept.pop();
  }
  const previous = kept.at(-1);
  if (previous?.base !== undefined) {
    kept[kept.length - 1] = { ...previous, base: undefined };
  }
  const merged = lineDiffBounds(
    base,
    lineStarts(base),
    newText,
    lineStarts(newText)
  );
  kept.push({
    path,
    base,
    hunk,
    start: merged.prefixLines,
    end: merged.newLineCount - merged.suffixLines,
    at,
    source,
  });
  return kept.slice(-MAX_HISTORY_ENTRIES);
}

function expandLinewise(
  costs: readonly number[],
  first: number,
  last: number,
  remaining: number,
  preferBefore: boolean
): { first: number; last: number } {
  while (remaining > 0 && (first > 0 || last < costs.length - 1)) {
    let expanded = false;
    if (preferBefore) {
      if (first > 0 && costs[first - 1] <= remaining) {
        remaining -= costs[--first];
        expanded = true;
      }
      if (last < costs.length - 1 && costs[last + 1] <= remaining) {
        remaining -= costs[++last];
        expanded = true;
      }
    } else {
      if (last < costs.length - 1 && costs[last + 1] <= remaining) {
        remaining -= costs[++last];
        expanded = true;
      }
      if (first > 0 && costs[first - 1] <= remaining) {
        remaining -= costs[--first];
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
  version: number,
  content: string,
  cursorOffset: number,
  history: readonly EditPredictionHistoryRecord[]
): EditPredictRequest | undefined {
  const starts = lineStarts(content);
  const normalizedCursor = Number.isFinite(cursorOffset)
    ? Math.trunc(cursorOffset)
    : 0;
  let cursor = Math.max(0, Math.min(normalizedCursor, content.length));
  const previous = content.charCodeAt(cursor - 1);
  const next = content.charCodeAt(cursor);
  if (
    cursor > 0 &&
    cursor < content.length &&
    ((previous === 13 && next === 10) ||
      (previous >= 0xd800 &&
        previous <= 0xdbff &&
        next >= 0xdc00 &&
        next <= 0xdfff))
  ) {
    cursor--;
  }
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (starts[middle] <= cursor) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  const cursorLine = low;
  const tokenCosts = starts.map((start, line) =>
    Math.max(
      1,
      Math.floor(
        textEncoder.encode(content.slice(start, lineEnd(content, starts, line)))
          .byteLength / 3
      )
    )
  );

  let editableFirst = cursorLine;
  let editableLast = cursorLine;
  const initialBudget = Math.floor((EDITABLE_TOKENS * 3) / 4);
  let remaining = Math.max(0, initialBudget - tokenCosts[cursorLine]);
  while (
    remaining > 0 &&
    (editableFirst > 0 || editableLast < tokenCosts.length - 1)
  ) {
    if (
      editableLast < tokenCosts.length - 1 &&
      tokenCosts[editableLast + 1] <= remaining
    ) {
      remaining -= tokenCosts[++editableLast];
    } else if (editableLast < tokenCosts.length - 1) {
      break;
    }
    if (
      editableFirst > 0 &&
      remaining > 0 &&
      tokenCosts[editableFirst - 1] <= remaining
    ) {
      remaining -= tokenCosts[--editableFirst];
    } else if (editableFirst > 0 && remaining > 0) {
      break;
    }
  }
  remaining += EDITABLE_TOKENS - initialBudget;
  ({ first: editableFirst, last: editableLast } = expandLinewise(
    tokenCosts,
    editableFirst,
    editableLast,
    remaining,
    true
  ));

  let contextFirst = editableFirst;
  let contextLast = editableLast;
  ({ first: contextFirst, last: contextLast } = expandLinewise(
    tokenCosts,
    contextFirst,
    contextLast,
    CONTEXT_TOKENS,
    true
  ));
  let editableTokens = 0;
  for (let line = editableFirst; line <= editableLast; line++) {
    editableTokens += tokenCosts[line];
  }
  let contextTokens = 0;
  for (let line = contextFirst; line <= contextLast; line++) {
    contextTokens += tokenCosts[line];
  }
  if (
    editableTokens > MAX_EDITABLE_TOKENS ||
    contextTokens > MAX_CONTEXT_TOKENS
  ) {
    return;
  }

  const contextStart = starts[contextFirst];
  const contextEnd = lineEnd(content, starts, contextLast);
  const excerptText = content.slice(contextStart, contextEnd);
  const request: EditPredictRequest = {
    path,
    version,
    eol:
      (excerptText.match(/\r\n|\r|\n/)?.[0] as
        | '\n'
        | '\r\n'
        | '\r'
        | undefined) ??
      (content.match(/\r\n|\r|\n/)?.[0] as '\n' | '\r\n' | '\r' | undefined) ??
      '\n',
    excerptText,
    excerptStartLine: contextFirst,
    cursorOffsetInExcerpt: cursor - contextStart,
    editableRange: {
      start: starts[editableFirst] - contextStart,
      end: lineEnd(content, starts, editableLast) - contextStart,
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
  if (pattern instanceof RegExp) {
    const lastIndex = pattern.lastIndex;
    pattern.lastIndex = 0;
    const matches = pattern.test(path);
    pattern.lastIndex = lastIndex;
    return matches;
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
