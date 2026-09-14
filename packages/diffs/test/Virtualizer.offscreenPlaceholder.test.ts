import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import { VirtualizedFile } from '../src/components/VirtualizedFile';
import { VirtualizedFileDiff } from '../src/components/VirtualizedFileDiff';
import { Virtualizer } from '../src/components/Virtualizer';
import { DEFAULT_VIRTUAL_FILE_METRICS } from '../src/constants';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { createRoot, installDom } from './domHarness';

class TestVirtualizedFile extends VirtualizedFile {
  getRenderedContentForTest() {
    return this.getRenderedFile();
  }
}

class TestVirtualizedFileDiff extends VirtualizedFileDiff {
  getRenderedContentForTest() {
    return this.getRenderedDiff();
  }
}

// Advance only explicitly requested frames so a render loop fails an assertion
// instead of hanging the test or depending on how quickly timers happen to run.
function installFrameHarness() {
  const dom = installDom();
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrameId = 0;
  let time = 0;

  globalThis.requestAnimationFrame = (callback) => {
    const id = ++nextFrameId;
    frames.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    frames.delete(id);
  };

  return {
    dom,
    frames,
    flushFrames(limit: number): number {
      let count = 0;
      while (frames.size > 0 && count < limit) {
        const callbacks = [...frames.values()];
        frames.clear();
        time += 16;
        count++;
        for (const callback of callbacks) {
          callback(time);
        }
      }
      return count;
    },
  };
}

// Keep the element beyond the real virtualizer's visibility margin. Geometry
// follows the placeholder's CSS height because jsdom does not perform layout.
function createOffscreenFixture(kind: 'file' | 'diff') {
  const harness = installFrameHarness();
  const root = createRoot({ height: 600 });
  const content = document.createElement('div');
  const container = document.createElement('diffs-container');
  root.appendChild(content);
  content.appendChild(container);
  const placeholderHeight = () =>
    Number.parseFloat(
      container.shadowRoot?.querySelector<HTMLElement>('[data-placeholder]')
        ?.style.height ?? '0'
    );

  container.getBoundingClientRect = () => ({
    top: 10_000,
    bottom: 10_000 + placeholderHeight(),
    left: 0,
    right: 1_000,
    width: 1_000,
    height: placeholderHeight(),
    x: 0,
    y: 10_000,
    toJSON() {
      return {};
    },
  });
  Object.defineProperty(root, 'scrollHeight', {
    get: () => 10_000 + placeholderHeight(),
  });

  const virtualizer = new Virtualizer();
  const options = { disableFileHeader: true };
  const metrics = {
    ...DEFAULT_VIRTUAL_FILE_METRICS,
    lineHeight: 20,
    paddingTop: 0,
    paddingBottom: 0,
  };
  const instance =
    kind === 'file'
      ? new TestVirtualizedFile(options, virtualizer, metrics)
      : new TestVirtualizedFileDiff(options, virtualizer, metrics);
  const onRender = spyOn(instance, 'onRender');
  const consoleError = spyOn(console, 'error').mockImplementation(() => {});

  return {
    ...harness,
    container,
    instance,
    onRender,
    consoleError,
    placeholderHeight,
    mount() {
      virtualizer.setup(root, content);
      // Both fixtures have three 20px rows. The diff ends with a newline to
      // avoid an extra "no newline" metadata row; the file omits a trailing
      // newline to avoid an extra empty editor line.
      const file = { name: 'offscreen.txt', contents: 'first\nsecond\nthird' };
      if (instance instanceof TestVirtualizedFile) {
        instance.render({ file, fileContainer: container });
      } else {
        instance.render({
          fileDiff: parseDiffFromFile(null, {
            ...file,
            contents: `${file.contents}\n`,
          }),
          fileContainer: container,
        });
      }
      harness.dom.triggerIntersectionObserver(container, false);
    },
    cleanup() {
      try {
        instance.cleanUp();
        virtualizer.cleanUp();
        // Verify production teardown cancels the queued work before the DOM
        // harness clears the shared render queue on our behalf.
        expect(harness.frames.size).toBe(0);
        expect(consoleError).not.toHaveBeenCalled();
      } finally {
        onRender.mockRestore();
        consoleError.mockRestore();
        harness.dom.cleanup();
      }
    },
  };
}

test('an empty virtualizer settles with the controlled frame queue', () => {
  const harness = installFrameHarness();
  const virtualizer = new Virtualizer();
  try {
    virtualizer.setup(createRoot());
    expect(harness.flushFrames(10)).toBeGreaterThan(0);
    expect(harness.frames.size).toBe(0);
    expect(harness.flushFrames(10)).toBe(0);
  } finally {
    virtualizer.cleanUp();
    harness.dom.cleanup();
  }
});

describe.each(['file', 'diff'] as const)(
  'off-screen %s placeholder',
  (kind) => {
    let fixture: ReturnType<typeof createOffscreenFixture>;

    beforeEach(() => {
      fixture = createOffscreenFixture(kind);
      fixture.mount();
      expect(
        fixture.container.shadowRoot?.querySelector('[data-placeholder]')
      ).not.toBeNull();
      expect(fixture.instance.getRenderedContentForTest()).toBeUndefined();
      expect(fixture.instance.height).toBe(60);
      expect(fixture.placeholderHeight()).toBe(60);
    });

    afterEach(() => {
      fixture.cleanup();
    });

    test('settles without scheduling more frames for unchanged content', () => {
      // Allow follow-up layout passes without coupling the test to their exact
      // count. The regression keeps one frame pending indefinitely.
      fixture.flushFrames(10);
      expect(fixture.onRender).toHaveBeenCalled();
      expect(fixture.consoleError).not.toHaveBeenCalled();
      expect(fixture.frames.size).toBe(0);

      const renderCount = fixture.onRender.mock.calls.length;
      expect(fixture.flushFrames(10)).toBe(0);
      expect(fixture.onRender).toHaveBeenCalledTimes(renderCount);
      expect(fixture.instance.getRenderedContentForTest()).toBeUndefined();
    });

    test('preserves estimated height through placeholder reconciliation', () => {
      fixture.flushFrames(10);
      expect(fixture.onRender).toHaveBeenCalled();
      expect(fixture.consoleError).not.toHaveBeenCalled();
      expect(fixture.instance.getRenderedContentForTest()).toBeUndefined();
      expect({
        instanceHeight: fixture.instance.height,
        placeholderHeight: fixture.placeholderHeight(),
      }).toEqual({ instanceHeight: 60, placeholderHeight: 60 });
    });
  }
);
