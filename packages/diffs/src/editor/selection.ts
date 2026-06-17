import type { DiffLineAnnotation } from '../types';
import { applyDocumentChangeToLineAnnotations } from './lineAnnotations';
import type {
  Position,
  Range,
  ResolvedTextEdit,
  TextDocument,
  TextDocumentChange,
  TextEdit,
} from './textDocument';

export const DirectionBackward = -1;
export const DirectionNone = 0;
export const DirectionForward = 1;

export type SelectionDirection =
  | typeof DirectionBackward
  | typeof DirectionNone
  | typeof DirectionForward;

export interface EditorSelection extends Range {
  direction: SelectionDirection;
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
  let endLine = end.line;
  if (start.line < end.line && end.character === 0) {
    endLine--;
  }
  for (let line = start.line; line <= endLine; line++) {
    const lineText = textDocument.getLineText(line);
    if (lineText === undefined) {
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
 * Maps the cursor move to all selections.
 */
export function mapCursorMove(
  textDocument: TextDocument<unknown>,
  selections: EditorSelection[],
  shortcut: 'textStart' | 'start' | 'end' | 'up' | 'down' | 'left' | 'right'
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
      if (shortcut === 'textStart') {
        const indent = getLeadingSpaces(textDocument.getLineText(line));
        character = character === indent ? 0 : indent;
      } else {
        character = shortcut === 'start' ? 0 : textDocument.getLineLength(line);
      }
      if (selection.direction === DirectionBackward) {
        line = selection.start.line;
      } else {
        line = selection.end.line;
      }
    } else if (shortcut === 'up') {
      line = Math.max(0, line - 1);
    } else if (shortcut === 'down') {
      line = Math.min(Math.max(lineCount - 1, 0), line + 1);
    } else if (isCollapsedSelection(selection)) {
      const lineLength = textDocument.getLineLength(line);
      character = Math.min(character, lineLength);
      if (shortcut === 'left') {
        character--;

        if (character < 0) {
          if (line === 0) {
            character = 0;
          } else {
            line = Math.max(0, line - 1);
            character = textDocument.getLineLength(line);
          }
        }
      } else {
        character++;
        if (character > lineLength) {
          if (line === lineCount - 1) {
            character--;
          } else {
            line = Math.min(Math.max(lineCount - 1, 0), line + 1);
            character = 0;
          }
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

/**
 * Same as mapCursorMove, but with shift key pressed.
 */
export function mapSelectionShift(
  textDocument: TextDocument<unknown>,
  selections: EditorSelection[],
  shortcut: 'textStart' | 'start' | 'end' | 'up' | 'down' | 'left' | 'right'
): EditorSelection[] {
  return selections.map((selection) => {
    const [anchorOffset, focusOffset] = getSelectionAnchorAndFocusOffsets(
      textDocument,
      selection
    );
    const focusPosition = textDocument.positionAt(focusOffset);
    const [movedFocusSelection] = mapCursorMove(
      textDocument,
      [
        {
          start: focusPosition,
          end: focusPosition,
          direction: DirectionNone,
        },
      ],
      shortcut
    );
    const movedFocusOffset = textDocument.offsetAt(movedFocusSelection.start);
    return createSelectionFromAnchorAndFocusOffsets(
      textDocument,
      anchorOffset,
      movedFocusOffset
    );
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
  tabSize = 2
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

  const change = textDocument.applyResolvedEdits(edits, true, selections);
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
    const originalText = textDocument.getText().slice(entry.start, entry.end);
    const preservedOffset = newText.indexOf(originalText);
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
 * Applies a text replace to multiple selections.
 */
export function applyTextReplaceToSelections<LAnnotation>(
  textDocument: TextDocument<LAnnotation>,
  selections: EditorSelection[],
  texts: string[],
  lineAnnotations?: DiffLineAnnotation<LAnnotation>[]
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
    text: string;
  }> = [];
  let isAlreadyOrdered = true;
  for (let index = 0; index < selections.length; index++) {
    const entry = {
      index,
      start: selectionOffsets[index * 2],
      end: selectionOffsets[index * 2 + 1],
      text: texts[index],
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
    for (const entry of ordered) {
      if (entry.start < previousEditEnd) {
        throw new Error('Overlapping multi-selection edits are not supported');
      }
      previousEditEnd = entry.end;
      const newText = expandSingleNewlineInsert(
        textDocument,
        entry.text,
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

  const change = textDocument.applyResolvedEdits(edits, true, selections);
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
  const text = textDocument.getText();
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
    const lineLength = textDocument.getLineLength(line);
    let edit: ResolvedTextEdit | undefined;

    if (character > 0 && character < lineLength) {
      edit = {
        start: offset - 1,
        end: offset + 1,
        text: text[offset] + text[offset - 1],
      };
      nextOffsetPairs.push([offset + 1, offset + 1]);
    } else if (character === lineLength && lineLength >= 2) {
      edit = {
        start: offset - 2,
        end: offset,
        text: text[offset - 1] + text[offset - 2],
      };
      nextOffsetPairs.push([offset, offset]);
    } else if (character === 0 && line > 0 && lineLength > 0) {
      const prevLine = line - 1;
      const prevLength = textDocument.getLineLength(prevLine);
      const prevEnd = textDocument.offsetAt({
        line: prevLine,
        character: prevLength,
      });
      const prevStart = prevLength > 0 ? prevEnd - 1 : prevEnd;
      edit = {
        start: prevStart,
        end: offset + 1,
        text:
          text[offset] +
          text.slice(prevEnd, offset) +
          text.slice(prevStart, prevEnd),
      };
      nextOffsetPairs.push([offset + 1, offset + 1]);
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
  const selected = new Set<number>();
  const accepted: {
    index: number;
    selection: EditorSelection;
  }[] = [];
  for (let i = selections.length - 1; i >= 0; i--) {
    const selection = selections[i];
    if (selection === undefined) {
      continue;
    }
    let left = 0;
    let right = accepted.length;
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      const candidate = accepted[mid]?.selection;
      if (candidate === undefined) {
        break;
      }
      if (comparePosition(candidate.start, selection.start) < 0) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }
    const previous = accepted[left - 1]?.selection;
    const next = accepted[left]?.selection;
    if (
      (previous !== undefined && selectionIntersects(previous, selection)) ||
      (next !== undefined && selectionIntersects(next, selection))
    ) {
      continue;
    }
    accepted.splice(left, 0, { index: i, selection });
    selected.add(i);
  }
  return selections.filter((_, index) => selected.has(index));
}

/**
 * Finds the next matching word and updates the selections.
 */
export function findNexMatch(
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
  atEnd: boolean
): EditorSelection {
  const line = atEnd ? textDocument.lineCount - 1 : 0;
  const character = atEnd ? textDocument.getLineLength(line) : 0;
  const start = { line, character };
  return {
    start: start,
    end: start,
    direction: DirectionForward,
  };
}

/**
 * Get the text of the selections for the given text document.
 */
export function getSelectionText(
  textDocument: TextDocument<unknown>,
  selections: EditorSelection[]
): string {
  return [...selections]
    .sort((a, b) => {
      const startOrder = comparePosition(a.start, b.start);
      if (startOrder !== 0) {
        return startOrder;
      }
      return comparePosition(a.end, b.end);
    })
    .map((selection) => {
      if (isCollapsedSelection(selection)) {
        return textDocument.getLineText(selection.start.line, false);
      }
      return textDocument.getText(selection);
    })
    .join('\n');
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
  const segmenter = new Intl.Segmenter(undefined, {
    granularity: 'word',
  });
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
  const graphemeStarts = [0];
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  for (const segment of segmenter.segment(lineText)) {
    if (segment.index > 0) {
      graphemeStarts.push(segment.index);
    }
  }
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
    if (nextChar !== ' ' || pos !== head) {
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
  if (insertText !== '\n' && insertText !== '\r\n') {
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
