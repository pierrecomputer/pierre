import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { File, FileDiff, parseDiffFromFile } from '../src';
import {
  disposeHighlighter,
  isHighlighterNull,
} from '../src/highlighter/shared_highlighter';
import { preloadFile, preloadFileDiff } from '../src/ssr';
import { installDom } from './domHarness';

// Each test starts without a shared highlighter, so it can tell whether
// hydrating started loading one.
beforeEach(disposeHighlighter);
afterEach(disposeHighlighter);

const options = { theme: 'pierre-dark', disableFileHeader: true } as const;
const oldFile = { name: 'example.ts', contents: 'const answer = 1;\n' };
const newFile = { name: 'example.ts', contents: 'const answer = 2;\n' };

// Prerenders on the "server", then drops that highlighter so hydration starts
// from what a browser has on first load: markup and no highlighter.
async function prerender<T>(load: () => Promise<T>): Promise<T> {
  const result = await load();
  await disposeHighlighter();
  return result;
}

describe('lazyHighlighter', () => {
  test('File hydration preloads the highlighter by default', async () => {
    const { prerenderedHTML } = await prerender(() =>
      preloadFile({ file: oldFile, options })
    );
    const { cleanup } = installDom();
    const instance = new File({ ...options, disableErrorHandling: true });
    try {
      const fileContainer = document.createElement('div');
      instance.hydrate({ file: oldFile, fileContainer, prerenderedHTML });
      expect(isHighlighterNull()).toBe(false);
    } finally {
      instance.cleanUp();
      cleanup();
    }
  });

  test('File hydration waits for a render that needs the highlighter', async () => {
    const { prerenderedHTML } = await prerender(() =>
      preloadFile({ file: oldFile, options })
    );
    const { cleanup } = installDom();
    const instance = new File({
      ...options,
      disableErrorHandling: true,
      lazyHighlighter: true,
    });
    try {
      const fileContainer = document.createElement('div');
      instance.hydrate({ file: oldFile, fileContainer, prerenderedHTML });
      expect(isHighlighterNull()).toBe(true);
      // The prerendered markup stays in place, highlighted.
      expect(fileContainer.shadowRoot?.innerHTML).toContain('answer');

      instance.render({ file: newFile, fileContainer });
      expect(isHighlighterNull()).toBe(false);
    } finally {
      instance.cleanUp();
      cleanup();
    }
  });

  test('FileDiff hydration waits for a render that needs the highlighter', async () => {
    const { prerenderedHTML } = await prerender(() =>
      preloadFileDiff({
        fileDiff: parseDiffFromFile(oldFile, newFile),
        options,
      })
    );
    const { cleanup } = installDom();
    const instance = new FileDiff({
      ...options,
      disableErrorHandling: true,
      lazyHighlighter: true,
    });
    try {
      const fileContainer = document.createElement('div');
      instance.hydrate({
        fileDiff: parseDiffFromFile(oldFile, newFile),
        fileContainer,
        prerenderedHTML,
      });
      expect(isHighlighterNull()).toBe(true);

      instance.render({
        fileDiff: parseDiffFromFile(oldFile, {
          ...newFile,
          contents: 'const answer = 3;\n',
        }),
        fileContainer,
      });
      expect(isHighlighterNull()).toBe(false);
    } finally {
      instance.cleanUp();
      cleanup();
    }
  });
});
