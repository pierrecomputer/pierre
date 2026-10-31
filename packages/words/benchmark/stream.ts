import type { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import type { ComponentType } from 'react';
import type { Root } from 'react-dom/client';

import type { streamers } from './shared.ts';

let dom: JSDOM | undefined;

export async function loadStream(engine: (typeof streamers)[number]) {
  if (dom == null) {
    const { JSDOM, VirtualConsole } = await import('jsdom');
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', (error: Error) => {
      throw error;
    });
    dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'https://benchmark.example/',
      pretendToBeVisual: true,
      virtualConsole,
    });
    // JSDOM has no layout. Streamdown's scroll effects still need stored offsets.
    dom.window.HTMLElement.prototype.scrollTo = function (
      options?: ScrollToOptions | number,
      top?: number
    ) {
      this.scrollLeft =
        typeof options === 'number'
          ? options
          : (options?.left ?? this.scrollLeft);
      this.scrollTop =
        typeof options === 'number'
          ? (top ?? this.scrollTop)
          : (options?.top ?? this.scrollTop);
    };
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      HTMLElement: dom.window.HTMLElement,
      Element: dom.window.Element,
      Node: dom.window.Node,
      MutationObserver: dom.window.MutationObserver,
      requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
      cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
      getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    });
  }
  // Import after DOM setup: Words chooses its layout effect at module load.
  const { createElement } = await import('react');
  const { flushSync } = await import('react-dom');
  const { createRoot } = await import('react-dom/client');
  const Component = (
    engine === 'words-react'
      ? (await import('@pierre/words/react')).Markdown
      : (await import('streamdown')).Streamdown
  ) as ComponentType<{
    children?: string;
    mode: 'streaming';
    isAnimating: boolean;
    controls: false;
    lineNumbers: false;
  }>;
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  let renderError: unknown;
  return {
    run(source: string, chunkSize: number): HTMLElement {
      assert.equal(
        root,
        undefined,
        'Clean up the previous stream before replay'
      );
      container = document.createElement('div');
      document.body.append(container);
      root = createRoot(container, {
        onUncaughtError(error) {
          renderError = error;
        },
      });
      for (const end of [...chunkEnds(source, chunkSize), -1]) {
        const final = end === -1;
        flushSync(() =>
          root!.render(
            createElement(
              Component,
              {
                mode: 'streaming',
                isAnimating: !final,
                controls: false,
                lineNumbers: false,
              },
              source.slice(0, final ? source.length : end)
            )
          )
        );
        if (renderError !== undefined) throw renderError;
      }
      return container;
    },
    cleanup() {
      if (root != null) flushSync(() => root!.unmount());
      root = undefined;
      container?.remove();
      container = undefined;
      renderError = undefined;
    },
  };
}

export function chunkEnds(source: string, chunkSize: number): number[] {
  assert.ok(
    Number.isSafeInteger(chunkSize) && chunkSize > 0,
    '--chunk-size must be a positive integer'
  );
  const ends: number[] = [];
  for (let end = 0; end < source.length; ) {
    end = Math.min(end + chunkSize, source.length);
    const previous = source.charCodeAt(end - 1);
    const next = source.charCodeAt(end);
    if (
      previous >= 0xd800 &&
      previous <= 0xdbff &&
      next >= 0xdc00 &&
      next <= 0xdfff
    )
      end++;
    ends.push(end);
  }
  return ends;
}
