// @ts-expect-error -- no @types/jsdom; only used in tests
import { JSDOM } from 'jsdom';

// DnD feature requires window.addEventListener/removeEventListener for dragend events.
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.CustomEvent = dom.window.CustomEvent;

import { describe, expect, it, mock } from 'bun:test';

import { dragAndDropFeature } from '../../src/features/drag-and-drop/feature';
import { isOrderedDragTarget } from '../../src/features/drag-and-drop/utils';
import { keyboardDragAndDropFeature } from '../../src/features/keyboard-drag-and-drop/feature';
import { AssistiveDndState } from '../../src/features/keyboard-drag-and-drop/types';
import { propMemoizationFeature } from '../../src/features/prop-memoization/feature';
import { selectionFeature } from '../../src/features/selection/feature';
import { TestTree } from './test-utils/test-tree';

// Note: vitest used expect.addEqualityTesters for ItemInstance comparison.
// bun:test doesn't support that API, but the TestTree helpers (expect.dropped,
// expect.substate) handle item comparisons correctly via deep equality.

const factory = TestTree.default({
  initialState: {
    expandedItems: ['x1', 'x11', 'x2', 'x21'],
  },
  onDrop: mock(() => {}),
}).withFeatures(
  selectionFeature,
  dragAndDropFeature,
  keyboardDragAndDropFeature,
  propMemoizationFeature
);

