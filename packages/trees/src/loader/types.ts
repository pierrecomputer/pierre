import type { ChildrenSortOption } from '../utils/sortChildren';

export interface DataLoaderOptions {
  flattenEmptyDirectories?: boolean;
  rootId?: string;
  rootName?: string;
  sortComparator?: ChildrenSortOption;
}

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
