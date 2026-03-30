export interface PathToIdLookup {
  readonly size: number;
  get: (path: string) => string | undefined;
  has: (path: string) => boolean;
  keys: () => IterableIterator<string>;
}

export type IdToPathLookup = Pick<Map<string, string>, 'get' | 'has'>;

/**
 * The sync loader uses literal paths as IDs, so this facade can answer the
 * path->id lookups Root needs without allocating a second full identity Map.
 */
export function createIdentityPathToIdLookup(
  tree: ReadonlyMap<string, unknown>
): PathToIdLookup {
  return {
    get size() {
      return tree.size;
    },
    get: (path: string) => (tree.has(path) ? path : undefined),
    has: (path: string) => tree.has(path),
    keys: () => tree.keys(),
  };
}
