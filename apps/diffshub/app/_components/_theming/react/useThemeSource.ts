'use client';

import type { ThemeController, ThemeResolver } from '@pierre/theming';
import { createContext, useContext, useRef, useSyncExternalStore } from 'react';

import type { ActiveThemeSnapshot, ThemeSource } from '../js/ThemeSource';

export const ThemeSourceContext = createContext<ThemeSource | undefined>(
  undefined
);

// Carries the controller behind the provider source so the names-now diffs hook
// and the selection hook can read selection + setters. Undefined under an
// override-only provider (a fixedSource has no controller).
export const ThemeControllerContext = createContext<
  ThemeController | undefined
>(undefined);

export const ThemeResolverContext = createContext<ThemeResolver | undefined>(
  undefined
);

const EMPTY_SNAPSHOT: ActiveThemeSnapshot = {
  theme: undefined,
  colorScheme: 'light',
};

// Returns whether two snapshots are equal by the fields React cares about, so
// useSyncExternalStore can keep a stable reference and avoid a render loop (the
// source may allocate a fresh object on every getSnapshot call).
function snapshotsEqual(
  a: ActiveThemeSnapshot,
  b: ActiveThemeSnapshot
): boolean {
  return a.theme === b.theme && a.colorScheme === b.colorScheme;
}

export function useThemeSource(override?: ThemeSource): {
  activeTheme: ActiveThemeSnapshot;
  source: ThemeSource | undefined;
} {
  const contextSource = useContext(ThemeSourceContext);
  const source = override ?? contextSource;
  // Cache the last snapshot so identical reads return the same reference; the
  // source may allocate a new object on every getSnapshot call.
  const cacheRef = useRef<ActiveThemeSnapshot>(EMPTY_SNAPSHOT);
  const getSnapshot = () => {
    const next = source != null ? source.getSnapshot() : EMPTY_SNAPSHOT;
    if (!snapshotsEqual(cacheRef.current, next)) {
      cacheRef.current = next;
    }
    return cacheRef.current;
  };
  const activeTheme = useSyncExternalStore(
    (listener) => (source != null ? source.subscribe(listener) : () => {}),
    getSnapshot,
    () => EMPTY_SNAPSHOT
  );
  return { activeTheme, source };
}

export function useThemeResolver(): ThemeResolver | undefined {
  return useContext(ThemeResolverContext);
}
