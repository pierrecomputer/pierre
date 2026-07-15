import type { DiffLineAnnotation, EditorSelection } from '../types';
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
  /**
   * When `true`, this entry is its own undo step and never merges with the
   * entry before or after it. Set for paste and cut, which otherwise look like
   * typing and would merge into the previous keystroke.
   */
  undoBoundary?: boolean;
  /**
   * When `true`, an undo or redo has exposed this entry as the top of the
   * undo stack. Traversed history is committed: a later edit must start a new
   * undo step instead of coalescing into this entry (which would fuse fresh
   * typing into pre-undo history and, via the redo clear, destroy the parked
   * entries above it). Stamped by `popUndoToRedo`/`popRedoToUndo`.
   */
  sealed?: boolean;
  /**
   * Which delete key produced this pure-delete entry, when the recorded
   * pre-edit selections were collapsed carets: 'backspace' deleted the range
   * before each caret, 'delete' the range after it. Backspace and forward
   * delete at the same pivot produce identical edit geometry, so the caret
   * side is the only signal that separates a continuing delete run from a
   * direction switch. Unset for non-delete entries and for deletes recorded
   * without caret selections, which keep the geometry-only coalescing rules.
   */
  deleteDirection?: 'backspace' | 'delete';
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
      this.#sealTopUndo();
      return entry;
    }
  }

  /** Moves the latest redo entry back to the undo stack and returns it, or `undefined` if empty. */
  popRedoToUndo(): EditStackEntry<LAnnotation> | void {
    const entry = this.#redoStack.pop();
    if (entry !== undefined) {
      this.#undoStack.push(entry);
      this.#sealTopUndo();
      return entry;
    }
  }

  // Marks the entry an undo or redo just exposed as the top of the undo stack
  // (after undo, the entry beneath the popped one; after redo, the re-pushed
  // entry itself) so later edits start a new undo step instead of coalescing
  // into traversed history.
  #sealTopUndo(): void {
    const topEntry = this.#undoStack[this.#undoStack.length - 1];
    if (topEntry !== undefined) {
      topEntry.sealed = true;
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
  const entry: EditStackEntry<LAnnotation> = {
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
  const deleteDirection = classifyDeleteDirection(
    textDocument,
    forwardEdits,
    selectionsBefore
  );
  if (deleteDirection !== undefined) {
    entry.deleteDirection = deleteDirection;
  }
  return entry;
}

// Classifies which delete key produced a pure-delete batch from where the
// recorded pre-edit carets sit relative to the deleted ranges: Backspace
// deletes the range before the caret (caret at `edit.end`), forward Delete
// the range after it (caret at `edit.start`). Both keys produce identical
// edit geometry at the same pivot, so the caret side is the only available
// signal. Returns `undefined` — keeping the geometry-only coalescing rules —
// when the batch is not purely deletes, the selections are missing,
// non-collapsed (a selection deletion has no key direction), or miscounted
// (e.g. carets with nothing to delete recorded alongside eligible ones), or
// the carets do not sit consistently on one edge.
function classifyDeleteDirection<LAnnotation>(
  textDocument: TextDocument<LAnnotation>,
  forwardEdits: readonly ResolvedTextEdit[],
  selectionsBefore?: EditorSelection[]
): 'backspace' | 'delete' | undefined {
  if (
    selectionsBefore === undefined ||
    selectionsBefore.length !== forwardEdits.length
  ) {
    return undefined;
  }
  for (const edit of forwardEdits) {
    if (edit.text.length > 0 || edit.end <= edit.start) {
      return undefined;
    }
  }
  const caretOffsets: number[] = [];
  for (const selection of selectionsBefore) {
    if (
      selection.start.line !== selection.end.line ||
      selection.start.character !== selection.end.character
    ) {
      return undefined;
    }
    caretOffsets.push(textDocument.offsetAt(selection.start));
  }
  // `forwardEdits` is already sorted ascending; sort the carets the same way
  // so each pairs with the range it deleted.
  caretOffsets.sort((a, b) => a - b);
  let atEveryEnd = true;
  let atEveryStart = true;
  for (let i = 0; i < forwardEdits.length; i++) {
    atEveryEnd &&= caretOffsets[i] === forwardEdits[i].end;
    atEveryStart &&= caretOffsets[i] === forwardEdits[i].start;
  }
  if (atEveryEnd) {
    return 'backspace';
  }
  if (atEveryStart) {
    return 'delete';
  }
  return undefined;
}

/** Determines if the change matches following modes:
 * - 'insert': simple typing
 * - 'backspace': backward delete
 * - 'delete': forward delete
 *
 * A previous entry that has been traversed by undo/redo (`sealed`) never
 * accepts coalescing, and two delete entries whose key directions
 * (`deleteDirection`) are both known and opposite never merge — a direction
 * switch starts a new undo step. When either side's direction is unknown
 * (untracked or programmatic edits, deletes recorded without caret
 * selections), the geometry-only rules apply unchanged, so a caret that
 * merely coincides with a delete edge (e.g. an outdent's leading-whitespace
 * delete) cannot break grouping against unlabeled neighbors.
 */
export function shouldCoalesceEditStackEntry<LAnnotation>(
  previousEntry: EditStackEntry<LAnnotation> | undefined,
  nextEntry: EditStackEntry<LAnnotation>
): boolean {
  if (
    previousEntry === undefined ||
    previousEntry.sealed === true ||
    previousEntry.undoBoundary === true ||
    nextEntry.undoBoundary === true ||
    previousEntry.forwardEdits.length === 0 ||
    previousEntry.forwardEdits.length !== previousEntry.inverseEdits.length ||
    previousEntry.forwardEdits.length !== nextEntry.forwardEdits.length ||
    nextEntry.forwardEdits.length !== nextEntry.inverseEdits.length
  ) {
    return false;
  }
  // Backspace and forward Delete at the same pivot leave identical edit
  // geometry (the pivot offset maps onto both the end of a just-deleted range
  // and the resting spot after a Backspace), so geometry alone cannot see a
  // direction switch. When both entries carry a known key direction and they
  // disagree, this is a switch, not a continuing run. Requiring BOTH sides
  // keeps a false or coincidental label (a programmatic delete whose recorded
  // caret happens to sit on an edit edge) from blocking merges with unlabeled
  // neighbors, which keep the geometry-only rules.
  if (
    previousEntry.deleteDirection !== undefined &&
    nextEntry.deleteDirection !== undefined &&
    previousEntry.deleteDirection !== nextEntry.deleteDirection
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
      !nextForward.text.includes('\n') &&
      nextInverse.text.length === 0;
    if (previousWasInsert && nextIsInsert) {
      // Merge only when the next insert starts exactly where the previous
      // inserted text ends, in after-edit offsets. `previousInverse.end` marks
      // that point, since undo replaces exactly the inserted range. A
      // base-offset check can't tell this apart from a caret that jumped to the
      // left edge: both edges of a pure insert map back to the same base offset,
      // so typing "a" then "b" at the left edge would merge as "ab" while the
      // buffer holds "ba", corrupting redo.
      if (nextForward.start !== previousInverse.end) {
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
        // Forward-delete-run shape (the direction-switch check above already
        // rejected a known backspace-vs-delete conflict).
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
      // Backspace-run shape; the mirror of the pivot ambiguity above, covered
      // by the same direction-switch check.
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

  const mergedEntry: EditStackEntry<LAnnotation> = {
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
  // Keep the run's key direction on the merged entry (either side may be an
  // unclassified untracked edit) so a later opposite-direction delete still
  // reads as a switch and starts a new undo step.
  const deleteDirection =
    previousEntry.deleteDirection ?? nextEntry.deleteDirection;
  if (deleteDirection !== undefined) {
    mergedEntry.deleteDirection = deleteDirection;
  }
  return mergedEntry;
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
