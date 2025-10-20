import type { components } from '@octokit/openapi-types';
import { NextResponse } from 'next/server';

type NextRequestLike = {
  cookies: {
    get(name: string): { value: string } | undefined;
  };
};

type Installation = components['schemas']['installation'];

type Owner = components['schemas']['simple-user'] &
  components['schemas']['enterprise'];

type InstallationResponse = {
  installations: Installation[];
};

type FilteredInstallation = {
  id: string;
  app_id: string;
  app_slug: string;
  permissions: Record<string, string>;
  owner_id: string | null;
  events: string[];
  type: string | null;
};

type FilteredOwner = {
  id: string;
  login: string;
  type: string | null;
  avatar_url: string | null;
};

type CodeStorageGitHubInstallationsOptions = {
  cookieName?: string;
};

export class CodeStorageGitHubInstallations {
  private cookieName: string;

  constructor(options: CodeStorageGitHubInstallationsOptions) {
    this.cookieName = options.cookieName ?? 'github_token';
  }

  private filterInstallations(installations: Installation[]) {
    return installations.map((installation) => {
      return {
        id: `${installation.id}`,
        app_id: `${installation.app_id}`,
        app_slug: installation.app_slug,
        owner_id:
          installation.account != null && 'id' in installation.account
            ? `${installation.account.id}`
            : null,
        permissions: installation.permissions,
        events: installation.events,
        type:
          installation.account != null && 'type' in installation.account
            ? installation.account.type
            : null,
      } satisfies FilteredInstallation;
    });
  }

  private filterOwners(owners: Owner[]) {
    return owners.map((owner) => {
      return {
        id: `${owner.id}`,
        login: owner.login,
        type: owner.type,
        avatar_url: owner.avatar_url,
      } satisfies FilteredOwner;
    });
  }

  private getOwnersFromInstallations(installations: Installation[]) {
    return installations
      .map((installation) => installation.account)
      .filter((account): account is Owner => account !== null);
  }

  async handleRequest(request: NextRequestLike) {
    const token = request.cookies.get(this.cookieName)?.value;

    if (token == null || token.trim() === '') {
      return NextResponse.json({
        data: { installations: [], owners: [] },
        auth: 'none',
      });
    }

    try {
      const response = await fetch(
        `https://api.github.com/user/installations`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github.v3+json',
          },
        }
      );

      if (!response.ok) {
        // If unauthorized, clear the cookie, and return an empty data set
        if (response.status === 401) {
          const unauthedResponse = NextResponse.json({
            data: {
              installations: [],
              owners: [],
            },
            auth: 'expired',
          });
          unauthedResponse.cookies.delete(this.cookieName);
          return unauthedResponse;
        }

        return NextResponse.json(
          {
            error: 'Failed to fetch installations',
            errorMessage: response.statusText,
          },
          { status: 400 }
        );
      }

      const data = (await response.json()) as InstallationResponse;

      if ((data?.installations?.length ?? 0) === 0) {
        return NextResponse.json({
          data: {
            installations: [],
            owners: [],
          },
          auth: 'valid',
        });
      }

      const filteredInstallations = this.filterInstallations(
        data.installations
      );

      const filteredOwners = this.filterOwners(
        this.getOwnersFromInstallations(data.installations)
      );

      return NextResponse.json({
        data: {
          installations: filteredInstallations,
          owners: filteredOwners,
        },
        auth: 'valid',
        // for debugging this can be nice
        // _raw: data.installations,
      });
    } catch (error) {
      console.error('Error fetching installations:', error);
      return NextResponse.json(
        {
          error: 'Failed to fetch installations',
          errorMessage:
            error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 }
      );
    }
  }
}
