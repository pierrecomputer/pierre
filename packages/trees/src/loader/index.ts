import type { ChildrenSortOption } from '../utils/sortChildren';

export interface DataLoaderOptions {
  flattenEmptyDirectories?: boolean;
  rootId?: string;
  rootName?: string;
  sortComparator?: ChildrenSortOption;
}

export { generateLazyDataLoader } from './lazy';
export { generateSyncDataLoader } from './sync';
