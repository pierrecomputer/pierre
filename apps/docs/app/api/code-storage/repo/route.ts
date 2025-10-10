import { GitStorage } from '@pierre/storage';
import { type NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const store = new GitStorage({
      name: 'pierre',
      key: process.env.CODE_STORAGE_SYNC_PRIVATE_KEY ?? '',
    });

    const body = await request.json();
    const { owner, name, defaultBranch } = body;

    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
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
        // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions, @typescript-eslint/prefer-nullish-coalescing
        defaultBranch: defaultBranch || 'main', // Optional, defaults to 'main'
      },
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions, @typescript-eslint/prefer-nullish-coalescing
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
        // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions, @typescript-eslint/prefer-nullish-coalescing
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
