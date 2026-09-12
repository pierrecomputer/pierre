import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

import type { WorkerResponse } from '../../src/worker/types';

test('the portable worker highlights from a blob without fetching dependencies', async ({
  page,
}) => {
  const source = await readFile(
    new URL('../../dist/worker/worker-portable.js', import.meta.url),
    'utf8'
  );
  await page.goto('/test/e2e/fixtures/index.html');
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  const result = await page.evaluate(
    (code) =>
      new Promise<WorkerResponse>((resolve, reject) => {
        const url = URL.createObjectURL(
          new Blob([code], { type: 'text/javascript' })
        );
        const worker = new Worker(url, { type: 'module' });
        worker.onerror = (event) => {
          worker.terminate();
          URL.revokeObjectURL(url);
          reject(new Error(event.message));
        };
        worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
          if (data.type === 'success' && data.requestType === 'initialize') {
            worker.postMessage({
              type: 'file',
              id: 'file',
              file: {
                name: 'example.ts',
                contents: 'const value = "<tag>";\n',
              },
            });
          } else {
            worker.terminate();
            URL.revokeObjectURL(url);
            resolve(data);
          }
        };
        worker.postMessage({
          type: 'initialize',
          id: 'initialize',
          renderOptions: {
            theme: { dark: 'portable-dark', light: 'portable-light' },
            useTokenTransformer: true,
            tokenizeMaxLineLength: 1000,
            lineDiffType: 'word-alt',
            maxLineDiffLength: 1000,
          },
          resolvedThemes: [
            {
              name: 'portable-dark',
              appearance: 'dark',
              style: {
                background: '#000000',
                foreground: '#ffffff',
                syntax: { keyword: '#ff0000' },
              },
            },
            {
              name: 'portable-light',
              appearance: 'light',
              style: {
                background: '#ffffff',
                foreground: '#000000',
                syntax: { keyword: '#0000ff' },
              },
            },
          ],
        });
      }),
    source
  );
  expect(result.type).toBe('success');
  if (result.type !== 'success' || result.requestType !== 'file')
    throw new Error('Expected highlighted file');
  expect(result.result.code).toHaveLength(2);
  expect(JSON.stringify(result.result.code)).toContain(
    '--diffs-token-dark:#ff0000'
  );
  expect(JSON.stringify(result.result.code)).toContain(
    '--diffs-token-light:#0000ff'
  );
  expect(JSON.stringify(result.result.code)).toContain('data-char');
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatch(/^blob:/);
});
