import { NextResponse } from 'next/server';

import { listLocalProjects } from '@/lib/localProjectsServer';

// Local mode is dev-only; never cache the config-derived listing.
export const dynamic = 'force-dynamic';

// Lists the projects configured in local-projects.json (id/label/repo only —
// the local checkout path stays server-side).
export function GET() {
  try {
    return NextResponse.json({ projects: listLocalProjects() });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to load local projects config',
      },
      { status: 500 }
    );
  }
}
