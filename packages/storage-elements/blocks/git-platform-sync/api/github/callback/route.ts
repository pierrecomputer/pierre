import { CodeStorageSuccessCallback } from '@pierre/storage-elements-next';
import { type NextRequest } from 'next/server';

const successCallback = new CodeStorageSuccessCallback({
  clientId: process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID!,
  clientSecret: process.env.GITHUB_CLIENT_SECRET!,
  platform: 'github',
  env: process.env.NODE_ENV,
});

export async function GET(request: NextRequest) {
  return successCallback.handleRequest(request);
}
