import {
  clearGitHubSessionCookie,
  getGitHubOAuthConfig,
  getGitHubOrigin,
  getGitHubSession,
  isSameOriginRequest,
} from '@/lib/githubAuth';

const CACHE_CONTROL = 'no-store';

export const runtime = 'nodejs';

export function GET(request: Request): Response {
  const session = getGitHubSession(request);
  const response = Response.json(
    {
      configured:
        getGitHubOAuthConfig() != null && getGitHubOrigin(request) != null,
      user: session?.user ?? null,
    },
    { headers: { 'Cache-Control': CACHE_CONTROL } }
  );
  if (session == null) {
    response.headers.append('Set-Cookie', clearGitHubSessionCookie(request));
  }
  return response;
}

export function DELETE(request: Request): Response {
  if (!isSameOriginRequest(request)) {
    return Response.json(
      { error: 'Cross-origin requests are not allowed.' },
      { status: 403, headers: { 'Cache-Control': CACHE_CONTROL } }
    );
  }

  const response = new Response(null, {
    status: 204,
    headers: { 'Cache-Control': CACHE_CONTROL },
  });
  response.headers.append('Set-Cookie', clearGitHubSessionCookie(request));
  return response;
}
