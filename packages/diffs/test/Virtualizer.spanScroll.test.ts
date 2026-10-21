import { expect, test } from 'bun:test';

import { Virtualizer } from '../src/components/Virtualizer';
import type { ScrollRequestResult } from '../src/types';
import { createRoot, installDom, wait, waitFor } from './domHarness';

const VIEWPORT_HEIGHT = 800;

// Sets up a real Virtualizer on an 800px root and returns it with a helper
// that issues span scroll requests and records how each one ended.
function setupVirtualizer() {
  const root = createRoot({ height: VIEWPORT_HEIGHT });
  // jsdom has no layout, so give the root room to scroll.
  Object.defineProperty(root, 'scrollHeight', { value: 10_000 });
  const content = document.createElement('div');
  root.appendChild(content);
  const virtualizer = new Virtualizer();
  virtualizer.setup(root, content);
  const request = (
    span: { top: number; height: number } | undefined,
    align: ScrollLogicalPosition = 'nearest'
  ): ScrollRequestResult[] => {
    const results: ScrollRequestResult[] = [];
    virtualizer.scrollSpanIntoView({
      align,
      resolveSpan: () => span,
      onDone: (result) => results.push(result),
    });
    return results;
  };
  return { root, virtualizer, request };
}

test('scrolls a span below the viewport to its bottom edge, then settles', async () => {
  const dom = installDom();
  try {
    const { root, virtualizer, request } = setupVirtualizer();
    const results = request({ top: 2000, height: 20 });
    await waitFor(() => results.length > 0);
    expect(results).toEqual(['settled']);
    expect(root.scrollTop).toBe(2020 - VIEWPORT_HEIGHT);
    virtualizer.cleanUp();
  } finally {
    dom.cleanup();
  }
});

test('start and end align a span to the viewport top and bottom', async () => {
  const dom = installDom();
  try {
    const { root, virtualizer, request } = setupVirtualizer();
    // 'start' moves a span that is already in view, unlike 'nearest'.
    const visible = request({ top: 300, height: 20 }, 'start');
    await waitFor(() => visible.length > 0);
    expect(root.scrollTop).toBe(300);

    const end = request({ top: 2000, height: 20 }, 'end');
    await waitFor(() => end.length > 0);
    expect(end).toEqual(['settled']);
    expect(root.scrollTop).toBe(2020 - VIEWPORT_HEIGHT);

    const start = request({ top: 2000, height: 20 }, 'start');
    await waitFor(() => start.length > 0);
    expect(start).toEqual(['settled']);
    expect(root.scrollTop).toBe(2000);
    virtualizer.cleanUp();
  } finally {
    dom.cleanup();
  }
});

// An instance change makes the next pass render with the old window and queue
// a corrected pass; settling before that pass would report rows that are not
// mounted yet.
test('waits for the corrected pass an instance change queues', async () => {
  const dom = installDom();
  try {
    const { root, virtualizer } = setupVirtualizer();
    let renders = 0;
    const instance = {
      onRender: () => {
        renders += 1;
        return true;
      },
      reconcileHeights: () => false,
      setVisibility: () => {},
    };
    const container = document.createElement('diffs-container');
    root.firstElementChild?.appendChild(container);
    virtualizer.connect(container, instance);
    await waitFor(() => renders > 0);

    renders = 0;
    const settledAfter: number[] = [];
    virtualizer.instanceChanged(instance, true);
    virtualizer.scrollSpanIntoView({
      align: 'nearest',
      resolveSpan: () => ({ top: 100, height: 20 }),
      onDone: () => settledAfter.push(renders),
    });
    await waitFor(() => settledAfter.length > 0);
    expect(settledAfter).toEqual([2]);
    virtualizer.cleanUp();
  } finally {
    dom.cleanup();
  }
});

