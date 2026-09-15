import { expect, test } from 'bun:test';

import { getSharedHighlighter } from '../src/highlighter';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { renderDiffWithHighlighter } from '../src/utils/renderDiffWithHighlighter';
import { renderFileWithHighlighter } from '../src/utils/renderFileWithHighlighter';
import type {
  WorkerRenderingOptions,
  WorkerRequest,
  WorkerResponse,
} from '../src/worker/types';
import { withTimeout } from './workerPoolHarness';

test.each(['highlights', 'shiki-wasm', 'shiki-js'] as const)(
  'the real worker loads %s and preserves setup/render order when switching',
  async (preferredHighlighter) => {
    const nextPreference =
      preferredHighlighter === 'highlights'
        ? 'shiki-js'
        : preferredHighlighter === 'shiki-js'
          ? 'shiki-wasm'
          : 'highlights';
    const options: WorkerRenderingOptions = {
      preferredHighlighter,
      theme: 'github-dark',
      useTokenTransformer: true,
      tokenizeMaxLineLength: 1000,
      lineDiffType: 'word-alt',
      maxLineDiffLength: 1000,
    };
    const nextOptions: WorkerRenderingOptions = {
      ...options,
      preferredHighlighter: nextPreference,
    };
    const [initialHighlighter, nextHighlighter] = await Promise.all([
      getSharedHighlighter({
        preferredHighlighter,
        themes: ['github-dark'],
        langs: ['typescript'],
      }),
      getSharedHighlighter({
        preferredHighlighter: nextPreference,
        themes: ['github-dark'],
        langs: ['css', 'typescript'],
      }),
    ]);
    const file = {
      name: 'example.ts',
      contents: 'const value: string = "<tag>";\n',
    };
    const diff = parseDiffFromFile(
      { name: 'before.css', contents: 'body { color: red; }\n' },
      { name: 'after.ts', contents: 'const value = true;\n' }
    );
    const requests: WorkerRequest[] = [
      {
        type: 'initialize',
        id: 'initialize',
        renderOptions: options,
        resolvedThemes: [initialHighlighter.getTheme('github-dark')],
      },
      { type: 'file', id: 'file', file },
      {
        type: 'set-render-options',
        id: 'switch',
        renderOptions: nextOptions,
        resolvedThemes: [nextHighlighter.getTheme('github-dark')],
      },
      { type: 'diff', id: 'diff', diff },
    ];
    const worker = new Worker(
      new URL('../src/worker/worker.ts', import.meta.url)
    );
    try {
      const responses = await withTimeout(
        new Promise<WorkerResponse[]>((resolve, reject) => {
          const received: WorkerResponse[] = [];
          worker.onerror = (event) => reject(new Error(event.message));
          worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
            if (data.type === 'error') {
              reject(new Error(data.error));
              return;
            }
            received.push(data);
            if (received.length === requests.length) resolve(received);
          };
          for (const request of requests) worker.postMessage(request);
        })
      );
      expect(responses.map(({ id }) => id)).toEqual([
        'initialize',
        'file',
        'switch',
        'diff',
      ]);
      expect(responses[1]).toMatchObject({
        type: 'success',
        requestType: 'file',
        options: { preferredHighlighter },
        result: renderFileWithHighlighter(file, initialHighlighter, options),
      });
      expect(responses[3]).toMatchObject({
        type: 'success',
        requestType: 'diff',
        options: nextOptions,
        result: renderDiffWithHighlighter(diff, nextHighlighter, nextOptions),
      });
    } finally {
      worker.terminate();
    }
  }
);
