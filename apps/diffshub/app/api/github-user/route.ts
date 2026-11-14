import { type NextRequest } from 'next/server';

import { loadGitHubTokenUser } from '@/lib/githubCommentsServer';

const CACHE_CONTROL = 'no-store';

// Resolves the identity of the caller's GitHub token (login + avatar) so the
// comment form can show who a posted comment will be authored as. Requires
// the user's own token — there is nothing meaningful to resolve without one.
export async function GET(request: NextRequest) {
  const token = parseBearerToken(request.headers.get('authorization'));

  if (token == null) {
    return createJSONResponse(
      { error: 'Resolving the GitHub user requires a token.' },
      { status: 401 }
    );
  }

  try {
    return createJSONResponse(await loadGitHubTokenUser({ token }));
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
