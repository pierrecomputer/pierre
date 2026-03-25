/* oxlint-disable typescript-eslint/no-unsafe-return, typescript-eslint/strict-boolean-expressions */
import type { FeatureImplementation } from '../../core/types/core';
import { makeStateUpdater } from '../../core/utils';
import type { SelectionDataRef } from './types';

export const selectionFeature: FeatureImplementation = {
  key: 'selection',

  getInitialState: (initialState) => ({
    selectedItems: [],
    ...initialState,
  }),

  getDefaultConfig: (defaultConfig, tree) => ({
    setSelectedItems: makeStateUpdater('selectedItems', tree),
    ...defaultConfig,
  }),

  stateHandlerNames: {
    selectedItems: 'setSelectedItems',
  },

  treeInstance: {
    setSelectedItems: ({ tree }, selectedItems) => {
      tree.applySubStateUpdate('selectedItems', selectedItems);
    },

    getSelectedItems: ({ tree }) => {
      return tree.getState().selectedItems.map(tree.getItemInstance);
    },
  },

  itemInstance: {
    select: ({ tree, itemId }) => {
      const { selectedItems } = tree.getState();
      tree.setSelectedItems(
        selectedItems.includes(itemId)
          ? selectedItems
          : [...selectedItems, itemId]
      );
    },

    deselect: ({ tree, itemId }) => {
      const { selectedItems } = tree.getState();
      tree.setSelectedItems(selectedItems.filter((id) => id !== itemId));
    },

    isSelected: ({ tree, itemId }) => {
      const { selectedItems } = tree.getState();
      return selectedItems.includes(itemId);
    },

    selectUpTo: ({ tree, item, itemId }, ctrl: boolean) => {
      const indexA = item.getItemMeta().index;
      const dataRef = tree.getDataRef<SelectionDataRef>();

      if (!dataRef.current.selectUpToAnchorId) {
        dataRef.current.selectUpToAnchorId = itemId;
        tree.setSelectedItems([itemId]);
        return;
      }

      const itemB = tree.getItemInstance(dataRef.current.selectUpToAnchorId);
      const indexB = itemB.getItemMeta().index;
      const [a, b] = indexA < indexB ? [indexA, indexB] : [indexB, indexA];
      const newSelectedItems = tree
        .getItems()
        .slice(a, b + 1)
        .map((treeItem) => treeItem.getItemMeta().itemId);

      if (!ctrl) {
        tree.setSelectedItems(newSelectedItems);
        return;
      }

      const { selectedItems } = tree.getState();
      const uniqueSelectedItems = [
        ...new Set([...selectedItems, ...newSelectedItems]),
      ];
      tree.setSelectedItems(uniqueSelectedItems);
    },

    toggleSelect: ({ item }) => {
      if (item.isSelected()) {
        item.deselect();
      } else {
        item.select();
      }
    },

    getProps: ({ tree, item, itemId, prev }) => ({
      ...prev?.(),
      'aria-selected': item.isSelected() ? 'true' : 'false',
      onClick: (e: MouseEvent) => {
        if (e.shiftKey) {
          item.selectUpTo(e.ctrlKey || e.metaKey);
        } else if (e.ctrlKey || e.metaKey) {
          item.toggleSelect();
        } else {
          tree.setSelectedItems([itemId]);
        }

        if (!e.shiftKey) {
          tree.getDataRef<SelectionDataRef>().current.selectUpToAnchorId =
            itemId;
        }

        prev?.()?.onClick?.(e);
      },
    }),
  },

  hotkeys: {
    // setSelectedItem: {
    //   hotkey: "space",
    //   handler: (e, tree) => {
    //     tree.setSelectedItems([tree.getFocusedItem().getId()]);
    //   },
    // },
    toggleSelectedItem: {
      hotkey: 'Control+Space',
      preventDefault: true,
      handler: (_, tree) => {
        tree.getFocusedItem().toggleSelect();
      },
    },
    selectUpwards: {
      hotkey: 'Shift+ArrowUp',
      handler: (e, tree) => {
        const focused = tree.getFocusedItem();
        const above = focused.getItemAbove();
        if (above == null) return;

        if (focused.isSelected() && above.isSelected()) {
          focused.deselect();
        } else {
          above.select();
        }

        above.setFocused();
        tree.updateDomFocus();
      },
    },
    selectDownwards: {
      hotkey: 'Shift+ArrowDown',
      handler: (e, tree) => {
        const focused = tree.getFocusedItem();
        const below = focused.getItemBelow();
        if (below == null) return;

        if (focused.isSelected() && below.isSelected()) {
          focused.deselect();
        } else {
          below.select();
        }

        below.setFocused();
        tree.updateDomFocus();
      },
    },
    selectAll: {
      hotkey: 'Control+KeyA',
      preventDefault: true,
      handler: (e, tree) => {
        tree.setSelectedItems(tree.getItems().map((item) => item.getId()));
      },
    },
  },
};
