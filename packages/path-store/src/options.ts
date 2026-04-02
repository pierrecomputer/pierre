import type { ResolvedPathStoreOptions } from './internal-types';
import type { PathStoreOptions } from './public-types';

export function resolvePathStoreOptions(
  options: PathStoreOptions = {}
): ResolvedPathStoreOptions {
  if (options.flattenEmptyDirectories === true) {
    throw new Error('flattenEmptyDirectories is not implemented yet');
  }

  return {
    flattenEmptyDirectories: false,
    sort: options.sort ?? 'default',
  };
}
