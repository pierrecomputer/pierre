import { GitStorage } from '@pierre/storage';
import { NextRequest, NextResponse } from 'next/server';

const store = new GitStorage({
  name: 'pierre',
  key: process.env.CODE_STORAGE_SYNC_PRIVATE_KEY || '',
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { owner, name, defaultBranch } = body;

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
        defaultBranch: defaultBranch || 'main', // Optional, defaults to 'main'
      },
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
