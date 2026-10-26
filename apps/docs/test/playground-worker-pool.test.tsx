import { disposeHighlighter } from '@pierre/diffs';
import { WorkerPoolManager } from '@pierre/diffs/worker';
import { expect, spyOn, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { act, useContext, useState } from 'react';
import { createRoot } from 'react-dom/client';

import {
  PlaygroundHighlighterReadyContext,
  PlaygroundWorkerPool,
} from '../app/(diffs)/playground/PlaygroundWorkerPool';

function Content() {
  const ready = useContext(PlaygroundHighlighterReadyContext);
  const [saved, setSaved] = useState('fixture');
  return (
    <button
      data-ready={ready}
      onClick={() => setSaved('saved edit and comment')}
    >
      {saved}
    </button>
  );
}

test('changing the playground highlighter preserves accepted content', async () => {
  await disposeHighlighter();
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = Object.getOwnPropertyDescriptors(globalThis);
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const paused = Promise.withResolvers<void>();
  let pause: Promise<void> | undefined;
  const initialize = spyOn(
    WorkerPoolManager.prototype,
    'initialize'
  ).mockImplementation(() => pause ?? Promise.resolve());
  try {
    await act(async () => {
      root.render(
        <PlaygroundWorkerPool highlighter="shiki-js">
          <Content />
        </PlaygroundWorkerPool>
      );
      await Promise.resolve();
    });
    act(() => {
      container.querySelector('button')!.click();
    });
    expect(container.textContent).toBe('saved edit and comment');
    pause = paused.promise;
    act(() => {
      root.render(
        <PlaygroundWorkerPool highlighter="highlights">
          <Content />
        </PlaygroundWorkerPool>
      );
    });
    expect(container.textContent).toBe('saved edit and comment');
    expect(container.querySelector('button')?.dataset.ready).toBe('false');
    act(() => {
      root.render(
        <PlaygroundWorkerPool highlighter="shiki-js">
          <Content />
        </PlaygroundWorkerPool>
      );
    });
    expect(container.querySelector('button')?.dataset.ready).toBe('false');
    await act(async () => {
      paused.resolve();
      await paused.promise;
    });
    expect(container.querySelector('button')?.dataset.ready).toBe('true');
    expect(container.textContent).toBe('saved edit and comment');
  } finally {
    await act(async () => {
      root.unmount();
      paused.resolve();
      await paused.promise;
    });
    initialize.mockRestore();
    await disposeHighlighter();
    dom.window.close();
    for (const key of Object.keys(globals)) {
      const descriptor = previous[key];
      if (descriptor == null) Reflect.deleteProperty(globalThis, key);
      else Object.defineProperty(globalThis, key, descriptor);
    }
  }
});
