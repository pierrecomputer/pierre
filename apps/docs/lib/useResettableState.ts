import { type Dispatch, type SetStateAction, useState } from 'react';

// Local state seeded from `source` that snaps back to `source` whenever it
// changes, before React commits, so a render never shows local edits against a
// stale source. Between source changes the returned setter works like useState.
export function useResettableState<T>(
  source: T
): [T, Dispatch<SetStateAction<T>>] {
  const [previousSource, setPreviousSource] = useState(source);
  const [value, setValue] = useState(source);

  if (previousSource !== source) {
    setPreviousSource(source);
    setValue(source);
  }

  return [value, setValue];
}
