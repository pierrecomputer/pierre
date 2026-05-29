import type { DiffLineAnnotation } from '../types';
import type { EditorSelection } from './selection';
import type { ResolvedTextEdit, TextDocument } from './textDocument';

/** Largest number of undo or redo entries kept; oldest entries drop first once exceeded. */
const DEFAULT_EDIT_STACK_MAX_ENTRIES = 100;

/** An entry in the edit stack. */
export interface EditStackEntry<LAnnotation> {
  /** Forward offset edits from the entry's base text to its final text. */
  forwardEdits: ResolvedTextEdit[];
  /** Inverse offset edits from the entry's final text back to its base text. */
  inverseEdits: ResolvedTextEdit[];
  /** Document version before the entry is applied. */
  versionBefore: number;
  /** Document version after the entry is applied. */
  versionAfter: number;
  /** Selection before the transaction. */
  selectionsBefore?: EditorSelection[];
  /** Selection after the transaction. */
  selectionsAfter?: EditorSelection[];
  /** Line annotations before the transaction. */
  lineAnnotationsBefore?: DiffLineAnnotation<LAnnotation>[];
  /** Line annotations after the transaction. */
  lineAnnotationsAfter?: DiffLineAnnotation<LAnnotation>[];
}

/** Options for the edit stack. */
export interface EditStackOptions {
  /** The maximum number of entries to keep in the undo stack. */
  maxEntries?: number;
}

/** A stack of edit entries. */
export class EditStack<LAnnotation> {
  #undoStack: EditStackEntry<LAnnotation>[] = [];
  #redoStack: EditStackEntry<LAnnotation>[] = [];
  #maxEntries: number;

  constructor(options?: EditStackOptions) {
    this.#maxEntries = Math.max(
      1,
      options?.maxEntries ?? DEFAULT_EDIT_STACK_MAX_ENTRIES
    );
  }

  get canUndo(): boolean {
    return this.#undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.#redoStack.length > 0;
  }

  /** Clears both the undo and redo stacks. */
  clear(): void {
    this.#undoStack.length = 0;
    this.#redoStack.length = 0;
  }

  /** Clears the redo stack. */
  clearRedo(): void {
    this.#redoStack.length = 0;
  }

  /** Pushes a new entry onto the undo stack. */
  push(entry: EditStackEntry<LAnnotation>): void {
    this.#undoStack.push(entry);
    this.clearRedo();
    if (this.#undoStack.length > this.#maxEntries) {
      this.#undoStack.shift();
    }
  }

  /** Sets the selections after the last undo entry. */
  setLastUndoSelectionsAfter(selections: EditorSelection[]): void {
    const lastEntry = this.#undoStack[this.#undoStack.length - 1];
    if (lastEntry !== undefined) {
      lastEntry.selectionsAfter = selections.map((selection) => ({
        ...selection,
      }));
    }
  }

  /** Sets the line annotations after the last undo entry. */
  setLastUndoLineAnnotations(
    lineAnnotationsBefore: DiffLineAnnotation<LAnnotation>[],
    lineAnnotationsAfter: DiffLineAnnotation<LAnnotation>[]
  ): void {
    const lastEntry = this.#undoStack[this.#undoStack.length - 1];
    if (lastEntry !== undefined) {
      lastEntry.lineAnnotationsBefore = lineAnnotationsBefore.slice();
      lastEntry.lineAnnotationsAfter = lineAnnotationsAfter.slice();
    }
  }

  /** Returns the last undo entry, or `undefined` if empty. */
  peekUndo(): EditStackEntry<LAnnotation> | undefined {
    return this.#undoStack[this.#undoStack.length - 1];
  }

  /** Replaces the last undo entry with the given entry. */
  replaceLastUndo(entry: EditStackEntry<LAnnotation>): void {
    if (this.#undoStack.length === 0) {
      this.push(entry);
      return;
    }
    this.#undoStack[this.#undoStack.length - 1] = entry;
    this.clearRedo();
  }

  /** Moves the latest undo entry to the redo stack and returns it, or `undefined` if empty. */
  popUndoToRedo(): EditStackEntry<LAnnotation> | void {
    const entry = this.#undoStack.pop();
    if (entry !== undefined) {
      this.#redoStack.push(entry);
      return entry;
    }
  }

  /** Moves the latest redo entry back to the undo stack and returns it, or `undefined` if empty. */
  popRedoToUndo(): EditStackEntry<LAnnotation> | void {
    const entry = this.#redoStack.pop();
    if (entry !== undefined) {
      this.#undoStack.push(entry);
      return entry;
    }
  }
}

