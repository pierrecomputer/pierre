import { afterEach, describe, expect, test } from 'bun:test';

import { getPreferredHighlighter } from '../getPreferredHighlighter';

const originalWebAssembly = globalThis.WebAssembly;

afterEach(() => {
  globalThis.WebAssembly = originalWebAssembly;
});

describe('getPreferredHighlighter', () => {
  test('prefers the wasm highlighter when WebAssembly is available', () => {
    expect(getPreferredHighlighter()).toBe('shiki-wasm');
  });

  test('falls back to the JS highlighter when WebAssembly is missing', () => {
    // Managed browsers can remove the global entirely on unapproved origins.
    // @ts-expect-error -- simulating a browser without WebAssembly
    delete globalThis.WebAssembly;
    expect(getPreferredHighlighter()).toBe('shiki-js');
  });
});
