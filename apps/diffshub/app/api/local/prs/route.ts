import { type NextRequest, NextResponse } from 'next/server';

import {
  isValidPrListState,
  listProjectPullRequests,
  resolveLocalProject,
} from '@/lib/localProjects.server';

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

// Lists PRs of a configured local project by running `gh pr list` in the
// project's local checkout. Query params: ?project=<id>&state=open|closed|merged|all
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const projectId = searchParams.get('project');
  const state = searchParams.get('state') ?? 'open';

  if (projectId == null || projectId === '') {
    return createTextResponse('project parameter is required', 400);
  }
  if (!isValidPrListState(state)) {
    return createTextResponse(
      `Invalid state "${state}". Expected one of: open, closed, merged, all`,
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

  try {
    const prs = await listProjectPullRequests(project, state);
    return NextResponse.json({
      project: { id: project.id, label: project.label, repo: project.repo },
      state,
      prs,
    });
  } catch (error) {
    return createTextResponse(
      error instanceof Error ? error.message : 'gh pr list failed',
      502
    );
  }
}
