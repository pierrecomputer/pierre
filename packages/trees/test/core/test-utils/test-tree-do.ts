import { expect, mock } from 'bun:test';

import type { HotkeyName } from '../../../src/core/types/core';
import type { HotkeyConfig } from '../../../src/features/hotkeys-core/types';
import type { TestTree as TestTreeType } from './test-tree';

export class TestTreeDo<T = string> {
  protected itemInstance(itemId: string) {
    // oxlint-disable-next-line typescript-eslint/no-unsafe-return
    return this.tree.instance.getItemInstance(itemId);
  }

  protected itemProps(itemId: string) {
    // oxlint-disable-next-line typescript-eslint/no-unsafe-return
    return this.itemInstance(itemId).getProps();
  }

  constructor(protected tree: TestTreeType<T>) {}

  selectItem(id: string) {
    this.itemProps(id).onClick({});
  }

  shiftSelectItem(id: string) {
    this.itemProps(id).onClick({ shiftKey: true });
  }

  ctrlSelectItem(id: string) {
    this.itemProps(id).onClick({ ctrlKey: true });
  }

  ctrlShiftSelectItem(id: string) {
    this.itemProps(id).onClick({ shiftKey: true, ctrlKey: true });
  }

  selectMultiple(...ids: string[]) {
    ids.forEach((id) => this.ctrlSelectItem(id));
  }

  hotkey(hotkey: HotkeyName, e: Partial<KeyboardEvent> = {}) {
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    const hotkeyConfig: HotkeyConfig<any> = {
      ...this.tree.instance.getHotkeyPresets()[hotkey],
      ...this.tree.instance.getConfig().hotkeys?.[hotkey],
    };
    if (
      hotkeyConfig.isEnabled != null &&
      !hotkeyConfig.isEnabled(this.tree.instance)
    ) {
      throw new Error(`Hotkey "${hotkey}" is disabled`);
    }
    if (hotkeyConfig.handler == null) {
      throw new Error(`Hotkey "${hotkey}" has no handler`);
    }
    hotkeyConfig.handler(
      {
        ...e,
        stopPropagation: () => {},
        preventDefault: () => {},
        // oxlint-disable-next-line typescript-eslint/no-explicit-any
      } as any,
      this.tree.instance
    );
  }

  startDrag(itemId: string, event?: DragEvent) {
    if (this.itemProps(itemId).draggable !== true) {
      throw new Error(
        `Can't drag item ${itemId}, has attribute draggable=false`
      );
    }

    const e = event ?? TestTree.dragEvent();
    this.itemProps(itemId).onDragStart(e);
    return e;
  }

  dragOver(itemId: string, event?: DragEvent) {
    const e = event ?? TestTree.dragEvent();
    (e.preventDefault as ReturnType<typeof mock>).mockClear();
    this.itemProps(itemId).onDragOver(e);
    this.itemProps(itemId).onDragOver(e);
    this.itemProps(itemId).onDragOver(e);
    expect(e.preventDefault).toHaveBeenCalledTimes(3);

    this.consistentCalls(e.preventDefault);
    this.consistentCalls(e.stopPropagation);
    return e;
  }

  dragLeave(itemId: string) {
    this.itemProps(itemId).onDragLeave({});
  }

  dragEnd(itemId: string, event?: DragEvent) {
    const e = event ?? TestTree.dragEvent();
    this.itemProps(itemId).onDragEnd(e);
    window.dispatchEvent(new CustomEvent('dragend'));
    return e;
  }

  async drop(itemId: string, event?: DragEvent) {
    const e = event ?? TestTree.dragEvent();
    await this.itemProps(itemId).onDrop(e);
    window.dispatchEvent(new CustomEvent('dragend'));
    return e;
  }

  async dragOverAndDrop(itemId: string, event?: DragEvent) {
    const e = event ?? TestTree.dragEvent();
    this.dragOver(itemId, e);
    return this.drop(itemId, e);
  }

  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  private consistentCalls(fn: any) {
    if (fn == null || !('mock' in fn)) {
      throw new Error('fn is not a mock');
    }
    expect(
      fn.mock.calls.length,
      'function called inconsistent times'
    ).toBeOneOf([0, 3]);
    expect(
      // oxlint-disable-next-line typescript-eslint/no-explicit-any
      new Set(fn.mock.calls.map((call: any[]) => call.join('__'))).size,
      'function called with inconsistent parameters'
    ).toBeOneOf([0, 1]);
  }

  async awaitNextTick() {
    await new Promise((r) => {
      setTimeout(r);
    });
  }
}

// Lazy import to avoid circular dependency at module level
import { TestTree } from './test-tree';
