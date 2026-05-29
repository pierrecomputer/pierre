import { describe, expect, test } from 'bun:test';

import { createEditStackEntry, EditStack } from '../src/editor/editStack';
import type { EditorSelection } from '../src/editor/selection';
import {
  DirectionNone,
  type SelectionDirection,
} from '../src/editor/selection';
import { TextDocument } from '../src/editor/textDocument';

function createSelection(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
  direction: SelectionDirection = DirectionNone
): EditorSelection {
  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
    direction,
  };
}

function caret(character: number) {
  return createSelection(0, character, 0, character, DirectionNone);
}

function stackEntry(
  textBeforeEdit: string,
  resolvedEdits: { start: number; end: number; text: string }[],
  versionBefore: number,
  versionAfter: number,
  selectionsBefore?: EditorSelection[],
  selectionsAfter?: EditorSelection[]
) {
  const doc = new TextDocument(
    'inmemory://edit-stack-test',
    textBeforeEdit,
    'plain',
    versionBefore
  );
  return createEditStackEntry(
    doc,
    resolvedEdits,
    versionBefore,
    versionAfter,
    selectionsBefore,
    selectionsAfter
  );
}

describe('EditHistory', () => {
  test('push stores cloned selections and pop methods move entries between stacks', () => {
    const editStack = new EditStack();
    const selectionBefore = [caret(0), caret(1)];
    const selectionAfter = [caret(2), caret(3)];

    editStack.push(
      stackEntry(
        'ab',
        [{ start: 1, end: 1, text: 'X' }],
        4,
        5,
        selectionBefore,
        selectionAfter
      )
    );

    selectionBefore[0] = caret(99);
    selectionAfter[0] = caret(99);

    expect(editStack.canUndo).toBe(true);
    expect(editStack.canRedo).toBe(false);

    const entry = editStack.popUndoToRedo();

    expect(entry).toEqual({
      forwardEdits: [{ start: 1, end: 1, text: 'X' }],
      inverseEdits: [{ start: 1, end: 2, text: '' }],
      versionBefore: 4,
      versionAfter: 5,
      selectionsBefore: [caret(0), caret(1)],
      selectionsAfter: [caret(2), caret(3)],
    });
    expect(editStack.canUndo).toBe(false);
    expect(editStack.canRedo).toBe(true);

    expect(editStack.popRedoToUndo()).toEqual(entry);
    expect(editStack.canUndo).toBe(true);
    expect(editStack.canRedo).toBe(false);
  });

  test('setLastUndoSelectionsAfter stores cloned redo selections', () => {
    const editStack = new EditStack();
    let selectionAfter = caret(2);

    editStack.push(
      stackEntry(
        'a',
        [{ start: 1, end: 1, text: 'b' }],
        1,
        2,
        [caret(1)],
        [selectionAfter]
      )
    );
    selectionAfter = caret(99);

    expect(editStack.popUndoToRedo()).toMatchObject({
      selectionsAfter: [caret(2)],
    });
  });

  test('push clears redo history when recording a new undo entry', () => {
    const editStack = new EditStack();

    editStack.push(
      stackEntry('', [{ start: 0, end: 0, text: 'a' }], 0, 1, [caret(0)])
    );
    editStack.push(
      stackEntry('a', [{ start: 1, end: 1, text: 'b' }], 1, 2, [caret(1)])
    );

    expect(editStack.popUndoToRedo()).toMatchObject({
      forwardEdits: [{ start: 1, end: 1, text: 'b' }],
    });
    expect(editStack.canRedo).toBe(true);

    editStack.push(
      stackEntry('a', [{ start: 1, end: 1, text: 'c' }], 1, 2, [caret(1)])
    );

    expect(editStack.canRedo).toBe(false);
    expect(editStack.popUndoToRedo()).toMatchObject({
      forwardEdits: [{ start: 1, end: 1, text: 'c' }],
    });
    expect(editStack.popUndoToRedo()).toMatchObject({
      forwardEdits: [{ start: 0, end: 0, text: 'a' }],
    });
  });

  test('maxEntries drops oldest undo history first', () => {
    const editStack = new EditStack({ maxEntries: 3 });

    for (let i = 0; i < 4; i++) {
      editStack.push(
        stackEntry('', [{ start: 0, end: 0, text: `${i}` }], i, i + 1, [
          caret(0),
        ])
      );
    }

    const third = editStack.popUndoToRedo();
    expect(third?.forwardEdits[0]?.text).toBe('3');
    expect(editStack.popUndoToRedo()?.forwardEdits[0]?.text).toBe('2');
    expect(editStack.popUndoToRedo()?.forwardEdits[0]?.text).toBe('1');
    expect(editStack.popUndoToRedo()).toBeUndefined();
  });

  test('clear resets both undo and redo stacks', () => {
    const editStack = new EditStack();

    editStack.push(
      stackEntry('', [{ start: 0, end: 0, text: 'a' }], 0, 1, [caret(0)])
    );
    editStack.popUndoToRedo();
    editStack.clear();

    expect(editStack.canUndo).toBe(false);
    expect(editStack.canRedo).toBe(false);
    expect(editStack.popUndoToRedo()).toBeUndefined();
    expect(editStack.popRedoToUndo()).toBeUndefined();
  });
});
