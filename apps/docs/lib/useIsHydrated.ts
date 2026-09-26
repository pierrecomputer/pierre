import { useSyncExternalStore } from 'react';

// Hydration happens once, from the server snapshot to the client snapshot, so
// there is no external source to subscribe to.
function subscribeToNothing(): () => void {
  return () => {};
}

function getClientSnapshot(): boolean {
  return true;
}

function getServerSnapshot(): boolean {
  return false;
}

// False during SSR and the hydrating render, true on every client render after
// that. Gate render output that depends on client-only state (persisted theme
// picks, localStorage) behind it so the first client render matches the SSR
// markup and then flips, instead of a set-state-in-effect round trip.
export function useIsHydrated(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    getClientSnapshot,
    getServerSnapshot
  );
}
