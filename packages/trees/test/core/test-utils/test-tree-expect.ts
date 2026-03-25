import { expect, mock } from 'bun:test';

import type { TreeState } from '../../../src/core/types/core';
import type { DragTarget } from '../../../src/features/drag-and-drop/types';
import type { TestTree as TestTreeType } from './test-tree';

export class TestTreeExpect<T> {
  protected itemInstance(itemId: string) {
    // oxlint-disable-next-line typescript-eslint/no-unsafe-return
    return this.tree.instance.getItemInstance(itemId);
  }

  protected itemProps(itemId: string) {
    // oxlint-disable-next-line typescript-eslint/no-unsafe-return
    return this.itemInstance(itemId).getProps();
  }

  constructor(private tree: TestTreeType<T>) {}

  foldersExpanded(...itemIds: string[]) {
    for (const itemId of itemIds) {
      expect(
        this.tree.instance.getItemInstance(itemId).isExpanded(),
        `Expected ${itemId} to be expanded`
      ).toBe(true);
    }
  }

  foldersCollapsed(...itemIds: string[]) {
    for (const itemId of itemIds) {
      expect(
        this.tree.instance.getItemInstance(itemId).isExpanded(),
        `Expected ${itemId} to be collapsed`
      ).toBe(false);
    }
  }

  hasChildren(itemId: string, children: string[]) {
    const item = this.tree.instance.getItemInstance(itemId);
    // oxlint-disable-next-line typescript-eslint/no-unsafe-return
    const itemChildren = item.getChildren().map((child) => child.getId());
    expect(itemChildren).toEqual(children);
  }

  /**
   * Asserts a substate value. For 'dnd' state, uses ID-based comparison
   * for ItemInstance objects to avoid circular reference issues.
   */
  substate<K extends keyof TreeState<T>>(key: K, value: TreeState<T>[K]) {
    const actual = this.tree.instance.getState()[key];

    // For dnd state, we need special handling due to ItemInstance circular refs
    if (key === 'dnd' && actual != null && value != null) {
      // oxlint-disable-next-line typescript-eslint/no-explicit-any
      const actualDnd = actual as any;
      // oxlint-disable-next-line typescript-eslint/no-explicit-any
      const expectedDnd = value as any;

      // Compare draggedItems by ID
      if (expectedDnd.draggedItems !== undefined) {
        if (expectedDnd.draggedItems === undefined) {
          expect(actualDnd.draggedItems).toBeUndefined();
        } else {
          // oxlint-disable-next-line typescript-eslint/no-unsafe-return, typescript-eslint/no-explicit-any
          const actualIds = actualDnd.draggedItems?.map((i: any) => i.getId());
          const expectedIds = expectedDnd.draggedItems?.map(
            // oxlint-disable-next-line typescript-eslint/no-unsafe-return, typescript-eslint/no-explicit-any
            (i: any) => i.getId()
          );
          expect(actualIds).toEqual(expectedIds);
        }
      }

      // Compare dragTarget
      if (expectedDnd.dragTarget !== undefined) {
        const actualTarget = actualDnd.dragTarget;
        const expectedTarget = expectedDnd.dragTarget;

        if (expectedTarget?.item != null) {
          expect(actualTarget?.item?.getId()).toBe(expectedTarget.item.getId());
          // Compare non-item properties
          const { item: _eI, ...expectedRest } = expectedTarget;
          const { item: _aI, ...actualRest } = actualTarget;
          if (Object.keys(expectedRest).length > 0) {
            expect(actualRest).toEqual(expectedRest);
          }
        } else {
          expect(actualTarget).toEqual(expectedTarget);
        }
      }

      // Compare draggingOverItem by ID if present
      if (expectedDnd.draggingOverItem !== undefined) {
        expect(actualDnd.draggingOverItem?.getId()).toBe(
          expectedDnd.draggingOverItem?.getId()
        );
      }

      return;
    }

    expect(actual).toEqual(value);
  }

  /**
   * Asserts that onDrop was called with the given dragged item IDs and target.
   * Compares ItemInstance objects by ID to avoid deep equality issues with
   * circular references in ItemInstance (getTree(), getParent(), etc.).
   */
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  dropped(draggedItems: string[], target: DragTarget<any>) {
    const onDrop = this.tree.instance.getConfig().onDrop as ReturnType<
      typeof mock
    >;
    expect(onDrop).toHaveBeenCalled();

    // Find the matching call by dragged item IDs
    const lastCall = onDrop.mock.calls[onDrop.mock.calls.length - 1];
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    const actualDraggedItems = lastCall[0] as any[];
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    const actualTarget = lastCall[1] as DragTarget<any>;

    // Compare dragged items by ID
    // oxlint-disable-next-line typescript-eslint/no-unsafe-return, typescript-eslint/no-explicit-any
    const actualIds = actualDraggedItems.map((item: any) => item.getId());
    expect(actualIds).toEqual(draggedItems);

    // Compare target: check item by ID, then other properties
    if ('item' in target && target.item != null) {
      // oxlint-disable-next-line typescript-eslint/no-explicit-any
      const expectedItemId = (target.item as any).getId();
      // oxlint-disable-next-line typescript-eslint/no-explicit-any
      const actualItemId = (actualTarget as any).item?.getId();
      expect(actualItemId).toBe(expectedItemId);

      // Check other target properties (excluding item)
      // oxlint-disable-next-line typescript-eslint/no-explicit-any
      const { item: _expectedItem, ...expectedRest } = target as any;
      // oxlint-disable-next-line typescript-eslint/no-explicit-any
      const { item: _actualItem, ...actualRest } = actualTarget as any;
      if (Object.keys(expectedRest).length > 0) {
        expect(actualRest).toEqual(expectedRest);
      }
    } else {
      expect(actualTarget).toEqual(target);
    }
  }

  dragOverNotAllowed(itemId: string, event?: DragEvent) {
    const e = event ?? TestTree.dragEvent();
    (e.preventDefault as ReturnType<typeof mock>).mockClear();
    this.itemProps(itemId).onDragOver(e);
    this.itemProps(itemId).onDragOver(e);
    this.itemProps(itemId).onDragOver(e);
    expect(
      e.preventDefault,
      "onDragOver shouldn't call e.preventDefault if drag is not allowed"
    ).not.toHaveBeenCalled();

    // Track call count before drop to check no new calls happen
    const onDrop = this.tree.instance.getConfig().onDrop as ReturnType<
      typeof mock
    >;
    const callCountBefore = onDrop?.mock?.calls?.length ?? 0;

    this.itemProps(itemId).onDrop(e);
    expect(
      e.preventDefault,
      "onDrop shouldn't call e.preventDefault if drag is not allowed"
    ).not.toHaveBeenCalled();

    const callCountAfter = onDrop?.mock?.calls?.length ?? 0;
    expect(
      callCountAfter,
      "onDrop handler shouldn't be called if drag is not allowed"
    ).toBe(callCountBefore);
    return e;
  }

  defaultDragLineProps(indent = 0) {
    expect(this.tree.instance.getDragLineData()).toEqual({
      indent,
      left: indent * 20,
      width: 100 - indent * 20,
      top: 0,
    });
    expect(this.tree.instance.getDragLineStyle(0, 0)).toEqual({
      position: 'absolute',
      left: `${indent * 20}px`,
      pointerEvents: 'none',
      top: '0px',
      width: `${100 - indent * 20}px`,
    });
  }
}

// Lazy import to avoid circular dependency at module level
import { TestTree } from './test-tree';
