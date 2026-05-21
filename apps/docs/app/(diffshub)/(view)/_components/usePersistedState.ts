'use client';

import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from 'react';

// useState-like hook that mirrors its value to localStorage. On mount it
// reads `storageKey`; if the stored string is included in `validValues` it
// replaces the default, otherwise the default is kept. The initial read
// happens in an effect (not the useState initializer) so the server-rendered
// markup always uses the default and React's hydration check stays happy.
// localStorage access is wrapped in try/catch because it can throw under
// private browsing or denied permissions.
export function usePersistedState<T extends string>(
  storageKey: string,
  defaultValue: T,
  validValues: readonly T[]
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(defaultValue);
  // Tracks whether the rehydration effect has run yet. Without this guard
  // the write effect would fire on the initial commit and clobber the
  // stored value with `defaultValue` before we get a chance to read it.
  const hydratedRef = useRef(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (
        stored != null &&
        (validValues as readonly string[]).includes(stored)
      ) {
        setValue(stored as T);
      }
    } catch {
      // localStorage unavailable; keep the default.
    }
    hydratedRef.current = true;
  }, [storageKey, validValues]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      window.localStorage.setItem(storageKey, value);
    } catch {
      // See note above.
    }
  }, [storageKey, value]);

  return [value, setValue];
}
