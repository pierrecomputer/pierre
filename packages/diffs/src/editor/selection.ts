import type {
  DiffLineAnnotation,
  EditorSelection,
  Position,
  Range,
  SelectionDirection,
  TextEdit,
} from '../types';
import { applyDocumentChangeToLineAnnotations } from './lineAnnotations';
import type {
  ResolvedTextEdit,
  TextDocument,
  TextDocumentChange,
} from './textDocument';
import {
  createSegmenter,
  endsWithLineBreak,
  getGraphemeSegmenter,
} from './utils';

export const DirectionBackward = -1;
export const DirectionNone = 0;
export const DirectionForward = 1;

const SURROUNDING_PAIRS: Array<[openChar: string, closeChar: string]> = [
  ["'", "'"],
  ['"', '"'],
  ['`', '`'],
  ['{', '}'],
  ['[', ']'],
  ['<', '>'],
  ['(', ')'],
];

const AUTO_SURROUND_CLOSE_CHARS = new Map(SURROUNDING_PAIRS);
const AUTO_SURROUND_QUOTE_CHARS = new Set(["'", '"', '`']);
const AUTO_SURROUND_BRACKET_CHARS = new Set(['{', '[', '(', '<']);

export interface CursorMoveOptions {
  getSoftLineOffsets?: (line: number) => ArrayLike<number> | undefined;
  /**
   * Fold-skip resolver for vertical motion crossing document lines: the
   * nearest renderable line at or beyond the target in the move direction,
   * or undefined when everything that way is hidden inside a collapsed
   * region (the caret then stays put). Soft-line moves within one document
   * line never consult it.
   */
  resolveRenderableLine?: ResolveRenderableLine;
}

interface SoftLineInfo {
  start: number;
  end: number;
  index: number;
  count: number;
}

/**
 * Converts a selection from a web selection to an editor selection.
 */
export function convertSelection(
  range: StaticRange,
  direction: SelectionDirection = DirectionNone
): EditorSelection | undefined {
  const start = boundaryToPosition(range.startContainer, range.startOffset);
  const end = boundaryToPosition(range.endContainer, range.endOffset);
  if (start === null || end === null) {
    return undefined;
  }
  return {
    start,
    end,
    direction,
  };
}

/**
 * Resolves the indent edits for a selection.
 */
export function resolveIndentEdits(
  textDocument: TextDocument<unknown>,
  selection: EditorSelection,
  tabSize: number,
  outdent: boolean
): [edits: TextEdit[], nextSelection: EditorSelection] {
  if (textDocument === undefined) {
    return [[], selection];
  }
  const { start, end } = selection;
  const edits: TextEdit[] = [];
  let newSelection: EditorSelection = { ...selection };
  const blockIndent = start.line !== end.line;
  let endLine = end.line;
  if (start.line < end.line && end.character === 0) {
    endLine--;
  }
  for (let line = start.line; line <= endLine; line++) {
    const lineText = textDocument.getLineText(line);
    if (lineText === undefined) {
      continue;
    }
    if (blockIndent && lineText.trim().length === 0) {
      continue;
    }
    const indentUnit = lineText.startsWith('\t') ? '\t' : ' '.repeat(tabSize);
    let deleteLength = 0;
    let newText = indentUnit;
    if (outdent) {
      if (lineText.startsWith('\t')) {
        deleteLength = 1;
      } else if (lineText.startsWith(' ')) {
        const leadingSpacesLength =
          lineText.length - lineText.trimStart().length;
        deleteLength = Math.min(indentUnit.length, leadingSpacesLength);
      }
      if (deleteLength === 0) {
        continue;
      }
      newText = '';
    }
    edits.push({
      range: {
        start: { line, character: 0 },
        end: { line, character: deleteLength },
      },
      newText,
    });
    const delta = newText.length - deleteLength;
    if (line === start.line) {
      newSelection = {
        ...newSelection,
        start: {
          ...start,
          character: Math.max(0, start.character + delta),
        },
      };
    }
    if (line === end.line) {
      newSelection = {
        ...newSelection,
        end: {
          ...end,
          character: Math.max(0, end.character + delta),
        },
      };
    }
  }
  return [edits, newSelection];
}

/**
 * The nearest zero-based document line at or beyond `line` in `direction`
 * that has a rendered row, or undefined when everything that way is hidden
 * inside a collapsed region. Vertical caret motion uses it to skip collapsed
 * regions atomically, like code folds.
 */
export type ResolveRenderableLine = (
  line: number,
  direction: 'up' | 'down'
) => number | undefined;

/**
 * Maps the cursor move to all selections.
 */
export function mapCursorMove(
  textDocument: TextDocument<unknown>,
  selections: EditorSelection[],
  shortcut: 'textStart' | 'start' | 'end' | 'up' | 'down' | 'left' | 'right',
  options: CursorMoveOptions = {}
): EditorSelection[] {
  const lineCount = textDocument.lineCount;
  return selections.map((selection) => {
    let { line, character } =
      shortcut === 'up' || shortcut === 'left'
        ? selection.start
        : selection.end;
    if (
      shortcut === 'textStart' ||
      shortcut === 'start' ||
      shortcut === 'end'
    ) {
      const caret = getCaretPosition(selection);
      line = caret.line;
      character = caret.character;
      const softLine = getSoftLineInfo(textDocument, line, character, options);
      if (shortcut === 'textStart') {
        const softLineText = textDocument
          .getLineText(line)
          .slice(softLine.start, softLine.end);
        const indent = softLine.start + getLeadingSpaces(softLineText);
        character = character === indent ? softLine.start : indent;
      } else {
        character = shortcut === 'start' ? softLine.start : softLine.end;
      }
    } else if (shortcut === 'up') {
      const moved = moveBySoftLine(textDocument, line, character, -1, options);
      if (moved !== undefined) {
        line = moved.line;
        character = moved.character;
      } else if (line > 0) {
        // Fold-skip: when the line above is collapsed, jump to the nearest
        // renderable line above it; stay put when nothing above renders.
        line =
          options.resolveRenderableLine == null
            ? line - 1
            : (options.resolveRenderableLine(line - 1, 'up') ?? line);
      }
    } else if (shortcut === 'down') {
      const moved = moveBySoftLine(textDocument, line, character, 1, options);
      if (moved !== undefined) {
        line = moved.line;
        character = moved.character;
      } else {
        const maxLine = Math.max(lineCount - 1, 0);
        if (line < maxLine) {
          line =
            options.resolveRenderableLine == null
              ? line + 1
              : Math.min(
                  options.resolveRenderableLine(line + 1, 'down') ?? line,
                  maxLine
                );
        }
      }
    } else if (isCollapsedSelection(selection)) {
      const lineLength = textDocument.getLineLength(line);
      character = Math.min(character, lineLength);
      if (shortcut === 'left') {
        if (character > 0) {
          // Step left by a whole grapheme so the caret never lands inside an
          // emoji or other multi-code-unit character.
          character = stepCharacterByGrapheme(
            textDocument,
            line,
            character,
            false
          );
        } else if (line > 0) {
          // Fold-skip: land at the end of the nearest renderable line above;
          // stay put when everything above is collapsed.
          const targetLine =
            options.resolveRenderableLine == null
              ? line - 1
              : options.resolveRenderableLine(line - 1, 'up');
          if (targetLine !== undefined) {
            line = targetLine;
            character = textDocument.getLineLength(line);
          }
        }
      } else if (character < lineLength) {
        character = stepCharacterByGrapheme(
          textDocument,
          line,
          character,
          true
        );
      } else if (line < lineCount - 1) {
        // Fold-skip: land at the start of the nearest renderable line below;
        // stay put when everything below is collapsed.
        const targetLine =
          options.resolveRenderableLine == null
            ? line + 1
            : options.resolveRenderableLine(line + 1, 'down');
        if (targetLine !== undefined) {
          line = Math.min(targetLine, lineCount - 1);
          character = 0;
        }
      }
    }
    const pos = { line, character };
    return {
      start: pos,
      end: pos,
      direction: DirectionNone,
    };
  });
}

function moveBySoftLine(
  textDocument: TextDocument<unknown>,
  line: number,
  character: number,
  direction: -1 | 1,
  options: CursorMoveOptions
): Position | undefined {
  if (options.getSoftLineOffsets === undefined) {
    return undefined;
  }

  const current = getSoftLineInfo(textDocument, line, character, options);
  const targetIndex = current.index + direction;
  let targetLine = line;
  let target: SoftLineInfo;

  if (targetIndex >= 0 && targetIndex < current.count) {
    target = getSoftLineInfoAtIndex(
      textDocument,
      targetLine,
      targetIndex,
      options
    );
  } else {
    const nextLine = line + direction;
    if (nextLine < 0 || nextLine >= textDocument.lineCount) {
      return { line, character };
    }

    // Fold-skip: crossing to another document line skips collapsed regions;
    // when nothing renders in that direction the caret stays put.
    const resolvedLine =
      options.resolveRenderableLine == null
        ? nextLine
        : options.resolveRenderableLine(
            nextLine,
            direction < 0 ? 'up' : 'down'
          );
    if (resolvedLine === undefined) {
      return { line, character };
    }

    targetLine = Math.min(resolvedLine, textDocument.lineCount - 1);
    const targetCount = getSoftLineCount(textDocument, targetLine, options);
    target = getSoftLineInfoAtIndex(
      textDocument,
      targetLine,
      direction < 0 ? targetCount - 1 : 0,
      options
    );
  }

  const column = Math.max(0, character - current.start);
  const targetCharacter = target.start + column;
  const landedCharacter =
    target.index === target.count - 1
      ? targetCharacter
      : Math.min(targetCharacter, target.end);
  const targetLineText = textDocument.getLineText(targetLine);
  // Keep goal-column overshoots, but snap real offsets out of graphemes.
  return {
    line: targetLine,
    character:
      landedCharacter > targetLineText.length
        ? landedCharacter
        : snapCharacterToGraphemeBoundary(targetLineText, landedCharacter),
  };
}

