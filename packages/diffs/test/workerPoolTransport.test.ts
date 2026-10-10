import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { toHtml } from 'hast-util-to-html';

import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { renderDiffWithHighlighter } from '../src/utils/renderDiffWithHighlighter';
import { renderFileWithHighlighter } from '../src/utils/renderFileWithHighlighter';
import type { WorkerWireResponse } from '../src/worker/workerMessage';
import { WorkerPoolManager } from '../src/worker/WorkerPoolManager';
import { installAnimationFramePolyfill } from './workerPoolHarness';

let restoreAnimationFrame: (() => void) | undefined;

beforeAll(() => {
  restoreAnimationFrame = installAnimationFramePolyfill();
});
beforeEach(disposeHighlighter);
afterAll(async () => {
  restoreAnimationFrame?.();
  await disposeHighlighter();
});

describe('worker cache transport', () => {
  for (const preferredHighlighter of [
    'shiki-js',
    'shiki-wasm',
    'highlights',
  ] as const) {
    for (const useTokenTransformer of [false, true]) {
      test(`${preferredHighlighter}, token transformer ${useTokenTransformer}`, async () => {
        const theme = { dark: 'pierre-dark', light: 'pierre-light' } as const;
        let compactFileResult = false;
        let compactDiffResult = false;
        const manager = new WorkerPoolManager(
          {
            poolSize: 1,
            workerFactory: () => {
              const worker = new Worker(
                new URL('../src/worker/worker.ts', import.meta.url),
                { type: 'module' }
              );
              worker.addEventListener(
                'message',
                ({ data }: MessageEvent<WorkerWireResponse>) => {
                  if (data.type !== 'success') return;
                  if (data.requestType === 'file')
                    compactFileResult = !Array.isArray(data.result.code);
                  else if (data.requestType === 'diff')
                    compactDiffResult =
                      !Array.isArray(data.result.code.additionLines) &&
                      !Array.isArray(data.result.code.deletionLines);
                }
              );
              return worker;
            },
          },
          { preferredHighlighter, theme, useTokenTransformer }
        );
        const oldFile = {
          name: 'transport.ts',
          cacheKey: 'transport:old',
          contents:
            '/* 🚀\ncontinued */\nconst value = "<&雪";\n\nexport { value };\n',
        };
        const newFile = {
          name: 'transport.ts',
          cacheKey: 'transport:new',
          contents: oldFile.contents.replace('"<&雪"', '"🌕"'),
        };
        const diff = parseDiffFromFile(oldFile, newFile);
        try {
          await manager.initialize();
          await Promise.all([
            manager.primeFileHighlightCache(oldFile),
            manager.primeDiffHighlightCache(diff),
          ]);
          const fileCache = manager.getFileResultCache(oldFile);
          const diffCache = manager.getDiffResultCache(diff);
          if (fileCache == null || diffCache == null)
            throw new Error('Expected cached results');
          expect(compactFileResult).toBe(true);
          expect(compactDiffResult).toBe(true);
          expect(Array.isArray(fileCache.result.code)).toBe(true);
          expect(Array.isArray(diffCache.result.code.additionLines)).toBe(true);
          expect(
            Object.getOwnPropertyDescriptor(fileCache.result.code, '0')?.get
          ).toBeDefined();
          expect(
            Object.getOwnPropertyDescriptor(
              diffCache.result.code.additionLines,
              '0'
            )?.get
          ).toBeDefined();
          const highlighter = await getSharedHighlighter({
            preferredHighlighter,
            langs: ['typescript'],
            themes: ['pierre-dark', 'pierre-light'],
          });
          const expectedFile = renderFileWithHighlighter(
            oldFile,
            highlighter,
            manager.getFileRenderOptions()
          );
          const expectedDiff = renderDiffWithHighlighter(
            diff,
            highlighter,
            manager.getDiffRenderOptions()
          );
          expect(structuredClone(fileCache.result)).toEqual(expectedFile);
          expect(structuredClone(diffCache.result)).toEqual(expectedDiff);
          expect(toHtml(diffCache.result.code.additionLines)).toContain(
            'data-diff-span'
          );
          expect(manager.getFileResultCache(oldFile)).toBe(fileCache);
          expect(manager.getDiffResultCache(diff)).toBe(diffCache);
          const line = fileCache.result.code[2];
          if (line.type !== 'element')
            throw new Error('Expected a line element');
          line.properties['data-marker'] = 'persist';
          expect(manager.getFileResultCache(oldFile)?.result.code[2]).toBe(
            line
          );
          expect(manager.getStats().activeTasks).toBe(0);
        } finally {
          manager.terminate();
        }
      });
    }
  }
});
