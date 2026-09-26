import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import { VirtualizedFile } from '../src/components/VirtualizedFile';
import { VirtualizedFileDiff } from '../src/components/VirtualizedFileDiff';
import { Virtualizer } from '../src/components/Virtualizer';
import { DEFAULT_VIRTUAL_FILE_METRICS } from '../src/constants';
import { Editor } from '../src/editor/editor';
import type { EditorType } from '../src/editor/types';
import type { DiffLineAnnotation, LineAnnotation } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { createRoot, installDom, wait, waitFor } from './domHarness';

class TestVirtualizedFile extends VirtualizedFile<string> {
  getAnnotationsForTest() {
    return this.getLatestAnnotations();
  }

  getRenderedContentForTest() {
    return this.getRenderedFile();
  }
}

class TestVirtualizedFileDiff extends VirtualizedFileDiff<string> {
  getAnnotationsForTest() {
    return this.getLatestAnnotations();
  }

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

// Start beyond the real virtualizer's visibility margin, then move with the
// scroll container. Row measurements are supplied because jsdom has no layout.
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
    top: 10_000 - root.scrollTop,
    bottom: 10_000 - root.scrollTop + instance.height,
    left: 0,
    right: 1_000,
    width: 1_000,
    height: instance.height,
    x: 0,
    y: 10_000 - root.scrollTop,
    toJSON() {
      return {};
    },
  });
  Object.defineProperty(root, 'scrollHeight', {
    value: 20_000,
  });

  const virtualizer = new Virtualizer();
  const options = {
    disableFileHeader: true,
    renderAnnotation: (annotation: LineAnnotation<string>) => {
      const node = document.createElement('span');
      node.textContent = annotation.metadata;
      return node;
    },
    // jsdom cannot measure rows or slotted annotations. Supply their geometry
    // after each content render using the current line height and 12px notes.
    onPostRender: (node: HTMLElement) => {
      for (const row of node.shadowRoot?.querySelectorAll<HTMLElement>(
        '[data-line], [data-line-annotation]'
      ) ?? []) {
        const height = row.hasAttribute('data-line') ? metrics.lineHeight : 12;
        row.getBoundingClientRect = () => ({
          top: 0,
          bottom: height,
          left: 0,
          right: 1_000,
          width: 1_000,
          height,
          x: 0,
          y: 0,
          toJSON() {
            return {};
          },
        });
      }
    },
  };
  let metrics = {
    ...DEFAULT_VIRTUAL_FILE_METRICS,
    lineHeight: 20,
    paddingTop: 0,
    paddingBottom: 0,
  };
  let layoutOptions: { collapsed?: boolean; diffStyle?: 'split' | 'unified' } =
    {};
  const createInstance = () =>
    kind === 'file'
      ? new TestVirtualizedFile(
          { ...options, ...layoutOptions },
          virtualizer,
          metrics
        )
      : new TestVirtualizedFileDiff(
          { ...options, ...layoutOptions },
          virtualizer,
          metrics
        );
  let instance = createInstance();
  // Scroll anchoring uses offsetHeight as well as the bounding rectangle.
  Object.defineProperty(container, 'offsetHeight', {
    get: () => instance.height,
  });
  let onRender = spyOn(instance, 'onRender');
  const consoleError = spyOn(console, 'error').mockImplementation(() => {});

  // The file omits a final empty editor line; the diff includes a final
  // newline so it has no extra "no newline" metadata row. Both initially have
  // three rows.
  let file = { name: 'offscreen.txt', contents: 'first\nsecond\nthird' };
  let fileDiff = parseDiffFromFile(null, {
    ...file,
    contents: `${file.contents}\n`,
  });
  const render = (lineAnnotations?: DiffLineAnnotation<string>[]) => {
    if (instance instanceof TestVirtualizedFile) {
      instance.render({ file, fileContainer: container, lineAnnotations });
    } else {
      instance.render({ fileDiff, fileContainer: container, lineAnnotations });
    }
  };
  const expectHidden = (height: number) => {
    harness.flushFrames(10);
    expect(harness.frames.size).toBe(0);
    expect(placeholderHeight()).toBe(height);
    expect(instance.height).toBe(height);
    expect(
      container.shadowRoot?.querySelector('[data-placeholder]')
    ).not.toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
    expect(harness.flushFrames(10)).toBe(0);
  };

  return {
    ...harness,
    container,
    virtualizer,
    get instance() {
      return instance;
    },
    get onRender() {
      return onRender;
    },
    consoleError,
    placeholderHeight,
    render,
    expectHidden,
    mount() {
      virtualizer.setup(root, content);
      render();
      harness.dom.triggerIntersectionObserver(container, false);
    },
    // A content render can wait for highlighter startup. Wait for its DOM before
    // checking idle frames, rather than treating an empty queue as completion.
    async show(expectedText: string) {
      virtualizer.scrollTo({ top: 10_000 });
      harness.dom.triggerIntersectionObserver(container, true);
      await waitFor(() => {
        harness.flushFrames(10);
        return (
          container.shadowRoot?.querySelector('[data-line]') != null &&
          (container.shadowRoot
            .querySelector('pre')
            ?.textContent?.includes(expectedText) ??
            false)
        );
      });
      expect(
        container.shadowRoot?.querySelector('[data-placeholder]')
      ).toBeNull();
      expect(container.shadowRoot?.querySelector('pre')?.textContent).toContain(
        expectedText
      );
      expect(instance.getRenderedContentForTest()).toBeDefined();
      await wait(0);
      harness.flushFrames(10);
      expect(consoleError).not.toHaveBeenCalled();
      expect(harness.frames.size).toBe(0);
      expect(harness.flushFrames(10)).toBe(0);
    },
    hide() {
      // Keep the scroll window unchanged to catch stale render-range reuse.
      harness.dom.triggerIntersectionObserver(container, false);
      harness.flushFrames(10);
    },
    replaceContents(contents: string, oldContents?: string) {
      file = { ...file, contents };
      fileDiff = parseDiffFromFile(
        oldContents == null ? null : { ...file, contents: `${oldContents}\n` },
        { ...file, contents: `${contents}\n` }
      );
      render();
    },
    setLineHeight(lineHeight: number) {
      metrics = { ...metrics, lineHeight };
      instance.setMetrics(metrics);
      render();
    },
    setLayout(next: typeof layoutOptions) {
      layoutOptions = { ...layoutOptions, ...next };
      instance.setOptions({ ...options, ...layoutOptions });
      render();
    },
    remount() {
      instance.cleanUp();
      onRender.mockRestore();
      instance = createInstance();
      onRender = spyOn(instance, 'onRender');
      render();
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

    test('renders on first visibility and after hiding with the same window', async () => {
      fixture.expectHidden(60);
      await fixture.show('first');
      expect(fixture.instance.height).toBe(60);
      fixture.hide();
      fixture.expectHidden(60);
      await fixture.show('third');
      expect(fixture.instance.height).toBe(60);
    });

    test('accepts replacement content while hidden and displays it on entry', async () => {
      fixture.expectHidden(60);
      fixture.replaceContents('replacement one\nreplacement two');
      // The hidden data-change path may render content before returning to a
      // placeholder, so let highlighter readiness complete before checking it.
      await waitFor(() => {
        fixture.flushFrames(10);
        return fixture.instance.getRenderedContentForTest() != null;
      });
      expect(fixture.instance.getRenderedContentForTest()).toBeDefined();
      fixture.expectHidden(40);
      await fixture.show('replacement two');
      expect(fixture.container.shadowRoot?.textContent).not.toContain('first');
      expect(fixture.instance.height).toBe(40);
    });

    test('accepts annotation-only updates while retaining the same file', async () => {
      fixture.expectHidden(60);
      const annotations: DiffLineAnnotation<string>[] = [
        { side: 'additions', lineNumber: 2, metadata: 'latest note' },
      ];
      fixture.render(annotations);
      fixture.expectHidden(60);
      fixture.render(annotations);
      fixture.expectHidden(60);
      expect(fixture.instance.getAnnotationsForTest()).toBe(annotations);
      await fixture.show('second');
      expect(fixture.container.textContent).toContain('latest note');
      expect(
        fixture.container.shadowRoot?.querySelector('[data-line-annotation]')
      ).not.toBeNull();
      expect(fixture.instance.height).toBe(72);
      fixture.hide();
      fixture.expectHidden(72);
    });

    test('recomputes hidden metrics and collapse state before first visibility', async () => {
      fixture.expectHidden(60);
      fixture.setLineHeight(30);
      fixture.expectHidden(90);
      fixture.setLayout({ collapsed: true });
      fixture.expectHidden(0);
      fixture.setLayout({ collapsed: false });
      fixture.expectHidden(90);
      await fixture.show('third');
      expect(fixture.instance.height).toBe(90);
    });

    test('settles after remounting a hidden instance following a layout change', async () => {
      fixture.expectHidden(60);
      const previous = fixture.instance;
      fixture.setLineHeight(30);
      fixture.remount();
      expect(fixture.instance).not.toBe(previous);
      expect(fixture.instance.getRenderedContentForTest()).toBeUndefined();
      fixture.expectHidden(90);
      await fixture.show('first');
      expect(fixture.instance.height).toBe(90);
    });

    if (kind === 'diff') {
      test('updates placeholder height for split and unified rows', async () => {
        fixture.replaceContents(
          'new one\nnew two\nnew three',
          'old one\nold two\nold three'
        );
        await waitFor(() => {
          fixture.flushFrames(10);
          return fixture.instance.getRenderedContentForTest() != null;
        });
        expect(fixture.instance.getRenderedContentForTest()).toBeDefined();
        fixture.expectHidden(60);
        fixture.setLayout({ diffStyle: 'unified' });
        fixture.expectHidden(120);
        fixture.remount();
        fixture.expectHidden(120);
        await fixture.show('new three');
        expect(fixture.container.shadowRoot?.textContent).toContain(
          'old three'
        );
        expect(fixture.instance.height).toBe(120);
      });
    }
  }
);