// Snaps a vertical landing to the end of its grapheme so edits cannot split a
// user-visible character. Stop once the containing cluster is resolved.
function snapCharacterToGraphemeBoundary(
  lineText: string,
  character: number
): number {
  if (character <= 0 || character >= lineText.length) {
    return character;
  }

  const segmenter = getGraphemeSegmenter();
  if (segmenter !== undefined) {
    for (const segment of segmenter.segment(lineText)) {
      if (character <= segment.index) {
        return character;
      }
      const segmentEnd = segment.index + segment.segment.length;
      if (character < segmentEnd) {
        return segmentEnd;
      }
    }
    return character;
  }

  // Degraded path for engines lacking Intl.Segmenter: preserve code points.
  let segmentStart = 0;
  for (const codePoint of lineText) {
    if (character <= segmentStart) {
      return character;
    }
    const segmentEnd = segmentStart + codePoint.length;
    if (character < segmentEnd) {
      return segmentEnd;
    }
    segmentStart = segmentEnd;
  }
  return character;
}

function getSoftLineInfo(
  textDocument: TextDocument<unknown>,
  line: number,
  character: number,
  options: CursorMoveOptions
): SoftLineInfo {
  const lineLength = textDocument.getLineLength(line);
  const offsets = options.getSoftLineOffsets?.(line);
  if (offsets === undefined || offsets.length < 2) {
    return { start: 0, end: lineLength, index: 0, count: 1 };
  }

  for (let index = 0; index + 1 < offsets.length; index++) {
    const softLine = getSoftLineInfoAtIndex(textDocument, line, index, options);
    if (character >= softLine.start && character <= softLine.end) {
      return softLine;
    }
  }

  return getSoftLineInfoAtIndex(
    textDocument,
    line,
    character < (offsets[0] ?? 0) ? 0 : offsets.length - 2,
    options
  );
}

function getSoftLineCount(
  textDocument: TextDocument<unknown>,
  line: number,
  options: CursorMoveOptions
): number {
  const offsets = options.getSoftLineOffsets?.(line);
  return offsets === undefined || offsets.length < 2 ? 1 : offsets.length - 1;
}

function getSoftLineInfoAtIndex(
  textDocument: TextDocument<unknown>,
  line: number,
  index: number,
  options: CursorMoveOptions
): SoftLineInfo {
  const lineLength = textDocument.getLineLength(line);
  const offsets = options.getSoftLineOffsets?.(line);
  if (offsets === undefined || offsets.length < 2) {
    return { start: 0, end: lineLength, index: 0, count: 1 };
  }

  const count = offsets.length - 1;
  const boundedIndex = Math.max(0, Math.min(index, count - 1));
  const start = Math.max(0, Math.min(lineLength, offsets[boundedIndex] ?? 0));
  const end = Math.max(
    start,
    Math.min(lineLength, offsets[boundedIndex + 1] ?? lineLength)
  );
  return { start, end, index: boundedIndex, count };
}

/**
 * Same as mapCursorMove, but with shift key pressed.
 */
export function mapSelectionShift(
  textDocument: TextDocument<unknown>,
  selections: EditorSelection[],
  shortcut: 'textStart' | 'start' | 'end' | 'up' | 'down' | 'left' | 'right',
  options: CursorMoveOptions = {}
): EditorSelection[] {
  return selections.map((selection) => {
    const focusPosition =
      selection.direction === DirectionBackward
        ? selection.start
        : selection.end;
    const [movedFocusSelection] = mapCursorMove(
      textDocument,
      [
        {
          start: focusPosition,
          end: focusPosition,
          direction: DirectionNone,
        },
      ],
      shortcut,
      options
    );
    return createSelectionFrom(selection, movedFocusSelection);
  });
}

/**
 * Applies a text change to the given text document
 */
export function applyTextChangeToSelections<LAnnotation>(
  textDocument: TextDocument<LAnnotation>,
  selections: EditorSelection[],
  edit: ResolvedTextEdit,
  lineAnnotations?: DiffLineAnnotation<LAnnotation>[],
  tabSize = 2,
  undoBoundary = false
): {
  nextSelections: EditorSelection[];
  change?: TextDocumentChange;
} {
  const primarySelection = selections[selections.length - 1];
  if (primarySelection === undefined) {
    return { nextSelections: [] };
  }
  const selectionPositions: Position[] = [];
  for (const selection of selections) {
    selectionPositions.push(selection.start, selection.end);
  }
  const selectionOffsets = selectionPositions.map((position) =>
    textDocument.offsetAt(position)
  );
  const primaryStartOffset = selectionOffsets[(selections.length - 1) * 2];
  const primaryEndOffset = selectionOffsets[(selections.length - 1) * 2 + 1];
  const ordered: Array<{
    index: number;
    start: number;
    end: number;
  }> = [];
  let isAlreadyOrdered = true;
  for (let index = 0; index < selections.length; index++) {
    const entry = {
      index,
      start: selectionOffsets[index * 2],
      end: selectionOffsets[index * 2 + 1],
    };
    const previous = ordered[ordered.length - 1];
    if (
      previous !== undefined &&
      (entry.start < previous.start ||
        (entry.start === previous.start && entry.end < previous.end))
    ) {
      isAlreadyOrdered = false;
    }
    ordered.push(entry);
  }
  if (!isAlreadyOrdered) {
    ordered.sort((a, b) => {
      const startOrder = a.start - b.start;
      if (startOrder !== 0) {
        return startOrder;
      }
      const endOrder = a.end - b.end;
      if (endOrder !== 0) {
        return endOrder;
      }
      return a.index - b.index;
    });
  }
  const adjustedChange = normalizeLeadingIndentForChange(
    textDocument,
    edit,
    tabSize
  );
  const edits: ResolvedTextEdit[] = [];
  const nextSelectionOffsets: Array<[number, number] | undefined> = Array.from({
    length: selections.length,
  });
  let offsetDelta = 0;
  let mergedGroup:
    | {
        start: number;
        end: number;
        indices: number[];
      }
    | undefined;
  const finalizeMergedGroup = () => {
    if (mergedGroup === undefined) {
      return;
    }
    const perGroupChange = normalizeLeadingIndentForChange(
      textDocument,
      {
        start: mergedGroup.start,
        end: mergedGroup.end,
        text: adjustedChange.text,
      },
      tabSize
    );
    const newText = expandSingleNewlineInsert(
      textDocument,
      perGroupChange.text,
      perGroupChange.start
    );
    edits.push({
      start: perGroupChange.start,
      end: perGroupChange.end,
      text: newText,
    });
    const nextOffsets: [number, number] = [
      mergedGroup.start + offsetDelta + newText.length,
      mergedGroup.start + offsetDelta + newText.length,
    ];
    for (const index of mergedGroup.indices) {
      nextSelectionOffsets[index] = nextOffsets;
    }
    offsetDelta += newText.length - (perGroupChange.end - perGroupChange.start);
    mergedGroup = undefined;
  };
  for (const entry of ordered) {
    const startOffset = Math.max(
      0,
      entry.start + (adjustedChange.start - primaryStartOffset)
    );
    const endOffset = Math.max(
      startOffset,
      entry.end + (adjustedChange.end - primaryEndOffset)
    );
    if (mergedGroup !== undefined && startOffset < mergedGroup.end) {
      mergedGroup.end = Math.max(mergedGroup.end, endOffset);
      mergedGroup.indices.push(entry.index);
      continue;
    }
    finalizeMergedGroup();
    mergedGroup = {
      start: startOffset,
      end: endOffset,
      indices: [entry.index],
    };
  }
  finalizeMergedGroup();

  const change = textDocument.applyResolvedEdits(
    edits,
    true,
    selections,
    undefined,
    undoBoundary
  );
  const nextSelections = createSelectionsFromOffsetPairs(
    textDocument,
    nextSelectionOffsets.map((offsets) => {
      if (offsets === undefined) {
        throw new Error('Missing next selection offsets');
      }
      return offsets;
    })
  );
  textDocument.setLastUndoSelectionsAfter(nextSelections);
  if (change !== undefined && lineAnnotations !== undefined) {
    const nextLineAnnotations =
      applyDocumentChangeToLineAnnotations<LAnnotation>(
        change,
        lineAnnotations
      );
    if (nextLineAnnotations !== undefined) {
      textDocument.setLastUndoLineAnnotations(
        lineAnnotations,
        nextLineAnnotations
      );
    }
  }
  return { nextSelections, change };
}

/**
 * Returns the next anchor/focus offsets after replacing a selection range.
 * When the inserted text still contains the original selection (auto-surround),
 * the inner range is reselected to match VS Code/CodeMirror behavior.
 */
// Detect exact auto-surround replacements before a substring search can match
// the newly inserted opening delimiter instead of the preserved selection.
function getAutoSurroundPreservedOffset(
  originalText: string,
  newText: string
): number | undefined {
  if (newText.length !== originalText.length + 2) {
    return undefined;
  }

  const closeChar = AUTO_SURROUND_CLOSE_CHARS.get(newText[0]);
  if (
    closeChar === undefined ||
    newText[newText.length - 1] !== closeChar ||
    newText.slice(1, -1) !== originalText
  ) {
    return undefined;
  }

  return 1;
}

