import { type NextRequest } from 'next/server';

import { loadGitHubComments } from '@/lib/githubCommentsServer';
import { parseGitHubDiffSource } from '@/lib/githubDiffSource';

const CACHE_CONTROL = 'no-store';

// Read-side proxy for GitHub comments. Browser code only talks to this
// same-origin route: an optional user PAT arrives as a bearer header, and for
// public sources without one the server falls back to its env token,
// mirroring the other GitHub proxy routes. Responses are never cached
// server-side so PAT-derived data cannot leak across viewers.
export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get('path');
  const token = parseBearerToken(request.headers.get('authorization'));

  if (path == null) {
    return createJSONResponse(
      { error: 'path parameter is required.' },
      { status: 400 }
    );
  }

  const source = parseGitHubDiffSource(path);
  if (source == null) {
    return createJSONResponse(
      { error: 'path is not a supported GitHub diff source.' },
      { status: 400 }
    );
  }

  try {
    return createJSONResponse(await loadGitHubComments(source, { token }));
  } catch (error) {
    return createJSONResponse(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 502 }
    );
  }
}

function parseBearerToken(value: string | null): string | undefined {
  if (value == null) {
    return undefined;
  }

  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  const token = match?.[1]?.trim();
  return token == null || token === '' ? undefined : token;
}

function createJSONResponse(
  body: unknown,
  options: { status?: number } = {}
): Response {
  return Response.json(body, {
    status: options.status ?? 200,
    headers: {
      'Cache-Control': CACHE_CONTROL,
      Vary: 'Authorization',
    },
  });
}
