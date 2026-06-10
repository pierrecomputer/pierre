import 'server-only';
import type { InitialDiffshubPatchResponse } from './diffshubPatchTypes';

const CACHE_CONTROL = 'no-store';
const EMPTY_PATCH_MESSAGE = 'GitHub returned an empty diff.';
const GITHUB_HOST = 'github.com';
const GITHUB_RAW_DIFF_HOST = 'patch-diff.githubusercontent.com';
const NON_DIFF_RESPONSE_MESSAGE = 'GitHub did not return a diff for this URL.';
const NON_WHITESPACE_PATTERN = /\S/;
const RAW_GITHUB_DIFF_PATH_PATTERN =
  /^\/raw\/[^/]+\/[^/]+\/pull\/[^/]+\.(?:diff|patch)$/;
const GITHUB_PULL_TAB_PATH_PATTERN =
  /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/(?:changes|files)$/;

const CACHED_BLOBS = new Map<string, string>([
  [
    '/nodejs/oven-sh/bun/pull/30412',
    'https://diffshub.pierrecdn.com/patches/30412.diff',
  ],
  [
    '/nodejs/node/pull/59805',
    'https://diffshub.pierrecdn.com/patches/59805.diff',
  ],
  [
    '/ghostty-org/ghostty/pull/12291',
    'https://diffshub.pierrecdn.com/patches/12291.diff',
  ],
  [
    '/pierrecomputer/pierre/commit/0800fb',
    'https://diffshub.pierrecdn.com/patches/0800fb.diff',
  ],
  [
    '/torvalds/linux/compare/v6.0...v7.0',
    'https://diffshub.pierrecdn.com/patches/v6.0-v7.0.diff',
  ],
]);

const HIDDEN_PATCH_DOMAIN_RULES = [
  { domainRoot: 'tangled.org', defaultExtension: '.patch' },
] as const;

interface ResolvedPatchRequest {
  patchURL: string;
  sourceURL?: string;
}

export interface DiffshubPatchRequestInput {
  domain?: string | null;
  path?: string | null;
  url?: string | null;
}

// Shared patch loader used by both the API route and the initial server render.
// The API route returns the Response directly, while the page passes its body
// stream through React Flight so the client can consume bytes earlier.
export async function createDiffshubPatchResponse(
  { domain = null, path = null, url = null }: DiffshubPatchRequestInput,
  requestSignal: AbortSignal | null
): Promise<Response> {
  if (path == null && url == null) {
    return createTextResponse('Path or URL parameter is required', {
      status: 400,
    });
  }

  try {
    // The client normally sends only the GitHub-relative path, but GitHub also
    // exposes raw PR diffs through patch-diff.githubusercontent.com. Tangled
    // paths use an explicit domain query parameter and are normalized to their
    // patch endpoint.
    const patchRequest = resolvePatchRequest(path, domain, url);
    if (patchRequest == null) {
      return createTextResponse('Invalid GitHub patch URL format', {
        status: 400,
      });
    }

    return await createPatchStreamResponse(
      patchRequest.patchURL,
      requestSignal,
      {
        sourceURL: patchRequest.sourceURL ?? patchRequest.patchURL,
      }
    );
  } catch (error) {
    return createTextResponse(
      error instanceof Error ? error.message : 'Unknown error',
      { status: 500 }
    );
  }
}

export async function loadInitialDiffshubPatchResponse(
  input: DiffshubPatchRequestInput
): Promise<InitialDiffshubPatchResponse> {
  try {
    const response = await createDiffshubPatchResponse(input, null);

    if (!response.ok || response.body == null) {
      return {
        body: null,
        bodyText: await response.text(),
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
      };
    }

    return {
      body: decodePatchBody(response.body),
      bodyText: null,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
    };
  } catch (error) {
    return {
      body: null,
      bodyText: error instanceof Error ? error.message : 'Unknown error',
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    };
  }
}