function getNextSelectionOffsetPairAfterReplace(
  textDocument: TextDocument<unknown>,
  entry: { start: number; end: number },
  offsetDelta: number,
  newText: string
): [number, number] {
  const insertStart = entry.start + offsetDelta;
  const insertEnd = insertStart + newText.length;
  const originalLength = entry.end - entry.start;
  if (originalLength > 0) {
    const originalText = textDocument.getTextSlice(entry.start, entry.end);
    const preservedOffset =
      getAutoSurroundPreservedOffset(originalText, newText) ??
      newText.indexOf(originalText);
    if (
      preservedOffset !== -1 &&
      preservedOffset + originalText.length <= newText.length
    ) {
      const rangeStart = insertStart + preservedOffset;
      return [rangeStart, rangeStart + originalText.length];
    }
  }
  return [insertEnd, insertEnd];
}

/**
 * Applies text replacements to multiple selections. Texts pair by selection
 * index unless they are explicitly marked as document ordered.
 */
export function applyTextReplaceToSelections<LAnnotation>(
  textDocument: TextDocument<LAnnotation>,
  selections: EditorSelection[],
  texts: string[],
  lineAnnotations?: DiffLineAnnotation<LAnnotation>[],
  undoBoundary = false,
  textOrder: 'selection' | 'document' = 'selection'
): {
  nextSelections: EditorSelection[];
  change?: TextDocumentChange;
} {
  if (selections.length !== texts.length) {
    throw new Error(
      'Selection text replacements must match the selection count'
    );
  }
  const selectionPositions: Position[] = [];
  for (const selection of selections) {
    selectionPositions.push(selection.start, selection.end);
  }
  const selectionOffsets = selectionPositions.map((position) =>
    textDocument.offsetAt(position)
  );
  const ordered: Array<{
    index: number;
    start: number;
    end: number;
  }> = [];
  let isAlreadyOrdered = true;
  for (let index = 0; index < selections.length; index++) {
    const entry = {
      index,
      start: selectionOffsets[index * 2],
      end: selectionOffsets[index * 2 + 1],
    };
    const previous = ordered[ordered.length - 1];
    if (
      previous !== undefined &&
      (entry.start < previous.start ||
        (entry.start === previous.start && entry.end < previous.end))
    ) {
      isAlreadyOrdered = false;
    }
    ordered.push(entry);
  }
  if (!isAlreadyOrdered) {
    ordered.sort((a, b) => {
      const startOrder = a.start - b.start;
      if (startOrder !== 0) {
        return startOrder;
      }
      const endOrder = a.end - b.end;
      if (endOrder !== 0) {
        return endOrder;
      }
      return a.index - b.index;
    });
  }
  const allDeletes = texts.every((text) => text === '');
  let edits: ResolvedTextEdit[];
  const nextSelectionOffsetPairs: Array<[number, number] | undefined> =
    Array.from({
      length: selections.length,
    });
  if (allDeletes) {
    edits = [];
    let hasEffect = false;
    for (const entry of ordered) {
      nextSelectionOffsetPairs[entry.index] = [entry.end, entry.end];
      if (entry.start >= entry.end) {
        continue;
      }
      hasEffect = true;
      const last = edits[edits.length - 1];
      if (last !== undefined && entry.start < last.end) {
        edits[edits.length - 1] = {
          start: last.start,
          end: Math.max(last.end, entry.end),
          text: '',
        };
      } else {
        edits.push({ start: entry.start, end: entry.end, text: '' });
      }
    }
    if (!hasEffect) {
      return { nextSelections: selections };
    }
    for (const entry of ordered) {
      const caret = entry.end;
      let delta = 0;
      let next = caret;
      for (const edit of edits) {
        if (caret <= edit.start) {
          break;
        }
        if (caret >= edit.end) {
          delta -= edit.end - edit.start;
          continue;
        }
        next = edit.start + delta;
        break;
      }
      if (next === caret) {
        next += delta;
      }
      nextSelectionOffsetPairs[entry.index] = [next, next];
    }
  } else {
    edits = [];
    let offsetDelta = 0;
    let previousEditEnd = -1;
    for (let index = 0; index < ordered.length; index++) {
      const entry = ordered[index];
      if (entry.start < previousEditEnd) {
        throw new Error('Overlapping multi-selection edits are not supported');
      }
      previousEditEnd = entry.end;
      const newText = expandSingleNewlineInsert(
        textDocument,
        texts[textOrder === 'document' ? index : entry.index],
        entry.start
      );
      edits.push({
        start: entry.start,
        end: entry.end,
        text: newText,
      });
      nextSelectionOffsetPairs[entry.index] =
        getNextSelectionOffsetPairAfterReplace(
          textDocument,
          entry,
          offsetDelta,
          newText
        );
      offsetDelta += newText.length - (entry.end - entry.start);
    }
  }

  const change = textDocument.applyResolvedEdits(
    edits,
    true,
    selections,
    undefined,
    undoBoundary
  );
  const nextSelections = createSelectionsFromOffsetPairs(
    textDocument,
    nextSelectionOffsetPairs.map((offsets) => {
      if (offsets === undefined) {
        throw new Error('Missing next selection offsets');
      }
      return offsets;
    })
  );
  textDocument.setLastUndoSelectionsAfter(nextSelections);
  if (change !== undefined && lineAnnotations !== undefined) {
    const nextLineAnnotations =
      applyDocumentChangeToLineAnnotations<LAnnotation>(
        change,
        lineAnnotations
      );
    if (nextLineAnnotations !== undefined) {
      textDocument.setLastUndoLineAnnotations(
        lineAnnotations,
        nextLineAnnotations
      );
    }
  }
  return { nextSelections, change };
}

export type AutoSurround =
  | 'default'
  | 'never'
  | 'brackets'
  | 'quotes'
  | 'languageDefined';

function shouldAutoSurroundChar(
  autoSurround: AutoSurround | undefined,
  char: string
): boolean {
  if (autoSurround === 'never') {
    return false;
  }
  if (autoSurround === 'brackets') {
    return AUTO_SURROUND_BRACKET_CHARS.has(char);
  }
  if (autoSurround === 'quotes') {
    return AUTO_SURROUND_QUOTE_CHARS.has(char);
  }
  return true;
}

/**
 * Returns per-selection replacement text when typing a surround character over
 * non-collapsed selections, matching VS Code auto-surround behavior.
 */
export function getAutoSurroundReplacementTexts<LAnnotation>(
  textDocument: TextDocument<LAnnotation>,
  selections: EditorSelection[],
  char: string,
  autoSurround?: AutoSurround
): string[] | undefined {
  if (char.length !== 1 || selections.length === 0) {
    return undefined;
  }
  const closeChar = AUTO_SURROUND_CLOSE_CHARS.get(char);
  if (closeChar === undefined || !shouldAutoSurroundChar(autoSurround, char)) {
    return undefined;
  }
  const replacements: string[] = [];
  for (const selection of selections) {
    if (isCollapsedSelection(selection)) {
      return undefined;
    }
    replacements.push(char + textDocument.getText(selection) + closeChar);
  }
  return replacements;
}

/**
 * Swaps the two characters adjacent to a collapsed selection, matching browser
 * insertTranspose (Ctrl+T) behavior.
 */
export function applyTransposeToSelections<LAnnotation>(
  textDocument: TextDocument<LAnnotation>,
  selections: EditorSelection[],
  lineAnnotations?: DiffLineAnnotation<LAnnotation>[]
): {
  nextSelections: EditorSelection[];
  change?: TextDocumentChange;
} {
  const edits: ResolvedTextEdit[] = [];
  const nextOffsetPairs: Array<[number, number]> = [];

  for (const selection of selections) {
    const [anchor, focus] = getSelectionAnchorAndFocusOffsets(
      textDocument,
      selection
    );
    if (!isCollapsedSelection(selection)) {
      nextOffsetPairs.push([anchor, focus]);
      continue;
    }

    const { line, character } = selection.start;
    const offset = anchor;
    const lineText = textDocument.getLineText(line);
    const lineLength = lineText.length;
    // Document offset of column 0 on this line, used to translate the
    // grapheme-cluster columns below back into document offsets.
    const lineStart = offset - character;
    const graphemeStarts = getLineGraphemeStarts(lineText);
    let edit: ResolvedTextEdit | undefined;

    if (character > 0 && character < lineLength) {
      // Swap the whole grapheme before the caret with the one after it so a
      // surrogate pair (emoji) on either side is moved intact.
      const before = findClusterBreak(
        lineText,
        character,
        false,
        graphemeStarts
      );
      const after = findClusterBreak(lineText, character, true, graphemeStarts);
      edit = {
        start: lineStart + before,
        end: lineStart + after,
        text:
          lineText.slice(character, after) + lineText.slice(before, character),
      };
      nextOffsetPairs.push([lineStart + after, lineStart + after]);
    } else if (character === lineLength && graphemeStarts.length >= 2) {
      // Swap the last two graphemes on the line.
      const lastStart = graphemeStarts[graphemeStarts.length - 1];
      const secondLastStart = graphemeStarts[graphemeStarts.length - 2];
      edit = {
        start: lineStart + secondLastStart,
        end: offset,
        text:
          lineText.slice(lastStart, lineLength) +
          lineText.slice(secondLastStart, lastStart),
      };
      nextOffsetPairs.push([offset, offset]);
    } else if (character === 0 && line > 0 && lineLength > 0) {
      // Carry the previous line's last grapheme and this line's first grapheme
      // across the line break, swapping their order.
      const prevLine = line - 1;
      const prevLineText = textDocument.getLineText(prevLine);
      const prevLength = prevLineText.length;
      const prevEnd = textDocument.offsetAt({
        line: prevLine,
        character: prevLength,
      });
      const prevGraphemeStart =
        prevLength > 0
          ? findClusterBreak(
              prevLineText,
              prevLength,
              false,
              getLineGraphemeStarts(prevLineText)
            )
          : prevLength;
      const firstEnd = findClusterBreak(lineText, 0, true, graphemeStarts);
      const prevStart = prevEnd - (prevLength - prevGraphemeStart);
      const newText =
        lineText.slice(0, firstEnd) +
        textDocument.getTextSlice(prevEnd, offset) +
        prevLineText.slice(prevGraphemeStart, prevLength);
      edit = {
        start: prevStart,
        end: offset + firstEnd,
        text: newText,
      };
      const caret = prevStart + newText.length;
      nextOffsetPairs.push([caret, caret]);
    } else {
      nextOffsetPairs.push([anchor, focus]);
      continue;
    }

    edits.push(edit);
  }

  if (edits.length === 0) {
    return { nextSelections: selections };
  }

  edits.sort((a, b) => a.start - b.start);
  for (let index = 1; index < edits.length; index++) {
    if (edits[index].start < edits[index - 1].end) {
      throw new Error('Overlapping multi-selection edits are not supported');
    }
  }

  const change = textDocument.applyResolvedEdits(edits, true, selections);
  const nextSelections = createSelectionsFromOffsetPairs(
    textDocument,
    nextOffsetPairs
  );
  textDocument.setLastUndoSelectionsAfter(nextSelections);
  if (change !== undefined && lineAnnotations !== undefined) {
    const nextLineAnnotations =
      applyDocumentChangeToLineAnnotations<LAnnotation>(
        change,
        lineAnnotations
      );
    if (nextLineAnnotations !== undefined) {
      textDocument.setLastUndoLineAnnotations(
        lineAnnotations,
        nextLineAnnotations
      );
    }
  }
  return { nextSelections, change };
}