test('a newer request cancels the pending one', async () => {
  const dom = installDom();
  try {
    const { virtualizer, request } = setupVirtualizer();
    const first = request({ top: 2000, height: 20 });
    const second = request({ top: 100, height: 20 });
    await waitFor(() => second.length > 0);
    expect(first).toEqual(['cancelled']);
    expect(second).toEqual(['settled']);
    virtualizer.cleanUp();
  } finally {
    dom.cleanup();
  }
});

test('a public scrollTo replaces a pending span scroll', async () => {
  const dom = installDom();
  try {
    const { root, virtualizer, request } = setupVirtualizer();
    const results = request({ top: 2000, height: 20 });
    virtualizer.scrollTo({ top: 6000 });
    expect(results).toEqual(['cancelled']);
    await wait(50);
    expect(root.scrollTop).toBe(6000);
    virtualizer.cleanUp();
  } finally {
    dom.cleanup();
  }
});

// A replaced request's cancel callback may itself request again; that newer
// request must win over the replacement that triggered the callback.
test('a request made from a cancel callback supersedes the replacement', async () => {
  const dom = installDom();
  try {
    const { virtualizer } = setupVirtualizer();
    const results: string[] = [];
    const resolveSpan = () => ({ top: 100, height: 20 });
    virtualizer.scrollSpanIntoView({
      align: 'nearest',
      resolveSpan,
      onDone: (result) => {
        results.push(`a:${result}`);
        virtualizer.scrollSpanIntoView({
          align: 'nearest',
          resolveSpan,
          onDone: (next) => results.push(`c:${next}`),
        });
      },
    });
    virtualizer.scrollSpanIntoView({
      align: 'nearest',
      resolveSpan,
      onDone: (result) => results.push(`b:${result}`),
    });
    await waitFor(() => results.length >= 3);
    expect(results).toEqual(['a:cancelled', 'b:cancelled', 'c:settled']);
    virtualizer.cleanUp();
  } finally {
    dom.cleanup();
  }
});

test('cancelScroll with onDone only cancels its own request', async () => {
  const dom = installDom();
  try {
    const { virtualizer, request } = setupVirtualizer();
    const results = request({ top: 100, height: 20 });
    virtualizer.cancelScroll(() => {});
    await waitFor(() => results.length > 0);
    expect(results).toEqual(['settled']);
    virtualizer.cleanUp();
  } finally {
    dom.cleanup();
  }
});

test('an unresolvable span cancels', async () => {
  const dom = installDom();
  try {
    const { virtualizer, request } = setupVirtualizer();
    const results = request(undefined);
    await waitFor(() => results.length > 0);
    expect(results).toEqual(['cancelled']);
    virtualizer.cleanUp();
  } finally {
    dom.cleanup();
  }
});

// Editor key commands prevent default and request their own scroll, and keys
// that don't scroll natively never take over, so only unhandled scroll input
// cancels.
test('user scroll input cancels, but handled and non-scroll keys do not', async () => {
  const dom = installDom();
  try {
    const { root, virtualizer, request } = setupVirtualizer();
    const wheeled = request({ top: 2000, height: 20 });
    root.dispatchEvent(new window.WheelEvent('wheel', { bubbles: true }));
    expect(wheeled).toEqual(['cancelled']);

    const handled = request({ top: 2000, height: 20 });
    const keydown = new window.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
    });
    keydown.preventDefault();
    root.dispatchEvent(keydown);
    await waitFor(() => handled.length > 0);
    expect(handled).toEqual(['settled']);

    // A held Cmd+V repeats keydown between its paste and the next frame.
    const pasting = request({ top: 2000, height: 20 });
    root.dispatchEvent(
      new window.KeyboardEvent('keydown', {
        bubbles: true,
        key: 'v',
        metaKey: true,
      })
    );
    await waitFor(() => pasting.length > 0);
    expect(pasting).toEqual(['settled']);

    const arrowed = request({ top: 2000, height: 20 });
    root.dispatchEvent(
      new window.KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' })
    );
    expect(arrowed).toEqual(['cancelled']);
    virtualizer.cleanUp();
  } finally {
    dom.cleanup();
  }
});
