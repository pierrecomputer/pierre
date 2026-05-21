'use client';

import { type Dispatch, type SetStateAction, useEffect, useState } from 'react';

// useState-like hook that mirrors its value to localStorage. On mount it
// reads `storageKey`; if the stored string is included in `validValues` it
// replaces the default, otherwise the default is kept. The initial read
// happens in an effect (not the useState initializer) so the server-rendered
// markup always uses the default and React's hydration check stays happy.
// localStorage access is wrapped in try/catch because it can throw under
// private browsing or denied permissions.
//
// The third tuple element exposes whether the rehydration effect has run.
// Callers that wire the stored value into shared singletons (e.g. the
// diffshub WorkerPool) gate side effects on this flag so the brief initial
// window where the hook still returns `defaultValue` doesn't clobber the
// singleton's current state. The flag also doubles as the write guard so
// the first `setItem` can't fire with the default before the rehydrating
// `setItem` has had a chance to land.
export function usePersistedState<T extends string>(
  storageKey: string,
  defaultValue: T,
  validValues: readonly T[]
): [T, Dispatch<SetStateAction<T>>, boolean] {
  const [value, setValue] = useState<T>(defaultValue);
  const [isHydrated, setIsHydrated] = useState(false);

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
    setIsHydrated(true);
  }, [storageKey, validValues]);

  useEffect(() => {
    if (!isHydrated) return;
    try {
      window.localStorage.setItem(storageKey, value);
    } catch {
      // See note above.
    }
  }, [storageKey, value, isHydrated]);

  return [value, setValue, isHydrated];
}
