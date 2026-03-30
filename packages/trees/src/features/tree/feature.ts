/* oxlint-disable typescript-eslint/no-unsafe-return, typescript-eslint/strict-boolean-expressions */
import type { FeatureImplementation } from '../../core/types/core';
import { makeStateUpdater, poll } from '../../core/utils';
import type { ItemMeta } from './types';

// oxlint-disable-next-line typescript-eslint/no-explicit-any
export const treeFeature: FeatureImplementation<any> = {
  key: 'tree',

  getInitialState: (initialState) => ({
    expandedItems: [],
    focusedItem: null,
    ...initialState,
  }),

  getDefaultConfig: (defaultConfig, tree) => ({
    setExpandedItems: makeStateUpdater('expandedItems', tree),
    setFocusedItem: makeStateUpdater('focusedItem', tree),
    ...defaultConfig,
  }),

  stateHandlerNames: {
    expandedItems: 'setExpandedItems',
    focusedItem: 'setFocusedItem',
  },

  treeInstance: {
    getItemsMeta: ({ tree }) => {
      const { rootItemId } = tree.getConfig();
      const { expandedItems } = tree.getState();
      const flatItems: ItemMeta[] = [];
      const expandedItemsSet = new Set(expandedItems); // TODO support setting state expandedItems as set instead of array
      const rootChildren = tree.retrieveChildrenIds(rootItemId) ?? [];

      // Iterative pre-order traversal avoids per-node recursive call overhead
      // on very large fully-expanded trees.
      const stack: Array<{
        itemId: string;
        parentId: string;
        level: number;
        setSize: number;
        posInSet: number;
      }> = [];

      for (
        let childIndex = rootChildren.length - 1;
        childIndex >= 0;
        childIndex--
      ) {
        const itemId = rootChildren[childIndex];
        stack.push({
          itemId,
          parentId: rootItemId,
          level: 0,
          setSize: rootChildren.length,
          posInSet: childIndex,
        });
      }

      while (stack.length > 0) {
        const current = stack.pop()!;

        flatItems.push({
          itemId: current.itemId,
          level: current.level,
          index: flatItems.length,
          parentId: current.parentId,
          setSize: current.setSize,
          posInSet: current.posInSet,
        });

        if (!expandedItemsSet.has(current.itemId)) {
          continue;
        }

        const children = tree.retrieveChildrenIds(current.itemId) ?? [];
        for (
          let childIndex = children.length - 1;
          childIndex >= 0;
          childIndex--
        ) {
          const childId = children[childIndex];
          stack.push({
            itemId: childId,
            parentId: current.itemId,
            level: current.level + 1,
            setSize: children.length,
            posInSet: childIndex,
          });
        }
      }

      return flatItems;
    },

    getFocusedItem: ({ tree }) => {
      const focusedItemId = tree.getState().focusedItem;
      // oxlint-disable-next-line typescript-eslint/no-unsafe-return
      return (
        (focusedItemId !== null ? tree.getItemInstance(focusedItemId) : null) ??
        tree.getItems()[0]
      );
    },

    getRootItem: ({ tree }) => {
      const { rootItemId } = tree.getConfig();
      // oxlint-disable-next-line typescript-eslint/no-unsafe-return
      return tree.getItemInstance(rootItemId);
    },

    focusNextItem: ({ tree }) => {
      const focused = tree.getFocusedItem().getItemMeta();
      if (focused == null) return;
      const nextIndex = Math.min(focused.index + 1, tree.getItems().length - 1);
      tree.getItems()[nextIndex]?.setFocused();
    },

    focusPreviousItem: ({ tree }) => {
      const focused = tree.getFocusedItem().getItemMeta();
      if (focused == null) return;
      const nextIndex = Math.max(focused.index - 1, 0);
      tree.getItems()[nextIndex]?.setFocused();
    },

    updateDomFocus: ({ tree }) => {
      // Required because if the state is managed outside in react, the state only updated during next render
      // oxlint-disable-next-line typescript-eslint/no-misused-promises
      setTimeout(async () => {
        const focusedItem = tree.getFocusedItem();
        tree.getConfig().scrollToItem?.(focusedItem);
        await poll(() => focusedItem.getElement() !== null, 20);
        const focusedElement = focusedItem.getElement();
        if (focusedElement == null) return;
        focusedElement.focus();
      });
    },

    // oxlint-disable-next-line typescript-eslint/no-unsafe-return
    getContainerProps: ({ prev, tree }, treeLabel) => ({
      ...prev?.(),
      role: 'tree',
      'aria-label': treeLabel ?? '',
      ref: tree.registerElement,
    }),

    // relevant for hotkeys of this feature
    isSearchOpen: () => false,
  },

  itemInstance: {
    // oxlint-disable-next-line typescript-eslint/no-misused-promises
    scrollTo: async ({ tree, item }, scrollIntoViewArg) => {
      // oxlint-disable-next-line typescript-eslint/no-explicit-any
      tree.getConfig().scrollToItem?.(item as any);
      await poll(() => item.getElement() !== null, 20);
      item.getElement()?.scrollIntoView(scrollIntoViewArg);
    },
    getId: ({ itemId }) => itemId,
    getKey: ({ itemId }) => itemId, // TODO apply to all stories to use
    // oxlint-disable-next-line typescript-eslint/no-unsafe-return
    getProps: ({ item, prev }) => {
      const itemMeta = item.getItemMeta();
      return {
        ...prev?.(),
        ref: item.registerElement,
        role: 'treeitem',
        'aria-setsize': itemMeta.setSize,
        'aria-posinset': itemMeta.posInSet + 1,
        'aria-selected': 'false',
        'aria-label': item.getItemName(),
        'aria-level': itemMeta.level + 1,
        'aria-expanded':
          item.isFolder() === true ? item.isExpanded() : undefined,
        tabIndex: item.isFocused() === true ? 0 : -1,
        onClick: (e: MouseEvent) => {
          item.setFocused();
          item.primaryAction();

          if (e.ctrlKey || e.shiftKey || e.metaKey) {
            return;
          }

          if (!item.isFolder()) {
            return;
          }

          if (item.isExpanded()) {
            item.collapse();
          } else {
            item.expand();
          }
        },
      };
    },
    expand: ({ tree, item, itemId }) => {
      if (!item.isFolder()) {
        return;
      }

      if (tree.getState().loadingItemChildrens?.includes(itemId) === true) {
        return;
      }

      tree.applySubStateUpdate('expandedItems', (expandedItems) => [
        ...expandedItems,
        itemId,
      ]);
      tree.rebuildTree();
    },
    collapse: ({ tree, item, itemId }) => {
      if (!item.isFolder()) {
        return;
      }

      tree.applySubStateUpdate('expandedItems', (expandedItems) =>
        expandedItems.filter((id) => id !== itemId)
      );
      tree.rebuildTree();
    },
    getItemData: ({ tree, itemId }) => tree.retrieveItemData(itemId),
    equals: ({ item }, other) => item.getId() === other?.getId(),
    isExpanded: ({ tree, itemId }) =>
      tree.getState().expandedItems.includes(itemId),
    isDescendentOf: ({ item }, parentId) => {
      const parent = item.getParent();
      return Boolean(
        parent?.getId() === parentId || parent?.isDescendentOf(parentId)
      );
    },
    isFocused: ({ tree, item, itemId }) =>
      tree.getState().focusedItem === itemId ||
      (tree.getState().focusedItem === null && item.getItemMeta().index === 0),
    isFolder: ({ tree, item, itemId }) =>
      itemId === tree.getConfig().rootItemId ||
      tree.getConfig().isItemFolder(item),
    getItemName: ({ tree, item }) => {
      const config = tree.getConfig();
      return config.getItemName(item);
    },
    setFocused: ({ tree, itemId }) => {
      tree.applySubStateUpdate('focusedItem', itemId);
    },
    primaryAction: ({ tree, item }) => tree.getConfig().onPrimaryAction?.(item),
    getParent: ({ tree, item }) => {
      const { parentId } = item.getItemMeta();
      return parentId != null ? tree.getItemInstance(parentId) : undefined;
    },
    getIndexInParent: ({ item }) => item.getItemMeta().posInSet,
    getChildren: ({ tree, itemId }) =>
      tree.retrieveChildrenIds(itemId).map((id) => tree.getItemInstance(id)),
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    getTree: ({ tree }) => tree as any,
    getItemAbove: ({ tree, item }) =>
      tree.getItems()[item.getItemMeta().index - 1],
    getItemBelow: ({ tree, item }) =>
      tree.getItems()[item.getItemMeta().index + 1],
  },

  hotkeys: {
    focusNextItem: {
      hotkey: 'ArrowDown',
      canRepeat: true,
      preventDefault: true,
      isEnabled: (tree) =>
        !(tree.isSearchOpen?.() ?? false) && tree.getState().dnd == null, // TODO what happens when the feature doesnt exist? proxy method still claims to exist
      handler: (e, tree) => {
        tree.focusNextItem();
        tree.updateDomFocus();
      },
    },
    focusPreviousItem: {
      hotkey: 'ArrowUp',
      canRepeat: true,
      preventDefault: true,
      isEnabled: (tree) =>
        !(tree.isSearchOpen?.() ?? false) && tree.getState().dnd == null,
      handler: (e, tree) => {
        tree.focusPreviousItem();
        tree.updateDomFocus();
      },
    },
    expandOrDown: {
      hotkey: 'ArrowRight',
      canRepeat: true,
      handler: (e, tree) => {
        const item = tree.getFocusedItem();
        if (item.isExpanded() || !item.isFolder()) {
          tree.focusNextItem();
          tree.updateDomFocus();
        } else {
          item.expand();
        }
      },
    },
    collapseOrUp: {
      hotkey: 'ArrowLeft',
      canRepeat: true,
      handler: (e, tree) => {
        const item = tree.getFocusedItem();
        if (
          (!item.isExpanded() || !item.isFolder()) &&
          item.getItemMeta().level !== 0
        ) {
          item.getParent()?.setFocused();
          tree.updateDomFocus();
        } else {
          item.collapse();
        }
      },
    },
    focusFirstItem: {
      hotkey: 'Home',
      handler: (e, tree) => {
        tree.getItems()[0]?.setFocused();
        tree.updateDomFocus();
      },
    },
    focusLastItem: {
      hotkey: 'End',
      handler: (e, tree) => {
        tree.getItems()[tree.getItems().length - 1]?.setFocused();
        tree.updateDomFocus();
      },
    },
  },
};