// Model a following item's DOM position from the preceding item's rendered
// height. Reading the following instance's cached top then checks that the
// virtualizer notices height changes and updates downstream layout.
function createFollowingFile(
  fixture: ReturnType<typeof createOffscreenFixture>
) {
  const container = document.createElement('diffs-container');
  fixture.container.after(container);
  const instance = new VirtualizedFile(
    { disableFileHeader: true },
    fixture.virtualizer
  );
  container.getBoundingClientRect = () => {
    const previous = fixture.container.getBoundingClientRect();
    const placeholder =
      fixture.container.shadowRoot?.querySelector<HTMLElement>(
        '[data-placeholder]'
      );
    const top =
      previous.top +
      (placeholder == null
        ? previous.height
        : parseFloat(placeholder.style.height));
    return {
      x: previous.x,
      left: previous.left,
      right: previous.right,
      width: previous.width,
      top,
      y: top,
      bottom: top + instance.height,
      height: instance.height,
      toJSON() {
        return {};
      },
    };
  };
  Object.defineProperty(container, 'offsetHeight', {
    get: () => instance.height,
  });
  instance.render({
    file: { name: 'following.txt', contents: 'following item' },
    fileContainer: container,
  });
  fixture.dom.triggerIntersectionObserver(container, true);
  return { instance, container };
}