/**
 * Deletes from each selection to the end of its line, including the line break
 * when the caret is already at the end of a non-final line. Non-collapsed
 * selections delete their selected text instead.
 */
export function applyDeleteHardLineForwardToSelections<LAnnotation>(
  textDocument: TextDocument<LAnnotation>,
  selections: EditorSelection[],
  lineAnnotations?: DiffLineAnnotation<LAnnotation>[]
): {
  nextSelections: EditorSelection[];
  change?: TextDocumentChange;
} {
  const deleteSelections: EditorSelection[] = selections.map((selection) => {
    const range = resolveDeleteHardLineForwardRange(textDocument, selection);
    return {
      start: range.start,
      end: range.end,
      direction: DirectionNone,
    };
  });
  return applyTextReplaceToSelections(
    textDocument,
    deleteSelections,
    deleteSelections.map(() => ''),
    lineAnnotations
  );
}

/**
 * Deletes from each selection back to the start of its soft (visual) line.
 * Non-collapsed selections delete their selected text instead.
 */
export function applyDeleteSoftLineBackwardToSelections<LAnnotation>(
  textDocument: TextDocument<LAnnotation>,
  selections: EditorSelection[],
  getSoftLineStart?: (line: number, character: number) => number,
  lineAnnotations?: DiffLineAnnotation<LAnnotation>[]
): {
  nextSelections: EditorSelection[];
  change?: TextDocumentChange;
} {
  const deleteSelections: EditorSelection[] = selections.map((selection) => {
    if (!isCollapsedSelection(selection)) {
      return {
        start: selection.start,
        end: selection.end,
        direction: DirectionNone,
      };
    }
    const caret = getCaretPosition(selection);
    const { line, character } = caret;
    const softLineStart = getSoftLineStart?.(line, character) ?? 0;
    if (character > softLineStart) {
      return {
        start: { line, character: softLineStart },
        end: { line, character },
        direction: DirectionNone,
      };
    }
    if (line === 0) {
      return {
        start: caret,
        end: caret,
        direction: DirectionNone,
      };
    }
    const prevLineLength = textDocument.getLineLength(line - 1);
    return {
      start: { line: line - 1, character: prevLineLength },
      end: { line, character: 0 },
      direction: DirectionNone,
    };
  });
  return applyTextReplaceToSelections(
    textDocument,
    deleteSelections,
    deleteSelections.map(() => ''),
    lineAnnotations
  );
}

/**
 * Deletes the word or separator group immediately before each selection.
 * Non-collapsed selections delete their selected text instead.
 */
export function applyDeleteWordBackwardToSelections<LAnnotation>(
  textDocument: TextDocument<LAnnotation>,
  selections: EditorSelection[],
  lineAnnotations?: DiffLineAnnotation<LAnnotation>[]
): {
  nextSelections: EditorSelection[];
  change?: TextDocumentChange;
} {
  const deleteSelections: EditorSelection[] = selections.map((selection) => {
    const [start, end] = resolveDeleteWordBackwardRange(
      textDocument,
      selection
    );
    return {
      start,
      end,
      direction: DirectionNone,
    };
  });
  return applyTextReplaceToSelections(
    textDocument,
    deleteSelections,
    deleteSelections.map(() => ''),
    lineAnnotations
  );
}

/**
 * Resolves the document range deleted by Backspace or Delete at a collapsed
 * caret. Non-collapsed selections delete their selected text instead.
 */
export function resolveDeleteCharacterRange(
  textDocument: TextDocument<unknown>,
  selection: EditorSelection,
  forward: boolean
): [start: Position, end: Position] {
  if (!isCollapsedSelection(selection)) {
    return [selection.start, selection.end];
  }

  const caret = getCaretPosition(selection);
  let { line, character } = caret;
  const lineLength = textDocument.getLineLength(line);
  const lineCount = textDocument.lineCount;

  // A preserved vertical-move goal column can overshoot a shorter line; clamp
  // before stepping so Backspace/Delete target the visible caret position.
  character = Math.min(character, lineLength);

  if (forward) {
    if (character < lineLength) {
      return [
        { line, character },
        {
          line,
          character: stepCharacterByGrapheme(
            textDocument,
            line,
            character,
            true
          ),
        },
      ];
    }
    if (line < lineCount - 1) {
      return [
        { line, character: lineLength },
        { line: line + 1, character: 0 },
      ];
    }
    return [caret, caret];
  }

  if (character > 0) {
    return [
      {
        line,
        character: stepCharacterByGrapheme(
          textDocument,
          line,
          character,
          false
        ),
      },
      { line, character },
    ];
  }
  if (line > 0) {
    const prevLineLength = textDocument.getLineLength(line - 1);
    return [
      { line: line - 1, character: prevLineLength },
      { line, character: 0 },
    ];
  }
  return [caret, caret];
}

/**
 * Deletes one grapheme (or selected text) at each selection.
 */
export function applyDeleteCharacterToSelections<LAnnotation>(
  textDocument: TextDocument<LAnnotation>,
  selections: EditorSelection[],
  forward: boolean,
  lineAnnotations?: DiffLineAnnotation<LAnnotation>[],
  tabSize = 2
): {
  nextSelections: EditorSelection[];
  change?: TextDocumentChange;
} {
  const deleteSelections: EditorSelection[] = selections.map((selection) => {
    let [start, end] = resolveDeleteCharacterRange(
      textDocument,
      selection,
      forward
    );
    // Only grow a Backspace into a full indent unit for a collapsed caret. When
    // the user has an explicit selection, Backspace must delete exactly that
    // selection rather than expanding it to a whole soft tab.
    if (!forward && isCollapsedSelection(selection)) {
      const normalized = normalizeLeadingIndentForChange(
        textDocument,
        {
          start: textDocument.offsetAt(start),
          end: textDocument.offsetAt(end),
          text: '',
        },
        tabSize
      );
      start = textDocument.positionAt(normalized.start);
      end = textDocument.positionAt(normalized.end);
    }
    return {
      start,
      end,
      direction: DirectionNone,
    };
  });
  return applyTextReplaceToSelections(
    textDocument,
    deleteSelections,
    deleteSelections.map(() => ''),
    lineAnnotations
  );
}

/**
 * Checks if a selection is collapsed.
 */
export function isCollapsedSelection(
  selection: EditorSelection | Range
): boolean {
  return (
    selection.start.line === selection.end.line &&
    selection.start.character === selection.end.character
  );
}

/**
 * Returns the caret (focus) position for a selection.
 */
export function getCaretPosition(selection: EditorSelection): Position {
  const { start, end, direction } = selection;
  return direction === DirectionBackward ? start : end;
}

/**
 * Checks if a line is editable.
 */
export function isLineEditable(lineType: string): boolean {
  return (
    lineType === 'context' ||
    lineType === 'context-expanded' ||
    lineType === 'change-addition'
  );
}

/**
 * Checks whether selections `a` and `b` intersect.
 */
export function selectionIntersects(
  a: EditorSelection | Range,
  b: EditorSelection | Range
): boolean {
  const aCollapsed = isCollapsedSelection(a);
  const bCollapsed = isCollapsedSelection(b);
  if (aCollapsed && bCollapsed) {
    return comparePosition(a.start, b.start) === 0;
  }
  if (aCollapsed) {
    return (
      comparePosition(b.start, a.start) <= 0 &&
      comparePosition(a.start, b.end) <= 0
    );
  }
  if (bCollapsed) {
    return (
      comparePosition(a.start, b.start) <= 0 &&
      comparePosition(b.start, a.end) <= 0
    );
  }
  return (
    comparePosition(a.start, b.end) < 0 && comparePosition(b.start, a.end) < 0
  );
}

