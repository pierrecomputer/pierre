import { readFile } from 'fs/promises';
import { type NextRequest } from 'next/server';
import { join } from 'path';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const path = searchParams.get('path');

  if (!path) {
    return createTextResponse('Path parameter is required', { status: 400 });
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
      return createTextResponse(patchContent, { sourceURL: 'local' });
    } catch (error) {
      return createTextResponse(
        `Failed to read local patch: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { status: 500 }
      );
    }
  }

  try {
    // Validate the path format (should be /org/repo/pull/{number})
    const pathSegments = path.split('/').filter(Boolean);
    if (pathSegments.length < 4 || pathSegments[2] !== 'pull') {
      return createTextResponse('Invalid GitHub PR path format', {
        status: 400,
      });
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
      return createTextResponse(
        `Failed to fetch patch: ${response.statusText}`,
        {
          status: response.status,
        }
      );
    }

    if (response.body == null) {
      return createTextResponse(await response.text(), { sourceURL: patchURL });
    }

    return createTextResponse(response.body, { sourceURL: patchURL });
  } catch (error) {
    return createTextResponse(
      error instanceof Error ? error.message : 'Unknown error',
      { status: 500 }
    );
  }
}

interface TextResponseOptions {
  status?: number;
  sourceURL?: string;
}

function createTextResponse(
  body: string | ReadableStream<Uint8Array>,
  { status = 200, sourceURL }: TextResponseOptions = {}
): Response {
  const headers = new Headers({
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  if (sourceURL != null) {
    headers.set('X-Patch-Source', sourceURL);
  }
  return new Response(body, {
    status,
    headers,
  });
}
