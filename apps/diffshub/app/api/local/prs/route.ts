import { type NextRequest, NextResponse } from 'next/server';

import {
  createLocalTextResponse,
  isValidPrListState,
  listProjectPullRequests,
  resolveLocalProjectForApi,
} from '@/lib/localProjectsServer';

export const dynamic = 'force-dynamic';

// Lists PRs of a configured local project by running `gh pr list` in the
// project's local checkout. Query params: ?project=<id>&state=open|closed|merged|all
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const projectId = searchParams.get('project');
  const state = searchParams.get('state') ?? 'open';

  if (projectId == null || projectId === '') {
    return createLocalTextResponse('project parameter is required', 400);
  }
  if (!isValidPrListState(state)) {
    return createLocalTextResponse(
      `Invalid state "${state}". Expected one of: open, closed, merged, all`,
      400
    );
  }

  const resolution = resolveLocalProjectForApi(projectId);
  if ('errorResponse' in resolution) return resolution.errorResponse;
  const { project } = resolution;

  try {
    const prs = await listProjectPullRequests(project, state);
    return NextResponse.json({
      project: { id: project.id, label: project.label, repo: project.repo },
      state,
      prs,
    });
  } catch (error) {
    return createLocalTextResponse(
      error instanceof Error ? error.message : 'gh pr list failed',
      502
    );
  }
}
