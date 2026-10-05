/** @jsxImportSource react */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test';
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { DiffsHubStatusPanel } from '../components/DiffsHubStatusPanel';
import { usePatchLoader } from '../components/usePatchLoader';

const originalFetch = globalThis.fetch;
const originalGlobals = {
  document: Reflect.get(globalThis, 'document'),
  window: Reflect.get(globalThis, 'window'),
  IS_REACT_ACT_ENVIRONMENT: Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT'),
};
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  pretendToBeVisual: true,
  url: 'https://diffshub.com',
});
const patchText =
  'diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new\n';
const viewerRef = { current: null };
const onLoadStart = () => {};
let container: HTMLDivElement;
let root: Root;

function PatchLoaderHarness() {
  const result = usePatchLoader({
    collapseMode: 'expanded',
    path: '/owner/repo/compare/main...main',
    viewerRef,
    onLoadStart,
  });
  return (
    <div
      data-load-state={result.loadState}
      data-file-count={result.diffStats?.fileCount}
      data-item-count={result.initialItems.length}
    >
      <DiffsHubStatusPanel
        errorMessage={result.errorMessage}
        onRetry={result.retryLoad}
        state={result.loadState}
      />
    </div>
  );
}

beforeAll(() => {
  Object.assign(globalThis, {
    document: dom.window.document,
    window: dom.window,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
});

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.fetch = originalFetch;
});

afterAll(() => {
  for (const [key, value] of Object.entries(originalGlobals)) {
    if (value === undefined) {
      Reflect.deleteProperty(globalThis, key);
    } else {
      Object.assign(globalThis, { [key]: value });
    }
  }
  dom.window.close();
});

// Waits for the real hook's stream reads and browser yields to finish, rather
// than replacing its loading logic with a mock.
async function waitForLoad(): Promise<Element> {
  for (let attempt = 0; attempt < 100; attempt++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    const result = container.querySelector('[data-load-state]');
    if (
      result != null &&
      ['ready', 'empty', 'error'].includes(
        result.getAttribute('data-load-state') ?? ''
      )
    ) {
      return result;
    }
  }
  throw new Error('Patch load did not finish.');
}

function loadResponse(response: Response): Promise<Element> {
  spyOn(globalThis, 'fetch').mockResolvedValue(response);
  act(() => root.render(<PatchLoaderHarness />));
  return waitForLoad();
}

describe('patch loader and status panel', () => {
  test.each([
    { name: 'empty stream', body: '' },
    { name: 'bodyless response', body: null },
    { name: 'whitespace-only stream', body: ' \n\t' },
  ])('finishes a successful $name with No changes', async ({ body }) => {
    const result = await loadResponse(new Response(body));

    expect(result.getAttribute('data-load-state')).toBe('empty');
    expect(result.getAttribute('data-file-count')).toBe('0');
    expect(result.getAttribute('data-item-count')).toBe('0');
    expect(container.querySelector('h2')?.textContent).toBe('No changes');
    expect(container.querySelector('p')?.textContent).toBe(
      'There are no file changes in this diff.'
    );
    expect(
      container.querySelector(
        '[role="alert"], [aria-busy="true"], .animate-spin, button'
      )
    ).toBeNull();
  });

  test.each([
    { name: 'streamed Git diff', body: patchText },
    {
      name: 'fallback unified diff',
      body: patchText.slice(patchText.indexOf('\n') + 1),
    },
  ])('still loads a normal $name', async ({ body }) => {
    const result = await loadResponse(new Response(body));

    expect(result.getAttribute('data-load-state')).toBe('ready');
    expect(result.getAttribute('data-file-count')).toBe('1');
    expect(result.getAttribute('data-item-count')).toBe('1');
  });

  test('rejects a nonempty error payload returned with HTTP 200', async () => {
    const result = await loadResponse(
      new Response('Upstream service unavailable. Please try again later.', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    );

    expect(result.getAttribute('data-load-state')).toBe('error');
    expect(result.getAttribute('data-file-count')).toBeNull();
    expect(container.querySelector('h2')?.textContent).toBe(
      'Couldn’t load diff'
    );
    expect(container.querySelector('p')?.textContent).toBe(
      'The response did not contain a valid diff. Please try again.'
    );
    expect(container.querySelector('button')?.textContent).toBe('Try again');
  });

  test('replaces HTML errors with a status-based message and can retry', async () => {
    const fetchMock = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('<!DOCTYPE html><html>Server error</html>', {
          status: 500,
          headers: { 'Content-Type': 'text/html' },
        })
      )
      .mockResolvedValueOnce(new Response(''));
    act(() => root.render(<PatchLoaderHarness />));
    const result = await waitForLoad();

    expect(result.getAttribute('data-load-state')).toBe('error');
    expect(container.querySelector('p')?.textContent).toBe(
      'Request failed (500).'
    );
    expect(container.textContent).not.toContain('<html>');
    act(() => container.querySelector('button')!.click());
    expect((await waitForLoad()).getAttribute('data-load-state')).toBe('empty');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('preserves actionable plain-text errors', async () => {
    const message =
      'GitHub accepted the token, but it cannot access this repository. Grant Contents: read.';
    await loadResponse(
      new Response(message, {
        status: 403,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    );

    expect(container.querySelector('p')?.textContent).toBe(message);
    expect(container.querySelector('button')?.textContent).toBe('Try again');
  });

  test.each(['HTTP', 'stream'])(
    'bounds oversized %s errors',
    async (source) => {
      const message = 'Technical details '.repeat(1_000);
      const response =
        source === 'HTTP'
          ? new Response(message, {
              status: 500,
              headers: { 'Content-Type': 'text/plain' },
            })
          : new Response(
              new ReadableStream({
                start(controller) {
                  controller.error(new Error(message));
                },
              })
            );
      const result = await loadResponse(response);

      expect(result.getAttribute('data-load-state')).toBe('error');
      expect(container.querySelector('p')?.textContent).toBe(
        `${message.slice(0, 499)}…`
      );
      expect(container.querySelector('button')?.textContent).toBe('Try again');
    }
  );
});
