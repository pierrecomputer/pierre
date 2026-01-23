import type { ChildrenComparator } from '../utils/sortChildren';

export interface DataLoaderOptions {
  flattenEmptyDirectories?: boolean;
  rootId?: string;
  rootName?: string;
  sortComparator?: ChildrenComparator;
}

export { generateLazyDataLoader } from './lazy';
export { generateSyncDataLoader } from './sync';
