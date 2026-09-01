import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import chameleHighlighter from '../src/chamele';
import { FileStream } from '../src/components/FileStream';
import type { CodeHighlighter } from '../src/highlighter/code_highlighter';
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
  test('a coalesced line flushes on the timer when the source pauses', async () => {
    const wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
    let controller: ReadableStreamDefaultController<string> | undefined;
    const source = new ReadableStream<string>({
      start(c) {
        controller = c;
      },
    });
    const stream = new FileStream({
      lang: 'typescript',
      theme: { dark: 'pierre-dark', light: 'pierre-light' },
    });
    await stream.setup(source, wrapper);
    // the first newline-bearing chunk pushes immediately; the second lands
    // inside the coalescing window and is held back
    controller!.enqueue('let a = 1;\nconst b');
    controller!.enqueue(' = 2;\nlet c');
    // the held line must paint from the scheduled flush while the source
    // stays open — no further chunks, no close
    await new Promise((resolve) => setTimeout(resolve, 60));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const root = wrapper.querySelector('diffs-container')?.shadowRoot;
    const text = Array.from(
      root?.querySelectorAll('[data-content] [data-line]') ?? [],
      (line) => line.textContent?.replaceAll('\n', '') ?? ''
    ).join('\n');
    expect(text).toContain('const b = 2;');
    controller!.close();
    await new Promise((resolve) => setTimeout(resolve, 10));
    stream.cleanUp();
    wrapper.remove();
  });

  test('a reused stream keeps the highlighter it captured at setup', async () => {
    setHighlighter(shikiHighlighter);
    const wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
    const stream = new FileStream({
      lang: 'typescript',
      theme: { dark: 'pierre-dark', light: 'pierre-light' },
    });
    const feed = (chunks: string[]) =>
      new Promise<void>((resolve) => {
        stream.options.onStreamClose = () => resolve();
        void stream.setup(chunkedStream(chunks), wrapper);
      });
    try {
      await feed(['let a = 1;\n']);
      // swap the registration between two runs of the same stream instance;
      // the stream captured shiki at setup and must not mix in the newly
      // registered implementation's tokenizer
      let constructed = 0;
      const wrapped: CodeHighlighter = {
        ...chameleHighlighter,
        name: 'wrapped-chamele',
        TokenizeStream: class {
          constructor() {
            constructed++;
          }
          pushCode(): never[] {
            return [];
          }
          end(): never[][] {
            return [[]];
          }
        },
      };
      setHighlighter(wrapped);
      await feed(['let b = 2;\n']);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      expect(constructed).toBe(0);
      const root = wrapper.querySelector('diffs-container')?.shadowRoot;
      expect(root?.textContent).toContain('let b = 2;');
    } finally {
      setHighlighter(chameleHighlighter);
      stream.cleanUp();
      wrapper.remove();
    }
  });

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
