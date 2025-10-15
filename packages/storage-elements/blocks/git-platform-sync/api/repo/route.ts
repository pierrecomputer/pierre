import { CodeStorageRepo } from '@pierre/storage-elements-next';
import { type NextRequest } from 'next/server';

const repo = new CodeStorageRepo({
  storageName: 'pierre',
  privateKey: process.env.CODE_STORAGE_SYNC_PRIVATE_KEY!,
});

export async function POST(request: NextRequest): Promise<Response> {
  return repo.handlePostRequest(request);
}
