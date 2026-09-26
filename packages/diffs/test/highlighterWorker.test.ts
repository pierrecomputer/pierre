import { describe, expect, test } from 'bun:test';
import { toHtml } from 'hast-util-to-html';

import { resolveLanguages } from '../src/highlighter/languages/resolveLanguages';
import { resolveThemes } from '../src/highlighter/themes/resolveThemes';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import type { WorkerRequest, WorkerResponse } from '../src/worker/types';

// Exercise structured cloning and the real worker entrypoint without pool mocks.
function requestWorker(
  worker: Worker,
  request: WorkerRequest
): Promise<WorkerResponse> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Worker timed out handling ${request.type}`));
    }, 5000);
    const onMessage = ({ data }: MessageEvent<WorkerResponse>) => {
      if (data.id !== request.id) return;
      cleanup();
      if (data.type === 'error') reject(new Error(data.error));
      else resolve(data);
    };
    const onError = (event: ErrorEvent) => {
      cleanup();
      reject(new Error(event.message));
    };
    function cleanup() {
      clearTimeout(timeout);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    }
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage(request);
  });
}

describe('real highlighter workers', () => {
  for (const preferredHighlighter of [
    'shiki-js',
    'shiki-wasm',
    'highlights',
  ] as const) {
    test(`${preferredHighlighter} initializes, renders files and diffs, and changes themes`, async () => {
      const worker = new Worker(
        new URL('../src/worker/worker.ts', import.meta.url),
        { type: 'module' }
      );
      const renderOptions = {
        theme: 'pierre-dark',
        useTokenTransformer: true,
        tokenizeMaxLineLength: 1000,
        lineDiffType: 'word-alt',
        maxLineDiffLength: 1000,
      } as const;
      try {
        const initialized = await requestWorker(worker, {
          type: 'initialize',
          id: 'initialize',
          preferredHighlighter,
          renderOptions,
          resolvedThemes: await resolveThemes(
            ['pierre-dark'],
            preferredHighlighter
          ),
          resolvedLanguages:
            preferredHighlighter === 'highlights'
              ? []
              : await resolveLanguages(['typescript']),
        });
        expect(initialized.type === 'success' && initialized.requestType).toBe(
          'initialize'
        );
        const oldFile = {
          name: 'worker.ts',
          contents: 'const rocket = "🚀";\n',
        };
        const newFile = {
          name: 'worker.ts',
          contents: 'const rocket = "🌕";\n',
        };
        const file = await requestWorker(worker, {
          type: 'file',
          id: 'file',
          file: oldFile,
        });
        if (file.type !== 'success' || file.requestType !== 'file')
          throw new Error('Expected file result');
        expect(toHtml(file.result.code)).toContain('🚀');
        expect(toHtml(file.result.code)).toContain('data-char="0"');
        expect(file.result.baseThemeType).toBe('dark');
        const diff = await requestWorker(worker, {
          type: 'diff',
          id: 'diff',
          diff: parseDiffFromFile(oldFile, newFile),
        });
        if (diff.type !== 'success' || diff.requestType !== 'diff')
          throw new Error('Expected diff result');
        expect(toHtml(diff.result.code.additionLines)).toContain('🌕');
        expect(toHtml(diff.result.code.additionLines)).toContain(
          'data-diff-span'
        );
        await requestWorker(worker, {
          type: 'set-render-options',
          id: 'theme',
          renderOptions: { ...renderOptions, theme: 'pierre-light' },
          resolvedThemes: await resolveThemes(
            ['pierre-light'],
            preferredHighlighter
          ),
        });
        const light = await requestWorker(worker, {
          type: 'file',
          id: 'light',
          file: oldFile,
        });
        if (light.type !== 'success' || light.requestType !== 'file')
          throw new Error('Expected themed file result');
        expect(light.result.baseThemeType).toBe('light');
        expect(toHtml(light.result.code)).not.toBe(toHtml(file.result.code));
      } finally {
        worker.terminate();
      }
    });
  }
});
