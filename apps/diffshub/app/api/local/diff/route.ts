import { type NextRequest } from 'next/server';

import {
  buildLocalDiffCommand,
  createLocalCommandStream,
  createLocalTextResponse,
  resolveLocalProjectForApi,
} from '@/lib/localProjectsServer';
import { parseLocalDiffTarget } from '@/lib/localSource';

export const dynamic = 'force-dynamic';

// Streams a locally produced patch: ?project=<id>&pr=<n> runs `gh pr diff`,
// &range=<a...b> runs `git diff <range>`, &worktree=1 runs `git diff HEAD` —
// all with the project's local checkout as cwd. Mirrors /api/diff so the
// viewer can stream files as they arrive.
export function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const projectId = searchParams.get('project');
  if (projectId == null || projectId === '') {
    return createLocalTextResponse('project parameter is required', 400);
  }

  const target = parseLocalDiffTarget(searchParams);
  if (target == null) {
    return createLocalTextResponse(
      'Provide exactly one of pr=<number>, range=<a...b>, or worktree=1',
      400
    );
  }

  const resolution = resolveLocalProjectForApi(projectId);
  if ('errorResponse' in resolution) return resolution.errorResponse;

  const command = buildLocalDiffCommand(resolution.project, target);
  return new Response(
    createLocalCommandStream(command, resolution.project.dir),
    {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    }
  );
}
