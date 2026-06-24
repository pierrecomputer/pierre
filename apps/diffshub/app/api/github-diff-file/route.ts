import type { ChangeTypes } from '@pierre/diffs';
import { type NextRequest } from 'next/server';

import { loadGitHubDiffFiles } from '@/lib/githubDiffFileServer';

const CACHE_CONTROL = 'no-store';
const CHANGE_TYPES = new Set<ChangeTypes>([
  'change',
  'deleted',
  'new',
  'rename-changed',
  'rename-pure',
]);

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const path = params.get('path');
  const name = params.get('name');
  const type = parseChangeType(params.get('type'));
  const prevName = params.get('prevName') ?? undefined;

  if (path == null || name == null || type == null) {
    return createJSONResponse(
      { error: 'path, name, and supported type parameters are required.' },
      { status: 400 }
    );
  }

  try {
    return createJSONResponse(
      await loadGitHubDiffFiles({ name, path, prevName, type })
    );
  } catch (error) {
    return createJSONResponse(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 502 }
    );
  }
}

function parseChangeType(value: string | null): ChangeTypes | undefined {
  if (value == null) {
    return undefined;
  }
  return CHANGE_TYPES.has(value as ChangeTypes)
    ? (value as ChangeTypes)
    : undefined;
}

function createJSONResponse(
  body: unknown,
  options: { status?: number } = {}
): Response {
  return Response.json(body, {
    status: options.status ?? 200,
    headers: {
      'Cache-Control': CACHE_CONTROL,
    },
  });
}
