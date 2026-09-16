import {
  getGitHubRequestToken,
  getGitHubSession,
  isSameOriginRequest,
} from '@/lib/githubAuth';
import {
  deleteGitHubComment,
  getGitHubComments,
  GitHubCommentsError,
  postGitHubComment,
} from '@/lib/githubCommentsServer';

const JSON_TYPE = /^application\/json(?:\s*;|$)/i;
const RESPONSE_HEADERS = {
  'Cache-Control': 'no-store',
  Vary: 'Authorization, Cookie',
};

export async function GET(request: Request): Promise<Response> {
  const token = getGitHubRequestToken(request);
  if (token == null) {
    return jsonError(401, 'Sign in to GitHub to load code comments.');
  }
  const path = new URL(request.url).searchParams.get('path');
  if (path == null) {
    return jsonError(400, 'A GitHub diff path is required.');
  }

  try {
    return json(
      await getGitHubComments(path, {
        token,
        signal: request.signal,
      })
    );
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) {
    return jsonError(403, 'This request must come from Diffshub.');
  }
  if (!JSON_TYPE.test(request.headers.get('content-type') ?? '')) {
    return jsonError(415, 'Content-Type must be application/json.');
  }
  const session = getGitHubSession(request);
  if (session == null) {
    return jsonError(401, 'Sign in to GitHub before posting comments.');
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return jsonError(400, 'The comment body must be valid JSON.');
  }

  try {
    return json(
      await postGitHubComment(input, {
        token: session.token,
        signal: request.signal,
      }),
      201
    );
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) {
    return jsonError(403, 'This request must come from Diffshub.');
  }
  const session = getGitHubSession(request);
  if (session == null) {
    return jsonError(401, 'Sign in to GitHub before deleting comments.');
  }

  const params = new URL(request.url).searchParams;
  const path = params.get('path');
  const id = params.get('id');
  if (path == null || id == null) {
    return jsonError(400, 'A GitHub diff path and comment id are required.');
  }

  try {
    await deleteGitHubComment(path, id, {
      token: session.token,
      userId: session.user.id,
      signal: request.signal,
    });
    return new Response(null, { status: 204, headers: RESPONSE_HEADERS });
  } catch (error) {
    return handleError(error);
  }
}

function handleError(error: unknown): Response {
  return error instanceof GitHubCommentsError
    ? jsonError(error.status, error.message)
    : jsonError(500, 'Diffshub could not handle GitHub code comments.');
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: RESPONSE_HEADERS });
}

function jsonError(status: number, error: string): Response {
  return json({ error }, status);
}
