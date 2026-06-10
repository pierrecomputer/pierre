import { afterEach, describe, expect, test } from 'bun:test';

import {
  disposeHighlighter,
  getHighlighterIfLoaded,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';

afterEach(async () => {
  await disposeHighlighter();
});

describe('shared highlighter cache lifecycle', () => {
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

  // The differing preferredHighlighter values are smoke inputs that exercise
  // both engine creation paths; instance identity cannot tell the engines
  // apart, so this test only verifies the dispose-then-recreate contract.
  test('disposeHighlighter clears the cache so the next getSharedHighlighter creates a fresh instance', async () => {
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
