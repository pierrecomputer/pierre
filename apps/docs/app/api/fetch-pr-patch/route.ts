import { readFile } from 'fs/promises';
import { type NextRequest, NextResponse } from 'next/server';
import { join } from 'path';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const path = searchParams.get('path');

  if (!path) {
    return NextResponse.json(
      { error: 'Path parameter is required' },
      { status: 400 }
    );
  }

  // Dev override to fetch the monster patch without required GitHub
  if (path === '/nodejs/node/pull/59805') {
    try {
      const localPatchPath = join(
        process.cwd(),
        'app/api/fetch-pr-patch',
        'larg.patch'
        // 'smol.patch'
      );
      const patchContent = await readFile(localPatchPath, 'utf-8');
      return NextResponse.json({
        content: patchContent,
        url: 'local',
      });
    } catch (error) {
      return NextResponse.json(
        {
          error: `Failed to read local patch: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
        { status: 500 }
      );
    }
  }

  try {
    // Validate the path format (should be /org/repo/pull/{number})
    const pathSegments = path.split('/').filter(Boolean);
    if (pathSegments.length < 4 || pathSegments[2] !== 'pull') {
      return NextResponse.json(
        { error: 'Invalid GitHub PR path format' },
        { status: 400 }
      );
    }

    // Ensure the path ends with .patch
    let patchPath = path;
    if (!patchPath.endsWith('.patch')) {
      patchPath += '.patch';
    }

    // Construct the full GitHub URL server-side
    const patchURL = `https://github.com${patchPath}`;

    // Fetch the patch from GitHub
    const response = await fetch(patchURL, {
      headers: {
        'User-Agent': 'pierre-js',
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch patch: ${response.statusText}` },
        { status: response.status }
      );
    }

    const patchContent = await response.text();

    return NextResponse.json({
      content: patchContent,
      url: patchURL,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
