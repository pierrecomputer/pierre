export function setDeferredArrayItem<T>(
  array: T[],
  index: number,
  create: () => T
): void {
  let initialized = false;
  let cached: T;
  Object.defineProperty(array, index, {
    configurable: true,
    enumerable: true,
    get() {
      if (!initialized) {
        cached = create();
        initialized = true;
      }
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