/**
 * Compares two positions.
 */
export function comparePosition(a: Position, b: Position): number {
  if (a.line !== b.line) {
    return a.line - b.line;
  }
  return a.character - b.character;
}

/**
 * Creates a selection from anchor and focus offsets.
 */
export function createSelectionFromAnchorAndFocusOffsets(
  textDocument: TextDocument<unknown>,
  anchorOffset: number,
  focusOffset: number
): EditorSelection {
  const direction =
    anchorOffset === focusOffset
      ? DirectionNone
      : anchorOffset < focusOffset
        ? DirectionForward
        : DirectionBackward;
  const start = Math.min(anchorOffset, focusOffset);
  const end = Math.max(anchorOffset, focusOffset);
  return {
    start: textDocument.positionAt(start),
    end: textDocument.positionAt(end),
    direction,
  };
}

/**
 * Maps a single offset from the pre-edit document into the post-edit document.
 * `edits` are resolved edits in pre-edit offsets, sorted ascending and
 * non-overlapping. An offset at or after an edit's start shifts to the end of
 * that edit's replacement (right gravity), so text inserted at the caret pushes
 * the caret past it; an offset strictly before an edit is only shifted by the
 * net length change of the edits that precede it.
 */
function remapOffsetThroughEdits(
  offset: number,
  edits: readonly ResolvedTextEdit[]
): number {
  let delta = 0;
  for (const edit of edits) {
    if (offset < edit.start) {
      break;
    }
    if (offset >= edit.end) {
      delta += edit.text.length - (edit.end - edit.start);
    } else {
      return edit.start + delta + edit.text.length;
    }
  }
  return offset + delta;
}

/**
 * Re-anchors selections after a batch of text edits has been applied, so the
 * caret keeps pointing at the same logical location in the changed buffer.
 *
 * `selectionOffsets` (one `[start, end]` pair per selection) and `edits` are
 * measured in the PRE-edit document; the returned selections are built from
 * `textDocument`, which must already reflect the applied edits. Selection
 * direction is preserved by remapping each edge and re-deriving anchor/focus.
 */
export function remapSelectionsAfterEdits(
  textDocument: TextDocument<unknown>,
  selections: readonly EditorSelection[],
  selectionOffsets: ReadonlyArray<readonly [number, number]>,
  edits: readonly ResolvedTextEdit[]
): EditorSelection[] {
  return selections.map((selection, index) => {
    const [startOffset, endOffset] = selectionOffsets[index];
    const nextStart = remapOffsetThroughEdits(startOffset, edits);
    const nextEnd = remapOffsetThroughEdits(endOffset, edits);
    const anchorOffset =
      selection.direction === DirectionBackward ? nextEnd : nextStart;
    const focusOffset =
      selection.direction === DirectionBackward ? nextStart : nextEnd;
    return createSelectionFromAnchorAndFocusOffsets(
      textDocument,
      anchorOffset,
      focusOffset
    );
  });
}

/**
 * Creates a selection from a anchor and focus selection.
 */
export function createSelectionFrom(
  anchorSelection: EditorSelection,
  focusSelection: EditorSelection
): EditorSelection {
  const anchor =
    anchorSelection.direction === DirectionBackward
      ? anchorSelection.end
      : anchorSelection.start;
  const currentStartOrder = comparePosition(anchor, focusSelection.start);
  const currentEndOrder = comparePosition(anchor, focusSelection.end);
  let focus = focusSelection.end;
  if (currentStartOrder <= 0) {
    focus = focusSelection.end;
  } else if (currentEndOrder >= 0) {
    focus = focusSelection.start;
  } else {
    // When the original anchor sits inside `current`, keep whichever edge
    // stayed at the anchor so drag direction remains stable.
    focus = currentStartOrder === 0 ? focusSelection.end : focusSelection.start;
  }
  const anchorVsFocus = comparePosition(anchor, focus);
  const direction: SelectionDirection =
    anchorVsFocus === 0
      ? DirectionNone
      : anchorVsFocus < 0
        ? DirectionForward
        : DirectionBackward;
  const selectionStart = anchorVsFocus <= 0 ? anchor : focus;
  const selectionEnd = anchorVsFocus <= 0 ? focus : anchor;
  return {
    start: selectionStart,
    end: selectionEnd,
    direction,
  };
}

/**
 * Extends or shrinks the selection `original` using the endpoints of `target`, \
 * matching contenteditable shift + click extend behavior.
 */
export function extendSelection(
  original: EditorSelection,
  target: EditorSelection
): EditorSelection {
  const leftExtended = comparePosition(target.start, original.start) < 0;
  const rightExtended = comparePosition(target.end, original.end) > 0;

  if (leftExtended && !rightExtended) {
    return {
      start: target.start,
      end: original.end,
      direction: DirectionBackward,
    };
  }

  if (rightExtended && !leftExtended) {
    return {
      start: original.start,
      end: target.end,
      direction: DirectionForward,
    };
  }

  if (original.direction === DirectionBackward) {
    return {
      start: target.start,
      end: original.end,
      direction:
        comparePosition(target.start, original.end) === 0
          ? DirectionNone
          : DirectionBackward,
    };
  }

  return {
    start: original.start,
    end: target.end,
    direction:
      comparePosition(original.start, target.end) === 0
        ? DirectionNone
        : DirectionForward,
  };
}

/**
 * Extends multiple selections.
 */
export function extendSelections(
  selections: EditorSelection[],
  target: EditorSelection
): EditorSelection[] {
  const newSelections = selections.map((selection) => {
    return extendSelection(selection, target);
  });
  return mergeOverlappingSelections(newSelections);
}

/**
 * Merges overlapping selections.
 */
export function mergeOverlappingSelections(
  selections: EditorSelection[]
): EditorSelection[] {
  if (selections.length <= 1) {
    return selections;
  }
  const ordered = selections
    .map((selection, index) => ({ index, selection }))
    .sort((a, b) => {
      const startOrder = comparePosition(a.selection.start, b.selection.start);
      if (startOrder !== 0) {
        return startOrder;
      }
      const endOrder = comparePosition(a.selection.end, b.selection.end);
      return endOrder !== 0 ? endOrder : a.index - b.index;
    });
  const merged: {
    index: number;
    selection: EditorSelection;
  }[] = [];

  let current = ordered[0];
  for (const entry of ordered.slice(1)) {
    if (selectionIntersects(current.selection, entry.selection)) {
      const latest = entry.index > current.index ? entry : current;
      const start =
        comparePosition(entry.selection.start, current.selection.start) < 0
          ? entry.selection.start
          : current.selection.start;
      const end =
        comparePosition(entry.selection.end, current.selection.end) > 0
          ? entry.selection.end
          : current.selection.end;
      let direction = latest.selection.direction;
      if (direction === DirectionNone && comparePosition(start, end) !== 0) {
        direction =
          comparePosition(latest.selection.start, start) === 0
            ? DirectionBackward
            : DirectionForward;
      }
      current = { index: latest.index, selection: { direction, end, start } };
      continue;
    }

    merged.push(current);
    current = entry;
  }
  merged.push(current);

  return merged
    .sort((a, b) => a.index - b.index)
    .map(({ selection }) => selection);
}

/**
 * Converts selections into merged line blocks for line-based commands.
 */
export function getSelectedLineBlocks(
  selections: EditorSelection[]
): { startLine: number; endLine: number }[] {
  const blocks = selections
    .map((selection) => {
      let endLine = selection.end.line;
      if (
        selection.end.character === 0 &&
        comparePosition(selection.start, selection.end) !== 0
      ) {
        endLine--;
      }
      return {
        startLine: selection.start.line,
        endLine: Math.max(selection.start.line, endLine),
      };
    })
    .sort((a, b) => {
      const startOrder = a.startLine - b.startLine;
      return startOrder !== 0 ? startOrder : a.endLine - b.endLine;
    });

  const merged: { startLine: number; endLine: number }[] = [];
  for (const block of blocks) {
    const previous = merged.at(-1);
    if (previous !== undefined && block.startLine <= previous.endLine + 1) {
      previous.endLine = Math.max(previous.endLine, block.endLine);
    } else {
      merged.push({ ...block });
    }
  }
  return merged;
}

/**
 * Moves a selection's line positions after its lines are shifted, clamping to
 * the target document bounds.
 */
export function shiftSelectionLines(
  selection: EditorSelection,
  direction: -1 | 1,
  lineCount: number,
  getLineLength: (line: number) => number
): EditorSelection {
  const shiftPosition = (position: Position): Position => {
    const line = position.line + direction;
    if (line >= lineCount) {
      const lastLine = Math.max(0, lineCount - 1);
      return {
        line: lastLine,
        character: getLineLength(lastLine),
      };
    }
    if (line < 0) {
      return { line: 0, character: 0 };
    }
    return {
      line,
      character: position.character,
    };
  };

  return {
    start: shiftPosition(selection.start),
    end: shiftPosition(selection.end),
    direction: selection.direction,
  };
}

/**
 * Finds the next matching word and updates the selections.
 */
