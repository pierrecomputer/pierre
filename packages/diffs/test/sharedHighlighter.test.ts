import { afterEach, describe, expect, test } from 'bun:test';

import {
  disposeHighlighter,
  getHighlighterIfLoaded,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';

afterEach(async () => {
  await disposeHighlighter();
});

describe('shared highlighter engine selection', () => {
  test('returns a cached highlighter instance until disposed', async () => {
    const first = await getSharedHighlighter({
      themes: ['pierre-dark'],
      langs: ['text'],
      preferredHighlighter: 'shiki-js',
    });

    const second = await getSharedHighlighter({
      themes: ['pierre-dark'],
      langs: ['text'],
      preferredHighlighter: 'shiki-wasm',
    });

    expect(second).toBe(first);
    expect(getHighlighterIfLoaded()).toBe(first);
  });

  test('can dispose and reinitialize with a different preferredHighlighter', async () => {
    const jsHighlighter = await getSharedHighlighter({
      themes: ['pierre-dark'],
      langs: ['text'],
      preferredHighlighter: 'shiki-js',
    });

    await disposeHighlighter();
    expect(getHighlighterIfLoaded()).toBeUndefined();

    const wasmHighlighter = await getSharedHighlighter({
      themes: ['pierre-dark'],
      langs: ['text'],
      preferredHighlighter: 'shiki-wasm',
    });

    expect(wasmHighlighter).not.toBe(jsHighlighter);
    expect(getHighlighterIfLoaded()).toBe(wasmHighlighter);
  });
});
