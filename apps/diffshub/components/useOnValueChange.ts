import { useState } from 'react';

// Runs `onChange` during the render in which `value` first differs from the
// last value seen, before React commits, so state that follows a prop or store
// value can be adjusted without a post-paint effect. `initialPrevious` seeds the
// comparison and is required because it decides whether the first render
// counts as a change: pass the current `value` to run only on later changes, or
// the value a fresh mount should be measured against (a server snapshot, a
// default) to also run when the first render already differs from it. An
// explicit `undefined` seed is honoured as a real value.
export function useOnValueChange<T>(
  value: T,
  onChange: (value: T) => void,
  initialPrevious: T
): void {
  const [previous, setPrevious] = useState(initialPrevious);
  if (previous !== value) {
    setPrevious(value);
    onChange(value);
  }
}
