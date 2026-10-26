// Defines `array[index]` as an item that `create` builds on read. By default
// the first read keeps the built value as a plain array item. With
// `retain: false`, every read builds a fresh value and nothing built is kept,
// for items whose source stays available anyway. Assignments store the given
// value like a normal array write and follow sealed/frozen array semantics.
export function setDeferredArrayItem<T>(
  array: T[],
  index: number,
  create: () => T,
  { retain = true }: { retain?: boolean } = {}
): void {
  let initialized = false;
  let cached: T;
  Object.defineProperty(array, index, {
    configurable: true,
    enumerable: true,
    get() {
      if (initialized) return cached;
      const value = create();
      if (!retain) return value;
      cached = value;
      initialized = true;
      if (
        Object.getOwnPropertyDescriptor(array, index)?.configurable === true
      ) {
        Object.defineProperty(array, index, {
          configurable: true,
          enumerable: true,
          writable: true,
          value: cached,
        });
      }
      return cached;
    },
    set(value: T) {
      if (
        Object.getOwnPropertyDescriptor(array, index)?.configurable === true
      ) {
        Object.defineProperty(array, index, {
          configurable: true,
          enumerable: true,
          writable: true,
          value,
        });
      } else if (Object.isFrozen(array)) {
        throw new TypeError(
          `Cannot assign to read only array index '${index}'`
        );
      } else {
        cached = value;
        initialized = true;
      }
    },
  });
}
