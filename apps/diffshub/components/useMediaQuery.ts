import { useCallback, useSyncExternalStore } from 'react';

// One MediaQueryList per query string, shared by the subscribe and snapshot
// readers, so renders do not allocate a new list and the change listener is
// bound to the same object the snapshot reads.
const mediaQueryLists = new Map<string, MediaQueryList>();

function getMediaQueryList(query: string): MediaQueryList {
  let mediaQueryList = mediaQueryLists.get(query);
  if (mediaQueryList == null) {
    mediaQueryList = window.matchMedia(query);
    mediaQueryLists.set(query, mediaQueryList);
  }
  return mediaQueryList;
}

// Whether `query` currently matches, re-rendering on change. `serverSnapshot`
// is what SSR and the hydrating render report, so pass the value the server
// markup assumes (or `undefined` when a consumer needs to know it is unknown).
export function useMediaQuery<ServerSnapshot extends boolean | undefined>(
  query: string,
  serverSnapshot: ServerSnapshot
): boolean | ServerSnapshot {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mediaQueryList = getMediaQueryList(query);
      mediaQueryList.addEventListener('change', onChange);
      return () => mediaQueryList.removeEventListener('change', onChange);
    },
    [query]
  );
  const getSnapshot = useCallback(
    () => getMediaQueryList(query).matches,
    [query]
  );
  const getServerSnapshot = useCallback(() => serverSnapshot, [serverSnapshot]);
  return useSyncExternalStore<boolean | ServerSnapshot>(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );
}