export function findNextMatch(
  textDocument: TextDocument<unknown>,
  selections: EditorSelection[]
): EditorSelection[] | undefined {
  if (selections.length === 0) {
    return undefined;
  }

  const normalizedSelections = selections.map((selection) =>
    isCollapsedSelection(selection)
      ? expandCollapsedSelectionToWord(textDocument, selection)
      : selection
  );
  const texts = normalizedSelections.map((s) => textDocument.getText(s));
  const needle = texts[0];
  if (needle.length === 0 || texts.some((t) => t !== needle)) {
    return undefined;
  }

  const occupied = normalizedSelections.map(
    (s) =>
      [textDocument.offsetAt(s.start), textDocument.offsetAt(s.end)] as [
        number,
        number,
      ]
  );
  const nextOffset = textDocument.findNextNonOverlappingSubstring(
    needle,
    occupied
  );
  if (nextOffset === undefined) {
    return normalizedSelections.some((selection, index) => {
      const original = selections[index];
      return (
        comparePosition(selection.start, original.start) !== 0 ||
        comparePosition(selection.end, original.end) !== 0 ||
        selection.direction !== original.direction
      );
    })
      ? normalizedSelections
      : undefined;
  }
  const added = createSelectionFromAnchorAndFocusOffsets(
    textDocument,
    nextOffset,
    nextOffset + needle.length
  );
  return [...normalizedSelections, added];
}

/**
 * Get the full selection of the document.
 */
export function getDocumentFullSelection(
  textDocument: TextDocument<unknown>
): EditorSelection {
  const lastLine = textDocument.lineCount - 1;
  const lastCharacter = textDocument.getLineLength(lastLine);
  return {
    start: { line: 0, character: 0 },
    end: { line: lastLine, character: lastCharacter },
    direction: DirectionForward,
  };
}

/**
 * Get the boundary selection of the document.
 */
export function getDocumentBoundarySelection(
  textDocument: TextDocument<unknown>,
  atEnd: boolean,
  trimmedEndNewLine?: boolean
): EditorSelection {
  let line = 0;
  if (atEnd) {
    const lastLine = textDocument.lineCount - 1;
    const hasTrailingBlankLine =
      trimmedEndNewLine === true &&
      lastLine > 0 &&
      textDocument.getLineLength(lastLine) === 0;
    line = hasTrailingBlankLine ? lastLine - 1 : lastLine;
  }
  const character = atEnd ? textDocument.getLineLength(line) : 0;
  const start = { line, character };
  return {
    start: start,
    end: start,
    direction: DirectionForward,
  };
}

interface ClipboardRegion {
  start: number;
  end: number;
}

/** Resolves the document offset range one selection contributes to a copy. */
function resolveClipboardRegion(
  textDocument: TextDocument<unknown>,
  selection: EditorSelection
): ClipboardRegion {
  if (isCollapsedSelection(selection)) {
    const line = selection.start.line;
    const start = textDocument.offsetAt({ line, character: 0 });
    const end =
      line < textDocument.lineCount - 1
        ? textDocument.offsetAt({ line: line + 1, character: 0 })
        : textDocument.offsetAt({
            line,
            character: textDocument.getLineLength(line),
          });
    return { start, end };
  }
  const start = textDocument.offsetAt(selection.start);
  const end = textDocument.offsetAt(selection.end);
  return start <= end ? { start, end } : { start: end, end: start };
}

/**
 * Resolves the document offset range each selection contributes to the
 * clipboard, ordered by position. A collapsed selection contributes its whole
 * logical line including the trailing line break; the final line has no
 * trailing break to include. A ranged selection contributes the selected text.
 */
function resolveClipboardRegions(
  textDocument: TextDocument<unknown>,
  selections: EditorSelection[]
): ClipboardRegion[] {
  return selections
    .map((selection) => resolveClipboardRegion(textDocument, selection))
    .sort((a, b) => {
      const startOrder = a.start - b.start;
      return startOrder !== 0 ? startOrder : a.end - b.end;
    });
}

/**
 * Gets the text contributed by each selection in document order, preserving
 * the pairing needed to paste the values into another set of selections.
 */
export function getSelectionClipboardTexts(
  textDocument: TextDocument<unknown>,
  selections: EditorSelection[]
): string[] {
  const regions = resolveClipboardRegions(textDocument, selections);
  return regions.map(({ start, end }) => textDocument.getTextSlice(start, end));
}

/**
 * Get the clipboard text of the selections for the given text document. Used by
 * both copy and cut so the two stay in sync. Overlapping regions (e.g. several
 * carets on one line) are merged so the same text is never emitted twice, and a
 * line-ending separator is inserted only between regions that aren't already
 * contiguous in the document.
 */
export function getSelectionText(
  textDocument: TextDocument<unknown>,
  selections: EditorSelection[]
): string {
  const regions = resolveClipboardRegions(textDocument, selections);
  const eol = textDocument.eol;
  let result = '';
  let prevEnd = -1;
  for (const region of regions) {
    if (region.end <= region.start) {
      continue;
    }
    if (region.start <= prevEnd) {
      // Contiguous with or overlapping the previous region: extend it rather
      // than repeat any shared text.
      if (region.end > prevEnd) {
        result += textDocument.getTextSlice(prevEnd, region.end);
        prevEnd = region.end;
      }
      continue;
    }
    if (result.length > 0 && !endsWithLineBreak(result)) {
      result += eol;
    }
    result += textDocument.getTextSlice(region.start, region.end);
    prevEnd = region.end;
  }
  return result;
}

interface SelectionCut {
  index: number;
  edit: ResolvedTextEdit;
}

// Resolves the deletion an individual selection contributes to a cut: a
// collapsed caret removes its whole logical line, while a ranged selection
// removes only the selected text.
function resolveSelectionCutEdit(
  textDocument: TextDocument<unknown>,
  selection: EditorSelection
): ResolvedTextEdit {
  if (isCollapsedSelection(selection)) {
    return resolveCollapsedSelectionCutEdit(textDocument, selection);
  }
  const [start, end] =
    comparePosition(selection.start, selection.end) <= 0
      ? [selection.start, selection.end]
      : [selection.end, selection.start];
  return {
    start: textDocument.offsetAt(start),
    end: textDocument.offsetAt(end),
    text: '',
  };
}

// A caret-only cut removes the whole logical line. Non-final lines delete
// their trailing line break; the final line deletes the preceding break so
// no empty line is left behind.
function resolveCollapsedSelectionCutEdit(
  textDocument: TextDocument<unknown>,
  selection: EditorSelection
): ResolvedTextEdit {
  const line = selection.start.line;
  const lineStart = textDocument.offsetAt({ line, character: 0 });
  const lineEnd = textDocument.offsetAt({
    line,
    character: textDocument.getLineLength(line),
  });

  if (line < textDocument.lineCount - 1) {
    const nextLineStart = textDocument.offsetAt({
      line: line + 1,
      character: 0,
    });
    return { start: lineStart, end: nextLineStart, text: '' };
  }

  if (line > 0) {
    const previousLineEnd = textDocument.offsetAt({
      line: line - 1,
      character: textDocument.getLineLength(line - 1),
    });
    return { start: previousLineEnd, end: lineEnd, text: '' };
  }

  return { start: lineStart, end: lineEnd, text: '' };
}

function mergeCutEdits(orderedCuts: SelectionCut[]): ResolvedTextEdit[] {
  const edits: ResolvedTextEdit[] = [];
  for (const { edit } of orderedCuts) {
    if (edit.start >= edit.end) {
      continue;
    }
    const last = edits.at(-1);
    if (last !== undefined && edit.start <= last.end) {
      edits[edits.length - 1] = {
        start: last.start,
        end: Math.max(last.end, edit.end),
        text: '',
      };
    } else {
      edits.push(edit);
    }
  }
  return edits;
}

function mapCutSelectionOffsets(
  orderedCuts: SelectionCut[],
  edits: ResolvedTextEdit[]
): number[] {
  const nextOffsets: number[] = Array.from({ length: orderedCuts.length });
  let editIndex = 0;
  let offsetDelta = 0;
  for (const cut of orderedCuts) {
    while (editIndex < edits.length && cut.edit.start > edits[editIndex].end) {
      const edit = edits[editIndex];
      offsetDelta -= edit.end - edit.start;
      editIndex++;
    }

    const edit = edits[editIndex];
    if (
      edit !== undefined &&
      cut.edit.start >= edit.start &&
      cut.edit.start <= edit.end
    ) {
      nextOffsets[cut.index] = edit.start + offsetDelta;
    } else {
      nextOffsets[cut.index] = cut.edit.start + offsetDelta;
    }
  }
  return nextOffsets;
}

// Resolves the clipboard text, merged deletions, and resulting caret offsets
// for a cut. The clipboard text comes from the shared getSelectionText helper
// so cut stays in sync with copy, while the deletions are computed per
// selection and merged so overlapping cuts delete their shared text once.
export function resolveSelectionCut(
  textDocument: TextDocument<unknown>,
  selections: EditorSelection[]
): {
  text: string;
  edits: ResolvedTextEdit[];
  nextSelectionOffsets: number[];
} {
  const cuts = selections.map<SelectionCut>((selection, index) => ({
    index,
    edit: resolveSelectionCutEdit(textDocument, selection),
  }));
  const orderedCuts = [...cuts].sort((a, b) => {
    const startOrder = a.edit.start - b.edit.start;
    if (startOrder !== 0) {
      return startOrder;
    }
    const endOrder = a.edit.end - b.edit.end;
    if (endOrder !== 0) {
      return endOrder;
    }
    return a.index - b.index;
  });
  const edits = mergeCutEdits(orderedCuts);
  return {
    text: getSelectionText(textDocument, selections),
    edits,
    nextSelectionOffsets: mapCutSelectionOffsets(orderedCuts, edits),
  };
}

