import { type NextRequest } from 'next/server';

import {
  GitHubCommentsRequestError,
  loadGitHubComments,
  parsePostGitHubCommentRequest,
  postGitHubComment,
} from '@/lib/githubCommentsServer';
import { parseGitHubDiffSource } from '@/lib/githubDiffSource';

const CACHE_CONTROL = 'no-store';

// Upstream statuses passed through to the client as-is; anything else
// collapses to 502. 403 in particular must survive: it drives the client's
// write-capability downgrade.
const PASSTHROUGH_ERROR_STATUSES = new Set([400, 401, 403, 404, 422, 429]);

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
    return createErrorResponse(error);
  }
}

// Write-side proxy: posts a review comment or thread reply to the pull
// request named by `path`. Requires the caller's own token — the server env
// token is never used to author comments on a user's behalf.
export async function POST(request: NextRequest) {
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

  if (token == null) {
    return createJSONResponse(
      { error: 'Posting comments requires a GitHub token.' },
      { status: 401 }
    );
  }

  const body: unknown = await request.json().catch(() => undefined);
  const postRequest = parsePostGitHubCommentRequest(body);
  if (postRequest == null) {
    return createJSONResponse(
      { error: 'Unsupported comment payload.' },
      { status: 400 }
    );
  }

  try {
    return createJSONResponse(
      await postGitHubComment(source, postRequest, { token })
    );
  } catch (error) {
    return createErrorResponse(error);
  }
}

function createErrorResponse(error: unknown): Response {
  const status =
    error instanceof GitHubCommentsRequestError &&
    PASSTHROUGH_ERROR_STATUSES.has(error.status)
      ? error.status
      : 502;
  return createJSONResponse(
    { error: error instanceof Error ? error.message : 'Unknown error' },
    { status }
  );
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
