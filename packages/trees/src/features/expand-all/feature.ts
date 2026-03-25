import type { FeatureImplementation } from '../../core/types/core';

export const expandAllFeature: FeatureImplementation = {
  key: 'expand-all',

  treeInstance: {
    // oxlint-disable-next-line typescript-eslint/no-misused-promises
    expandAll: async ({ tree }, cancelToken) => {
      await Promise.all(
        // oxlint-disable-next-line typescript-eslint/no-unsafe-return
        tree.getItems().map((item) => item.expandAll(cancelToken))
      );
    },

    collapseAll: ({ tree }) => {
      tree.applySubStateUpdate('expandedItems', []);
      tree.rebuildTree();
    },
  },

  itemInstance: {
    // oxlint-disable-next-line typescript-eslint/no-misused-promises
    expandAll: async ({ tree, item }, cancelToken) => {
      if (cancelToken?.current === true) {
        return;
      }
      if (item.isFolder() !== true) {
        return;
      }

      item.expand();
      await tree.waitForItemChildrenLoaded(item.getId());
      await Promise.all(
        item.getChildren().map(async (child) => {
          await tree.waitForItemChildrenLoaded(item.getId());
          await child?.expandAll(cancelToken);
        })
      );
    },

    collapseAll: ({ item }) => {
      if (item.isExpanded() !== true) return;
      for (const child of item.getChildren()) {
        child?.collapseAll();
      }
      item.collapse();
    },
  },

  hotkeys: {
    expandSelected: {
      hotkey: 'Control+Shift+Plus',
      // oxlint-disable-next-line typescript-eslint/no-misused-promises
      handler: async (_, tree) => {
        const cancelToken = { current: false };
        const cancelHandler = (e: KeyboardEvent) => {
          if (e.code === 'Escape') {
            cancelToken.current = true;
          }
        };
        document.addEventListener('keydown', cancelHandler);
        await Promise.all(
          // oxlint-disable-next-line typescript-eslint/no-unsafe-return
          tree.getSelectedItems().map((item) => item.expandAll(cancelToken))
        );
        document.removeEventListener('keydown', cancelHandler);
      },
    },

    collapseSelected: {
      hotkey: 'Control+Shift+Minus',
      handler: (_, tree) => {
        // oxlint-disable-next-line typescript-eslint/no-unsafe-return
        tree.getSelectedItems().forEach((item) => item.collapseAll());
      },
    },
  },
};
