import { readFile } from 'fs/promises';
import { type NextRequest } from 'next/server';
import { join } from 'path';

const SUCCESS_CACHE_CONTROL = 'private, max-age=60, stale-while-revalidate=300';
const ERROR_CACHE_CONTROL = 'no-store';
const EMPTY_PATCH_MESSAGE = 'GitHub returned an empty diff.';
const NON_DIFF_RESPONSE_MESSAGE = 'GitHub did not return a diff for this URL.';
const NON_WHITESPACE_PATTERN = /\S/;

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
      return createPatchTextResponse(patchContent, { sourceURL: 'local' });
    } catch (error) {
      return createTextResponse(
        `Failed to read local patch: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { status: 500 }
      );
    }
  }

  try {
    // The client sends only the GitHub-relative path. Always proxy through
    // github.com so this route cannot be used as a general-purpose URL fetcher.
    if (!path.startsWith('/') || path === '/') {
      return createTextResponse('Invalid GitHub path format', {
        status: 400,
      });
    }

    // Prefer GitHub's raw diff endpoint unless the caller explicitly requests a patch.
    let patchPath = path;
    if (!patchPath.endsWith('.patch') && !patchPath.endsWith('.diff')) {
      patchPath += '.diff';
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

    const contentType = response.headers.get('Content-Type');
    if (contentType == null || !contentType.startsWith('text/plain')) {
      return createTextResponse(NON_DIFF_RESPONSE_MESSAGE, { status: 422 });
    }

    if (response.body == null) {
      return createPatchTextResponse(await response.text(), {
        sourceURL: patchURL,
      });
    }

    return await createPatchStreamResponse(response.body, {
      sourceURL: patchURL,
    });
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

function createPatchTextResponse(
  patchText: string,
  options: Omit<TextResponseOptions, 'status'>
): Response {
  if (!NON_WHITESPACE_PATTERN.test(patchText)) {
    return createTextResponse(EMPTY_PATCH_MESSAGE, { status: 422 });
  }

  return createTextResponse(patchText, options);
}

async function createPatchStreamResponse(
  body: ReadableStream<Uint8Array>,
  options: Omit<TextResponseOptions, 'status'>
): Promise<Response> {
  const reader = body.getReader();
  let firstChunk: Uint8Array | undefined;
  while (firstChunk == null) {
    const result = await reader.read();
    if (result.done) {
      return createTextResponse(EMPTY_PATCH_MESSAGE, { status: 422 });
    }
    if (result.value.byteLength > 0) {
      firstChunk = result.value;
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(firstChunk);
      void pumpReader(reader, controller);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return createTextResponse(stream, options);
}

async function pumpReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  controller: ReadableStreamDefaultController<Uint8Array>
): Promise<void> {
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) {
        controller.close();
        return;
      }
      if (result.value.byteLength > 0) {
        controller.enqueue(result.value);
      }
    }
  } catch (error) {
    controller.error(error);
  }
}

function createTextResponse(
  body: string | ReadableStream<Uint8Array>,
  { status = 200, sourceURL }: TextResponseOptions = {}
): Response {
  const cacheControl =
    status >= 200 && status < 300 ? SUCCESS_CACHE_CONTROL : ERROR_CACHE_CONTROL;
  const headers = new Headers({
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': cacheControl,
  });
  if (sourceURL != null) {
    headers.set('X-Patch-Source', sourceURL);
  }
  return new Response(body, {
    status,
    headers,
  });
}
