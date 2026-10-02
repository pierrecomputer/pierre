import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import { DiffHunksRenderer } from '../src/renderers/DiffHunksRenderer';
import { FileRenderer } from '../src/renderers/FileRenderer';
import { getRejection } from './testUtils';

beforeEach(disposeHighlighter);
afterEach(disposeHighlighter);

for (const kind of ['file', 'diff'] as const) {
  describe(`${kind} renderer highlighter type`, () => {
    function createRenderer(options: {
      theme: string;
      preferredHighlighter?: 'shiki-js' | 'highlights';
    }) {
      return kind === 'file'
        ? new FileRenderer(options)
        : new DiffHunksRenderer(options);
    }

    test('rejects an explicit type other than the loaded one', async () => {
      await getSharedHighlighter({
        themes: ['pierre-dark'],
        langs: ['typescript'],
        preferredHighlighter: 'shiki-js',
      });
      const renderer = createRenderer({
        theme: 'pierre-dark',
        preferredHighlighter: 'highlights',
      });
      try {
        expect(
          (await getRejection(renderer.initializeHighlighter())).message
        ).toContain(
          'Cannot load the "highlights" highlighter while "shiki-js" is in use'
        );
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
      test(`${update} rejects another type without changing the renderer`, async () => {
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
          ).toThrow(
            'Cannot load the "highlights" highlighter while "shiki-js" is in use'
          );
          expect(await renderer.initializeHighlighter()).toBe(highlighter);
          expect(() =>
            renderer[update]({ theme: 'pierre-light' })
          ).not.toThrow();
        } finally {
          renderer.cleanUp();
        }
      });
    }

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
