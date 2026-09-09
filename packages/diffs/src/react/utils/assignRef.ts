import type { Ref } from 'react';

// Forwards a ref value to a ref object or ref callback. Callbacks follow the
// React 18 protocol only: they receive the element on mount and `null` on
// unmount, and a cleanup function they return is ignored. Kept as a wrapper so
// the ref write happens outside component render, where the React Compiler
// allows it.
export function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') {
    ref(value);
  } else if (ref != null) {
    ref.current = value;
  }
}
