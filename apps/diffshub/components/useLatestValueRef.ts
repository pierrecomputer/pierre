import { type RefObject, useInsertionEffect, useRef } from 'react';

// Keeps imperative callbacks on the latest committed value without changing
// the ref's identity or mutating it during render.
export function useLatestValueRef<T>(value: T): RefObject<T> {
  const valueRef = useRef(value);
  useInsertionEffect(() => {
    valueRef.current = value;
  }, [value]);
  return valueRef;
}