describe('core-feature/keyboard-drag-and-drop', () => {
  factory.forSuits((tree) => {
    describe('happy paths', () => {
      it('correct initial state', () => {
        tree.do.selectMultiple('x111', 'x112');
        tree.do.hotkey('startDrag');
        tree.expect.substate('dnd', {
          dragTarget: {
            childIndex: 2,
            dragLineIndex: 4,
            dragLineLevel: 2,
            insertionIndex: 0,
            item: tree.item('x11'),
          },
          draggedItems: [tree.item('x111'), tree.item('x112')],
        });
        tree.expect.substate('assistiveDndState', AssistiveDndState.Started);
      });

      it('starts dragging only focused item', () => {
        tree.item('x3').setFocused();
        tree.do.hotkey('startDrag');
        tree.expect.substate('dnd', {
          draggedItems: [tree.item('x3')],
          dragTarget: {
            childIndex: 3,
            dragLineIndex: 19,
            dragLineLevel: 0,
            insertionIndex: 2,
            item: tree.item('x'),
          },
        });
      });

      it('starts dragging both selected and focused item', () => {
        tree.do.selectMultiple('x111', 'x112');
        tree.item('x3').setFocused();
        tree.do.hotkey('startDrag');
        tree.expect.substate('dnd', {
          draggedItems: [tree.item('x111'), tree.item('x112'), tree.item('x3')],
          dragTarget: {
            childIndex: 3,
            dragLineIndex: 19,
            dragLineLevel: 0,
            insertionIndex: 2,
            item: tree.item('x'),
          },
        });
      });

      it('moves down 1', () => {
        tree.do.selectMultiple('x111', 'x112');
        tree.do.hotkey('startDrag');
        tree.do.hotkey('dragDown');
        tree.expect.substate('dnd', {
          dragTarget: {
            childIndex: 3,
            dragLineIndex: 5,
            dragLineLevel: 2,
            insertionIndex: 1,
            item: tree.item('x11'),
          },
          draggedItems: [tree.item('x111'), tree.item('x112')],
        });
        tree.expect.substate('assistiveDndState', AssistiveDndState.Dragging);
      });

      it('moves down 2', () => {
        tree.do.selectMultiple('x111', 'x112');
        tree.do.hotkey('startDrag');
        tree.do.hotkey('dragDown');
        tree.do.hotkey('dragDown');
        tree.expect.substate('dnd', {
          dragTarget: {
            childIndex: 4,
            dragLineIndex: 6,
            dragLineLevel: 2,
            insertionIndex: 2,
            item: tree.item('x11'),
          },
          draggedItems: [tree.item('x111'), tree.item('x112')],
        });
        tree.expect.substate('assistiveDndState', AssistiveDndState.Dragging);
      });

      it('reparent down', () => {
        tree.do.selectMultiple('x111', 'x112');
        tree.do.hotkey('startDrag');
        tree.do.hotkey('dragDown');
        tree.do.hotkey('dragDown');
        tree.do.hotkey('dragDown');
        tree.expect.substate('dnd', {
          dragTarget: {
            childIndex: 1,
            dragLineIndex: 6,
            dragLineLevel: 1,
            insertionIndex: 1,
            item: tree.item('x1'),
          },
          draggedItems: [tree.item('x111'), tree.item('x112')],
        });
      });

      it("doesn't reparent further", () => {
        tree.do.selectMultiple('x111', 'x112');
        tree.do.hotkey('startDrag');
        tree.do.hotkey('dragDown');
        tree.do.hotkey('dragDown');
        tree.do.hotkey('dragDown');
        tree.do.hotkey('dragDown');
        tree.expect.substate('dnd', {
          dragTarget: { item: tree.item('x12') },
          draggedItems: [tree.item('x111'), tree.item('x112')],
        });
      });

      it('reparent back up', () => {
        tree.do.selectMultiple('x111', 'x112');
        tree.do.hotkey('startDrag');
        tree.do.hotkey('dragDown');
        tree.do.hotkey('dragDown');
        tree.do.hotkey('dragDown');
        tree.do.hotkey('dragUp');
        tree.expect.substate('dnd', {
          dragTarget: {
            childIndex: 4,
            dragLineIndex: 6,
            dragLineLevel: 2,
            insertionIndex: 2,
            item: tree.item('x11'),
          },
          draggedItems: [tree.item('x111'), tree.item('x112')],
        });
      });
    });

    describe('dropping', () => {
      it('drops below starting items', async () => {
        tree.do.selectMultiple('x111', 'x112');
        tree.do.hotkey('startDrag');
        tree.do.hotkey('dragDown');
        tree.do.hotkey('dragDown');
        tree.do.hotkey('completeDrag');
        tree.expect.dropped(['x111', 'x112'], {
          childIndex: 4,
          insertionIndex: 2,
          dragLineIndex: 6,
          dragLineLevel: 2,
          item: tree.item('x11'),
        });
        // Wait a tick for async state update
        await new Promise((r) => setTimeout(r, 50));
        tree.expect.substate('assistiveDndState', AssistiveDndState.Completed);
      });

      it('drops above starting items', async () => {
        tree.do.selectMultiple('x111', 'x112');
        tree.do.hotkey('startDrag');
        tree.do.hotkey('dragUp');
        tree.do.hotkey('dragUp');
        tree.do.hotkey('completeDrag');
        tree.expect.dropped(['x111', 'x112'], {
          childIndex: 0,
          insertionIndex: 0,
          dragLineIndex: 2,
          dragLineLevel: 2,
          item: tree.item('x11'),
        });
        // Wait a tick for async state update
        await new Promise((r) => setTimeout(r, 50));
        tree.expect.substate('assistiveDndState', AssistiveDndState.Completed);
      });

      it('drops inside folder', () => {
        tree.do.selectMultiple('x111', 'x112');
        tree.do.hotkey('startDrag');
        tree.do.hotkey('dragDown');
        tree.do.hotkey('dragDown');
        tree.do.hotkey('dragDown');
        tree.do.hotkey('dragDown');
        tree.do.hotkey('completeDrag');
        tree.expect.dropped(['x111', 'x112'], {
          item: tree.item('x12'),
        });
      });

      it('cancels drag', () => {
        const onDrop = tree.mockedHandler('onDrop');
        tree.do.selectMultiple('x111', 'x112');
        tree.do.hotkey('startDrag');
        tree.do.hotkey('cancelDrag');
        expect(onDrop).not.toHaveBeenCalled();
        tree.expect.substate('dnd', null);
        tree.expect.substate('assistiveDndState', AssistiveDndState.None);
      });
    });

    describe('foreign drag', () => {
      it('drags items out of tree', () => {
        tree.do.selectMultiple('x111', 'x112');
        tree.do.hotkey('startDrag');
        expect(tree.instance.getState().dnd?.draggedItems).toStrictEqual([
          tree.item('x111'),
          tree.item('x112'),
        ]);
        tree.instance.stopKeyboardDrag();
        expect(tree.instance.getState().dnd).toBe(null);
      });

      it('drags items inside of tree', () => {
        tree.mockedHandler('canDropForeignDragObject').mockReturnValue(true);
        tree.item('x111').setFocused();
        const dataTransfer = {
          getData: mock(() => 'hello world'),
        };
        tree.instance.startKeyboardDragOnForeignObject(
          dataTransfer as unknown as DataTransfer
        );
        tree.expect.substate('assistiveDndState', AssistiveDndState.Started);
        tree.expect.substate('dnd', {
          draggedItems: undefined,
          dragTarget: {
            childIndex: 1,
            dragLineIndex: 3,
            dragLineLevel: 2,
            insertionIndex: 1,
            item: tree.item('x11'),
          },
        });
      });

      it('starts at first valid location when dragging foreign object', () => {
        const canDropForeignDragObject = tree
          .mockedHandler('canDropForeignDragObject')
          .mockReturnValue(true);
        canDropForeignDragObject.mockReturnValueOnce(false);
        canDropForeignDragObject.mockReturnValueOnce(false);
        tree.item('x111').setFocused();
        const dataTransfer = {
          getData: mock(() => 'hello world'),
        };
        tree.instance.startKeyboardDragOnForeignObject(
          dataTransfer as unknown as DataTransfer
        );
        tree.expect.substate('assistiveDndState', AssistiveDndState.Started);
        tree.expect.substate('dnd', {
          draggedItems: undefined,
          dragTarget: {
            childIndex: 2,
            dragLineIndex: 4,
            dragLineLevel: 2,
            insertionIndex: 2,
            item: tree.item('x11'),
          },
        });
      });

      it('skips invalid positions to inbetween when dragging foreign object', () => {
        const canDropForeignDragObject = tree
          .mockedHandler('canDropForeignDragObject')
          .mockReturnValue(true);
        tree.item('x111').setFocused();
        const dataTransfer = {
          getData: mock(() => 'hello world'),
        };
        tree.instance.startKeyboardDragOnForeignObject(
          dataTransfer as unknown as DataTransfer
        );
        canDropForeignDragObject.mockReturnValueOnce(false);
        canDropForeignDragObject.mockReturnValueOnce(false);
        canDropForeignDragObject.mockReturnValueOnce(false);
        tree.do.hotkey('dragDown');
        tree.expect.substate('assistiveDndState', AssistiveDndState.Dragging);
        tree.expect.substate('dnd', {
          draggedItems: undefined,
          dragTarget: {
            childIndex: 3,
            dragLineIndex: 5,
            dragLineLevel: 2,
            insertionIndex: 3,
            item: tree.item('x11'),
          },
        });
      });

      it('skips invalid positions to folder when dragging foreign object', () => {
        const canDropForeignDragObject = tree
          .mockedHandler('canDropForeignDragObject')
          .mockReturnValue(true);
        tree.item('x111').setFocused();
        const dataTransfer = {
          getData: mock(() => 'hello world'),
        };
        tree.instance.startKeyboardDragOnForeignObject(
          dataTransfer as unknown as DataTransfer
        );
        canDropForeignDragObject.mockReturnValueOnce(false);
        canDropForeignDragObject.mockReturnValueOnce(false);
        canDropForeignDragObject.mockReturnValueOnce(false);
        canDropForeignDragObject.mockReturnValueOnce(false);
        tree.do.hotkey('dragDown');
        tree.expect.substate('assistiveDndState', AssistiveDndState.Dragging);
        tree.expect.substate('dnd', {
          draggedItems: undefined,
          dragTarget: {
            item: tree.item('x114'),
          },
        });
      });
    });

    describe('drag restrictions', () => {
      const expectChildIndex = (index: number) => {
        const state = tree.instance.getState().dnd?.dragTarget;
        if (state == null || !isOrderedDragTarget(state))
          throw new Error('No childIndex');
        expect(state.childIndex).toEqual(index);
      };

      it('doesnt drag when canDrag=false', () => {
        const canDrag = tree.mockedHandler('canDrag').mockReturnValue(false);
        tree.do.selectMultiple('x111', 'x112');
        tree.do.hotkey('startDrag');
        expect(canDrag).toHaveBeenCalledWith([
          tree.item('x111'),
          tree.item('x112'),
        ]);
        tree.expect.substate('dnd', undefined);
        tree.expect.substate('assistiveDndState', undefined);
      });

      it('skips positions during arrowing that have canDrop=false', () => {
        // note that, with mocked canDrop, non-folders are viable targets
        const canDrop = tree.mockedHandler('canDrop').mockReturnValue(true);
        tree.do.selectMultiple('x111');
        tree.do.hotkey('startDrag');
        tree.do.hotkey('dragDown');
        tree.do.hotkey('dragDown');
        expect(canDrop).toHaveBeenCalled();
        expectChildIndex(2);

        canDrop.mockReturnValueOnce(false);
        canDrop.mockReturnValueOnce(false);
        canDrop.mockReturnValueOnce(false);
        tree.do.hotkey('dragDown');
        expectChildIndex(4);
      });

      it('doesnt go below end of tree', () => {
        const lastState = {
          draggedItems: [tree.item('x111'), tree.item('x3')],
          dragTarget: {
            item: tree.item('x'),
            childIndex: 4,
            dragLineIndex: 20,
            dragLineLevel: 0,
            insertionIndex: 3,
          },
        };

        tree.do.selectMultiple('x111');
        tree.item('x3').setFocused();
        tree.do.hotkey('startDrag');
        tree.do.hotkey('dragDown');
        tree.do.hotkey('dragDown');
        tree.do.hotkey('dragDown');
        tree.expect.substate('dnd', lastState);
        tree.do.hotkey('dragDown');
        tree.expect.substate('dnd', lastState);
      });

      it('doesnt go above top of tree', () => {
        const firstState = {
          draggedItems: [tree.item('x111'), tree.item('x1')],
          dragTarget: {
            item: tree.item('x'),
            childIndex: 0,
            dragLineIndex: 0,
            dragLineLevel: 0,
            insertionIndex: 0,
          },
        };

        tree.do.selectMultiple('x111');
        tree.item('x1').setFocused();
        tree.do.hotkey('startDrag');
        tree.do.hotkey('dragUp');
        tree.do.hotkey('dragUp');
        tree.expect.substate('dnd', firstState);
        tree.do.hotkey('dragUp');
        tree.expect.substate('dnd', firstState);
      });
    });
  });
});