export function createEditStackEntry<LAnnotation>(
  textDocument: TextDocument<LAnnotation>,
  resolvedEdits: ResolvedTextEdit[],
  versionBefore: number,
  versionAfter: number,
  selectionsBefore?: EditorSelection[],
  selectionsAfter?: EditorSelection[],
  lineAnnotationsBefore?: DiffLineAnnotation<LAnnotation>[],
  lineAnnotationsAfter?: DiffLineAnnotation<LAnnotation>[]
): EditStackEntry<LAnnotation> {
  const forwardEdits = [...resolvedEdits].sort((a, b) => a.start - b.start);
  const inverseEdits: ResolvedTextEdit[] = [];
  for (let i = 0, offsetDelta = 0; i < forwardEdits.length; i++) {
    const edit = forwardEdits[i];
    const replacedText = textDocument.getTextSlice(edit.start, edit.end);
    const startAfterEdit = edit.start + offsetDelta;
    inverseEdits.push({
      start: startAfterEdit,
      end: startAfterEdit + edit.text.length,
      text: replacedText,
    });
    offsetDelta += edit.text.length - (edit.end - edit.start);
  }
  return {
    forwardEdits: forwardEdits.map((edit) => ({ ...edit })),
    inverseEdits: inverseEdits,
    versionBefore,
    versionAfter,
    selectionsBefore: selectionsBefore?.map((selection) => ({
      ...selection,
    })),
    selectionsAfter: selectionsAfter?.map((selection) => ({ ...selection })),
    lineAnnotationsBefore: lineAnnotationsBefore?.slice(),
    lineAnnotationsAfter: lineAnnotationsAfter?.slice(),
  };
}

/** Determines if the change matches following modes:
 * - 'insert': simple typing
 * - 'backspace': backward delete
 * - 'delete': forward delete
 */
export function shouldCoalesceEditStackEntry<LAnnotation>(
  previousEntry: EditStackEntry<LAnnotation> | undefined,
  nextEntry: EditStackEntry<LAnnotation>
): boolean {
  if (
    previousEntry === undefined ||
    previousEntry.forwardEdits.length === 0 ||
    previousEntry.forwardEdits.length !== previousEntry.inverseEdits.length ||
    previousEntry.forwardEdits.length !== nextEntry.forwardEdits.length ||
    nextEntry.forwardEdits.length !== nextEntry.inverseEdits.length
  ) {
    return false;
  }
  let mode: 'insert' | 'backspace' | 'delete' | undefined;
  for (let i = 0; i < previousEntry.forwardEdits.length; i++) {
    const previousForward = previousEntry.forwardEdits[i];
    const previousInverse = previousEntry.inverseEdits[i];
    const nextForward = nextEntry.forwardEdits[i];
    const nextInverse = nextEntry.inverseEdits[i];
    const mappedNextStart = mapOffsetAfterForwardBatchToBefore(
      nextForward.start,
      previousEntry.forwardEdits
    );
    const previousWasInsert =
      previousForward.start <= previousForward.end &&
      previousForward.text.length > 0 &&
      !previousForward.text.includes('\n') &&
      !previousInverse.text.includes('\n');
    const nextIsInsert =
      nextForward.start === nextForward.end &&
      nextForward.text.length > 0 &&
      nextInverse.text.length === 0;
    if (previousWasInsert && nextIsInsert) {
      const expectedMappedNextStart = previousForward.end;
      // Allow continuing typing after replacing a selection (e.g. "hello" -> "w")
      // while still requiring that the cursor extension maps inside the same base range.
      if (mappedNextStart !== expectedMappedNextStart) {
        return false;
      }
      mode ??= 'insert';
      if (mode !== 'insert') {
        return false;
      }
      continue;
    }
    const previousWasDelete =
      previousForward.text.length === 0 &&
      previousForward.end > previousForward.start &&
      previousInverse.text.length > 0;
    const nextIsDelete =
      nextForward.text.length === 0 &&
      nextForward.end > nextForward.start &&
      nextInverse.text.length > 0;
    if (previousWasDelete && nextIsDelete) {
      if (mappedNextStart === previousForward.end) {
        mode ??= 'delete';
        if (mode !== 'delete') {
          return false;
        }
        continue;
      }
      if (
        mappedNextStart + (nextForward.end - nextForward.start) !==
        previousForward.start
      ) {
        return false;
      }
      mode ??= 'backspace';
      if (mode !== 'backspace') {
        return false;
      }
      continue;
    }
    return false;
  }
  return mode !== undefined;
}

