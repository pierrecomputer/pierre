import { NextRequest } from 'next/server';

import { CodeStorageSuccessCallback } from './success-callback';

const successCallback = new CodeStorageSuccessCallback({
  clientId: process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID!,
  clientSecret: process.env.GITHUB_CLIENT_SECRET!,
  platform: 'github',
  env: process.env.NODE_ENV === 'production' ? 'production' : 'development',
});

export async function GET(request: NextRequest) {
  return successCallback.handleRequest(request);
}
