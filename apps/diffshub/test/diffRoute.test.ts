import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { NextRequest } from 'next/server';

import { GET } from '../app/api/diff/route';

const originalFetch = globalThis.fetch;
const patchText =
  'diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new\n';

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function createCompareRequest(): NextRequest {
  const params = new URLSearchParams({
    path: '/nikelborm/qcode-effect-v4/compare/main%40%7B1022minutes%7D...main',
  });
  return new NextRequest(`https://diffshub.com/api/diff?${params}`);
}

describe('diff route', () => {
  test.each([
    { name: 'empty stream', body: '', contentLength: undefined },
    { name: 'Content-Length: 0', body: '', contentLength: '0' },
    { name: 'bodyless response', body: null, contentLength: undefined },
    { name: 'whitespace-only stream', body: ' \n\t', contentLength: undefined },
  ])('accepts a successful $name', async ({ body, contentLength }) => {
    const headers = new Headers({ 'Content-Type': 'text/plain' });
    if (contentLength != null) {
      headers.set('Content-Length', contentLength);
    }
    spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(body, { headers })
    );

    const response = await GET(createCompareRequest());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(body ?? '');
  });

  test('forwards diff chunks before the upstream stream finishes', async () => {
    let upstreamController!: ReadableStreamDefaultController<Uint8Array>;
    const encoder = new TextEncoder();
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        upstreamController = controller;
        controller.enqueue(encoder.encode(patchText));
      },
    });
    spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(upstream, { headers: { 'Content-Type': 'text/plain' } })
    );

    const response = await GET(createCompareRequest());
    const reader = response.body!.getReader();
    expect(response.status).toBe(200);
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(
      patchText
    );

    upstreamController.close();
    expect((await reader.read()).done).toBe(true);
    reader.releaseLock();
  });

  test('preserves real stream failures', async () => {
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('Upstream connection failed.'));
      },
    });
    spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(upstream, { headers: { 'Content-Type': 'text/plain' } })
    );

    const response = await GET(createCompareRequest());
    expect(response.text()).rejects.toThrow('Upstream connection failed.');
  });

  test.each([200, 500])(
    'rejects upstream HTML with status %i',
    async (status) => {
      spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('<!DOCTYPE html><html>Server error</html>', {
          status,
          headers: { 'Content-Type': 'text/html' },
        })
      );

      const response = await GET(createCompareRequest());

      expect(response.status).toBe(status === 200 ? 415 : status);
      expect(response.headers.get('Content-Type')).toBe(
        'text/plain; charset=utf-8'
      );
      expect(await response.text()).not.toContain('<html>');
    }
  );

  describe('pull request title header', () => {
    function createPullRequest(path: string): NextRequest {
      return new NextRequest(
        `https://diffshub.com/api/diff?${new URLSearchParams({ path })}`
      );
    }

    // Answers the PR metadata call and the diff call separately, the way
    // GitHub does, and records every URL that was requested.
    function mockGitHub(pullResponse: Response): string[] {
      const requested: string[] = [];
      spyOn(globalThis, 'fetch').mockImplementation((async (
        input: Parameters<typeof fetch>[0]
      ) => {
        const url = String(input);
        requested.push(url);
        return url.startsWith('https://api.github.com/repos/')
          ? pullResponse
          : new Response(patchText, {
              headers: { 'Content-Type': 'text/plain' },
            });
      }) as typeof fetch);
      return requested;
    }

    test('sends the encoded PR title for a public pull request', async () => {
      const requested = mockGitHub(
        Response.json({ title: 'Fix café rendering' })
      );

      const response = await GET(createPullRequest('/acme/widgets/pull/42'));

      expect(response.status).toBe(200);
      expect(response.headers.get('X-Diffshub-Title')).toBe(
        encodeURIComponent('Fix café rendering')
      );
      expect(await response.text()).toBe(patchText);
      expect(requested).toContain(
        'https://api.github.com/repos/acme/widgets/pulls/42'
      );
    });

    test('still serves the diff when the title lookup fails', async () => {
      mockGitHub(new Response('rate limited', { status: 403 }));

      const response = await GET(createPullRequest('/acme/widgets/pull/42'));

      expect(response.status).toBe(200);
      expect(response.headers.get('X-Diffshub-Title')).toBeNull();
      expect(await response.text()).toBe(patchText);
    });

    test('skips the title lookup for non-pull diffs', async () => {
      const requested = mockGitHub(Response.json({ title: 'unused' }));

      const response = await GET(
        createPullRequest('/acme/widgets/compare/main...dev')
      );

      expect(response.headers.get('X-Diffshub-Title')).toBeNull();
      expect(
        requested.some((url) => url.startsWith('https://api.github.com/'))
      ).toBe(false);
      await response.text();
    });
  });
});
