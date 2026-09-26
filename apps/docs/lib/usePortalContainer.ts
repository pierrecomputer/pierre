import { useSyncExternalStore } from 'react';

// The portal node is rendered by the root layout (apps/docs/app/layout.tsx) and
// lives for the whole app, so there is nothing to subscribe to after hydration.
const PORTAL_CONTAINER_ID = 'dark-mode-portal-container';

function subscribeToPortalContainer(): () => void {
  return () => {};
}

function getPortalContainer(): HTMLElement | null {
  return document.getElementById(PORTAL_CONTAINER_ID);
}

function getServerPortalContainer(): null {
  return null;
}

// The root layout's dark-mode portal node: null on the server and during the
// hydrating render, the element on every client render after that.
export function usePortalContainer(): HTMLElement | null {
  return useSyncExternalStore(
    subscribeToPortalContainer,
    getPortalContainer,
    getServerPortalContainer
  );
}
