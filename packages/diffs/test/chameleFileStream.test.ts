import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import chameleHighlighter from '../src/chamele';
import { FileStream } from '../src/components/FileStream';
import { setHighlighter } from '../src/highlighter/code_highlighter';
import { shikiHighlighter } from '../src/highlighter/shiki_highlighter';
import { installDom } from './domHarness';

let dom: ReturnType<typeof installDom>;

beforeAll(() => {
  dom = installDom();
  setHighlighter(chameleHighlighter);
  // FileStream appends its <pre> into the container's shadow root, which the
  // real diffs-container custom element attaches on upgrade; register a
  // minimal stand-in since jsdom lacks the constructable-stylesheet APIs the
  // shipped web component needs.
  const { customElements } = window;
  if (customElements.get('diffs-container') == null) {
    customElements.define(
      'diffs-container',
      class extends window.HTMLElement {
        constructor() {
          super();
          if (this.shadowRoot == null) {
            this.attachShadow({ mode: 'open' });
          }
        }
      }
    );
  }
});

afterAll(() => {
  setHighlighter(shikiHighlighter);
  dom.cleanup();
});

function chunkedStream(chunks: string[]): ReadableStream<string> {
  return new ReadableStream<string>({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
        // yield between chunks like a real network stream
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      controller.close();
    },
  });
}

async function streamToText(chunks: string[]): Promise<{
  text: string;
  root: ShadowRoot;
}> {
  const wrapper = document.createElement('div');
  document.body.appendChild(wrapper);
  const closed = new Promise<void>((resolve) => {
    const stream = new FileStream({
      lang: 'typescript',
      theme: { dark: 'pierre-dark', light: 'pierre-light' },
      onStreamClose: () => resolve(),
    });
    void stream.setup(chunkedStream(chunks), wrapper);
  });
  await closed;
  // let the queued render flush
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  // FileStream renders into the diffs-container shadow root
  const root = wrapper.querySelector('diffs-container')?.shadowRoot;
  if (root == null) throw new Error('missing diffs-container shadow root');
  const lines = Array.from(
    root.querySelectorAll('[data-content] [data-line]'),
    (line) => line.textContent?.replaceAll('\n', '') ?? ''
  );
  return { text: lines.join('\n'), root };
}

describe('FileStream with the chamele highlighter', () => {
  test('reassembles code split at hostile chunk boundaries', async () => {
    // boundaries split a CRLF pair, an astral emoji pair, and a keyword
    const source = 'const a = 1;\r\nconst e = "\u{1F600}";\nlet done = true;';
    const chunks = [
      'const a = 1;\r',
      '\nconst e = "\u{1F600}'.slice(0, 13), // ends on the high surrogate
      '\nconst e = "\u{1F600}'.slice(13),
      '";\nlet do',
      'ne = true;',
    ];
    expect(chunks.join('')).toBe(source);
    const { text, root } = await streamToText(chunks);
    expect(text).toBe('const a = 1;\nconst e = "\u{1F600}";\nlet done = true;');
    // chamele tokenized in the browser path: keyword spans carry its colors
    const spans = Array.from(
      root.querySelectorAll('[data-content] span'),
      (span) => span.getAttribute('style') ?? ''
    );
    expect(spans.some((style) => style.includes('#ff678d'))).toBe(true);
  });

  test('a trailing line without a newline still renders', async () => {
    const { text } = await streamToText(['let a = 1;\nlet b', ' = 2;']);
    expect(text).toBe('let a = 1;\nlet b = 2;');
  });
});
