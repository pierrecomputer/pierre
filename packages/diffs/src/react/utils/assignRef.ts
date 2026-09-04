import type { Ref } from 'react';

// Forwards on a ref value to a ref object or ref function. Also built as a
// wrapper to avoid any react compiler warnings
export function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') {
    ref(value);
  } else if (ref != null) {
    ref.current = value;
  }
}
