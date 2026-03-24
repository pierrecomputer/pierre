import { makeStateUpdater } from '@headless-tree/core';
import type { FeatureImplementation, ItemInstance } from '@headless-tree/core';

import type { FileTreeNode } from '../types';

type InputEvent = {
  target?: {
    value: string;
  };
};

export const renamingFeature: FeatureImplementation = {
  key: 'renaming',
  overwrites: ['drag-and-drop'],

  getDefaultConfig: (defaultConfig, tree) => ({
    setRenamingItem: makeStateUpdater('renamingItem', tree),
    setRenamingValue: makeStateUpdater('renamingValue', tree),
    canRename: () => true,
    ...defaultConfig,
  }),

  stateHandlerNames: {
    renamingItem: 'setRenamingItem',
    renamingValue: 'setRenamingValue',
  },

  treeInstance: {
    getRenamingItem: ({ tree }) => {
      const itemId = tree.getState().renamingItem;
      return itemId ? tree.getItemInstance(itemId) : null;
    },

    getRenamingValue: ({ tree }) => tree.getState().renamingValue ?? '',

    abortRenaming: ({ tree }) => {
      tree.applySubStateUpdate('renamingItem', null);
      tree.updateDomFocus();
    },

    completeRenaming: ({ tree }) => {
      const config = tree.getConfig();
      const item = tree.getRenamingItem();
      if (item != null) {
        config.onRename?.(item, tree.getState().renamingValue ?? '');
      }
      tree.applySubStateUpdate('renamingItem', null);
      tree.updateDomFocus();
    },

    isRenamingItem: ({ tree }) => !!tree.getState().renamingItem,
  },

  itemInstance: {
    startRenaming: ({ tree, item, itemId }) => {
      if (!item.canRename()) {
        return;
      }
      tree.applySubStateUpdate('renamingItem', itemId);
      tree.applySubStateUpdate('renamingValue', item.getItemName());
    },

    getRenameInputProps: ({ tree }) => {
      const updateRenamingValue = (e: InputEvent) => {
        tree.applySubStateUpdate('renamingValue', e.target?.value);
      };
      return {
        ref: (element: HTMLInputElement | null) => element?.focus(),
        onBlur: () => tree.abortRenaming(),
        value: tree.getRenamingValue(),
        // Preact text inputs emit `onInput` for per-keystroke updates.
        onInput: updateRenamingValue,
        onChange: updateRenamingValue,
      };
    },

    canRename: ({ tree, item }) =>
      tree.getConfig().canRename?.(item as ItemInstance<FileTreeNode>) ?? true,

    isRenaming: ({ tree, item }) =>
      item.getId() === tree.getState().renamingItem,

    getProps: ({ prev, item }) => {
      const isRenaming = item.isRenaming();
      const prevProps = prev?.() ?? {};
      if (!isRenaming) {
        return prevProps;
      }
      return {
        ...prevProps,
        draggable: false,
        onDragStart: () => {},
      };
    },
  },

  hotkeys: {
    renameItem: {
      hotkey: 'F2',
      handler: (_e, tree) => {
        tree.getFocusedItem().startRenaming();
      },
    },

    abortRenaming: {
      hotkey: 'Escape',
      allowWhenInputFocused: true,
      isEnabled: (tree) => tree.isRenamingItem(),
      handler: (_e, tree) => {
        tree.abortRenaming();
      },
    },

    completeRenaming: {
      hotkey: 'Enter',
      allowWhenInputFocused: true,
      isEnabled: (tree) => tree.isRenamingItem(),
      handler: (_e, tree) => {
        tree.completeRenaming();
      },
    },
  },
};
