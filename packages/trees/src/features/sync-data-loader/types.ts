import type { TreeDataLoader } from '../../loader/types';

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
