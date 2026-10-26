import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import { DiffHunksRenderer } from '../src/renderers/DiffHunksRenderer';
import { FileRenderer } from '../src/renderers/FileRenderer';
import type { HighlighterTypes } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';

beforeEach(disposeHighlighter);
afterEach(disposeHighlighter);

for (const kind of ['file', 'diff'] as const) {
  describe(`${kind} renderer highlighter type`, () => {
    function createRenderer(options: {
      theme: string;
      preferredHighlighter?: HighlighterTypes;
    }) {
      return kind === 'file'
        ? new FileRenderer(options)
        : new DiffHunksRenderer(options);
    }

    test('reuses the loaded type despite another preference', async () => {
      const loaded = await getSharedHighlighter({
        themes: ['pierre-dark'],
        langs: ['typescript'],
        preferredHighlighter: 'shiki-js',
      });
      const renderer = createRenderer({
        theme: 'pierre-dark',
        preferredHighlighter: 'highlights',
      });
      try {
        expect(await renderer.initializeHighlighter()).toBe(loaded);
      } finally {
        renderer.cleanUp();
      }
    });

    test('follows the loaded type when no type is requested', async () => {
      const loaded = await getSharedHighlighter({
        themes: ['pierre-dark'],
        langs: ['typescript'],
        preferredHighlighter: 'highlights',
      });
      const renderer = createRenderer({ theme: 'pierre-dark' });
      try {
        expect(await renderer.initializeHighlighter()).toBe(loaded);
      } finally {
        renderer.cleanUp();
      }
    });

    for (const update of ['setOptions', 'mergeOptions'] as const) {
      test(`${update} accepts another preference and keeps the loaded type`, async () => {
        const options = {
          theme: 'pierre-dark',
          preferredHighlighter: 'shiki-js' as const,
        };
        const renderer = createRenderer(options);
        try {
          const highlighter = await renderer.initializeHighlighter();
          expect(() =>
            renderer[update]({
              ...options,
              preferredHighlighter: 'highlights',
            })
          ).not.toThrow();
          expect(await renderer.initializeHighlighter()).toBe(highlighter);
          expect(() =>
            renderer[update]({ theme: 'pierre-light' })
          ).not.toThrow();
        } finally {
          renderer.cleanUp();
        }
      });
    }

    for (const preferredHighlighter of [
      'shiki-js',
      'shiki-wasm',
      'highlights',
    ] as const) {
      test(`${preferredHighlighter} renders new content after the shared instance is disposed and recreated`, async () => {
        const renderer = createRenderer({
          theme: 'pierre-dark',
          preferredHighlighter,
        });
        try {
          for (const contents of ['const a = 1;\n', 'const b = 2;\n']) {
            await getSharedHighlighter({
              themes: ['pierre-dark'],
              langs: ['typescript'],
              preferredHighlighter,
            });
            const file = { name: 'test.ts', contents, cacheKey: contents };
            if (renderer instanceof FileRenderer) {
              expect(renderer.renderFile(file)?.file).toBe(file);
            } else {
              const diff = parseDiffFromFile(
                { name: 'test.ts', contents: '', cacheKey: `old-${contents}` },
                file
              );
              expect(renderer.renderDiff(diff)?.fileDiff).toBe(diff);
            }
            await disposeHighlighter();
          }
        } finally {
          renderer.cleanUp();
        }
      });
    }

    test('reports a theme that fails to load during hydrate and render', async () => {
      const logError = spyOn(console, 'error').mockImplementation(() => {});
      const renderer = createRenderer({ theme: 'missing-theme' });
      const initialize = spyOn(renderer, 'initializeHighlighter');
      const file = { name: 'test.ts', contents: 'const a = 1;\n' };
      try {
        if (renderer instanceof FileRenderer) {
          renderer.hydrate(file);
          renderer.renderFile(file);
        } else {
          const diff = parseDiffFromFile(
            { name: 'test.ts', contents: '' },
            file
          );
          renderer.hydrate(diff);
          renderer.renderDiff(diff);
        }
        expect(initialize).toHaveBeenCalledTimes(2);
        for (const { value } of initialize.mock.results) {
          await (value as Promise<unknown>).catch(() => undefined);
        }
        await Bun.sleep(0);
        expect(logError).toHaveBeenCalledTimes(2);
        for (const [error] of logError.mock.calls) {
          expect(String(error)).toContain('missing-theme');
        }
      } finally {
        logError.mockRestore();
        renderer.cleanUp();
      }
    });

    test('ignores a dispose while hydrate loads the highlighter', async () => {
      const logError = spyOn(console, 'error').mockImplementation(() => {});
      const renderer = createRenderer({ theme: 'pierre-dark' });
      const initialize = spyOn(renderer, 'initializeHighlighter');
      const file = { name: 'test.ts', contents: 'const a = 1;\n' };
      try {
        if (renderer instanceof FileRenderer) {
          renderer.hydrate(file);
        } else {
          renderer.hydrate(
            parseDiffFromFile({ name: 'test.ts', contents: '' }, file)
          );
        }
        await disposeHighlighter();
        const loading = initialize.mock.results[0]?.value as Promise<unknown>;
        expect(
          String(await loading.catch((error: unknown) => error))
        ).toContain('Highlighter is disposed');
        await Bun.sleep(0);
        expect(logError).not.toHaveBeenCalled();
      } finally {
        logError.mockRestore();
        renderer.cleanUp();
      }
    });

    test('loads another type after the previous one is disposed', async () => {
      await getSharedHighlighter({
        themes: ['pierre-dark'],
        langs: ['typescript'],
        preferredHighlighter: 'shiki-js',
      });
      await disposeHighlighter();
      const renderer = createRenderer({
        theme: 'pierre-dark',
        preferredHighlighter: 'highlights',
      });
      try {
        expect((await renderer.initializeHighlighter()).name).toBe(
          'highlights'
        );
      } finally {
        renderer.cleanUp();
      }
    });
  });
}