// React Flight's binary ReadableStream path currently trips over long patch
// streams in dev. Decode on the server so the client receives text chunks via
// the model stream path while preserving incremental delivery.
function decodePatchBody(
  body: ReadableStream<Uint8Array>
): ReadableStream<string> {
  const decoder = new TextDecoder();
  const reader = body.getReader();

  return new ReadableStream<string>({
    async pull(controller) {
      const result = await reader.read();
      if (result.done) {
        const finalText = decoder.decode();
        if (finalText.length > 0) {
          controller.enqueue(finalText);
        }
        controller.close();
        reader.releaseLock();
        return;
      }

      if (result.value.byteLength > 0) {
        const text = decoder.decode(result.value, { stream: true });
        if (text.length > 0) {
          controller.enqueue(text);
        }
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        reader.releaseLock();
      }
    },
  });
}

// Resolves the accepted URL shapes to the exact upstream URL to fetch. Most
// callers send a GitHub-relative path, but this also permits GitHub's raw PR
// diff host and Tangled patch URLs without becoming a general URL fetcher.
function resolvePatchRequest(
  path: string | null,
  domain: string | null,
  url: string | null
): ResolvedPatchRequest | undefined {
  if (url != null) {
    return resolvePatchURLInput(url);
  }

  if (path == null) {
    return undefined;
  }

  if (domain != null) {
    const patchURL = resolveDomainPatchURL(domain, path);
    return patchURL == null ? undefined : { patchURL };
  }

  return resolvePatchURLInput(path);
}

function resolvePatchURLInput(input: string): ResolvedPatchRequest | undefined {
  if (input.startsWith('/')) {
    return resolveGitHubPatchRequest(input);
  }

  let parsedURL: URL;
  try {
    parsedURL = new URL(input);
  } catch {
    return undefined;
  }

  if (!isAllowedHTTPSURL(parsedURL)) {
    return undefined;
  }

  if (parsedURL.hostname === GITHUB_HOST) {
    return resolveGitHubPatchRequest(parsedURL.pathname);
  }

  if (
    parsedURL.hostname === GITHUB_RAW_DIFF_HOST &&
    RAW_GITHUB_DIFF_PATH_PATTERN.test(parsedURL.pathname)
  ) {
    return { patchURL: parsedURL.href };
  }

  const domainPatchURL = resolveDomainPatchURL(
    parsedURL.hostname,
    parsedURL.pathname
  );
  return domainPatchURL == null ? undefined : { patchURL: domainPatchURL };
}

function resolveGitHubPatchRequest(
  path: string
): ResolvedPatchRequest | undefined {
  const patchURL = resolveGitHubPath(path);
  return patchURL == null ? undefined : { patchURL };
}

function resolveDomainPatchURL(
  domain: string,
  path: string
): string | undefined {
  const domainRule = getHiddenPatchDomainRule(domain);
  if (domainRule == null) {
    return undefined;
  }

  const pathWithLeadingSlash = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`https://${domainRule.hostname}`);
  const normalizedPath = pathWithLeadingSlash.replace(/\/+$/, '');
  url.pathname = normalizedPath === '' ? '/' : normalizedPath;
  if (!url.pathname.endsWith(domainRule.defaultExtension)) {
    url.pathname += domainRule.defaultExtension;
  }

  return url.href;
}

function getHiddenPatchDomainRule(
  domain: string
): { defaultExtension: string; hostname: string } | undefined {
  let hostname: string;
  try {
    hostname = new URL(`https://${domain}`).hostname;
  } catch {
    return undefined;
  }

  for (const domainRule of HIDDEN_PATCH_DOMAIN_RULES) {
    if (
      hostname === domainRule.domainRoot ||
      hostname.endsWith(`.${domainRule.domainRoot}`)
    ) {
      return { defaultExtension: domainRule.defaultExtension, hostname };
    }
  }

  return undefined;
}

