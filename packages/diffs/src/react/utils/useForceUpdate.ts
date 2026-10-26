import { useState, useSyncExternalStore } from 'react';

// A helper hook to force a react component to re-render
export function useForceUpdate(): () => void {
  const [store] = useState(() => {
    let version = 0;
    let listener: (() => void) | undefined;
    return {
      getSnapshot: () => version,
      subscribe(next: () => void) {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
      forceUpdate() {
        version++;
        listener?.();
      },
    };
  });
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return store.forceUpdate;
}
