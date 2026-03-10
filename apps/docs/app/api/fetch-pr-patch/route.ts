import { createReadStream } from 'fs';
import { type NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { Readable } from 'stream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STREAM_HEADERS = {
  'cache-control': 'no-store, no-transform',
  'content-type': 'text/plain; charset=utf-8',
} as const;

function createPatchStreamResponse(
  stream: ReadableStream<Uint8Array>,
  patchURL: string,
  status = 200
): Response {
  const reader = stream.getReader();

  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(value);
      },
      async cancel(reason) {
        await reader.cancel(reason);
      },
    }),
    {
      status,
      headers: {
        ...STREAM_HEADERS,
        'x-patch-url': patchURL,
      },
    }
  );
}

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
      return createPatchStreamResponse(
        Readable.toWeb(
          createReadStream(localPatchPath)
        ) as unknown as ReadableStream<Uint8Array>,
        'local'
      );
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

    if (response.body == null) {
      return NextResponse.json(
        { error: 'GitHub patch response body was empty' },
        { status: 502 }
      );
    }

    return createPatchStreamResponse(response.body, patchURL, response.status);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
