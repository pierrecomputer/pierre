const CACHE_KEY_VERSION = 1;

/** Encodes caller-controlled segments without delimiter ambiguity. */
export function composeCacheKey(
  scope: string,
  ...segments: readonly string[]
): string {
  return `ck${CACHE_KEY_VERSION}:${JSON.stringify([scope, ...segments])}`;
}
