export function areObjectsEqual<T extends object>(
  objA: T | undefined,
  objB: T | undefined,
  omitKeys?: (keyof T)[]
): boolean {
  // Lets get out of here early if they are the same or either is undefined
  if (objA === objB || objA == null || objB == null) {
    return objA === objB;
  }

  // Convert array to Set for O(1) lookup
  const omitSet = new Set(omitKeys);
  const keysA = Object.keys(objA) as (keyof T)[];
  const keysBSet = new Set(Object.keys(objB) as (keyof T)[]);

  // Compare keys from objA
  for (const key of keysA) {
    keysBSet.delete(key);
    if (omitSet.has(key)) {
      continue;
    }

    if (!(key in objB) || objA[key] !== objB[key]) {
      return false;
    }
  }

  // If we got any remaining keys that aren't omitted in objB,
  // then we gotta return false
  for (const key of Array.from(keysBSet)) {
    if (!omitSet.has(key)) {
      return false;
    }
  }

  return true;
}
