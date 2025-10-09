'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

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
   * @default '/api/github/installations'
   * @description The URL to fetch GitHub app installations.
   * If not provided, we will use `/api/github/installations` as the path
   * on the same origin that the current window is in.
   */
  installationsUrl?: string;
}

export type Owner = {
  id: string;
  login: string;
  type: string | null;
  avatar_url: string | null;
};

type InstallationsResponse = {
  installations: Array<unknown>;
  owners: Owner[];
};

// Cache configuration
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let cachedInstallationsData: {
  data: InstallationsResponse;
  timestamp: number;
} | null = null;

// Track in-flight requests to prevent duplicate simultaneous requests
let pendingFetchInstallations: Promise<InstallationsResponse> | null = null;

function isCacheValid(): boolean {
  if (!cachedInstallationsData) return false;
  return Date.now() - cachedInstallationsData.timestamp < CACHE_TTL_MS;
}

/**
 * Manually clear the cached installations data.
 * Useful when you know the data has changed.
 */
export function clearInstallationsCache(): void {
  cachedInstallationsData = null;
}

export async function fetchInstallations(
  url = '/api/github/installations',
  signal?: AbortSignal
): Promise<InstallationsResponse> {
  // Return cached data if still valid
  if (isCacheValid() && cachedInstallationsData) {
    return cachedInstallationsData.data;
  }

  // If there's already a pending request, wait for it and return its result
  if (pendingFetchInstallations) {
    return pendingFetchInstallations;
  }

  // Create the request promise
  const requestPromise = (async () => {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal,
      });

      // TODO: handle error cases better, especially if we can begin to pass more
      // info about the error from the server
      if (response.ok) {
        const jsonResult = await response.json();
        const data = jsonResult?.data;

        if (data && 'installations' in data) {
          const result: InstallationsResponse = {
            installations: Array.isArray(data.installations)
              ? data.installations
              : [],
            owners: Array.isArray(data.owners) ? data.owners : [],
          };

          // Cache the successful response
          cachedInstallationsData = {
            data: result,
            timestamp: Date.now(),
          };

          return result;
        } else {
          console.warn(
            'Warning: fetching installations - response has unexpected shape, falling back to empty array.'
          );
          return { installations: [], owners: [] };
        }
      } else {
        throw new Error('installations endpoint not ok');
      }
    } finally {
      // Clear the pending request when done (success or error)
      pendingFetchInstallations = null;
    }
  })();

  pendingFetchInstallations = requestPromise;
  return requestPromise;
}

function hasInstallation(data: InstallationsResponse): boolean {
  return data.installations.length > 0;
}

export type GitHubConnectionStatus =
  | 'uninitialized'
  | 'pending'
  | 'installed'
  | 'error';

export type GitHubAppConnectionHandlerProps = {
  onSuccess?: () => void;
};

/**
 * Encapsulates all imperative logic for managing GitHub App installation flow.
 * This class handles popup windows, message listeners, and polling in a way that
 * avoids React closure/stale reference issues.
 */
class GitHubAppConnector {
  private popup: Window | null = null;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private abortController = new AbortController();
  private connectionStatus: GitHubConnectionStatus = 'uninitialized';
  private stableId = crypto.randomUUID();

  constructor(
    private config: {
      slug: string;
      origin: string;
      redirectUrl: string;
      installationsUrl: string;
    },
    private onStatusChange: (status: GitHubConnectionStatus) => void
  ) {}

  private setStatus(status: GitHubConnectionStatus) {
    this.connectionStatus = status;
    this.onStatusChange(status);
  }

  private handleMessage = async (event: MessageEvent) => {
    if (event.origin !== this.config.origin) {
      return;
    }

    // If we're getting the right event type, and the unique
    // state id matches this instance, we can proceed
    if (
      event.data.type === 'git-platform-sync-app-installed--github' &&
      event.data.state === this.stableId
    ) {
      try {
        const data = await fetchInstallations(
          this.config.installationsUrl,
          this.abortController.signal
        );

        if (hasInstallation(data)) {
          this.setStatus('installed');
        } else {
          this.setStatus('uninitialized');
        }
      } catch {
        this.setStatus('error');
      }
    }
  };

  async connect(props?: GitHubAppConnectionHandlerProps) {
    const onSuccess = props?.onSuccess;
    const width = 600;
    const height = 700;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;

    // Build the installation URL with redirect
    const baseUrl = `https://github.com/apps/${this.config.slug}/installations/new`;
    const url = `${baseUrl}?redirect_uri=${encodeURIComponent(this.config.redirectUrl)}&state=${encodeURIComponent(this.stableId)}`;

    this.setStatus('pending');

    this.popup = window.open(
      url,
      'code-storage-github-app-install',
      `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,location=no,status=no`
    );

    this.checkInterval = setInterval(async () => {
      if (this.connectionStatus === 'installed') {
        this.clearInterval();
        onSuccess?.();
      } else if (!this.popup || this.popup.closed) {
        // Nothing new can happen if the pop-up is gone, so lets clear the interval
        this.clearInterval();

        // If the connection was closed while still in the 'pending' state,
        // the user likely closed the pop-up before the handleMessage listener
        // was able to receive a message (regardless of whether one was sent).
        if (this.connectionStatus === 'pending') {
          try {
            // We need to determine if the app was installed or not.
            const data = await fetchInstallations(
              this.config.installationsUrl,
              this.abortController.signal
            );

            if (hasInstallation(data)) {
              this.setStatus('installed');
              onSuccess?.();
            } else {
              this.setStatus('uninitialized');
            }
          } catch {
            this.setStatus('error');
          }
        }
      }
    }, 1000);

    // Use AbortController for automatic cleanup
    window.addEventListener('message', this.handleMessage, {
      signal: this.abortController.signal,
    });
  }

  async fetchInstallationStatus() {
    this.setStatus('pending');

    try {
      const data = await fetchInstallations(
        this.config.installationsUrl,
        this.abortController.signal
      );
      if (hasInstallation(data)) {
        this.setStatus('installed');
      } else {
        this.setStatus('uninitialized');
      }
    } catch {
      this.setStatus('error');
    }
  }

  private clearInterval() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  destroy() {
    // AbortController automatically removes all listeners and aborts any in-flight fetches
    this.abortController.abort();
    this.clearInterval();
    this.popup?.close();
    this.popup = null;
  }
}

export function useGitHubAppConnection({
  slug,
  redirectUrl: redirectUrlProp,
  installationsUrl,
}: GitHubAppConnectProps) {
  const [status, setStatus] = useState<GitHubConnectionStatus>('uninitialized');

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const redirectUrl = redirectUrlProp ?? `${origin}/api/github/callback`;
  const installationsUrlResolved =
    installationsUrl ?? '/api/github/installations';

  // Create the connector once - all config is captured at creation time.
  // We intentionally create this only once to avoid recreating listeners and intervals.
  // Config changes during the component lifecycle are not supported by design.
  const connector = useMemo(() => {
    return new GitHubAppConnector(
      {
        slug,
        origin,
        redirectUrl,
        installationsUrl: installationsUrlResolved,
      },
      setStatus
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => connector.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Return stable callbacks that delegate to the connector
  const handleConnect = useCallback(
    (props?: GitHubAppConnectionHandlerProps) => {
      connector.connect(props);
    },
    [connector]
  );

  const fetchInstallationStatus = useCallback(async () => {
    await connector.fetchInstallationStatus();
  }, [connector]);

  const destroy = useCallback(() => {
    connector.destroy();
  }, [connector]);

  return {
    status,
    handleConnect,
    fetchInstallationStatus,
    destroy,
  };
}