/**
 * Get the anchor node and offset for a selection.
 */
export function getSelectionAnchor(
  lineElement: HTMLElement,
  character: number
): [Node, number] {
  const ch = Math.max(0, character);
  const tokens = collectTokens(lineElement);

  let last: HTMLElement | null = null;
  for (const token of tokens) {
    last = token;
    const base = getCharacterIndex(token)!;
    const end = base + (token.textContent?.length ?? 0);
    if (ch <= end) {
      const anchor = textAt(token, ch < base ? 0 : ch - base);
      if (anchor !== null) {
        return anchor;
      }
    }
  }

  if (last !== null) {
    const anchor = textAt(last, last.textContent?.length ?? 0);
    if (anchor !== null) {
      return anchor;
    }
    return [last, 0];
  }

  let textOffset = 0;
  let lastTextNode: Text | null = null;
  for (const child of lineElement.childNodes) {
    if (child.nodeType === 1 && (child as HTMLElement).tagName === 'BR') {
      return [child, 0];
    }
    if (child.nodeType !== 3) {
      continue;
    }
    lastTextNode = child as Text;
    const len = getTextOffset(
      lastTextNode.textContent,
      lastTextNode.textContent?.length ?? 0
    );
    if (ch <= textOffset + len) {
      return [
        lastTextNode,
        getTextOffset(lastTextNode.textContent, ch - textOffset),
      ];
    }
    textOffset += len;
  }

  if (lastTextNode !== null) {
    return [
      lastTextNode,
      getTextOffset(
        lastTextNode.textContent,
        lastTextNode.textContent?.length ?? 0
      ),
    ];
  }
  return [lineElement, 0];
}

/**
 * Expands a zero-width selection to the word-like segment that contains the caret.
 */
export function expandCollapsedSelectionToWord(
  textDocument: TextDocument<unknown>,
  selection: EditorSelection
): EditorSelection {
  const { line, character } = selection.start;
  const lineText = textDocument.getLineText(line);
  const ch = Math.max(0, Math.min(character, lineText.length));
  const span = expandCollapsedLineWord(lineText, ch);
  if (span === undefined) {
    return selection;
  }
  return {
    start: { line, character: span.start },
    end: { line, character: span.end },
    direction: DirectionForward,
  };
}

function expandCollapsedLineWord(
  lineText: string,
  character: number
): { start: number; end: number } | undefined {
  const segmenter = createSegmenter({ granularity: 'word' });
  if (segmenter !== undefined) {
    for (const seg of segmenter.segment(lineText)) {
      if (seg.isWordLike !== true) {
        continue;
      }
      const lo = seg.index;
      const hi = lo + seg.segment.length;
      // Match when the cursor is inside the word or immediately touching
      // one of its boundaries — not when separated by non-word characters.
      if (character >= lo && character <= hi) {
        return { start: lo, end: hi };
      }
    }
    return undefined;
  }
  // Degraded path for engines lacking Intl.Segmenter: treat runs of
  // alphanumeric/underscore characters as words.
  const wordRe = /[\p{Alphabetic}\p{Number}_]+/gu;
  let match: RegExpExecArray | null;
  while ((match = wordRe.exec(lineText)) !== null) {
    const lo = match.index;
    const hi = lo + match[0].length;
    if (character >= lo && character <= hi) {
      return { start: lo, end: hi };
    }
  }
  return undefined;
}

// Resolves the range removed by deleteWordBackward for one selection.
function resolveDeleteWordBackwardRange(
  textDocument: TextDocument<unknown>,
  selection: EditorSelection
): [start: Position, end: Position] {
  if (!isCollapsedSelection(selection)) {
    return [selection.start, selection.end];
  }
  const caret = getCaretPosition(selection);
  const { line, character: head } = caret;
  if (head === 0) {
    if (line === 0) {
      return [caret, caret];
    }
    const prevLineLength = textDocument.getLineLength(line - 1);
    return [
      { line: line - 1, character: prevLineLength },
      { line, character: 0 },
    ];
  }
  const lineText = textDocument.getLineText(line);
  const graphemeStarts = getLineGraphemeStarts(lineText);
  let pos = head;
  let match: number | undefined;
  while (pos > 0) {
    const prev = findClusterBreak(lineText, pos, false, graphemeStarts);
    const nextChar = lineText.slice(prev, pos);
    const nextMatch = !/\S/.test(nextChar)
      ? 0
      : /\p{Alphabetic}|\p{Number}|_/u.test(nextChar)
        ? 1
        : 2;
    if (match !== undefined && nextMatch !== match) {
      break;
    }
    if (nextMatch !== 0 || pos !== head) {
      match = nextMatch;
    }
    pos = prev;
  }
  return [
    { line, character: pos },
    { line, character: head },
  ];
}

function findClusterBreak(
  text: string,
  pos: number,
  forward: boolean,
  graphemeStarts: number[]
): number {
  if (forward) {
    for (const start of graphemeStarts) {
      if (start > pos) {
        return start;
      }
    }
    return text.length;
  }
  for (let i = graphemeStarts.length - 1; i >= 0; i--) {
    const start = graphemeStarts[i];
    if (start < pos) {
      return start;
    }
  }
  return 0;
}

// Lists the start column of every grapheme cluster on a line (always starting
// at 0). Used to step the caret and to transpose by whole graphemes so a
// surrogate pair (emoji) or combining sequence is never split.
function getLineGraphemeStarts(lineText: string): number[] {
  const graphemeStarts = [0];
  const segmenter = getGraphemeSegmenter();
  if (segmenter !== undefined) {
    for (const segment of segmenter.segment(lineText)) {
      if (segment.index > 0) {
        graphemeStarts.push(segment.index);
      }
    }
    return graphemeStarts;
  }
  // Degraded path for engines lacking Intl.Segmenter: step by code point
  // (keeps surrogate pairs intact, but not combining sequences).
  let index = 0;
  for (const codePoint of lineText) {
    if (index > 0) {
      graphemeStarts.push(index);
    }
    index += codePoint.length;
  }
  return graphemeStarts;
}

// Returns the character column one grapheme cluster to the left or right of
// `character` on `line`. Stepping by grapheme rather than by a single UTF-16
// code unit keeps the caret from landing inside an emoji or other multi-unit
// character. Crossing a line boundary is left to the caller.
function stepCharacterByGrapheme(
  textDocument: TextDocument<unknown>,
  line: number,
  character: number,
  forward: boolean
): number {
  const lineLength = textDocument.getLineLength(line);
  if (forward) {
    if (character >= lineLength) {
      return lineLength;
    }
    const lineStart = textDocument.offsetAt({ line, character: 0 });
    const suffix = textDocument.getTextSlice(
      lineStart + character,
      lineStart + lineLength
    );
    const segmenter = getGraphemeSegmenter();
    if (segmenter !== undefined) {
      for (const segment of segmenter.segment(suffix)) {
        return character + segment.segment.length;
      }
      return lineLength;
    }
    // Degraded path for engines lacking Intl.Segmenter: step one code point.
    for (const codePoint of suffix) {
      return character + codePoint.length;
    }
    return lineLength;
  }
  if (character <= 0) {
    return 0;
  }
  const lineStart = textDocument.offsetAt({ line, character: 0 });
  const prefix = textDocument.getTextSlice(lineStart, lineStart + character);
  let prevStart = 0;
  const segmenter = getGraphemeSegmenter();
  if (segmenter !== undefined) {
    for (const segment of segmenter.segment(prefix)) {
      prevStart = segment.index;
    }
    return prevStart;
  }
  // Degraded path for engines lacking Intl.Segmenter: step one code point.
  let index = 0;
  for (const codePoint of prefix) {
    prevStart = index;
    index += codePoint.length;
  }
  return prevStart;
}

function getSelectionAnchorAndFocusOffsets(
  textDocument: TextDocument<unknown>,
  selection: EditorSelection
): [anchorOffset: number, focusOffset: number] {
  const isBackward = selection.direction === DirectionBackward;
  return [
    textDocument.offsetAt(isBackward ? selection.end : selection.start),
    textDocument.offsetAt(getCaretPosition(selection)),
  ];
}

// Resolves the range removed by deleteHardLineForward for one selection.
function resolveDeleteHardLineForwardRange(
  textDocument: TextDocument<unknown>,
  selection: EditorSelection
): Range {
  if (!isCollapsedSelection(selection)) {
    return { start: selection.start, end: selection.end };
  }
  const { line, character } = selection.start;
  const lineText = textDocument.getLineText(line);
  const lineLength = lineText.length;
  if (character < lineLength) {
    return {
      start: { line, character },
      end: { line, character: lineLength },
    };
  }
  if (line < textDocument.lineCount - 1) {
    return {
      start: { line, character },
      end: { line: line + 1, character: 0 },
    };
  }
  return {
    start: { line, character },
    end: { line, character },
  };
}

// When the user inserts a lone line break, copy the current line's indentation onto the new line.
function expandSingleNewlineInsert(
  textDocument: TextDocument<unknown>,
  insertText: string,
  insertStartOffset: number
): string {
  if (insertText !== '\n' && insertText !== '\r' && insertText !== '\r\n') {
    return insertText;
  }
  const line = textDocument.positionAt(insertStartOffset).line;
  const lineText = textDocument.getLineText(line);
  const indentLen = getLeadingSpaces(lineText);
  if (indentLen === 0) {
    return insertText;
  }
  return insertText + lineText.slice(0, indentLen);
}

