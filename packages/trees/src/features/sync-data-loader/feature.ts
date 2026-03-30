import type { FeatureImplementation } from '../../core/types/core';
import { throwError } from '../../core/utilities/errors';
import { makeStateUpdater } from '../../core/utils';

const undefErrorMessage = 'sync dataLoader returned undefined';
const promiseErrorMessage = 'sync dataLoader returned promise';
const unpromise = <T>(data: T | Promise<T>): T => {
  if (data == null) {
    throw throwError(undefErrorMessage);
  }
  if (typeof data === 'object' && 'then' in data) {
    throw throwError(promiseErrorMessage);
  }
  return data;
};

export const syncDataLoaderFeature: FeatureImplementation = {
  key: 'sync-data-loader',

  getInitialState: (initialState) => ({
    loadingItemData: [],
    loadingItemChildrens: [],
    ...initialState,
  }),

  getDefaultConfig: (defaultConfig, tree) => ({
    setLoadingItemData: makeStateUpdater('loadingItemData', tree),
    setLoadingItemChildrens: makeStateUpdater('loadingItemChildrens', tree),
    ...defaultConfig,
  }),

  stateHandlerNames: {
    loadingItemData: 'setLoadingItemData',
    loadingItemChildrens: 'setLoadingItemChildrens',
  },

  treeInstance: {
    // oxlint-disable-next-line typescript-eslint/no-misused-promises
    waitForItemDataLoaded: async () => {},
    // oxlint-disable-next-line typescript-eslint/no-misused-promises
    waitForItemChildrenLoaded: async () => {},

    retrieveItemData: ({ tree }, itemId) => {
      // oxlint-disable-next-line typescript-eslint/no-unsafe-return
      return unpromise(tree.getConfig().dataLoader.getItem(itemId));
    },

    retrieveChildrenIds: ({ tree }, itemId) => {
      const { dataLoader } = tree.getConfig();
      if ('getChildren' in dataLoader) {
        // oxlint-disable-next-line typescript-eslint/no-unsafe-return
        return unpromise(dataLoader.getChildren(itemId));
      }
      // oxlint-disable-next-line typescript-eslint/no-unsafe-return
      return unpromise(dataLoader.getChildrenWithData(itemId)).map(
        // oxlint-disable-next-line typescript-eslint/no-unsafe-return
        (c) => c.data
      );
    },

    // oxlint-disable-next-line typescript-eslint/no-unsafe-return
    loadItemData: ({ tree }, itemId) => tree.retrieveItemData(itemId),
    // oxlint-disable-next-line typescript-eslint/no-unsafe-return
    loadChildrenIds: ({ tree }, itemId) => tree.retrieveChildrenIds(itemId),
  },

  itemInstance: {
    isLoading: () => false,
    hasLoadedData: () => true,
  },
};
