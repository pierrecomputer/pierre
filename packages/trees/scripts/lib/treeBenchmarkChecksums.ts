import type { TreeInstance } from '../../src/core/types/core';
import type { FileTreeData } from '../../src/types';

export function checksumFileTreeData(tree: FileTreeData): number {
  let checksum = 0;

  for (const [id, node] of Object.entries(tree)) {
    checksum += id.length;
    checksum += node.name.length;
    checksum += node.path.length;

    if (node.children != null) {
      checksum += node.children.direct.length;
      for (const child of node.children.direct) {
        checksum += child.length;
      }
      if (node.children.flattened != null) {
        checksum += node.children.flattened.length;
        for (const child of node.children.flattened) {
          checksum += child.length;
        }
      }
    }

    if (node.flattens != null) {
      checksum += node.flattens.length;
      for (const path of node.flattens) {
        checksum += path.length;
      }
    }
  }

  return checksum;
}

// Computes a deterministic signature of the flattened item list produced by
// rebuildTree so benchmark runs can detect accidental behavior drift.
export function checksumTreeItems<T>(tree: TreeInstance<T>): number {
  const items = tree.getItems();
  let checksum = items.length;

  for (const item of items) {
    const itemId = item.getId();
    const itemMeta = item.getItemMeta();

    checksum += itemId.length;
    checksum += itemMeta.level;
    checksum += itemMeta.index;
    checksum += itemMeta.posInSet;
    checksum += itemMeta.setSize;

    if (itemMeta.parentId != null) {
      checksum += itemMeta.parentId.length;
    }
  }

  return checksum;
}

// Captures lightweight state/config signals after createTree so the benchmark
// can verify deterministic construction without measuring rebuild work.
export function checksumCreateTreeState<T>(tree: TreeInstance<T>): number {
  const state = tree.getState();
  const config = tree.getConfig();

  let checksum = config.rootItemId.length;
  checksum += state.expandedItems.length;
  checksum += state.focusedItem?.length ?? 0;
  checksum += Object.keys(tree.getHotkeyPresets()).length;

  return checksum;
}
