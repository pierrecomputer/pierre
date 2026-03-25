import type { SetStateFn } from '../core/types/core';

export type TreeDataLoader<T> =
  | {
      getItem: (itemId: string) => T | Promise<T>;
      getChildren: (itemId: string) => string[] | Promise<string[]>;
    }
  | {
      getItem: (itemId: string) => T | Promise<T>;
      getChildrenWithData: (
        itemId: string
      ) => { id: string; data: T }[] | Promise<{ id: string; data: T }[]>;
    };

export type SyncDataLoaderFeatureDef<T> = {
  state: {};
  config: {
    rootItemId: string;
    dataLoader: TreeDataLoader<T>;
  };
  treeInstance: {
    retrieveItemData: (itemId: string) => T;

    /** Retrieve children Ids. If an async data loader is used, skipFetch is set to true, and children have not been retrieved
     * yet for this item, this will initiate fetching the children, and return an empty array. Once the children have loaded,
     * a rerender will be triggered.
     * @param skipFetch - Defaults to false.
     */
    retrieveChildrenIds: (itemId: string, skipFetch?: boolean) => string[];
  };
  itemInstance: {
    /** Returns false. Provided for consistency with async data loader */
    isLoading: () => boolean;
    /** Returns true. Provided for consistency with async data loader */
    hasLoadedData: () => boolean;
  };
  hotkeys: never;
};

// oxlint-disable-next-line typescript-eslint/no-explicit-any
export interface AsyncDataLoaderDataRef<T = any> {
  itemData: Record<string, T>;
  childrenIds: Record<string, string[]>;

  // If an item load is requested while it is already loading, we reuse the existing load promise
  // and store callbacks to be called when the load completes
  loadingDataSubs: Record<string, (() => void)[]>;
  loadingChildrenSubs: Record<string, (() => void)[]>;
}

export type AsyncDataLoaderFeatureDef<T> = {
  state: {
    loadingItemData: string[];
    loadingItemChildrens: string[];
  };
  config: {
    rootItemId: string;

    /** Will be called when HT retrieves item data for an item whose item data is asynchronously being loaded.
     * Can be used to create placeholder data to use for rendering the tree item while it is loaded. If not defined,
     * the tree item data will be null. */
    createLoadingItemData?: () => T;

    setLoadingItemData?: SetStateFn<string[]>;
    setLoadingItemChildrens?: SetStateFn<string[]>;
    onLoadedItem?: (itemId: string, item: T) => void;
    onLoadedChildren?: (itemId: string, childrenIds: string[]) => void;
  };
  treeInstance: SyncDataLoaderFeatureDef<T>['treeInstance'] & {
    /** @deprecated use loadItemData instead */
    waitForItemDataLoaded: (itemId: string) => Promise<void>;
    /** @deprecated use loadChildrenIds instead */
    waitForItemChildrenLoaded: (itemId: string) => Promise<void>;
    loadItemData: (itemId: string) => Promise<T>;
    loadChildrenIds: (itemId: string) => Promise<string[]>;
  };
  itemInstance: SyncDataLoaderFeatureDef<T>['itemInstance'] & {
    /** Invalidate fetched data for item, and triggers a refetch and subsequent rerender if the item is visible
     * @param optimistic If true, the item will not trigger a state update on `loadingItemData`, and
     * the tree will continue to display the old data until the new data has loaded. */
    invalidateItemData: (optimistic?: boolean) => Promise<void>;

    /** Invalidate fetched children ids for item, and triggers a refetch and subsequent rerender if the item is visible
     * @param optimistic If true, the item will not trigger a state update on `loadingItemChildrens`, and
     * the tree will continue to display the old data until the new data has loaded. */
    invalidateChildrenIds: (optimistic?: boolean) => Promise<void>;

    /** Set to undefined to clear cache without triggering automatic refetch. Use @invalidateItemData to clear and triggering refetch. */
    updateCachedData: (data: T | undefined) => void;
    updateCachedChildrenIds: (childrenIds: string[]) => void;
    hasLoadedData: () => boolean;
    isLoading: () => boolean;
  };
  hotkeys: SyncDataLoaderFeatureDef<T>['hotkeys'];
};