function resolveGitHubPath(path: string): string | undefined {
  if (path === '/') {
    return undefined;
  }

  let patchPath = normalizeGitHubPath(path);
  if (patchPath === '') {
    return undefined;
  }

  const blobPatchURL = CACHED_BLOBS.get(removeDiffExtension(patchPath));
  if (blobPatchURL != null) {
    return blobPatchURL;
  }

  if (!patchPath.endsWith('.patch') && !patchPath.endsWith('.diff')) {
    patchPath += '.diff';
  }

  return `https://${GITHUB_HOST}${patchPath}`;
}

function removeDiffExtension(path: string): string {
  if (path.endsWith('.patch')) {
    return path.slice(0, -'.patch'.length);
  }

  if (path.endsWith('.diff')) {
    return path.slice(0, -'.diff'.length);
  }

  return path;
}

function normalizeGitHubPath(path: string): string {
  const trimmedPath = path.replace(/\/+$/, '');
  const pullTabMatch = GITHUB_PULL_TAB_PATH_PATTERN.exec(trimmedPath);
  if (pullTabMatch == null) {
    return trimmedPath;
  }

  return `/${pullTabMatch[1]}/${pullTabMatch[2]}/pull/${pullTabMatch[3]}`;
}

function isAllowedHTTPSURL(url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    url.port === '' &&
    url.username === '' &&
    url.password === ''
  );
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

// Validates the upstream response before opening the client-facing stream so
// GitHub HTML pages and redirects become small text errors instead of Next.js
// error documents.
async function createPatchStreamResponse(
  patchURL: string,
  requestSignal: AbortSignal | null,
  options: Omit<TextResponseOptions, 'status'>
): Promise<Response> {
  const upstreamController = new AbortController();
  const removeRequestAbortListener = forwardAbortSignal(
    requestSignal,
    upstreamController
  );

  let response: Response;
  try {
    response = await fetch(patchURL, {
      cache: 'no-store',
      headers: { 'User-Agent': 'pierre-diffshub' },
      signal: upstreamController.signal,
    });
  } catch {
    removeRequestAbortListener();
    return createTextResponse('Failed to fetch patch.', { status: 502 });
  }

  if (!response.ok) {
    const status = response.status >= 400 ? response.status : 502;
    removeRequestAbortListener();
    return createTextResponse(
      `Failed to fetch patch: ${response.status} ${response.statusText}`,
      { status }
    );
  }

  const contentType = response.headers.get('Content-Type');
  if (contentType == null || !contentType.startsWith('text/plain')) {
    removeRequestAbortListener();
    return createTextResponse(NON_DIFF_RESPONSE_MESSAGE, { status: 415 });
  }

  if (response.headers.get('Content-Length') === '0') {
    removeRequestAbortListener();
    return createTextResponse(EMPTY_PATCH_MESSAGE, { status: 422 });
  }

  const responseBody = response.body;
  if (responseBody == null) {
    try {
      const patchText = await response.text();
      return createPatchTextResponse(patchText, options);
    } finally {
      removeRequestAbortListener();
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void pumpPatchBody(responseBody, controller).finally(() => {
        removeRequestAbortListener();
      });
    },
    cancel() {
      upstreamController.abort();
      removeRequestAbortListener();
    },
  });

  return createTextResponse(stream, options);
}

// Connects request cancellation to the upstream fetch without requiring callers
// without a request signal to invent a never-aborted signal.
function forwardAbortSignal(
  requestSignal: AbortSignal | null,
  upstreamController: AbortController
): () => void {
  if (requestSignal == null) {
    return () => {};
  }

  const abortUpstream = () => upstreamController.abort();
  if (requestSignal.aborted) {
    abortUpstream();
    return () => {};
  }

  requestSignal.addEventListener('abort', abortUpstream, { once: true });
  return () => requestSignal.removeEventListener('abort', abortUpstream);
}

// Forwards each validated upstream diff chunk into the client stream.
async function pumpPatchBody(
  body: ReadableStream<Uint8Array>,
  controller: ReadableStreamDefaultController<Uint8Array>
): Promise<void> {
  try {
    const reader = body.getReader();
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
