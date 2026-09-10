import { useState } from 'react';

// Runs `onChange` during the render in which `value` first differs from the
// last value seen, before React commits, so state that follows a prop or store
// value can be adjusted without a post-paint effect. `initialPrevious` seeds
// the comparison: pass the value a fresh mount should be measured against when
// a mount that already differs must run `onChange` on its first render.
export function useOnValueChange<T>(
  value: T,
  onChange: (value: T) => void,
  initialPrevious: T = value
): void {
  const [previous, setPrevious] = useState(initialPrevious);
  if (previous !== value) {
    setPrevious(value);
    onChange(value);
  }
}
