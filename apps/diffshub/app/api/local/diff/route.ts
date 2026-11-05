import { type NextRequest } from 'next/server';

import {
  buildLocalDiffCommand,
  createLocalCommandStream,
  resolveLocalProject,
} from '@/lib/localProjects.server';
import { parseLocalDiffTarget } from '@/lib/localSource';

export const dynamic = 'force-dynamic';

function createTextResponse(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

// Streams a locally produced patch: ?project=<id>&pr=<n> runs `gh pr diff`,
// &range=<a...b> runs `git diff <range>`, &worktree=1 runs `git diff HEAD` —
// all with the project's local checkout as cwd. Mirrors /api/diff so the
// viewer can stream files as they arrive.
export function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const projectId = searchParams.get('project');
  if (projectId == null || projectId === '') {
    return createTextResponse('project parameter is required', 400);
  }

  const target = parseLocalDiffTarget(searchParams);
  if (target == null) {
    return createTextResponse(
      'Provide exactly one of pr=<number>, range=<a...b>, or worktree=1',
      400
    );
  }

  let project;
  try {
    project = resolveLocalProject(projectId);
  } catch (error) {
    return createTextResponse(
      error instanceof Error
        ? error.message
        : 'Failed to load local projects config',
      500
    );
  }
  if (project == null) {
    return createTextResponse(
      `Unknown local project "${projectId}". Add it to local-projects.json.`,
      404
    );
  }

  const command = buildLocalDiffCommand(project, target);
  return new Response(createLocalCommandStream(command, project.dir), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
