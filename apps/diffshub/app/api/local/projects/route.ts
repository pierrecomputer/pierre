import { NextResponse } from 'next/server';

import {
  createLocalTextResponse,
  listLocalProjects,
} from '@/lib/localProjectsServer';

// Local mode is dev-only; never cache the config-derived listing.
export const dynamic = 'force-dynamic';

// Lists the projects configured in local-projects.json (id/label/repo only —
// the local checkout path stays server-side). Errors are plain text because
// the panel's readErrorOrJson throws the raw body on !ok.
export function GET() {
  try {
    return NextResponse.json({ projects: listLocalProjects() });
  } catch (error) {
    return createLocalTextResponse(
      error instanceof Error
        ? error.message
        : 'Failed to load local projects config',
      500
    );
  }
}
