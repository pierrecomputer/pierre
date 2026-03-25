import type { ChildrenSortOption } from '../utils/sortChildren';

export interface DataLoaderOptions {
  flattenEmptyDirectories?: boolean;
  rootId?: string;
  rootName?: string;
  sortComparator?: ChildrenSortOption;
}

export { generateLazyDataLoader } from './lazy';
export { generateSyncDataLoader } from './sync';
export { syncDataLoaderFeature } from './sync-data-loader-feature';
export { asyncDataLoaderFeature } from './async-data-loader-feature';
export type {
  TreeDataLoader,
  SyncDataLoaderFeatureDef,
  AsyncDataLoaderFeatureDef,
  AsyncDataLoaderDataRef,
} from './types';