function getLeadingSpaces(text: string): number {
  let indent = 0;
  for (; indent < text.length; indent++) {
    const c = text.charCodeAt(indent);
    if (c !== /* space */ 32 && c !== /* tab */ 9) {
      break;
    }
  }
  return indent;
}

function createSelectionsFromOffsetPairs(
  textDocument: TextDocument<unknown>,
  offsetPairs: readonly [anchorOffset: number, focusOffset: number][]
): EditorSelection[] {
  const normalizedOffsets: number[] = [];
  for (const [anchorOffset, focusOffset] of offsetPairs) {
    normalizedOffsets.push(
      Math.min(anchorOffset, focusOffset),
      Math.max(anchorOffset, focusOffset)
    );
  }
  const positions = textDocument.positionsAt(normalizedOffsets);
  return offsetPairs.map(([anchorOffset, focusOffset], index) => {
    const direction =
      anchorOffset === focusOffset
        ? DirectionNone
        : anchorOffset < focusOffset
          ? DirectionForward
          : DirectionBackward;
    return {
      start: positions[index * 2],
      end: positions[index * 2 + 1],
      direction,
    };
  });
}

// Expands a backspace over leading spaces into one soft-tab width so mixed hard/soft indentation
// behaves like the explicit outdent command.
function normalizeLeadingIndentForChange(
  textDocument: TextDocument<unknown>,
  change: ResolvedTextEdit,
  tabSize: number
): ResolvedTextEdit {
  if (change.text !== '' || change.start !== change.end - 1) {
    return change;
  }
  const caretPosition = textDocument.positionAt(change.end);
  if (caretPosition.character === 0) {
    return change;
  }
  const lineText = textDocument.getLineText(caretPosition.line);
  const leadingText = lineText.slice(0, caretPosition.character);
  if (/[^ \t]/.test(leadingText)) {
    return change;
  }
  if (lineText[caretPosition.character - 1] === '\t') {
    return change;
  }
  const softTabStart = Math.max(0, caretPosition.character - tabSize);
  const softTabText = lineText.slice(softTabStart, caretPosition.character);
  if (softTabText.length === tabSize && /^ +$/.test(softTabText)) {
    return {
      ...change,
      start: change.end - softTabText.length,
    };
  }
  return change;
}

function boundaryToPosition(node: Node, offset: number): Position | null {
  const host = node.nodeType === 1 ? (node as HTMLElement) : node.parentElement;
  let lineEl: HTMLElement | null = host;
  while (lineEl !== null && getLineIndex(lineEl) === undefined) {
    lineEl = lineEl.parentElement;
  }
  if (lineEl === null) {
    return null;
  }
  const line = getLineIndex(lineEl);
  if (line === undefined) {
    return null;
  }

  if (node.nodeType === 3) {
    if (node.parentElement === null) {
      return null;
    }
    if (findTokenSpan(node.parentElement) !== null) {
      return { line, character: getLineChildEnd(node, offset) };
    }
    return {
      line,
      character:
        offsetBefore(lineEl, node) + getTextOffset(node.textContent, offset),
    };
  }

  if (node.nodeType === 1) {
    const el = node as HTMLElement;
    if (el.tagName === 'DIV') {
      let character = 0;
      for (let i = 0; i < offset; i++) {
        character = getLineChildEnd(el.childNodes[i]);
      }
      return { line, character };
    }
    if (el.tagName === 'BR') {
      return { line, character: 0 };
    }
    if (el.tagName === 'SPAN') {
      if (offset < el.childNodes.length) {
        const next = el.childNodes[offset];
        if (next?.nodeType === 1) {
          const nextBase = getCharacterIndex(next as HTMLElement);
          if (nextBase !== undefined) {
            return { line, character: nextBase };
          }
          const token = findTokenSpan(next as HTMLElement);
          const tokenBase =
            token === null ? undefined : getCharacterIndex(token);
          if (tokenBase !== undefined) {
            return { line, character: tokenBase };
          }
        }
      }
      return {
        line,
        character:
          offset > 0
            ? getLineChildEnd(el.childNodes[offset - 1])
            : offsetBefore(lineEl, el),
      };
    }
    return { line, character: offsetBefore(lineEl, el) };
  }
  return null;
}

function collectTokens(line: HTMLElement): HTMLElement[] {
  const tokens: HTMLElement[] = [];
  for (const child of line.childNodes) {
    if (child.nodeType !== 1) {
      continue;
    }
    const el = child as HTMLElement;
    if (el.tagName !== 'SPAN') {
      continue;
    }
    const base = getCharacterIndex(el);
    if (base !== undefined) {
      tokens.push(el);
      continue;
    }
    for (const nested of el.childNodes) {
      if (
        nested.nodeType === 1 &&
        getCharacterIndex(nested as HTMLElement) !== undefined
      ) {
        tokens.push(nested as HTMLElement);
      }
    }
  }
  return tokens;
}

function textAt(token: HTMLElement, offset: number): [Node, number] | null {
  let remaining = Math.max(0, offset);
  const stack: Array<{ container: Node; index: number }> = [
    { container: token, index: 0 },
  ];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.index >= frame.container.childNodes.length) {
      stack.pop();
      continue;
    }
    const walkNode = frame.container.childNodes[frame.index];
    frame.index++;
    if (walkNode.nodeType === 3) {
      const len = getTextOffset(
        walkNode.textContent,
        walkNode.textContent?.length ?? 0
      );
      if (remaining <= len) {
        return [walkNode, remaining];
      }
      remaining -= len;
    } else if (walkNode.nodeType === 1) {
      stack.push({ container: walkNode, index: 0 });
    }
  }
  return null;
}

function textLengthBefore(root: Node, target: Node): number {
  let before = 0;
  const stack: Array<{ container: Node; index: number }> = [
    { container: root, index: 0 },
  ];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.index >= frame.container.childNodes.length) {
      stack.pop();
      continue;
    }
    const walkNode = frame.container.childNodes[frame.index];
    if (walkNode === target) {
      return before;
    }
    frame.index++;
    if (walkNode.nodeType === 3) {
      before += getTextOffset(
        walkNode.textContent,
        walkNode.textContent?.length ?? 0
      );
    } else if (walkNode.nodeType === 1) {
      stack.push({ container: walkNode, index: 0 });
    }
  }
  return before;
}

function isInside(token: HTMLElement, node: Node): boolean {
  let current: Node | null = node;
  while (current !== null) {
    if (current === token) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function offsetBefore(line: HTMLElement, node: Node): number {
  if (node.parentElement === line) {
    let offset = 0;
    const index = Array.prototype.indexOf.call(line.childNodes, node);
    for (let i = 0; i < index; i++) {
      offset = getLineChildEnd(line.childNodes[i]);
    }
    return offset;
  }
  for (const token of collectTokens(line)) {
    if (isInside(token, node)) {
      const base = getCharacterIndex(token)!;
      return base + (node.nodeType === 3 ? textLengthBefore(token, node) : 0);
    }
  }
  let offset = 0;
  let target: HTMLElement | null =
    node.nodeType === 1 ? (node as HTMLElement) : node.parentElement;
  while (target !== null && target.parentElement !== null) {
    if (getLineIndex(target.parentElement) !== undefined) {
      break;
    }
    const parent = target.parentElement;
    const index = Array.prototype.indexOf.call(parent.childNodes, target);
    for (let i = 0; i < index; i++) {
      offset = getLineChildEnd(parent.childNodes[i]);
    }
    target = parent;
  }
  return offset;
}

function findTokenSpan(el: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = el;
  while (current !== null) {
    if (getLineIndex(current) !== undefined) {
      return null;
    }
    if (getCharacterIndex(current) !== undefined) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function getLineChildEnd(
  child: Node | undefined,
  textOffsetInChild?: number
): number {
  if (child === undefined) {
    return 0;
  }
  if (child.nodeType === 3) {
    const parent = child.parentElement;
    if (parent === null) {
      return 0;
    }
    const token = findTokenSpan(parent);
    if (token === null) {
      return 0;
    }
    const base = getCharacterIndex(token);
    if (base === undefined) {
      return 0;
    }
    const length =
      textOffsetInChild === undefined
        ? getTextOffset(child.textContent, child.textContent?.length ?? 0)
        : getTextOffset(child.textContent, textOffsetInChild);
    return base + textLengthBefore(token, child) + length;
  }
  if (child.nodeType !== 1) {
    return 0;
  }
  const el = child as HTMLElement;
  if (el.tagName !== 'SPAN' && el.tagName !== 'BR') {
    return 0;
  }
  const base = getCharacterIndex(el);
  if (base !== undefined) {
    return base + (el.textContent?.length ?? 0);
  }
  let end = 0;
  for (const token of el.childNodes) {
    end = Math.max(end, getLineChildEnd(token));
  }
  return end;
}

function getLineIndex(el: HTMLElement): number | undefined {
  const { line, lineType } = el.dataset;
  if (line !== undefined && lineType !== 'change-deletion') {
    const lineNumber = parseInt(line, 10);
    if (!Number.isNaN(lineNumber)) {
      return lineNumber - 1;
    }
  }
  return undefined;
}

function getCharacterIndex(el: HTMLElement): number | undefined {
  const { char } = el.dataset;
  if (char !== undefined) {
    const charIndex = parseInt(char, 10);
    if (!Number.isNaN(charIndex)) {
      return charIndex;
    }
  }
  return undefined;
}

function getTextOffset(
  text: string | null | undefined,
  offset: number
): number {
  const value = text ?? '';
  const lineBreakIndex = value.search(/[\r\n]/);
  return Math.min(
    offset,
    lineBreakIndex === -1 ? value.length : lineBreakIndex
  );
}
