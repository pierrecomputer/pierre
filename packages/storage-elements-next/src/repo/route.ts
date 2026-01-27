import { GitStorage } from '@pierre/storage';
import { NextResponse } from 'next/server';

type NextRequestLike = {
  json(): Promise<unknown>;
};

type CodeStorageRepoOptions = {
  storageName: string;
  privateKey: string;
};

type CreateRepoRequest = {
  owner: string;
  name: string;
  defaultBranch?: string;
};

export class CodeStorageRepo {
  private storageName: string;
  private privateKey: string;

  constructor(options: CodeStorageRepoOptions) {
    this.storageName = options.storageName;
    this.privateKey = options.privateKey;
  }

  async handlePostRequest(request: NextRequestLike) {
    try {
      const store = new GitStorage({
        name: this.storageName,
        key: this.privateKey,
      });

      const body = (await request.json()) as CreateRepoRequest;
      const { owner, name, defaultBranch } = body;

      // oxlint-disable-next-line typescript/strict-boolean-expressions
      if (!owner || !name) {
        return NextResponse.json(
          { success: false, error: 'Repository owner and name are required' },
          { status: 400 }
        );
      }

      // TODO: Authenticate the user for this operation

      const repo = await store.createRepo({
        baseRepo: {
          owner,
          name,
          // NOTE(amadeus): Given these types are `any`, not sure the safest way
          // to convert fix them...
          // oxlint-disable-next-line typescript/prefer-nullish-coalescing
          defaultBranch: defaultBranch || 'main', // Optional, defaults to 'main'
        },
        // oxlint-disable-next-line typescript/prefer-nullish-coalescing
        defaultBranch: defaultBranch || 'main', // Optional, defaults to 'main' for the Git Storage repo
      });

      const ciUrl = await repo.getRemoteURL({
        permissions: ['git:read', 'git:write'],
        ttl: 86400, // 24 hours
      });

      return NextResponse.json({
        success: true,
        url: ciUrl,
        repository: {
          owner,
          name,
          // oxlint-disable-next-line typescript/prefer-nullish-coalescing
          defaultBranch: defaultBranch || 'main',
        },
      });
    } catch (error) {
      console.error('Error syncing storage:', error);
      return NextResponse.json(
        { error: 'Failed to sync storage' },
        { status: 500 }
      );
    }
  }
}
