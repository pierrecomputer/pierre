import { useEffect, useMemo, useState } from 'react';

import {
  type Owner,
  clearInstallationsCache,
  fetchInstallations,
} from './github-app-connect';

export type { Owner };

export type OwnersFetchStatus = 'loading' | 'error' | 'success';

type FetchOwnersResult = {
  error: Error | null;
  data:
    | {
        owners: Owner[];
      }
    | undefined;
};

async function fetchOwners(signal?: AbortSignal): Promise<FetchOwnersResult> {
  try {
    const response = await fetchInstallations(
      '/api/code-storage/github/installations',
      signal
    );
    return {
      error: null,
      data: { owners: response.owners },
    };
  } catch (e) {
    // Don't set error state if the request was aborted
    if (e instanceof Error && e.name === 'AbortError') {
      return { error: null, data: undefined };
    }
    return {
      error: new Error('Failed to fetch owners'),
      data: undefined,
    };
  }
}

/**
 * Manually clear the cached owners data.
 * Useful when you know the data has changed (e.g., after adding a new repository).
 */
export function clearOwnersCache(): void {
  clearInstallationsCache();
}

export function useOwners() {
  const [owners, setOwners] = useState<Owner[]>([]);
  const [status, setStatus] = useState<OwnersFetchStatus>('loading');
  const [bustVersion, setBustVersion] = useState(0);

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
  }, [bustVersion]);

  const ownerMap = useMemo(() => {
    const map = new Map<string, Owner>();
    for (const owner of owners) {
      map.set(owner.id, owner);
    }
    return map;
  }, [owners]);

  return {
    owners,
    status,
    getOwnerById: (id: string) => {
      return ownerMap.get(id);
    },
    refresh: () => {
      clearOwnersCache();
      setBustVersion(bustVersion + 1);
    },
  };
}

export function generateOwnerOptions(owners: Owner[]) {
  return owners.map((owner) => ({
    value: owner.id,
    label: owner.login,
    image: owner.avatar_url,
  }));
}