/** Coalesce edit stack entries for simple typing and single-character deletes. */
export function coalesceEditStackEntries<LAnnotation>(
  previousEntry: EditStackEntry<LAnnotation>,
  nextEntry: EditStackEntry<LAnnotation>
): EditStackEntry<LAnnotation> {
  const forwardEdits: ResolvedTextEdit[] = [];
  const replacedTexts: string[] = [];
  for (let i = 0; i < previousEntry.forwardEdits.length; i++) {
    const previousForward = previousEntry.forwardEdits[i];
    const previousInverse = previousEntry.inverseEdits[i];
    const nextForward = nextEntry.forwardEdits[i];
    const nextInverse = nextEntry.inverseEdits[i];
    const mappedNextStart = mapOffsetAfterForwardBatchToBefore(
      nextForward.start,
      previousEntry.forwardEdits
    );

    if (previousForward.text.length > 0) {
      forwardEdits.push({
        start: previousForward.start,
        end: previousForward.end,
        text: previousForward.text + nextForward.text,
      });
      replacedTexts.push(previousInverse.text);
      continue;
    }

    if (mappedNextStart === previousForward.end) {
      forwardEdits.push({
        start: previousForward.start,
        end: mappedNextStart + (nextForward.end - nextForward.start),
        text: '',
      });
      replacedTexts.push(previousInverse.text + nextInverse.text);
      continue;
    }

    forwardEdits.push({
      start: Math.min(previousForward.start, mappedNextStart),
      end: previousForward.end,
      text: '',
    });
    replacedTexts.push(nextInverse.text + previousInverse.text);
  }

  return {
    forwardEdits,
    inverseEdits: buildInverseEditsFromReplacedTexts(
      forwardEdits,
      replacedTexts
    ),
    versionBefore: previousEntry.versionBefore,
    versionAfter: nextEntry.versionAfter,
    selectionsBefore: previousEntry.selectionsBefore?.slice(),
    selectionsAfter: nextEntry.selectionsAfter?.slice(),
    lineAnnotationsBefore: previousEntry.lineAnnotationsBefore?.slice(),
    lineAnnotationsAfter: nextEntry.lineAnnotationsAfter?.slice(),
  };
}

function buildInverseEditsFromReplacedTexts(
  forwardEdits: readonly ResolvedTextEdit[],
  replacedTexts: readonly string[]
): ResolvedTextEdit[] {
  const inverseEdits: ResolvedTextEdit[] = [];
  for (let i = 0, offsetDelta = 0; i < forwardEdits.length; i++) {
    const edit = forwardEdits[i];
    const startAfterEdit = edit.start + offsetDelta;
    inverseEdits.push({
      start: startAfterEdit,
      end: startAfterEdit + edit.text.length,
      text: replacedTexts[i],
    });
    offsetDelta += edit.text.length - (edit.end - edit.start);
  }
  return inverseEdits;
}

function mapOffsetAfterForwardBatchToBefore(
  offsetAfter: number,
  forwardEdits: readonly ResolvedTextEdit[]
): number {
  let offset = offsetAfter;
  for (const edit of forwardEdits) {
    const oldLength = edit.end - edit.start;
    const newLength = edit.text.length;
    const delta = newLength - oldLength;
    if (offset < edit.start) {
      continue;
    }
    if (offset >= edit.start + newLength) {
      offset -= delta;
      continue;
    }
    offset = edit.start + Math.min(offset - edit.start, oldLength);
  }
  return offset;
}
