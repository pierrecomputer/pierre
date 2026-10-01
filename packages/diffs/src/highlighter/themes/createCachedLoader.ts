export function createCachedLoader<T extends object>(
  loader: () => Promise<T>
): () => T | Promise<T> {
  let value: T | undefined;
  let pending: Promise<T> | undefined;
  return () => {
    if (value != null) return value;
    return (pending ??= loader().then(
      (loaded) => {
        value = loaded;
        return loaded;
      },
      (error: unknown) => {
        pending = undefined;
        throw error;
      }
    ));
  };
}
