import { type NextRequest } from 'next/server';

import { createDiffshubPatchResponse } from '@/lib/diffshubPatchResponse';

// Validates the accepted path or URL, normalizes it to a raw diff URL, and
// returns a streaming proxy response so the client can render files as they
// arrive instead of waiting for the full patch text.
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  return createDiffshubPatchResponse(
    {
      domain: searchParams.get('domain'),
      path: searchParams.get('path'),
      url: searchParams.get('url'),
    },
    request.signal
  );
}
