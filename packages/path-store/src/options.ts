import type {
  PathStoreBuilderOptions,
  ResolvedPathStoreOptions,
} from './types';

export function resolvePathStoreOptions(
  options: PathStoreBuilderOptions = {}
): ResolvedPathStoreOptions {
  return {
    flattenEmptyDirectories: options.flattenEmptyDirectories ?? true,
    sort: options.sort ?? 'default',
  };
}
