'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

export interface GitHubAppConnectProps {
  /**
   * @description The slug of the GitHub app to connect to, this is different
   * than the app id or the client id. It's what goes into the installation URL.
   */
  slug: string;
  /**
   * @default '${window.location.origin}/api/github/callback'
   * @description The URL to redirect to after the GitHub app is installed.
   * If not provided, we wil use `window.location.origin` as the base url and
   *  '/api/github/callback' as the path.
   */
  redirectUrl?: string;
  /**
   * @default '/api/github/check-installation'
   * @description The URL to check for installation.
   * If not provided, we will use `/api/github/check-installation` as the path
   * on the same origin that the current window is in.
   */
  checkInstallationUrl?: string;
}

async function checkInstallation(url = '/api/github/check-installation') {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (response.ok) {
    const data = await response.json();

    if (data && 'installed' in data) {
      if (data.installed) {
        return true;
      } else {
        return false;
      }
    } else {
      console.warn(
        'Warning: checking installation - response has unexpected shape, falling back to not installed.'
      );
      return false;
    }
  } else {
    throw new Error('check-installation endpoint not ok');
  }
}

export type GitHubConnectionStatus =
  | 'uninitialized'
  | 'pending'
  | 'installed'
  | 'error';

export type GitHubAppConnectionHandlerProps = {
  onSuccess?: () => void;
};

function useStableId() {
  return useMemo(() => crypto.randomUUID(), []);
}

export function useGitHubAppConnection({
  slug,
  redirectUrl: redirectUrlProp,
  checkInstallationUrl,
}: GitHubAppConnectProps) {
  const stableId = useStableId();

  const [connectionStatus, setConnectionStatus] =
    useState<GitHubConnectionStatus>('uninitialized');

  const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Use a ref to avoid stale closures in the interval callback, really gross
  // but it works for now. any time we update the state we also need to update the ref
  const connectionStatusRef = useRef<GitHubConnectionStatus>('uninitialized');

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  // TODO: consider one global handleMessage listener that is attached once forever
  // instead of trying to attach multiple listeners and keep track of them
  const handleMessage = useCallback(
    async (event: MessageEvent) => {
      if (event.origin !== origin) {
        return;
      }
      // If we're getting the right event type, and the unique
      // state id matches this instance of the hook, we can proceed
      if (
        event.data.type === 'github-app-installed' &&
        event.data.state === stableId
      ) {
        try {
          const installed = await checkInstallation(checkInstallationUrl);

          if (installed) {
            connectionStatusRef.current = 'installed';
            setConnectionStatus('installed');
          } else {
            connectionStatusRef.current = 'uninitialized';
            setConnectionStatus('uninitialized');
          }
        } catch {
          connectionStatusRef.current = 'error';
          setConnectionStatus('error');
        }

        window.removeEventListener('message', handleMessage);
      }
    },
    [checkInstallationUrl, origin, stableId]
  );

  // TODO: we'll need a way to add cleanup inside of a useEffect so that
  // we dont leak memory or duplicate listeners
  const handleConnect = useCallback(
    (props?: GitHubAppConnectionHandlerProps) => {
      const onSuccess = props?.onSuccess;
      const width = 600;
      const height = 700;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;

      // Build the installation URL with redirect
      const redirectUrl = redirectUrlProp ?? `${origin}/api/github/callback`;
      const baseUrl = `https://github.com/apps/${slug}/installations/new`;

      // Add redirect_uri as a query parameter
      const url = `${baseUrl}?redirect_uri=${encodeURIComponent(redirectUrl)}&state=${encodeURIComponent(stableId)}`;

      connectionStatusRef.current = 'pending';
      setConnectionStatus('pending');

      const popup = window.open(
        url,
        'code-storage-github-app-install',
        `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,location=no,status=no`
      );

      checkIntervalRef.current = setInterval(async () => {
        if (connectionStatusRef.current === 'installed') {
          clearInterval(checkIntervalRef.current ?? undefined);
          onSuccess?.();
        } else if (!popup || popup.closed) {
          // Nothing new can happen if the pop-up is gone, so lets clear the interval
          clearInterval(checkIntervalRef.current ?? undefined);
          // Stop listening for messages if the popup is closed, since there's nothing
          // to send the message from
          window.removeEventListener('message', handleMessage);

          // If the connection was closed while still in the 'pending' state,
          // the user likely closed the pop-up before the handleMessage listener
          // was able to receive a message (regardless of whether one was sent).
          if (connectionStatusRef.current === 'pending') {
            try {
              // We need to determine if the app was installed or not.
              const installed = await checkInstallation(checkInstallationUrl);

              if (installed) {
                connectionStatusRef.current = 'installed';
                setConnectionStatus('installed');
                onSuccess?.();
              } else {
                connectionStatusRef.current = 'uninitialized';
                setConnectionStatus('uninitialized');
              }
            } catch {
              // TODO: decide if it'd be better to just use 'uninitialized' here
              // since the error is not that interesting if they didn't install the app
              connectionStatusRef.current = 'error';
              setConnectionStatus('error');
            }
          } else {
            // TODO: do we need to do anything in any other case?
            // in the normal success case, the connectionStatus will be set by the handleMessage
            // listener.
          }
        }
      }, 1000);

      window.addEventListener('message', handleMessage);
    },
    [
      redirectUrlProp,
      slug,
      handleMessage,
      origin,
      checkInstallationUrl,
      stableId,
    ]
  );

  // TODO: we should add a way for the application to provide this information directly
  // and trust that it's accurate, so that it isn't a waterfall request every load
  const fetchInstallationStatus = useCallback(async () => {
    // TODO: handle multiple calls to this function during the pending state
    setConnectionStatus('pending');

    try {
      const installed = await checkInstallation(checkInstallationUrl);
      if (installed) {
        setConnectionStatus('installed');
      } else {
        setConnectionStatus('uninitialized');
      }
    } catch {
      setConnectionStatus('error');
    }
  }, [checkInstallationUrl]);

  const destroyImpl = useCallback(() => {
    // TODO: lets also abort any calls to checkInstallation
    window.removeEventListener('message', handleMessage);
    clearInterval(checkIntervalRef.current ?? undefined);
  }, [handleMessage]);

  // Keep a ref to the latest destroy implementation
  const destroyRef = useRef(destroyImpl);
  destroyRef.current = destroyImpl;

  // Return a stable wrapper that always calls the latest destroy
  const destroy = useCallback(() => {
    destroyRef.current();
  }, []);

  return {
    status: connectionStatus,
    handleConnect,
    fetchInstallationStatus,
    destroy,
  };
}
