import type { components } from '@octokit/openapi-types';
import { useEffect, useState } from 'react';

export type Owner = components['schemas']['repository']['owner'];

export type OwnersFetchStatus = 'loading' | 'error' | 'success';
type OwnersResponse = {
  data?: {
    owners: Owner[];
  };
  error?: string;
};
type FetchOwnersResult = {
  error: Error | null;
  data:
    | {
        owners: Owner[];
      }
    | undefined;
};

// Cache configuration
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let cachedOwners: {
  owners: Owner[];
  timestamp: number;
} | null = null;

function isCacheValid(): boolean {
  if (!cachedOwners) return false;
  return Date.now() - cachedOwners.timestamp < CACHE_TTL_MS;
}

// TODO: make this more robust
async function fetchOwners(signal?: AbortSignal): Promise<FetchOwnersResult> {
  // Return cached data if still valid
  if (isCacheValid() && cachedOwners) {
    return {
      error: null,
      data: { owners: cachedOwners.owners },
    };
  }
  let data:
    | {
        owners: Owner[];
      }
    | undefined;
  let error: Error | null = null;

  try {
    const response = await fetch('/api/github/owners', { signal });

    if (!response.ok) {
      error = new Error('Failed to fetch owners');
    } else {
      const responseData = (await response.json()) as OwnersResponse;
      data = responseData.data;

      // Cache the successful response
      if (data) {
        cachedOwners = {
          owners: data.owners,
          timestamp: Date.now(),
        };
      }
    }
  } catch (e) {
    // Don't set error state if the request was aborted
    if (e instanceof Error && e.name === 'AbortError') {
      return { error: null, data: undefined };
    }
    error = new Error('Failed to fetch owners');
  }

  return {
    error,
    data,
  };
}

/**
 * Manually clear the cached owners data.
 * Useful when you know the data has changed (e.g., after adding a new repository).
 */
export function clearOwnersCache(): void {
  cachedOwners = null;
}

export function useOwners() {
  const [owners, setOwners] = useState<Owner[]>([]);
  const [status, setStatus] = useState<OwnersFetchStatus>('loading');

  useEffect(() => {
    const abortController = new AbortController();

    const fetchEffect = async () => {
      setStatus('loading');
      const { error, data } = await fetchOwners(abortController.signal);

      // Don't update state if the component was unmounted
      if (abortController.signal.aborted) {
        return;
      }

      if (error || data === null) {
        setStatus('error');
      } else if (data) {
        setOwners(data.owners);
        setStatus('success');
      }
    };

    fetchEffect();

    return () => {
      abortController.abort();
    };
  }, []);

  return {
    owners,
    status,
  };
}

export function generateOwnerOptions(owners: Owner[]) {
  return owners.map((owner) => ({
    value: owner.id,
    label: owner.login,
    image: owner.avatar_url,
  }));
}
