export function createCachedLoader<T extends object>(
  loader: () => Promise<T>
): () => T | Promise<T> {
  let cached: T | Promise<T> | undefined;
  return () =>
    (cached ??= loader().then(
      (loaded) => {
        cached = loaded;
        return loaded;
      },
      (error: unknown) => {
        cached = undefined;
        throw error;
      }
    ));
}
