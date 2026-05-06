import { readFile } from 'fs/promises';
import { type NextRequest } from 'next/server';
import { join } from 'path';

const CACHE_CONTROL = 'no-store';
const EMPTY_PATCH_MESSAGE = 'GitHub returned an empty diff.';
const NON_DIFF_RESPONSE_MESSAGE = 'GitHub did not return a diff for this URL.';
const NON_WHITESPACE_PATTERN = /\S/;

// Validates the GitHub-relative path, normalizes it to a raw diff URL, and
// returns a streaming proxy response so the client can render files as they
// arrive instead of waiting for the full patch text.
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const path = searchParams.get('path');

  if (!path) {
    return createTextResponse('Path parameter is required', { status: 400 });
  }

  // Override to fetch default patch without requiring GitHub, to help avoid
  // abuse and potential rate limits
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

    return createPatchStreamResponse(patchURL, request.signal, {
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

// Serves local patch fixtures through the same response path as GitHub data,
// while rejecting empty files so the viewer does not enter a silent no-op
// state.
function createPatchTextResponse(
  patchText: string,
  options: Omit<TextResponseOptions, 'status'>
): Response {
  if (!NON_WHITESPACE_PATTERN.test(patchText)) {
    return createTextResponse(EMPTY_PATCH_MESSAGE, { status: 422 });
  }

  return createTextResponse(patchText, options);
}

// Creates the client-facing stream and pumps GitHub data into it
// asynchronously so the browser can render each completed file as soon as
// GitHub sends bytes.
function createPatchStreamResponse(
  patchURL: string,
  requestSignal: AbortSignal,
  options: Omit<TextResponseOptions, 'status'>
): Response {
  const upstreamController = new AbortController();
  const abortUpstream = () => upstreamController.abort();
  requestSignal.addEventListener('abort', abortUpstream, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void pumpPatchURL(
        patchURL,
        upstreamController.signal,
        controller
      ).finally(() => {
        requestSignal.removeEventListener('abort', abortUpstream);
      });
    },
    cancel() {
      abortUpstream();
      requestSignal.removeEventListener('abort', abortUpstream);
    },
  });

  return createTextResponse(stream, options);
}

// Fetches the raw GitHub diff and forwards each upstream chunk into the client
// stream. `cache: 'no-store'` avoids Next/browser replay behavior that can
// turn a large streamed response back into a delayed full-response read.
async function pumpPatchURL(
  patchURL: string,
  signal: AbortSignal,
  controller: ReadableStreamDefaultController<Uint8Array>
): Promise<void> {
  try {
    const response = await fetch(patchURL, {
      cache: 'no-store',
      headers: { 'User-Agent': 'pierre-diffshub' },
      signal,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch patch: ${response.statusText}`);
    }

    const contentType = response.headers.get('Content-Type');
    if (contentType == null || !contentType.startsWith('text/plain')) {
      throw new Error(NON_DIFF_RESPONSE_MESSAGE);
    }

    if (response.body == null) {
      const patchText = await response.text();
      if (!NON_WHITESPACE_PATTERN.test(patchText)) {
        throw new Error(EMPTY_PATCH_MESSAGE);
      }

      controller.enqueue(new TextEncoder().encode(patchText));
      controller.close();
      return;
    }

    const reader = response.body.getReader();
    let sawContent = false;
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) {
          break;
        }

        if (result.value.byteLength > 0) {
          sawContent = true;
          controller.enqueue(result.value);
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (!sawContent) {
      throw new Error(EMPTY_PATCH_MESSAGE);
    }

    controller.close();
  } catch (error) {
    controller.error(error);
  }
}

// Centralizes text response headers for both stream and error bodies. Diff
// responses are intentionally not cached in the browser because cached 100MB+
// responses can replay poorly and delay the first useful diff bytes.
function createTextResponse(
  body: string | ReadableStream<Uint8Array>,
  { status = 200, sourceURL }: TextResponseOptions = {}
): Response {
  const headers = new Headers({
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': CACHE_CONTROL,
  });
  if (sourceURL != null) {
    headers.set('X-Patch-Source', sourceURL);
  }
  return new Response(body, {
    status,
    headers,
  });
}
