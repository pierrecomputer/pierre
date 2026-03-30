/* oxlint-disable typescript-eslint/no-unsafe-return, typescript-eslint/strict-boolean-expressions, typescript-eslint/no-misused-promises */
import type {
  FeatureImplementation,
  TreeInstance,
} from '../../core/types/core';
import { makeStateUpdater } from '../../core/utils';
import type { AsyncDataLoaderDataRef } from './types';

const getDataRef = <T>(tree: TreeInstance<T>) => {
  const dataRef = tree.getDataRef<AsyncDataLoaderDataRef>();
  dataRef.current.itemData ??= {};
  dataRef.current.childrenIds ??= {};
  dataRef.current.loadingDataSubs ??= {};
  dataRef.current.loadingChildrenSubs ??= {};
  return dataRef;
};

const loadItemData = async <T>(tree: TreeInstance<T>, itemId: string) => {
  const config = tree.getConfig();
  const dataRef = getDataRef(tree);

  if (tree.getState().loadingItemData.includes(itemId)) {
    return new Promise<T>((resolve) => {
      dataRef.current.loadingDataSubs[itemId] ??= [];
      dataRef.current.loadingDataSubs[itemId].push(() => {
        resolve(dataRef.current.itemData[itemId]);
      });
    });
  }

  if (dataRef.current.itemData[itemId] == null) {
    tree.applySubStateUpdate('loadingItemData', (loadingItemData) => [
      ...loadingItemData,
      itemId,
    ]);
  }

  const item = await config.dataLoader.getItem(itemId);
  dataRef.current.itemData[itemId] = item;
  config.onLoadedItem?.(itemId, item);
  tree.applySubStateUpdate('loadingItemData', (loadingItemData) =>
    loadingItemData.filter((id) => id !== itemId)
  );
  dataRef.current.loadingDataSubs[itemId]?.forEach((cb) => cb());

  return item;
};

const loadChildrenIds = async <T>(tree: TreeInstance<T>, itemId: string) => {
  const config = tree.getConfig();
  const dataRef = getDataRef(tree);
  let childrenIds: string[];

  if (tree.getState().loadingItemChildrens.includes(itemId)) {
    return new Promise<string[]>((resolve) => {
      dataRef.current.loadingChildrenSubs[itemId] ??= [];
      dataRef.current.loadingChildrenSubs[itemId].push(() => {
        resolve(dataRef.current.childrenIds[itemId]);
      });
    });
  }

  if (dataRef.current.childrenIds[itemId] == null) {
    tree.applySubStateUpdate('loadingItemChildrens', (loadingItemChildrens) => [
      ...loadingItemChildrens,
      itemId,
    ]);
  }

  if ('getChildrenWithData' in config.dataLoader) {
    const children = await config.dataLoader.getChildrenWithData(itemId);
    childrenIds = children.map((c) => c.id);
    dataRef.current.childrenIds[itemId] = childrenIds;
    children.forEach(({ id, data }) => {
      dataRef.current.itemData[id] = data;
      config.onLoadedItem?.(id, data);
    });

    config.onLoadedChildren?.(itemId, childrenIds);
    tree.rebuildTree();
    tree.applySubStateUpdate('loadingItemData', (loadingItemData) =>
      loadingItemData.filter((id) => !childrenIds.includes(id))
    );
  } else {
    childrenIds = await config.dataLoader.getChildren(itemId);
    dataRef.current.childrenIds[itemId] = childrenIds;
    config.onLoadedChildren?.(itemId, childrenIds);
    tree.rebuildTree();
  }

  tree.applySubStateUpdate('loadingItemChildrens', (loadingItemChildrens) =>
    loadingItemChildrens.filter((id) => id !== itemId)
  );
  dataRef.current.loadingChildrenSubs[itemId]?.forEach((cb) => cb());

  return childrenIds;
};

export const asyncDataLoaderFeature: FeatureImplementation = {
  key: 'async-data-loader',

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
    waitForItemDataLoaded: ({ tree }, itemId) => tree.loadItemData(itemId),

    waitForItemChildrenLoaded: ({ tree }, itemId) =>
      tree.loadChildrenIds(itemId),

    loadItemData: async ({ tree }, itemId) => {
      return (
        getDataRef(tree).current.itemData[itemId] ??
        (await loadItemData(tree, itemId))
      );
    },
    loadChildrenIds: async ({ tree }, itemId) => {
      return (
        getDataRef(tree).current.childrenIds[itemId] ??
        (await loadChildrenIds(tree, itemId))
      );
    },

    retrieveItemData: ({ tree }, itemId, skipFetch = false) => {
      const config = tree.getConfig();
      const dataRef = getDataRef(tree);

      if (dataRef.current.itemData[itemId] != null) {
        return dataRef.current.itemData[itemId];
      }

      if (
        !tree.getState().loadingItemData.includes(itemId) &&
        skipFetch !== true
      ) {
        setTimeout(() => void loadItemData(tree, itemId));
      }

      return config.createLoadingItemData?.() ?? null;
    },

    retrieveChildrenIds: ({ tree }, itemId, skipFetch = false) => {
      const dataRef = getDataRef(tree);
      if (dataRef.current.childrenIds[itemId] != null) {
        return dataRef.current.childrenIds[itemId];
      }

      if (
        tree.getState().loadingItemChildrens.includes(itemId) ||
        skipFetch === true
      ) {
        return [];
      }

      setTimeout(() => void loadChildrenIds(tree, itemId));

      return [];
    },
  },

  itemInstance: {
    isLoading: ({ tree, item }) =>
      tree.getState().loadingItemData.includes(item.getItemMeta().itemId) ||
      tree.getState().loadingItemChildrens.includes(item.getItemMeta().itemId),
    // oxlint-disable-next-line typescript-eslint/no-misused-promises
    invalidateItemData: async ({ tree, itemId }, optimistic) => {
      if (optimistic !== true) {
        delete getDataRef(tree).current.itemData?.[itemId];
      }
      await loadItemData(tree, itemId);
    },
    // oxlint-disable-next-line typescript-eslint/no-misused-promises
    invalidateChildrenIds: async ({ tree, itemId }, optimistic) => {
      if (optimistic !== true) {
        delete getDataRef(tree).current.childrenIds?.[itemId];
      }
      await loadChildrenIds(tree, itemId);
    },
    updateCachedChildrenIds: ({ tree, itemId }, childrenIds) => {
      const dataRef = tree.getDataRef<AsyncDataLoaderDataRef>();
      dataRef.current.childrenIds[itemId] = childrenIds;
      tree.rebuildTree();
    },
    updateCachedData: ({ tree, itemId }, data) => {
      const dataRef = tree.getDataRef<AsyncDataLoaderDataRef>();
      dataRef.current.itemData[itemId] = data;
      tree.rebuildTree();
    },
    hasLoadedData: ({ tree, itemId }) => {
      const dataRef = tree.getDataRef<AsyncDataLoaderDataRef>();
      return dataRef.current.itemData[itemId] !== undefined;
    },
  },
};