describe.each(['file', 'split', 'unified'] as const)(
  'off-screen %s prediction',
  (surface) => {
    test.each([false, true])(
      'removes dismissed ghost rows from the placeholder (wrapperDirty=%s)',
      async (wrapperDirty) => {
        const fixture = createOffscreenFixture(
          surface === 'file' ? 'file' : 'diff'
        );
        const anchor = { line: 1, character: 'second'.length };
        const editor = new Editor<EditorType, string>(
          surface === 'file' ? 'file' : 'file-diff',
          {
            editPrediction: {
              provider: {
                predict() {
                  return Promise.resolve({
                    edits: [
                      {
                        range: { start: anchor, end: anchor },
                        newText: '\nghostOne();\nghostTwo();',
                      },
                    ],
                    newCursor: { line: 3, character: 'ghostTwo();'.length },
                  });
                },
              },
            },
          }
        );
        let following: ReturnType<typeof createFollowingFile> | undefined;
        try {
          fixture.mount();
          if (surface !== 'file') {
            fixture.setLayout({ diffStyle: surface });
            fixture.replaceContents(
              'first\nsecond\nthird',
              'first\nbefore\nthird'
            );
          }
          await fixture.show('second');
          editor.edit(fixture.instance);
          const hasEditableContent = () =>
            Array.from(
              fixture.container.shadowRoot?.querySelectorAll<HTMLElement>(
                '[data-content]'
              ) ?? []
            ).some(
              (element) =>
                element.contentEditable === 'true' ||
                element.getAttribute('contenteditable') === 'true'
            );
          await waitFor(() => {
            fixture.flushFrames(10);
            return hasEditableContent();
          });
          expect(hasEditableContent()).toBe(true);
          following = createFollowingFile(fixture);
          await wait(0);
          fixture.flushFrames(10);
          const baselineHeight = fixture.instance.height;
          const baselineTop = 10_000 + baselineHeight;
          expect(following.instance.top).toBe(baselineTop);

          editor.setSelections([
            { start: anchor, end: anchor, direction: 'none' },
          ]);
          await waitFor(
            () => {
              fixture.flushFrames(10);
              return editor.__getGhostTextRows().size > 0;
            },
            { timeout: 2_000 }
          );
          expect(editor.__getGhostTextRows()).toEqual(new Map([[1, 2]]));
          expect(fixture.instance.height).toBe(baselineHeight + 40);
          expect(following.instance.top).toBe(baselineTop + 40);

          fixture.virtualizer.scrollTo({ top: 0 });
          fixture.hide();
          fixture.dom.triggerIntersectionObserver(following.container, false);
          fixture.expectHidden(baselineHeight + 40);

          if (wrapperDirty) {
            // A pending full repaint paints the placeholder before this pass
            // reconciles it. The repaint must not leave the old height behind.
            fixture.virtualizer.markDOMDirty();
          }
          editor.setOptions({ editPrediction: undefined });
          expect(editor.__getGhostTextRows().size).toBe(0);
          expect(fixture.frames.size).toBeGreaterThan(0);
          fixture.flushFrames(10);
          expect(fixture.consoleError).not.toHaveBeenCalled();
          expect(fixture.frames.size).toBe(0);
          expect(fixture.flushFrames(10)).toBe(0);
          expect({
            instanceHeight: fixture.instance.height,
            placeholderHeight: fixture.placeholderHeight(),
          }).toEqual({
            instanceHeight: baselineHeight,
            placeholderHeight: baselineHeight,
          });
          // After a placeholder resizes, following items reposition from the
          // content ResizeObserver, which jsdom does not provide. The clean-pass
          // variant checks the virtualizer's own change notification instead.
          if (!wrapperDirty) {
            expect(following.instance.top).toBe(baselineTop);
          }
        } finally {
          editor.cleanUp();
          following?.instance.cleanUp();
          fixture.cleanup();
        }
      }
    );
  }
);
