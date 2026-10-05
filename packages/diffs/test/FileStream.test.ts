import { afterAll, beforeEach, expect, test } from 'bun:test';

import { FileStream } from '../src/components/FileStream';
import { DIFFS_TAG_NAME } from '../src/constants';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import { createRoot, installDom, wait, waitFor } from './domHarness';
import { getRejection } from './testUtils';

// Each test loads its backend fresh: only one highlighter type can be loaded.
beforeEach(disposeHighlighter);
afterAll(disposeHighlighter);

function installStreamDom() {
  const dom = installDom();
  // FileStream expects the browser's diffs-container to create its shadow root.
  dom.window.customElements.define(
    DIFFS_TAG_NAME,
    class extends dom.window.HTMLElement {
      constructor() {
        super();
        this.attachShadow({ mode: 'open' });
      }
    }
  );
  return dom;
}

for (const preferredHighlighter of [
  'shiki-js',
  'shiki-wasm',
  'highlights',
] as const) {
  for (const renderEachChunk of [false, true]) {
    test(`${preferredHighlighter} renders CR and CRLF rows with ${renderEachChunk ? 'separate' : 'batched'} frames`, async () => {
      const dom = installStreamDom();
      try {
        for (const chunks of [
          ['a\rb'],
          ['a\r', 'b'],
          ['a\r', '\nb'],
          ['a\r\nb'],
          ['a\r'],
          ['a', '\r', '\r', 'b'],
          ['a\r', '\r\n', 'b'],
        ]) {
          const root = createRoot();
          let controller!: ReadableStreamDefaultController<string>;
          const source = new ReadableStream<string>({
            start(value) {
              controller = value;
            },
          });
          let rendered = 0;
          let closed = false;
          const stream = new FileStream({
            preferredHighlighter,
            theme: 'pierre-dark',
            lang: 'text',
            startingLineIndex: 3,
            onPostRender: () => {
              rendered++;
            },
            onStreamClose: () => {
              closed = true;
            },
          });
          try {
            await stream.setup(source, root);
            for (const chunk of chunks) {
              const previousRender = rendered;
              controller.enqueue(chunk);
              if (renderEachChunk) {
                await waitFor(() => rendered > previousRender);
                expect(rendered).toBeGreaterThan(previousRender);
              }
            }
            controller.close();
            await waitFor(() => closed);
            expect(closed).toBe(true);
            await wait();
            const shadow = root.firstElementChild?.shadowRoot;
            const expected = chunks.join('').split(/\r\n|\r|\n/);
            const rows = Array.from(
              shadow?.querySelectorAll('[data-content] > [data-line]') ?? []
            );
            expect(
              rows.map((row) => row.textContent?.replaceAll('\n', ''))
            ).toEqual(expected);
            expect(rows.map((row) => row.getAttribute('data-line'))).toEqual(
              expected.map((_, index) => String(index + 3))
            );
            expect(
              Array.from(
                shadow?.querySelectorAll('[data-line-number-content]') ?? [],
                (number) => number.textContent
              )
            ).toEqual(expected.map((_, index) => String(index + 3)));
          } finally {
            stream.cleanUp();
            await wait();
            root.remove();
          }
        }
      } finally {
        dom.cleanup();
      }
    });
  }
}

test('setup can retry after the highlighter request rejects', async () => {
  const dom = installStreamDom();
  const root = createRoot();
  let closed = false;
  const stream = new FileStream({
    preferredHighlighter: 'shiki-js',
    theme: 'pierre-dark',
    lang: 'text',
    onStreamClose: () => {
      closed = true;
    },
  });
  const source = () =>
    new ReadableStream<string>({
      start(controller) {
        controller.enqueue('retried');
        controller.close();
      },
    });
  try {
    await getSharedHighlighter({
      themes: ['pierre-dark'],
      langs: [],
      preferredHighlighter: 'highlights',
    });
    expect(
      (await getRejection(stream.setup(source(), root))).message
    ).toContain(
      'Cannot load the "shiki-js" highlighter while "highlights" is in use'
    );
    await disposeHighlighter();
    await stream.setup(source(), root);
    await waitFor(() => closed);
    await wait();
    expect(
      root.firstElementChild?.shadowRoot?.querySelector(
        '[data-content] > [data-line]'
      )?.textContent
    ).toBe('retried');
  } finally {
    stream.cleanUp();
    await wait();
    root.remove();
    dom.cleanup();
  }
});
